import { HttpError } from './auth.js';
import { isWorkDay, today as todayJalali } from './calendar.js';
import { attachFiles, publicFile, removeFiles } from './files.js';
import { onlineUserIds, publish } from './live.js';
import { managersOf, notify } from './notify.js';
import { canManageUser, toTask } from './tasks.js';
import { addDaysJalali, addMonthsJalali, dateToJalali, diffDays, monthLength, normalizeJalali, pad } from '../shared/jalali.js';
import { isOverdue, OPEN_STATUSES, STATUSES, taskTone } from '../shared/status.js';

const isBoss = (user) => user.role === 'ceo' || user.role === 'admin';

// Only employees and supervisors send daily reports; the CEO and admins do not.
export const reportsRequired = (user) => Boolean(user.active) && (user.role === 'employee' || user.role === 'supervisor');

// Nobody is expected to report for days before their account existed.
const joinedOn = (user) => dateToJalali(new Date(user.created_at));

// The people a manager reports on: active staff, limited to a supervisor's department.
// withTaskOwners: also the CEO/admins who have tasks assigned to them, and deactivated people who still hold open
// tasks, so task reports cover all work that is still out there.
export function staffFor(db, viewer, { withTaskOwners = false } = {}) {
  const rows = db.all(
    `SELECT u.*, d.name AS department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE (u.active = 1 AND (u.role IN ('employee', 'supervisor')
         OR (? AND EXISTS (SELECT 1 FROM tasks t WHERE t.assignee_id = u.id AND t.is_private = 0 AND t.status != 'cancelled'))))
       OR (? AND u.active = 0 AND EXISTS (SELECT 1 FROM tasks t WHERE t.assignee_id = u.id AND t.is_private = 0 AND t.status IN (${OPEN_STATUSES.map(() => '?').join(',')})))
     ORDER BY d.sort_order, d.name, u.full_name`,
    [withTaskOwners ? 1 : 0, withTaskOwners ? 1 : 0, ...OPEN_STATUSES]
  );
  if (isBoss(viewer)) return rows;
  if (viewer.role === 'supervisor') return rows.filter((u) => u.id === viewer.id || (u.department_id && u.department_id === viewer.department_id));
  return rows.filter((u) => u.id === viewer.id);
}

const personInfo = (u) => ({ id: u.id, fullName: u.full_name, title: u.title || '', role: u.role, active: Boolean(u.active), departmentId: u.department_id, departmentName: u.department_name || '' });

const placeholders = (list) => list.map(() => '?').join(',') || 'NULL';

// Daily reports ---------------------------------------------------------------------------
function toReport(db, row) {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    doneText: row.done_text || '',
    issuesText: row.issues_text || '',
    planText: row.plan_text || '',
    lat: row.lat,
    lng: row.lng,
    managerNote: row.manager_note || '',
    seenBy: row.seen_by,
    seenByName: row.seen_by_name || '',
    seenAt: row.seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    files: db.all('SELECT * FROM files WHERE report_id = ? ORDER BY id', [row.id]).map((f) => publicFile(db, f))
  };
}

const REPORT_SELECT = 'SELECT r.*, s.full_name AS seen_by_name FROM daily_reports r LEFT JOIN users s ON s.id = r.seen_by';

export function myReports(db, user, limit = 40) {
  return db.all(`${REPORT_SELECT} WHERE r.user_id = ? ORDER BY r.date DESC LIMIT ?`, [user.id, limit]).map((r) => toReport(db, r));
}

export function reportsForDate(db, viewer, date) {
  const day = normalizeJalali(date || '') || todayJalali();
  const staff = staffFor(db, viewer);
  const rows = db.all(`${REPORT_SELECT} WHERE r.date = ? AND r.user_id IN (${placeholders(staff)})`, [day, ...staff.map((u) => u.id)]);
  const byUser = new Map(rows.map((r) => [r.user_id, toReport(db, r)]));
  return {
    date: day,
    workDay: isWorkDay(db.settings(), day),
    people: staff.filter((u) => joinedOn(u) <= day || byUser.has(u.id)).map((u) => ({ ...personInfo(u), report: byUser.get(u.id) || null }))
  };
}

export function saveReport(db, user, body) {
  const today = todayJalali();
  const date = normalizeJalali(body.date || '') || today;
  // Yesterday's report may still be sent in the morning; older days are closed.
  if (date !== today && date !== addDaysJalali(today, -1)) throw new HttpError(422, 'گزارش فقط برای امروز یا دیروز ثبت می‌شود.');
  const done = String(body.doneText || '').trim().slice(0, 5000);
  const issues = String(body.issuesText || '').trim().slice(0, 3000);
  const plan = String(body.planText || '').trim().slice(0, 3000);
  if (!done) throw new HttpError(422, 'بنویسید امروز چه کارهایی انجام دادید.');
  const lat = body.lat === null || body.lat === undefined || body.lat === '' ? null : Number(body.lat);
  const lng = lat === null ? null : Number(body.lng);
  const now = new Date().toISOString();
  const existing = db.get('SELECT * FROM daily_reports WHERE user_id = ? AND date = ?', [user.id, date]);
  const id = db.transaction(() => {
    let reportId;
    if (existing) {
      db.run(`UPDATE daily_reports SET done_text = ?, issues_text = ?, plan_text = ?, lat = COALESCE(?, lat), lng = COALESCE(?, lng),
                updated_at = ? WHERE id = ?`, [done, issues, plan, lat, lng, now, existing.id]);
      reportId = existing.id;
    } else {
      reportId = db.run(
        `INSERT INTO daily_reports (user_id, date, done_text, issues_text, plan_text, lat, lng, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [user.id, date, done, issues, plan, lat, lng, now, now]
      ).lastId;
    }
    attachFiles(db, user.id, body.fileIds, { reportId });
    if (body.removeFileIds?.length) {
      removeFiles(db, db.all(`SELECT * FROM files WHERE report_id = ? AND id IN (${placeholders(body.removeFileIds)})`, [reportId, ...body.removeFileIds.map(Number)]));
    }
    return reportId;
  });
  const managers = managersOf(db, user.id);
  if (issues && issues !== (existing?.issues_text || '')) {
    notify(db, managers, { type: 'report_issue', title: `مشکل در گزارش روزانه ${user.full_name}`, body: issues.slice(0, 160), link: `/daily?date=${date}` });
  }
  publish([user.id, ...managers], { type: 'report', id, date });
  return id;
}

export function reviewReport(db, viewer, id, note) {
  const row = db.get('SELECT * FROM daily_reports WHERE id = ?', [Number(id)]);
  if (!row || !canManageUser(db, viewer, row.user_id) || row.user_id === viewer.id) throw new HttpError(404, 'گزارش پیدا نشد.');
  const text = note === undefined ? row.manager_note : String(note || '').trim().slice(0, 2000);
  db.run('UPDATE daily_reports SET manager_note = ?, seen_by = ?, seen_at = ? WHERE id = ?', [text, viewer.id, new Date().toISOString(), row.id]);
  if (note && text !== (row.manager_note || '')) {
    notify(db, [row.user_id], { type: 'report_note', title: `${viewer.full_name} روی گزارش ${row.date} نظر داد`, body: text.slice(0, 160), link: '/daily' });
  }
  publish([row.user_id, ...managersOf(db, row.user_id)], { type: 'report', id: row.id, date: row.date });
}

// Task reports ---------------------------------------------------------------------------
function visibleTasks(db, staffIds, extraWhere = '1 = 1', params = []) {
  if (!staffIds.length) return [];
  return db.all(
    `SELECT t.*, a.full_name AS assignee_name, a.department_id AS assignee_department, c.full_name AS creator_name,
       0 AS check_total, 0 AS check_done, 0 AS comment_count, 0 AS file_count
     FROM tasks t JOIN users a ON a.id = t.assignee_id LEFT JOIN users c ON c.id = t.created_by
     WHERE t.assignee_id IN (${placeholders(staffIds)}) AND t.is_private = 0 AND ${extraWhere}`,
    [...staffIds, ...params]
  );
}

export function overdueReport(db, viewer) {
  const staff = staffFor(db, viewer, { withTaskOwners: true });
  const now = new Date();
  const rows = visibleTasks(db, staff.map((u) => u.id), `t.status IN (${placeholders(OPEN_STATUSES)}) AND t.due_date IS NOT NULL AND t.due_date <= ?`, [...OPEN_STATUSES, todayJalali(now)])
    .filter((row) => isOverdue(row, now))
    .map((row) => toTask(row, now))
    .sort((a, b) => b.lateDays - a.lateDays || b.priority - a.priority);
  const byPerson = staff.map((u) => {
    const tasks = rows.filter((t) => t.assigneeId === u.id);
    return { ...personInfo(u), count: tasks.length, maxLate: Math.max(0, ...tasks.map((t) => t.lateDays)), tasks };
  }).filter((p) => p.count).sort((a, b) => b.count - a.count || b.maxLate - a.maxLate);
  return { total: rows.length, people: byPerson };
}

export function staffStatus(db, viewer) {
  const staff = staffFor(db, viewer, { withTaskOwners: true });
  const now = new Date();
  const today = todayJalali(now);
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const tasks = visibleTasks(db, staff.map((u) => u.id), "(t.status != 'cancelled')");
  const reports = new Map(db.all(
    `SELECT user_id, MAX(date) AS last_date, SUM(date = ?) AS today_count FROM daily_reports
     WHERE user_id IN (${placeholders(staff)}) GROUP BY user_id`, [today, ...staff.map((u) => u.id)]
  ).map((r) => [r.user_id, r]));
  const online = new Set(onlineUserIds());
  const people = staff.map((u) => {
    const mine = tasks.filter((t) => t.assignee_id === u.id);
    const tones = mine.map((t) => taskTone(t, now));
    const report = reports.get(u.id);
    return {
      ...personInfo(u),
      open: mine.filter((t) => STATUSES[t.status].open).length,
      todo: mine.filter((t) => t.status === 'todo').length,
      overdue: tones.filter((t) => t === 'overdue').length,
      soon: tones.filter((t) => t === 'soon').length,
      review: mine.filter((t) => t.status === 'review').length,
      blocked: mine.filter((t) => t.status === 'blocked').length,
      doneWeek: mine.filter((t) => t.status === 'done' && t.done_at >= weekAgo).length,
      // One colour per task, as on the board, for the stacked workload chart.
      bars: {
        overdue: tones.filter((t) => t === 'overdue').length,
        soon: tones.filter((t) => t === 'soon').length,
        blocked: tones.filter((t) => t === 'blocked' || t === 'returned').length,
        open: tones.filter((t) => t === 'doing' || t === 'todo').length,
        review: tones.filter((t) => t === 'review').length
      },
      reportsRequired: reportsRequired(u),
      reportToday: Boolean(report?.today_count),
      lastReport: report?.last_date || null,
      lastSeenAt: u.last_seen_at,
      online: online.has(u.id)
    };
  });
  const sum = (key) => people.reduce((acc, p) => acc + (typeof p[key] === 'boolean' ? Number(p[key]) : p[key]), 0);
  return {
    date: today,
    workDay: isWorkDay(db.settings(), today),
    totals: { people: people.length, reporters: people.filter((p) => p.reportsRequired).length, open: sum('open'), todo: sum('todo'), overdue: sum('overdue'), review: sum('review'), blocked: sum('blocked'), doneWeek: sum('doneWeek'), reportToday: sum('reportToday') },
    people
  };
}

// Monthly scorecard ---------------------------------------------------------------------
const monthBounds = (month) => {
  const [y, m] = month.split('/').map(Number);
  return { from: `${y}/${pad(m)}/01`, to: `${y}/${pad(m)}/${pad(monthLength(y, m))}` };
};

function workDaysBetween(settings, from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDaysJalali(d, 1)) if (isWorkDay(settings, d)) days.push(d);
  return days;
}

// Score out of 100: 60 for on-time delivery, 25 for daily-report discipline, 15 for work accepted without returns.
function scoreFor(tasks, reportDates, settings, from, to, now, { reports = true, joined = '' } = {}) {
  const today = todayJalali(now);
  const end = to < today ? to : today;
  const inRange = tasks.filter((t) => t.due_date && t.due_date >= from && t.due_date <= end && t.status !== 'cancelled');
  const submittedDay = (t) => (t.submitted_at ? dateToJalali(new Date(t.submitted_at)) : null);
  let onTime = 0; let lateDone = 0; let openLate = 0; let openOnTrack = 0; const delays = [];
  inRange.forEach((t) => {
    const sent = submittedDay(t);
    if (sent && !STATUSES[t.status].open) {
      if (sent <= t.due_date) onTime += 1;
      else { lateDone += 1; delays.push(diffDays(t.due_date, sent)); }
    } else if (isOverdue(t, now)) {
      openLate += 1;
      delays.push(Math.max(0, diffDays(t.due_date, today)));
    } else {
      // Due today and not yet late: not counted against anyone.
      openOnTrack += 1;
    }
  });
  const judged = onTime + lateDone + openLate;
  const returns = inRange.reduce((acc, t) => acc + t.return_count, 0);
  // Today's report counts only once it exists, so the morning never looks like a missed day.
  const expected = reports ? workDaysBetween(settings, from > joined ? from : joined, end).filter((d) => d < today || reportDates.has(d)) : [];
  const submitted = expected.filter((d) => reportDates.has(d)).length;
  const onTimeRate = judged ? onTime / judged : null;
  const reportRate = expected.length ? submitted / expected.length : null;
  const returnRate = judged ? Math.min(1, returns / judged) : 0;
  let score = null;
  // A month with no due work and no reports at all (e.g. before the person joined) has no score.
  if (!judged && !submitted) score = null;
  else if (onTimeRate !== null) score = 60 * onTimeRate + 25 * (reportRate ?? 1) + 15 * (1 - returnRate);
  else if (reportRate !== null) score = 100 * reportRate;
  return {
    due: judged,
    onTime,
    lateDone,
    openLate,
    openOnTrack,
    onTimeRate: onTimeRate === null ? null : Math.round(onTimeRate * 1000) / 10,
    avgDelay: delays.length ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10 : 0,
    returns,
    reportsExpected: expected.length,
    reportsSubmitted: submitted,
    reportRate: reportRate === null ? null : Math.round(reportRate * 1000) / 10,
    completed: tasks.filter((t) => t.status === 'done' && t.done_at && dateToJalali(new Date(t.done_at)) >= from && dateToJalali(new Date(t.done_at)) <= to).length,
    score: score === null ? null : Math.round(score)
  };
}

export function scorecard(db, viewer, month) {
  const now = new Date();
  const current = todayJalali(now).slice(0, 7);
  const target = /^\d{4}\/\d{2}$/.test(month || '') ? month : current;
  const months = [-5, -4, -3, -2, -1, 0].map((k) => addMonthsJalali(`${target}/01`, k).slice(0, 7));
  const first = monthBounds(months[0]).from;
  const last = monthBounds(target).to;
  const staff = staffFor(db, viewer, { withTaskOwners: true });
  const ids = staff.map((u) => u.id);
  const tasks = visibleTasks(db, ids, "((t.due_date >= ? AND t.due_date <= ?) OR t.done_at >= ?)", [first, last, new Date(now.getTime() - 220 * 86400000).toISOString()]);
  const reports = db.all(`SELECT user_id, date FROM daily_reports WHERE user_id IN (${placeholders(ids)}) AND date >= ? AND date <= ?`, [...ids, first, last]);
  const settings = db.settings();
  const people = staff.map((u) => {
    const mine = tasks.filter((t) => t.assignee_id === u.id);
    const dates = new Set(reports.filter((r) => r.user_id === u.id).map((r) => r.date));
    const { from, to } = monthBounds(target);
    const trend = months.map((m) => {
      const b = monthBounds(m);
      return { month: m, score: b.from > todayJalali(now) ? null : scoreFor(mine, dates, settings, b.from, b.to, now, { reports: reportsRequired(u), joined: joinedOn(u) }).score };
    });
    return { ...personInfo(u), ...scoreFor(mine, dates, settings, from, to, now, { reports: reportsRequired(u), joined: joinedOn(u) }), trend };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return { month: target, months, people };
}

// One-line summary for the CEO's morning notification.
export function digestFor(db, viewer) {
  const status = staffStatus(db, viewer);
  const yesterday = addDaysJalali(todayJalali(), -1);
  let missing = [];
  if (isWorkDay(db.settings(), yesterday)) {
    missing = reportsForDate(db, viewer, yesterday).people.filter((p) => !p.report).map((p) => p.fullName);
  }
  const parts = [
    `${status.totals.overdue} کار معوقه`,
    `${status.totals.review} منتظر تأیید`,
    status.totals.blocked ? `${status.totals.blocked} متوقف` : null,
    missing.length ? `${missing.length} نفر بدون گزارش دیروز` : null
  ].filter(Boolean);
  return { ...status.totals, missingYesterday: missing, text: parts.join('، ') };
}

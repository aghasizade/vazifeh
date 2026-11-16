import { HttpError } from './auth.js';
import { recurrenceMatches, today as todayJalali } from './calendar.js';
import { canManageUser, cleanTaskInput, createTasks } from './tasks.js';
import { addDaysJalali, normalizeJalali } from '../shared/jalali.js';

export const KINDS = { daily: 'هر روز کاری', weekly: 'روزهای مشخص هفته', monthly: 'یک روز مشخص از ماه' };

function cleanRule(body) {
  const kind = String(body.kind || '');
  if (!KINDS[kind]) throw new HttpError(422, 'نوع تکرار معتبر نیست.');
  const weekdays = kind === 'weekly' ? [...new Set((body.weekdays || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort() : [];
  if (kind === 'weekly' && !weekdays.length) throw new HttpError(422, 'حداقل یک روز هفته را انتخاب کنید.');
  const monthDay = kind === 'monthly' ? Number(body.monthDay) : null;
  if (kind === 'monthly' && !(monthDay >= 1 && monthDay <= 31)) throw new HttpError(422, 'روز ماه باید بین ۱ تا ۳۱ باشد.');
  const dueOffset = Math.max(0, Math.min(60, Math.round(Number(body.dueOffset) || 0)));
  const startDate = normalizeJalali(body.startDate || '') || todayJalali();
  const endDate = body.endDate ? normalizeJalali(body.endDate) : null;
  if (body.endDate && !endDate) throw new HttpError(422, 'تاریخ پایان تکرار معتبر نیست.');
  if (endDate && endDate < startDate) throw new HttpError(422, 'تاریخ پایان تکرار قبل از شروع آن است.');
  return { kind, weekdays: JSON.stringify(weekdays), month_day: monthDay, due_offset: dueOffset, start_date: startDate, end_date: endDate };
}

const toRecurrence = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description || '',
  assigneeId: row.assignee_id,
  assigneeName: row.assignee_name,
  priority: row.priority,
  tag: row.tag || '',
  checklist: JSON.parse(row.checklist || '[]'),
  kind: row.kind,
  weekdays: JSON.parse(row.weekdays || '[]'),
  monthDay: row.month_day,
  dueOffset: row.due_offset,
  dueTime: row.due_time,
  startDate: row.start_date,
  endDate: row.end_date,
  lastGenerated: row.last_generated,
  active: Boolean(row.active),
  createdBy: row.created_by,
  creatorName: row.creator_name,
  generated: row.generated,
  nextDate: row.next_date
});

export function listRecurrences(db, user) {
  const rows = db.all(
    `SELECT r.*, a.full_name AS assignee_name, a.department_id, c.full_name AS creator_name,
       (SELECT COUNT(*) FROM tasks t WHERE t.recurrence_id = r.id) AS generated
     FROM recurrences r JOIN users a ON a.id = r.assignee_id LEFT JOIN users c ON c.id = r.created_by
     ORDER BY r.active DESC, r.id DESC`
  );
  const settings = db.settings();
  // The next day a new task will be made (tomorrow onwards if today's is already done).
  const from = (row) => (row.last_generated && row.last_generated >= todayJalali() ? addDaysJalali(todayJalali(), 1) : todayJalali());
  return rows.filter((row) => canManageUser(db, user, row.assignee_id))
    .map((row) => toRecurrence({ ...row, next_date: row.active ? nextOccurrence(row, from(row), settings) : null }));
}

export function createRecurrences(db, user, body, { isDemo = false } = {}) {
  const input = cleanTaskInput(body);
  const rule = cleanRule(body.recurrence || {});
  const assigneeIds = [...new Set((body.assigneeIds || []).map(Number))];
  if (!assigneeIds.length) throw new HttpError(422, 'مسئول تسک تکراری را انتخاب کنید.');
  assigneeIds.forEach((id) => {
    if (!canManageUser(db, user, id)) throw new HttpError(403, 'تسک تکراری را فقط مدیر برای پرسنل خودش تعریف می‌کند.');
  });
  const checklist = JSON.stringify((body.checklist || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 50));
  const now = new Date().toISOString();
  const ids = db.transaction(() => assigneeIds.map((assigneeId) => db.run(
    `INSERT INTO recurrences (title, description, assignee_id, priority, tag, checklist, kind, weekdays, month_day, due_offset, due_time,
       start_date, end_date, created_by, created_at, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.title, input.description, assigneeId, input.priority, input.tag, checklist, rule.kind, rule.weekdays, rule.month_day,
      rule.due_offset, input.due_time, rule.start_date, rule.end_date, user.id, now, isDemo ? 1 : 0]
  ).lastId));
  runRecurrences(db);
  return { ids, nextDate: nextOccurrence(rule, todayJalali(), db.settings()) };
}

// First date on or after `from` that the rule falls on (within two months), so the form can say when it starts.
export function nextOccurrence(rule, from, settings) {
  for (let i = 0, date = from; i < 62; i += 1, date = addDaysJalali(date, 1)) {
    if (recurrenceMatches(rule, date, settings)) return date;
  }
  return null;
}

export function updateRecurrence(db, user, id, body) {
  const row = db.get('SELECT * FROM recurrences WHERE id = ?', [Number(id)]);
  if (!row || !canManageUser(db, user, row.assignee_id)) throw new HttpError(404, 'تسک تکراری پیدا نشد.');
  if (body.active !== undefined && Object.keys(body).length === 1) {
    db.run('UPDATE recurrences SET active = ? WHERE id = ?', [body.active ? 1 : 0, row.id]);
    if (body.active) runRecurrences(db);
    return;
  }
  const input = cleanTaskInput(body);
  const rule = cleanRule(body.recurrence || {});
  const checklist = JSON.stringify((body.checklist || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 50));
  db.run(
    `UPDATE recurrences SET title = ?, description = ?, priority = ?, tag = ?, checklist = ?, kind = ?, weekdays = ?, month_day = ?,
       due_offset = ?, due_time = ?, start_date = ?, end_date = ? WHERE id = ?`,
    [input.title, input.description, input.priority, input.tag, checklist, rule.kind, rule.weekdays, rule.month_day, rule.due_offset,
      input.due_time, rule.start_date, rule.end_date, row.id]
  );
}

// Tasks already made from it stay; only the template goes.
export function deleteRecurrence(db, user, id) {
  const row = db.get('SELECT * FROM recurrences WHERE id = ?', [Number(id)]);
  if (!row || !canManageUser(db, user, row.assignee_id)) throw new HttpError(404, 'تسک تکراری پیدا نشد.');
  db.run('DELETE FROM recurrences WHERE id = ?', [row.id]);
}

// Makes today's task for every active template that falls on today (once per day).
export function runRecurrences(db, now = new Date()) {
  const date = todayJalali(now);
  const settings = db.settings();
  const due = db.all('SELECT * FROM recurrences WHERE active = 1 AND (last_generated IS NULL OR last_generated < ?)', [date]);
  due.forEach((rule) => {
    db.run('UPDATE recurrences SET last_generated = ? WHERE id = ?', [date, rule.id]);
    if (!recurrenceMatches(rule, date, settings)) return;
    const creator = db.get('SELECT * FROM users WHERE id = ?', [rule.created_by]);
    const assignee = db.get('SELECT active FROM users WHERE id = ?', [rule.assignee_id]);
    if (!creator || !assignee?.active) return;
    try {
      createTasks(db, creator, {
        title: rule.title,
        description: rule.description,
        assigneeIds: [rule.assignee_id],
        priority: rule.priority,
        tag: rule.tag,
        startDate: date,
        dueDate: addDaysJalali(date, rule.due_offset),
        dueTime: rule.due_time,
        checklist: JSON.parse(rule.checklist || '[]')
      }, { recurrenceId: rule.id, isDemo: Boolean(rule.is_demo), trusted: true });
    } catch (error) {
      console.error(`recurrence ${rule.id}:`, error.message);
    }
  });
}

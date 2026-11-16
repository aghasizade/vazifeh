import { HttpError } from './auth.js';
import { attachFiles, publicFile, removeFiles } from './files.js';
import { publish } from './live.js';
import { managersOf, notify } from './notify.js';
import { isOverdue, lateDays, OPEN_STATUSES, STATUSES, taskTone } from '../shared/status.js';
import { normalizeJalali } from '../shared/jalali.js';

const isBoss = (user) => user.role === 'ceo' || user.role === 'admin';

// Which tasks a user may see: bosses all, supervisors their department, everyone their own.
// A personal task (is_private) is seen by its owner only — not by the CEO, admins or the supervisor.
export function visibility(user, alias = 't', assigneeAlias = 'a') {
  let base;
  if (isBoss(user)) {
    base = { sql: '1 = 1', params: [] };
  } else if (user.role === 'supervisor' && user.department_id) {
    base = {
      sql: `(${assigneeAlias}.department_id = ? OR ${alias}.assignee_id = ? OR ${alias}.created_by = ?)`,
      params: [user.department_id, user.id, user.id]
    };
  } else {
    base = { sql: `(${alias}.assignee_id = ? OR ${alias}.created_by = ?)`, params: [user.id, user.id] };
  }
  return { sql: `${base.sql} AND (${alias}.is_private = 0 OR ${alias}.assignee_id = ?)`, params: [...base.params, user.id] };
}

// May this user manage (assign, approve, edit) tasks of `assigneeId`?
export function canManageUser(db, user, assigneeId) {
  if (isBoss(user)) return true;
  if (user.role !== 'supervisor' || !user.department_id) return false;
  const target = db.get('SELECT department_id, role FROM users WHERE id = ?', [assigneeId]);
  if (!target || target.role === 'ceo' || target.role === 'admin') return false;
  return target.department_id === user.department_id;
}

const TASK_SELECT = `
  SELECT t.*, a.full_name AS assignee_name, a.department_id AS assignee_department, c.full_name AS creator_name,
    (SELECT COUNT(*) FROM task_checklist k WHERE k.task_id = t.id) AS check_total,
    (SELECT COUNT(*) FROM task_checklist k WHERE k.task_id = t.id AND k.done = 1) AS check_done,
    (SELECT COUNT(*) FROM task_events e WHERE e.task_id = t.id AND e.type = 'comment') AS comment_count,
    (SELECT COUNT(*) FROM files f JOIN task_events e ON e.id = f.event_id WHERE e.task_id = t.id) AS file_count
  FROM tasks t JOIN users a ON a.id = t.assignee_id LEFT JOIN users c ON c.id = t.created_by`;

export function toTask(row, now = new Date()) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    departmentId: row.assignee_department,
    createdBy: row.created_by,
    creatorName: row.creator_name,
    priority: row.priority,
    status: row.status,
    tag: row.tag || '',
    startDate: row.start_date,
    dueDate: row.due_date,
    dueTime: row.due_time,
    startTime: row.start_time || null,
    alarmDate: row.alarm_date || null,
    alarmTime: row.alarm_time || null,
    progress: row.progress,
    blockedReason: row.blocked_reason || '',
    personal: Boolean(row.personal),
    isPrivate: Boolean(row.is_private),
    recurrenceId: row.recurrence_id,
    submittedAt: row.submitted_at,
    doneAt: row.done_at,
    returnCount: row.return_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    checkTotal: row.check_total,
    checkDone: row.check_done,
    commentCount: row.comment_count,
    fileCount: row.file_count,
    isDemo: Boolean(row.is_demo),
    tone: taskTone(row, now),
    overdue: isOverdue(row, now),
    lateDays: lateDays(row, now)
  };
}

export function listTasks(db, user, query = {}) {
  const where = [];
  const params = [];
  const vis = visibility(user);
  where.push(vis.sql);
  params.push(...vis.params);

  if (query.mine) { where.push('t.assignee_id = ?'); params.push(user.id); }
  // Personal tasks live in "My tasks" only; the board, reports and exports never list them, not even the owner's.
  else where.push('t.is_private = 0');
  if (query.assignee) { where.push('t.assignee_id = ?'); params.push(Number(query.assignee)); }
  if (query.department) { where.push('a.department_id = ?'); params.push(Number(query.department)); }
  if (query.tag) { where.push('t.tag = ?'); params.push(String(query.tag)); }
  if (query.priority !== undefined && query.priority !== '') { where.push('t.priority = ?'); params.push(Number(query.priority)); }
  if (query.q) {
    where.push('(t.title LIKE ? OR t.description LIKE ? OR t.tag LIKE ?)');
    const like = `%${String(query.q).trim()}%`;
    params.push(like, like, like);
  }
  if (query.status && STATUSES[query.status]) { where.push('t.status = ?'); params.push(query.status); }
  // By default the board shows open work plus what finished in the last two weeks.
  if (query.scope !== 'all') {
    const days = Number(query.closedDays) || 14;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    where.push(`(t.status IN (${OPEN_STATUSES.map(() => '?').join(',')}) OR t.status = 'review' OR t.updated_at >= ?)`);
    params.push(...OPEN_STATUSES, since);
  }
  const rows = db.all(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.due_date IS NULL, t.due_date, t.due_time, t.priority DESC, t.id DESC LIMIT 2000`, params);
  const now = new Date();
  return rows.map((row) => toTask(row, now));
}

export function loadTask(db, user, id) {
  const vis = visibility(user);
  const row = db.get(`${TASK_SELECT} WHERE t.id = ? AND ${vis.sql}`, [Number(id), ...vis.params]);
  if (!row) throw new HttpError(404, 'تسک پیدا نشد یا به آن دسترسی ندارید.');
  return row;
}

export function taskDetail(db, user, id) {
  const row = loadTask(db, user, id);
  const checklist = db.all('SELECT * FROM task_checklist WHERE task_id = ? ORDER BY sort_order, id', [row.id])
    .map((item) => ({ id: item.id, text: item.text, done: Boolean(item.done), doneAt: item.done_at }));
  const files = db.all('SELECT f.* FROM files f JOIN task_events e ON e.id = f.event_id WHERE e.task_id = ? ORDER BY f.id', [row.id]);
  const filesByEvent = new Map();
  files.forEach((file) => {
    if (!filesByEvent.has(file.event_id)) filesByEvent.set(file.event_id, []);
    filesByEvent.get(file.event_id).push(publicFile(db, file));
  });
  const events = db.all(
    `SELECT e.*, u.full_name AS user_name, u.role AS user_role FROM task_events e JOIN users u ON u.id = e.user_id
     WHERE e.task_id = ? ORDER BY e.id`, [row.id]
  );
  // Read receipts for the viewer's own messages: who else has opened the conversation since (two ticks).
  const reads = db.all(
    `SELECT r.user_id, r.last_event_id, u.full_name FROM task_reads r JOIN users u ON u.id = r.user_id
     WHERE r.task_id = ? AND r.user_id != ?`, [row.id, user.id]
  );
  const mapped = events.map((e) => ({
    id: e.id,
    type: e.type,
    body: e.body || '',
    meta: e.meta ? JSON.parse(e.meta) : null,
    lat: e.lat,
    lng: e.lng,
    userId: e.user_id,
    userName: e.user_name,
    userRole: e.user_role,
    createdAt: e.created_at,
    files: filesByEvent.get(e.id) || [],
    ...(e.type === 'comment' && e.user_id === user.id
      ? { seenBy: reads.filter((r) => r.last_event_id >= e.id).map((r) => r.full_name) }
      : {})
  }));
  return {
    task: toTask(row),
    checklist,
    events: mapped,
    permissions: permissionsFor(db, user, row)
  };
}

// Supervisors manage their department, but their own tasks are approved by the CEO.
const managesTask = (db, user, row) => canManageUser(db, user, row.assignee_id) && !(user.role === 'supervisor' && row.assignee_id === user.id);

function permissionsFor(db, user, row) {
  const manager = managesTask(db, user, row);
  const owner = row.created_by === user.id;
  const assignee = row.assignee_id === user.id;
  const ownTask = owner && (Boolean(row.personal) || (Boolean(row.is_private) && assignee));
  return {
    edit: manager || ownTask,
    remove: manager || ownTask,
    approve: manager && row.status === 'review',
    work: assignee || manager,
    reopen: manager && ['done', 'cancelled'].includes(row.status),
    cancel: manager && row.status !== 'cancelled'
  };
}

// Everyone who should hear about a task: assignee, creator, people who wrote in it, and the assignee's managers.
function audience(db, row) {
  if (row.is_private) return [row.assignee_id];
  const writers = db.all('SELECT DISTINCT user_id FROM task_events WHERE task_id = ?', [row.id]).map((r) => r.user_id);
  return [...new Set([row.assignee_id, row.created_by, ...writers, ...managersOf(db, row.assignee_id)])];
}

const touched = (db, row) => publish(audience(db, row), { type: 'task', id: row.id });

function addEvent(db, taskId, userId, { type, body = null, meta = null, lat = null, lng = null, clientId = null }) {
  const { lastId } = db.run(
    'INSERT INTO task_events (task_id, user_id, type, body, meta, lat, lng, created_at, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [taskId, userId, type, body, meta ? JSON.stringify(meta) : null, lat, lng, new Date().toISOString(), clientId]
  );
  return lastId;
}

function validTime(value, label = 'ساعت سررسید') {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new HttpError(422, `${label} معتبر نیست.`);
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function validDate(value, label) {
  if (!value) return null;
  const date = normalizeJalali(value);
  if (!date) throw new HttpError(422, `${label} معتبر نیست.`);
  return date;
}

export function cleanTaskInput(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.title !== undefined) {
    out.title = String(body.title || '').trim();
    if (!out.title) throw new HttpError(422, 'عنوان تسک را وارد کنید.');
    if (out.title.length > 200) throw new HttpError(422, 'عنوان تسک طولانی است.');
  }
  if (!partial || body.description !== undefined) out.description = String(body.description || '').trim().slice(0, 5000);
  if (!partial || body.priority !== undefined) {
    out.priority = Number(body.priority ?? 1);
    if (![0, 1, 2, 3].includes(out.priority)) throw new HttpError(422, 'اولویت معتبر نیست.');
  }
  if (!partial || body.tag !== undefined) out.tag = String(body.tag || '').trim().slice(0, 40) || null;
  if (!partial || body.startDate !== undefined) out.start_date = validDate(body.startDate, 'تاریخ شروع');
  if (!partial || body.dueDate !== undefined) out.due_date = validDate(body.dueDate, 'تاریخ سررسید');
  if (!partial || body.dueTime !== undefined) out.due_time = validTime(body.dueTime);
  if (!partial || body.startTime !== undefined) out.start_time = validTime(body.startTime, 'ساعت شروع');
  if (!partial || body.isPrivate !== undefined) out.is_private = body.isPrivate ? 1 : 0;
  if (out.start_date && out.due_date && out.start_date > out.due_date) throw new HttpError(422, 'تاریخ سررسید نباید قبل از تاریخ شروع باشد.');
  Object.assign(out, cleanAlarm(body, { partial }));
  return out;
}

const ALARM_KEYS = ['alarm_date', 'alarm_time'];

// Alarm: both a date and a time, or neither.
function cleanAlarm(body, { partial }) {
  if (partial && body.alarmDate === undefined && body.alarmTime === undefined) return {};
  const date = validDate(body.alarmDate, 'تاریخ یادآور');
  const time = validTime(body.alarmTime, 'ساعت یادآور');
  if (Boolean(date) !== Boolean(time)) throw new HttpError(422, 'برای یادآور هم روز و هم ساعت را انتخاب کنید.');
  return { alarm_date: date, alarm_time: time };
}

// Creates one task per assignee. Employees may only create tasks for themselves (marked personal).
// trusted: made by the scheduler from a recurring template, whose permissions were checked when it was defined.
export function createTasks(db, user, body, { recurrenceId = null, isDemo = false, trusted = false } = {}) {
  const input = cleanTaskInput(body);
  const assigneeIds = [...new Set((body.assigneeIds?.length ? body.assigneeIds : [user.id]).map(Number))];
  // Only a task one makes for oneself can be personal.
  if (input.is_private && (trusted || assigneeIds.length !== 1 || assigneeIds[0] !== user.id)) {
    throw new HttpError(422, 'فقط کاری که برای خودتان می‌سازید می‌تواند «شخصی» باشد.');
  }
  assigneeIds.forEach((id) => {
    const target = db.get('SELECT id, active FROM users WHERE id = ?', [id]);
    if (!target?.active) throw new HttpError(422, 'مسئول انتخاب‌شده پیدا نشد یا غیرفعال است.');
    if (!trusted && id !== user.id && !canManageUser(db, user, id)) {
      throw new HttpError(403, user.role === 'supervisor' ? 'فقط برای افراد واحد خودتان می‌توانید تسک تعریف کنید.' : 'فقط برای خودتان می‌توانید تسک تعریف کنید.');
    }
  });
  const checklist = (body.checklist || []).map((text) => String(text).trim()).filter(Boolean).slice(0, 50);
  const now = new Date().toISOString();

  const ids = db.transaction(() => assigneeIds.map((assigneeId, index) => {
    const personal = !trusted && assigneeId === user.id && !canManageUser(db, user, assigneeId) ? 1 : 0;
    // An alarm rings for the person who set it, so it is kept only on a task for oneself.
    const ownAlarm = assigneeId === user.id && !trusted;
    const { lastId } = db.run(
      `INSERT INTO tasks (title, description, assignee_id, created_by, priority, status, tag, start_date, start_time, due_date, due_time,
         alarm_date, alarm_time, personal, is_private, recurrence_id, created_at, updated_at, is_demo)
       VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.title, input.description, assigneeId, user.id, input.priority, input.tag, input.start_date, input.start_time, input.due_date, input.due_time,
        ownAlarm ? input.alarm_date : null, ownAlarm ? input.alarm_time : null, personal, input.is_private, recurrenceId, now, now, isDemo ? 1 : 0]
    );
    checklist.forEach((text, order) => db.run('INSERT INTO task_checklist (task_id, text, sort_order) VALUES (?, ?, ?)', [lastId, text, order]));
    const eventId = addEvent(db, lastId, user.id, { type: 'created' });
    // Attachments of the form go with the first copy only (they are one set of files).
    if (index === 0 && body.fileIds?.length) attachFiles(db, user.id, body.fileIds, { eventId });
    return lastId;
  }));

  ids.forEach((id) => {
    const row = db.get('SELECT * FROM tasks WHERE id = ?', [id]);
    if (row.assignee_id !== user.id) {
      notify(db, [row.assignee_id], {
        type: 'task_new',
        title: `تسک جدید: ${row.title}`,
        body: `${user.full_name}${row.due_date ? ` — مهلت ${row.due_date}${row.due_time ? ` ساعت ${row.due_time}` : ''}` : ''}`,
        link: `/task/${id}`,
        taskId: id
      });
    }
    touched(db, row);
  });
  return ids;
}

export function updateTask(db, user, id, body) {
  const row = loadTask(db, user, id);
  const perms = permissionsFor(db, user, row);
  const input = cleanTaskInput(body, { partial: true });
  // The alarm belongs to the assignee: they may set it on any of their tasks; nobody else may change it.
  const isAssignee = row.assignee_id === user.id;
  if (!isAssignee) ALARM_KEYS.forEach((k) => delete input[k]);
  // Only the owner of a task made for themself may mark it personal (or public again).
  if (input.is_private !== undefined && !(isAssignee && row.created_by === user.id)) {
    if (input.is_private) throw new HttpError(422, 'فقط کاری که برای خودتان ساخته‌اید می‌تواند «شخصی» باشد.');
    delete input.is_private;
  }
  const onlyAlarm = Object.keys(input).every((k) => ALARM_KEYS.includes(k) || k === 'is_private')
    && (body.assigneeId === undefined || Number(body.assigneeId) === row.assignee_id);
  if (!perms.edit && !(isAssignee && onlyAlarm)) throw new HttpError(403, 'اجازه ویرایش این تسک را ندارید.');
  const start = input.start_date !== undefined ? input.start_date : row.start_date;
  const due = input.due_date !== undefined ? input.due_date : row.due_date;
  if (start && due && start > due) throw new HttpError(422, 'تاریخ سررسید نباید قبل از تاریخ شروع باشد.');

  let reassignTo = null;
  if (body.assigneeId !== undefined && Number(body.assigneeId) !== row.assignee_id) {
    reassignTo = Number(body.assigneeId);
    const target = db.get('SELECT id, active, full_name FROM users WHERE id = ?', [reassignTo]);
    if (!target?.active) throw new HttpError(422, 'مسئول انتخاب‌شده پیدا نشد یا غیرفعال است.');
    if (!canManageUser(db, user, reassignTo)) throw new HttpError(403, 'اجازه واگذاری به این فرد را ندارید.');
    if (row.is_private || input.is_private) throw new HttpError(422, 'کار شخصی را نمی‌توان به دیگری سپرد؛ اول «شخصی» را خاموش کنید.');
    input.assignee_id = reassignTo;
  }
  const keys = Object.keys(input);
  if (!keys.length) return;
  const changes = keys.filter((k) => String(input[k] ?? '') !== String(row[k] ?? ''));
  db.transaction(() => {
    db.run(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      [...keys.map((k) => input[k]), new Date().toISOString(), row.id]);
    // Setting one's own alarm (or the personal switch) is private and does not show up in the task's history.
    const visible = changes.filter((k) => !ALARM_KEYS.includes(k) && k !== 'is_private');
    if (visible.length) addEvent(db, row.id, user.id, { type: 'edit', meta: { fields: visible } });
  });
  const fresh = db.get('SELECT * FROM tasks WHERE id = ?', [row.id]);
  if (reassignTo) {
    notify(db, [reassignTo], { type: 'task_new', title: `تسک به شما واگذار شد: ${fresh.title}`, body: user.full_name, link: `/task/${row.id}`, taskId: row.id });
  } else if (changes.includes('due_date') || changes.includes('due_time')) {
    if (fresh.assignee_id !== user.id) {
      notify(db, [fresh.assignee_id], { type: 'task_edit', title: `مهلت تسک تغییر کرد: ${fresh.title}`, body: `مهلت جدید: ${fresh.due_date || 'بدون مهلت'}${fresh.due_time ? ` ساعت ${fresh.due_time}` : ''}`, link: `/task/${row.id}`, taskId: row.id });
    }
  }
  // A task that was just made personal must also vanish from the screens of those who could see it before.
  touched(db, { ...fresh, assignee_id: row.assignee_id, is_private: row.is_private && fresh.is_private });
  if (reassignTo) touched(db, fresh);
}

export function deleteTask(db, user, id) {
  const row = loadTask(db, user, id);
  if (!permissionsFor(db, user, row).remove) throw new HttpError(403, 'اجازه حذف این تسک را ندارید.');
  const people = audience(db, row);
  db.transaction(() => {
    removeFiles(db, db.all('SELECT f.* FROM files f JOIN task_events e ON e.id = f.event_id WHERE e.task_id = ?', [row.id]));
    db.run('DELETE FROM task_events WHERE task_id = ?', [row.id]);
    db.run('DELETE FROM task_checklist WHERE task_id = ?', [row.id]);
    db.run('DELETE FROM task_reads WHERE task_id = ?', [row.id]);
    db.run('DELETE FROM notifications WHERE task_id = ?', [row.id]);
    db.run('DELETE FROM tasks WHERE id = ?', [row.id]);
    db.audit('task', row.id, 'delete', user.id, { title: row.title, assignee: row.assignee_id });
  });
  publish(people, { type: 'task', id: row.id, deleted: true });
}

// A task that is opened again must not keep looking finished: its checklist decides, or it drops below 100%.
function reopenedProgress(db, row) {
  const counts = db.get('SELECT COUNT(*) AS total, SUM(done) AS done FROM task_checklist WHERE task_id = ?', [row.id]);
  if (counts.total) return Math.round((counts.done || 0) * 100 / counts.total);
  return Math.min(row.progress, 90);
}

// Status changes. "done" from the assignee becomes "review" when approval is required.
export function changeStatus(db, user, id, body) {
  const row = loadTask(db, user, id);
  const perms = permissionsFor(db, user, row);
  const note = String(body.note || '').trim().slice(0, 2000);
  let next = String(body.status || '');
  const from = row.status;
  const now = new Date().toISOString();
  const updates = {};

  if (next === 'approve') {
    if (!perms.approve) throw new HttpError(403, 'فقط مدیر می‌تواند این تسک را تأیید کند.');
    next = 'done';
    Object.assign(updates, { done_at: now, approved_by: user.id, progress: 100 });
  } else if (next === 'return') {
    if (!perms.approve && !(perms.reopen && from === 'done')) throw new HttpError(403, 'اجازه برگشت دادن این تسک را ندارید.');
    if (!note) throw new HttpError(422, 'دلیل برگشت را بنویسید تا کارمند بداند چه چیزی باید اصلاح شود.');
    next = 'returned';
    Object.assign(updates, { return_count: row.return_count + 1, done_at: null, approved_by: null, progress: reopenedProgress(db, row) });
  } else if (next === 'done') {
    if (!perms.work) throw new HttpError(403, 'اجازه تغییر وضعیت این تسک را ندارید.');
    if (!STATUSES[from].open) throw new HttpError(422, 'این تسک باز نیست.');
    const needsApproval = db.getSetting('require_approval') && !row.personal && !row.is_private && !managesTask(db, user, row);
    updates.submitted_at = now;
    // Waiting for approval keeps its progress, so a returned task does not look finished.
    if (needsApproval) {
      next = 'review';
    } else {
      Object.assign(updates, { done_at: now, approved_by: user.id, progress: 100 });
    }
  } else if (next === 'cancelled') {
    if (!perms.cancel) throw new HttpError(403, 'فقط مدیر می‌تواند تسک را لغو کند.');
  } else if (['todo', 'doing', 'blocked'].includes(next)) {
    if (!perms.work) throw new HttpError(403, 'اجازه تغییر وضعیت این تسک را ندارید.');
    if (!STATUSES[from].open && !perms.reopen) throw new HttpError(422, 'تسک بسته‌شده را فقط مدیر می‌تواند دوباره باز کند.');
    if (next === 'blocked' && !note) throw new HttpError(422, 'دلیل توقف را بنویسید.');
    updates.blocked_reason = next === 'blocked' ? note : null;
    if (!STATUSES[from].open) Object.assign(updates, { done_at: null, approved_by: null, submitted_at: null, progress: reopenedProgress(db, row) });
  } else {
    throw new HttpError(422, 'وضعیت معتبر نیست.');
  }
  if (next === from && next !== 'blocked') return;

  updates.status = next;
  updates.updated_at = now;
  const keys = Object.keys(updates);
  db.transaction(() => {
    db.run(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => updates[k]), row.id]);
    addEvent(db, row.id, user.id, { type: 'status', body: note || null, meta: { from, to: next } });
  });

  const link = `/task/${row.id}`;
  const base = { link, taskId: row.id };
  if (next === 'review') {
    notify(db, managersOf(db, row.assignee_id), { ...base, type: 'review', title: `منتظر تأیید: ${row.title}`, body: `${user.full_name} کار را انجام‌شده اعلام کرد.${note ? ` «${note}»` : ''}` });
  } else if (next === 'done' && row.assignee_id !== user.id) {
    notify(db, [row.assignee_id], { ...base, type: 'approved', title: `تأیید شد: ${row.title}`, body: `${user.full_name} انجام کار را تأیید کرد.` });
  } else if (next === 'returned') {
    notify(db, [row.assignee_id], { ...base, type: 'returned', title: `برگشت خورد: ${row.title}`, body: note });
  } else if (next === 'blocked' && !row.is_private) {
    notify(db, [...managersOf(db, row.assignee_id), row.created_by].filter((uid) => uid !== user.id), { ...base, type: 'blocked', title: `متوقف شد: ${row.title}`, body: `${user.full_name}: ${note}` });
  } else if (next === 'done' && row.assignee_id === user.id && row.created_by !== user.id) {
    notify(db, [row.created_by], { ...base, type: 'approved', title: `انجام شد: ${row.title}`, body: user.full_name });
  } else if (next === 'cancelled' && row.assignee_id !== user.id) {
    notify(db, [row.assignee_id], { ...base, type: 'cancelled', title: `لغو شد: ${row.title}`, body: note || user.full_name });
  }
  touched(db, row);
}

export function setProgress(db, user, id, value) {
  const row = loadTask(db, user, id);
  if (!permissionsFor(db, user, row).work) throw new HttpError(403, 'اجازه تغییر این تسک را ندارید.');
  assertOpen(row);
  const progress = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const status = row.status === 'todo' && progress > 0 ? 'doing' : row.status;
  db.run('UPDATE tasks SET progress = ?, status = ?, updated_at = ? WHERE id = ?', [progress, status, new Date().toISOString(), row.id]);
  if (status !== row.status) addEvent(db, row.id, user.id, { type: 'status', meta: { from: row.status, to: status } });
  touched(db, row);
}

// A message in the task's conversation: text, attachments, voice notes and/or a location.
export function addComment(db, user, id, body) {
  const row = loadTask(db, user, id);
  const text = String(body.body || '').trim().slice(0, 5000);
  const lat = Number.isFinite(Number(body.lat)) && body.lat !== null && body.lat !== '' ? Number(body.lat) : null;
  const lng = lat !== null && Number.isFinite(Number(body.lng)) ? Number(body.lng) : null;
  const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
  if (!text && !fileIds.length && lat === null) throw new HttpError(422, 'پیام خالی است.');
  // The app sends each message with its own id; one that arrives a second time (its first answer was lost on a
  // weak connection) is the same message, not a new one.
  const clientId = body.clientId ? String(body.clientId).slice(0, 64) : null;
  if (clientId) {
    const again = db.get('SELECT id FROM task_events WHERE task_id = ? AND user_id = ? AND client_id = ?', [row.id, user.id, clientId]);
    if (again) return again.id;
  }
  const eventId = db.transaction(() => {
    const created = addEvent(db, row.id, user.id, { type: 'comment', body: text || null, lat, lng: lat === null ? null : lng, meta: body.accuracy ? { accuracy: Math.round(body.accuracy) } : null, clientId });
    attachFiles(db, user.id, fileIds, { eventId: created });
    // Work started the moment the assignee reports on it.
    if (row.assignee_id === user.id && row.status === 'todo') db.run("UPDATE tasks SET status = 'doing' WHERE id = ?", [row.id]);
    db.run('UPDATE tasks SET updated_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
    return created;
  });
  const files = db.all('SELECT kind FROM files WHERE event_id = ?', [eventId]);
  const what = text ? text.slice(0, 140) : files.some((f) => f.kind === 'audio') ? 'پیام صوتی' : files.length ? `${files.length} فایل پیوست` : 'موقعیت مکانی';
  notify(db, audience(db, row).filter((uid) => uid !== user.id), {
    type: 'comment',
    title: `${user.full_name} در «${row.title}»`,
    body: what,
    link: `/task/${row.id}`,
    taskId: row.id
  });
  touched(db, row);
  return eventId;
}

export function deleteComment(db, user, eventId) {
  const event = db.get('SELECT * FROM task_events WHERE id = ?', [Number(eventId)]);
  if (!event || event.type !== 'comment') throw new HttpError(404, 'پیام پیدا نشد.');
  const row = loadTask(db, user, event.task_id);
  const recent = Date.now() - new Date(event.created_at) < 15 * 60000;
  if (!(event.user_id === user.id && recent) && !isBoss(user)) throw new HttpError(403, 'پیام را فقط تا ۱۵ دقیقه پس از ارسال می‌توانید حذف کنید.');
  db.transaction(() => {
    removeFiles(db, db.all('SELECT * FROM files WHERE event_id = ?', [event.id]));
    db.run('DELETE FROM task_events WHERE id = ?', [event.id]);
  });
  touched(db, row);
}

// A finished (or waiting-for-approval) task keeps its progress and checklist as they were approved; it must be
// reopened or returned first. Otherwise ticking an item would quietly drop a done task below 100%.
function assertOpen(row) {
  if (!STATUSES[row.status].open) throw new HttpError(422, 'این تسک بسته یا منتظر تأیید است؛ برای تغییر، ابتدا باید باز یا برگشت داده شود.');
}

// Checklist ------------------------------------------------------------
function syncChecklistProgress(db, taskId) {
  const counts = db.get('SELECT COUNT(*) AS total, SUM(done) AS done FROM task_checklist WHERE task_id = ?', [taskId]);
  if (counts.total) {
    db.run('UPDATE tasks SET progress = ?, updated_at = ? WHERE id = ?', [Math.round((counts.done || 0) * 100 / counts.total), new Date().toISOString(), taskId]);
  }
}

export function addChecklistItem(db, user, taskId, text) {
  const row = loadTask(db, user, taskId);
  if (!permissionsFor(db, user, row).work) throw new HttpError(403, 'اجازه تغییر این تسک را ندارید.');
  assertOpen(row);
  const value = String(text || '').trim().slice(0, 300);
  if (!value) throw new HttpError(422, 'متن مورد چک‌لیست خالی است.');
  const order = db.get('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM task_checklist WHERE task_id = ?', [row.id]).n;
  db.run('INSERT INTO task_checklist (task_id, text, sort_order) VALUES (?, ?, ?)', [row.id, value, order]);
  syncChecklistProgress(db, row.id);
  touched(db, row);
}

export function updateChecklistItem(db, user, itemId, body, { remove = false } = {}) {
  const item = db.get('SELECT * FROM task_checklist WHERE id = ?', [Number(itemId)]);
  if (!item) throw new HttpError(404, 'مورد چک‌لیست پیدا نشد.');
  const row = loadTask(db, user, item.task_id);
  if (!permissionsFor(db, user, row).work) throw new HttpError(403, 'اجازه تغییر این تسک را ندارید.');
  assertOpen(row);
  if (remove) {
    db.run('DELETE FROM task_checklist WHERE id = ?', [item.id]);
  } else {
    if (body.text !== undefined) {
      const text = String(body.text).trim().slice(0, 300);
      if (!text) throw new HttpError(422, 'متن مورد چک‌لیست خالی است.');
      db.run('UPDATE task_checklist SET text = ? WHERE id = ?', [text, item.id]);
    }
    if (body.done !== undefined) {
      db.run('UPDATE task_checklist SET done = ?, done_by = ?, done_at = ? WHERE id = ?',
        [body.done ? 1 : 0, body.done ? user.id : null, body.done ? new Date().toISOString() : null, item.id]);
      if (body.done && row.status === 'todo' && row.assignee_id === user.id) db.run("UPDATE tasks SET status = 'doing' WHERE id = ?", [row.id]);
    }
  }
  syncChecklistProgress(db, row.id);
  touched(db, row);
}

// The viewer has the conversation open: everything up to the newest event counts as seen. Authors of messages that
// just became "seen" are told, so their double tick appears at once.
export function markRead(db, user, id) {
  const row = loadTask(db, user, id);
  const newest = db.get('SELECT MAX(id) AS id FROM task_events WHERE task_id = ?', [row.id]).id || 0;
  const before = db.get('SELECT last_event_id FROM task_reads WHERE task_id = ? AND user_id = ?', [row.id, user.id])?.last_event_id || 0;
  if (newest <= before) return { lastEventId: before };
  db.run(
    `INSERT INTO task_reads (task_id, user_id, last_event_id, read_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (task_id, user_id) DO UPDATE SET last_event_id = excluded.last_event_id, read_at = excluded.read_at`,
    [row.id, user.id, newest, new Date().toISOString()]
  );
  const authors = db.all(
    "SELECT DISTINCT user_id FROM task_events WHERE task_id = ? AND type = 'comment' AND id > ? AND id <= ? AND user_id != ?",
    [row.id, before, newest, user.id]
  ).map((r) => r.user_id);
  if (authors.length) publish(authors, { type: 'task', id: row.id, read: true });
  return { lastEventId: newest };
}

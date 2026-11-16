import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {
  authenticate, createSession, deleteOtherSessions, deleteSession, hashPassword, HttpError, loginThrottle, publicUser, requireRole, requireUser,
  verifyPassword
} from './auth.js';
import { publicFile, saveUpload, sendFile } from './files.js';
import { attachClient, publish } from './live.js';
import {
  addChecklistItem, addComment, canManageUser, changeStatus, createTasks, deleteComment, deleteTask, listTasks, markRead, setProgress, taskDetail,
  updateChecklistItem, updateTask
} from './tasks.js';
import { createRecurrences, deleteRecurrence, listRecurrences, updateRecurrence } from './recurrences.js';
import { myReports, overdueReport, reportsForDate, reviewReport, saveReport, scorecard, staffFor, staffStatus } from './reports.js';
import { buildWorkbook, sendWorkbook } from './excel.js';
import { demoStatus, loadDemoData, removeDemoData } from './demo.js';
import { DEFAULT_SETTINGS } from './db.js';
import { dateToJalali, normalizeJalali } from '../shared/jalali.js';
import { CHANGELOG } from '../shared/changelog.js';
import { PRIORITIES, ROLES, STATUSES, TONES, isManagerRole } from '../shared/status.js';

// Wraps a handler so thrown HttpErrors become JSON responses.
const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    if (!res.headersSent) res.json(result ?? { ok: true });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message, ...error.extra });
    } else {
      console.error(error);
      res.status(500).json({ error: 'خطای داخلی سرور. جزئیات در گزارش سرور ثبت شد.' });
    }
  }
};

export function lanAddresses(port) {
  const addresses = [];
  Object.values(os.networkInterfaces()).flat().forEach((net) => {
    if (net && net.family === 'IPv4' && !net.internal) addresses.push(`http://${net.address}:${port}`);
  });
  return addresses;
}

const BOSS = ['ceo', 'admin'];
const MANAGERS = ['ceo', 'admin', 'supervisor'];

export function createApp(db, { staticDir, downloadsDir, version }) {
  const app = express();
  app.disable('x-powered-by');
  // Basic hardening for pages and files served to browsers and the desktop app.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // Pages load only their own scripts and talk only to this server.
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/downloads/')) {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
        + "media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
    }
    next();
  });
  app.set('trust proxy', 'loopback');

  // The Android app and the desktop shell call the API from their own origin. Sign-in uses a bearer
  // token (never a cookie), so allowing any origin does not expose anything to other sites.
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-File-Name, X-File-Duration');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  const api = express.Router();
  // Signed file links work without a login so <img> and <audio> can load them.
  api.get('/files/:id/:sig{/:name}',(req, res) => sendFile(db, req, res));

  api.use(express.json({ limit: '2mb' }));
  api.use(authenticate(db));

  // ---------- Public ----------
  api.get('/public/info', handle(() => ({
    app: 'vazifeh',
    companyName: db.getSetting('company_name'),
    version,
    android: readAndroidRelease(downloadsDir),
    // The phone app's "new version" popup lists these changes before the new APK is installed.
    changelog: CHANGELOG.slice(0, 6)
  })));

  // ---------- Auth ----------
  api.post('/auth/login', handle((req) => {
    const throttle = loginThrottle(req.ip);
    if (throttle.blocked) throw new HttpError(429, 'تلاش‌های ناموفق زیاد بود. ده دقیقه دیگر دوباره امتحان کنید.');
    const user = db.get('SELECT * FROM users WHERE username = ?', [String(req.body.username || '').trim()]);
    if (!user || !user.active || !verifyPassword(String(req.body.password || ''), user.password_hash)) {
      throttle.fail();
      throw new HttpError(401, 'نام کاربری یا رمز عبور نادرست است.');
    }
    throttle.reset();
    const token = createSession(db, user.id, req.body.device || req.headers['user-agent'] || '');
    db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), user.id]);
    return { token, user: publicUser(user) };
  }));

  api.post('/auth/logout', handle((req) => {
    if (req.sessionToken) deleteSession(db, req.sessionToken);
  }));

  api.get('/auth/me', handle((req) => {
    if (!req.user) throw new HttpError(401, 'وارد نشده‌اید.');
    return { user: publicUser(req.user), settings: clientSettings() };
  }));

  api.post('/auth/change-password', requireUser, handle((req) => {
    const { currentPassword, newPassword } = req.body;
    if (!verifyPassword(String(currentPassword || ''), req.user.password_hash)) throw new HttpError(422, 'رمز فعلی نادرست است.');
    if (String(newPassword || '').length < 6) throw new HttpError(422, 'رمز جدید باید حداقل ۶ نویسه باشد.');
    if (newPassword === currentPassword) throw new HttpError(422, 'رمز جدید باید با رمز فعلی فرق داشته باشد.');
    db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hashPassword(newPassword), req.user.id]);
    deleteOtherSessions(db, req.user.id, req.sessionToken);
  }));

  api.use(requireUser);

  const clientSettings = () => {
    const s = db.settings();
    return { companyName: s.company_name, workDays: s.work_days, holidays: s.holidays, requireApproval: s.require_approval, reportHour: s.report_hour, digestHour: s.digest_hour };
  };

  // ---------- Live updates ----------
  api.get('/live', (req, res) => attachClient(req, res, req.user.id));

  // ---------- Reference data ----------
  api.get('/meta', handle((req) => ({
    statuses: STATUSES,
    priorities: PRIORITIES,
    roles: ROLES,
    tones: TONES,
    departments: db.all('SELECT id, name, sort_order AS sortOrder FROM departments ORDER BY sort_order, name'),
    // Everyone sees the names of active colleagues (for conversations); managers also get whom they can assign to.
    users: db.all(
      `SELECT u.id, u.full_name AS fullName, u.title, u.role, u.department_id AS departmentId, u.active, u.last_seen_at AS lastSeenAt
       FROM users u ORDER BY u.active DESC, u.full_name`
    ).map((u) => ({ ...u, active: Boolean(u.active) })),
    staffIds: isManagerRole(req.user.role) ? staffFor(db, req.user, { withTaskOwners: true }).map((u) => u.id) : [req.user.id],
    assignableIds: db.all('SELECT id FROM users WHERE active = 1').map((u) => u.id).filter((id) => id === req.user.id || canManageUser(db, req.user, id)),
    tags: db.all("SELECT tag, COUNT(*) AS n FROM tasks WHERE tag IS NOT NULL AND tag != '' AND (is_private = 0 OR assignee_id = ?) GROUP BY tag ORDER BY n DESC LIMIT 40", [req.user.id]).map((r) => r.tag),
    settings: clientSettings(),
    today: dateToJalali()
  })));

  // ---------- Files ----------
  api.post('/files', express.raw({ type: () => true, limit: '26mb' }), handle((req) => {
    const file = saveUpload(db, req.user.id, {
      buffer: req.body,
      name: decodeURIComponent(String(req.headers['x-file-name'] || 'file')),
      mime: req.headers['content-type'],
      duration: req.headers['x-file-duration']
    });
    return publicFile(db, file);
  }));

  // ---------- Tasks ----------
  api.get('/tasks', handle((req) => ({ tasks: listTasks(db, req.user, req.query) })));
  api.post('/tasks', handle((req) => {
    if (req.body.recurrence) {
      if (req.body.isPrivate) throw new HttpError(422, 'کار شخصی تکراری نمی‌شود.');
      const { ids, nextDate } = createRecurrences(db, req.user, req.body);
      return { recurrenceIds: ids, nextDate };
    }
    return { ids: createTasks(db, req.user, req.body) };
  }));
  api.get('/tasks/:id', handle((req) => taskDetail(db, req.user, req.params.id)));
  api.patch('/tasks/:id', handle((req) => updateTask(db, req.user, req.params.id, req.body)));
  api.delete('/tasks/:id', handle((req) => deleteTask(db, req.user, req.params.id)));
  api.post('/tasks/:id/status', handle((req) => changeStatus(db, req.user, req.params.id, req.body)));
  api.post('/tasks/:id/read', handle((req) => markRead(db, req.user, req.params.id)));
  api.post('/tasks/:id/progress', handle((req) => setProgress(db, req.user, req.params.id, req.body.progress)));
  api.post('/tasks/:id/comments', handle((req) => ({ id: addComment(db, req.user, req.params.id, req.body) })));
  api.delete('/comments/:id', handle((req) => deleteComment(db, req.user, req.params.id)));
  api.post('/tasks/:id/checklist', handle((req) => addChecklistItem(db, req.user, req.params.id, req.body.text)));
  api.patch('/checklist/:id', handle((req) => updateChecklistItem(db, req.user, req.params.id, req.body)));
  api.delete('/checklist/:id', handle((req) => updateChecklistItem(db, req.user, req.params.id, {}, { remove: true })));

  // ---------- Recurring tasks ----------
  api.get('/recurrences', requireRole(...MANAGERS), handle((req) => ({ recurrences: listRecurrences(db, req.user) })));
  api.put('/recurrences/:id', requireRole(...MANAGERS), handle((req) => updateRecurrence(db, req.user, req.params.id, req.body)));
  api.delete('/recurrences/:id', requireRole(...MANAGERS), handle((req) => deleteRecurrence(db, req.user, req.params.id)));

  // ---------- Daily reports ----------
  api.get('/daily/mine', handle((req) => ({ reports: myReports(db, req.user) })));
  api.put('/daily', handle((req) => ({ id: saveReport(db, req.user, req.body) })));
  api.get('/daily', requireRole(...MANAGERS), handle((req) => reportsForDate(db, req.user, req.query.date)));
  api.post('/daily/:id/review', requireRole(...MANAGERS), handle((req) => reviewReport(db, req.user, req.params.id, req.body.note)));

  // ---------- Reports ----------
  api.get('/reports/overdue', requireRole(...MANAGERS), handle((req) => overdueReport(db, req.user)));
  api.get('/reports/staff', requireRole(...MANAGERS), handle((req) => staffStatus(db, req.user)));
  api.get('/reports/scorecard', requireRole(...MANAGERS), handle((req) => scorecard(db, req.user, req.query.month)));

  api.get('/export/:kind', requireRole(...MANAGERS), handle(async (req, res) => {
    const stamp = dateToJalali().replaceAll('/', '-');
    const { kind } = req.params;
    let sheets;
    if (kind === 'overdue') {
      const report = overdueReport(db, req.user);
      sheets = [{
        name: 'کارهای معوقه',
        title: `کارهای معوقه — ${dateToJalali()}`,
        columns: [
          { key: 'person', label: 'مسئول', width: 22 }, { key: 'title', label: 'عنوان تسک', width: 40 }, { key: 'priority', label: 'اولویت', width: 10 },
          { key: 'due', label: 'سررسید', width: 16 }, { key: 'late', label: 'روز تأخیر', type: 'number', width: 11 }, { key: 'status', label: 'وضعیت', width: 16 },
          { key: 'progress', label: 'پیشرفت', type: 'percent', width: 10 }
        ],
        rows: report.people.flatMap((p) => p.tasks.map((t) => ({
          person: p.fullName, title: t.title, priority: PRIORITIES[t.priority].label, due: `${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ''}`,
          late: t.lateDays, status: STATUSES[t.status].label, progress: t.progress
        })))
      }];
    } else if (kind === 'staff') {
      const report = staffStatus(db, req.user);
      sheets = [{
        name: 'وضعیت پرسنل',
        title: `وضعیت کلی پرسنل — ${dateToJalali()}`,
        columns: [
          { key: 'fullName', label: 'نام', width: 22 }, { key: 'departmentName', label: 'واحد', width: 16 }, { key: 'open', label: 'باز', type: 'number', width: 8 },
          { key: 'overdue', label: 'معوقه', type: 'number', width: 8 }, { key: 'review', label: 'منتظر تأیید', type: 'number', width: 11 },
          { key: 'blocked', label: 'متوقف', type: 'number', width: 8 }, { key: 'doneWeek', label: 'انجام‌شده ۷ روز اخیر', type: 'number', width: 14 },
          { key: 'report', label: 'گزارش امروز', width: 12 }, { key: 'lastReport', label: 'آخرین گزارش', width: 14 }
        ],
        rows: report.people.map((p) => ({ ...p, report: p.reportToday ? 'ثبت شده' : '—', lastReport: p.lastReport || '—' }))
      }];
    } else if (kind === 'scorecard') {
      const report = scorecard(db, req.user, req.query.month);
      sheets = [{
        name: 'کارنامه',
        title: `کارنامه پرسنل — ${report.month}`,
        columns: [
          { key: 'fullName', label: 'نام', width: 22 }, { key: 'departmentName', label: 'واحد', width: 16 }, { key: 'score', label: 'امتیاز', type: 'number', width: 9 },
          { key: 'due', label: 'کارهای سررسیدشده', type: 'number', width: 14 }, { key: 'onTime', label: 'به‌موقع', type: 'number', width: 9 },
          { key: 'lateDone', label: 'با تأخیر', type: 'number', width: 9 }, { key: 'openLate', label: 'هنوز معوقه', type: 'number', width: 10 },
          { key: 'onTimeRate', label: 'درصد به‌موقع', type: 'percent', width: 11 }, { key: 'avgDelay', label: 'میانگین تأخیر (روز)', type: 'number', width: 14 },
          { key: 'returns', label: 'برگشتی', type: 'number', width: 9 }, { key: 'reportRate', label: 'نظم گزارش روزانه', type: 'percent', width: 14 },
          { key: 'completed', label: 'انجام‌شده در ماه', type: 'number', width: 13 }
        ],
        rows: report.people
      }];
    } else if (kind === 'tasks') {
      const tasks = listTasks(db, req.user, { scope: 'all' });
      sheets = [{
        name: 'تسک‌ها',
        title: `فهرست تسک‌ها — ${dateToJalali()}`,
        columns: [
          { key: 'id', label: 'شماره', type: 'number', width: 8 }, { key: 'title', label: 'عنوان', width: 40 }, { key: 'assigneeName', label: 'مسئول', width: 20 },
          { key: 'creatorName', label: 'تعریف‌کننده', width: 20 }, { key: 'priority', label: 'اولویت', width: 9 }, { key: 'status', label: 'وضعیت', width: 14 },
          { key: 'tag', label: 'برچسب', width: 14 }, { key: 'startDate', label: 'شروع', width: 12 }, { key: 'due', label: 'سررسید', width: 16 },
          { key: 'progress', label: 'پیشرفت', type: 'percent', width: 9 }, { key: 'lateDays', label: 'روز تأخیر', type: 'number', width: 10 }
        ],
        rows: tasks.map((t) => ({ ...t, priority: PRIORITIES[t.priority].label, status: STATUSES[t.status].label, due: t.dueDate ? `${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ''}` : '' }))
      }];
    } else {
      throw new HttpError(404, 'گزارش پیدا نشد.');
    }
    sendWorkbook(res, await buildWorkbook(sheets), `${sheets[0].name}-${stamp}.xlsx`);
  }));

  // ---------- Notifications ----------
  api.get('/notifications', handle((req) => {
    const rows = db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100', [req.user.id]);
    return {
      unread: db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.user.id]).n,
      notifications: rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, taskId: n.task_id, createdAt: n.created_at, readAt: n.read_at }))
    };
  }));
  // Used by the Android background check: only what arrived after `after`.
  api.get('/notifications/since', handle((req) => ({
    notifications: db.all('SELECT id, type, key, title, body, link FROM notifications WHERE user_id = ? AND id > ? AND read_at IS NULL ORDER BY id LIMIT 20',
      [req.user.id, Number(req.query.after) || 0])
  })));
  api.post('/notifications/read', handle((req) => {
    const now = new Date().toISOString();
    if (req.body.all) db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [now, req.user.id]);
    else if (req.body.taskId) db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND task_id = ? AND read_at IS NULL', [now, req.user.id, Number(req.body.taskId)]);
    else (req.body.ids || []).forEach((id) => db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', [now, Number(id), req.user.id]));
    publish([req.user.id], { type: 'notifications_read' });
  }));

  // ---------- Users & departments ----------
  api.get('/users', requireRole(...BOSS), handle(() => ({
    users: db.all("SELECT * FROM users ORDER BY active DESC, CASE role WHEN 'ceo' THEN 0 WHEN 'admin' THEN 1 WHEN 'supervisor' THEN 2 ELSE 3 END, full_name").map(publicUser)
  })));

  const cleanUser = (b, { creating }) => {
    const out = {};
    if (creating || b.username !== undefined) {
      out.username = String(b.username || '').trim();
      if (!/^[A-Za-z0-9._-]{3,30}$/.test(out.username)) throw new HttpError(422, 'نام کاربری باید ۳ تا ۳۰ نویسه انگلیسی، عدد، نقطه یا خط تیره باشد.');
    }
    if (creating || b.fullName !== undefined) {
      out.full_name = String(b.fullName || '').trim();
      if (!out.full_name) throw new HttpError(422, 'نام و نام خانوادگی را وارد کنید.');
    }
    if (creating || b.role !== undefined) {
      if (!ROLES[b.role]) throw new HttpError(422, 'نقش کاربر معتبر نیست.');
      out.role = b.role;
    }
    if (b.title !== undefined) out.title = String(b.title || '').trim().slice(0, 60);
    if (b.phone !== undefined) out.phone = String(b.phone || '').trim().slice(0, 20);
    if (b.departmentId !== undefined) {
      out.department_id = b.departmentId ? Number(b.departmentId) : null;
      if (out.department_id && !db.get('SELECT id FROM departments WHERE id = ?', [out.department_id])) throw new HttpError(422, 'واحد انتخاب‌شده پیدا نشد.');
    }
    if (creating || b.password) {
      if (String(b.password || '').length < 6) throw new HttpError(422, 'رمز عبور باید حداقل ۶ نویسه باشد.');
      out.password_hash = hashPassword(String(b.password));
      out.must_change_password = b.mustChangePassword === false ? 0 : 1;
    }
    if (b.active !== undefined) out.active = b.active ? 1 : 0;
    return out;
  };

  api.post('/users', requireRole(...BOSS), handle((req) => {
    const input = cleanUser(req.body, { creating: true });
    if (db.get('SELECT id FROM users WHERE username = ?', [input.username])) throw new HttpError(409, 'این نام کاربری قبلاً ثبت شده است.');
    input.created_at = new Date().toISOString();
    const keys = Object.keys(input);
    const { lastId } = db.run(`INSERT INTO users (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => input[k]));
    db.audit('user', lastId, 'create', req.user.id, { username: input.username, role: input.role });
    publish('all', { type: 'meta' });
    return { user: publicUser(db.get('SELECT * FROM users WHERE id = ?', [lastId])) };
  }));

  api.put('/users/:id', requireRole(...BOSS), handle((req) => {
    const id = Number(req.params.id);
    const target = db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!target) throw new HttpError(404, 'کاربر پیدا نشد.');
    const input = cleanUser(req.body, { creating: false });
    if (input.username && db.get('SELECT id FROM users WHERE username = ? AND id != ?', [input.username, id])) throw new HttpError(409, 'این نام کاربری قبلاً ثبت شده است.');
    const bossLeft = db.get("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND role IN ('ceo', 'admin') AND id != ?", [id]).n;
    const losingBoss = BOSS.includes(target.role) && ((input.role && !BOSS.includes(input.role)) || input.active === 0);
    if (losingBoss && !bossLeft) throw new HttpError(422, 'حداقل یک مدیر عامل یا مدیر سامانه فعال باید باقی بماند.');
    if (id === req.user.id && input.active === 0) throw new HttpError(422, 'نمی‌توانید حساب خودتان را غیرفعال کنید.');
    const keys = Object.keys(input);
    if (keys.length) db.run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => input[k]), id]);
    if (input.active === 0 || input.password_hash) db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
    db.audit('user', id, 'update', req.user.id, { fields: keys.filter((k) => k !== 'password_hash') });
    publish('all', { type: 'meta' });
    // Deactivating someone leaves their open tasks with nobody working on them; the admin is told how many.
    const openTasks = input.active === 0
      ? db.get("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND is_private = 0 AND status IN ('todo', 'doing', 'blocked', 'returned', 'review')", [id]).n
      : 0;
    return { user: publicUser(db.get('SELECT * FROM users WHERE id = ?', [id])), openTasks };
  }));

  api.post('/departments', requireRole(...BOSS), handle((req) => {
    const name = String(req.body.name || '').trim();
    if (!name) throw new HttpError(422, 'نام واحد را وارد کنید.');
    const order = db.get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM departments').n;
    db.run('INSERT INTO departments (name, sort_order) VALUES (?, ?)', [name.slice(0, 60), order]);
    publish('all', { type: 'meta' });
  }));
  api.put('/departments/:id', requireRole(...BOSS), handle((req) => {
    const name = String(req.body.name || '').trim();
    if (!name) throw new HttpError(422, 'نام واحد را وارد کنید.');
    db.run('UPDATE departments SET name = ? WHERE id = ?', [name.slice(0, 60), Number(req.params.id)]);
    publish('all', { type: 'meta' });
  }));
  api.delete('/departments/:id', requireRole(...BOSS), handle((req) => {
    const id = Number(req.params.id);
    if (db.get('SELECT id FROM users WHERE department_id = ? AND active = 1 LIMIT 1', [id])) throw new HttpError(422, 'این واحد کاربر فعال دارد؛ ابتدا کاربران را به واحد دیگری منتقل کنید.');
    db.run('UPDATE users SET department_id = NULL WHERE department_id = ?', [id]);
    db.run('DELETE FROM departments WHERE id = ?', [id]);
    publish('all', { type: 'meta' });
  }));

  // ---------- Settings ----------
  api.get('/settings', requireRole(...BOSS), handle(() => clientSettings()));
  api.put('/settings', requireRole(...BOSS), handle((req) => {
    const b = req.body;
    const time = (v, label) => {
      if (!/^\d{2}:\d{2}$/.test(String(v))) throw new HttpError(422, `${label} معتبر نیست.`);
      return v;
    };
    db.transaction(() => {
      if (b.companyName !== undefined) db.setSetting('company_name', String(b.companyName).trim().slice(0, 80) || DEFAULT_SETTINGS.company_name);
      if (b.workDays !== undefined) db.setSetting('work_days', [...new Set(b.workDays.map(Number).filter((d) => d >= 0 && d <= 6))].sort());
      if (b.holidays !== undefined) {
        const list = b.holidays.map((d) => normalizeJalali(d)).filter(Boolean);
        db.setSetting('holidays', [...new Set(list)].sort());
      }
      if (b.requireApproval !== undefined) db.setSetting('require_approval', Boolean(b.requireApproval));
      if (b.reportHour !== undefined) db.setSetting('report_hour', time(b.reportHour, 'ساعت یادآوری گزارش'));
      if (b.digestHour !== undefined) db.setSetting('digest_hour', time(b.digestHour, 'ساعت گزارش صبحگاهی'));
    });
    publish('all', { type: 'meta' });
    return clientSettings();
  }));

  // ---------- Demo data & backups ----------
  api.get('/system/demo', requireRole(...BOSS), handle(() => demoStatus(db)));
  api.post('/system/demo', requireRole(...BOSS), handle((req) => {
    loadDemoData(db, req.user);
    publish('all', { type: 'meta' });
    return demoStatus(db);
  }));
  api.delete('/system/demo', requireRole(...BOSS), handle(() => {
    removeDemoData(db);
    publish('all', { type: 'meta' });
    return demoStatus(db);
  }));

  api.get('/system/backups', requireRole(...BOSS), handle(() => ({ backups: db.listBackups() })));
  api.get('/system/backup/download', requireRole(...BOSS), (req, res) => {
    const target = db.snapshot(path.join(db.backupDir, 'download.tmp.db'));
    res.download(target, `vazifeh-${dateToJalali().replaceAll('/', '-')}.db`, { dotfiles: 'allow' }, () => fs.rmSync(target, { force: true }));
  });

  api.use((req, res) => res.status(404).json({ error: 'مسیر پیدا نشد.' }));
  app.use('/api', api);

  // Installers (APK, desktop setup) are served for in-app updates.
  if (downloadsDir) app.use('/downloads', express.static(downloadsDir, { dotfiles: 'allow', maxAge: 0 }));

  if (staticDir && fs.existsSync(staticDir)) {
    // Hashed assets can be cached for long; index.html must always be fresh so updates show up.
    app.use(express.static(staticDir, {
      index: 'index.html',
      setHeaders: (res, filePath) => res.setHeader('Cache-Control',
        filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
    }));
    app.use((req, res) => res.sendFile(path.join(staticDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  }

  return app;
}

// downloads/android.json: { "version": "1.0.1", "file": "Vazifeh-1.0.1.apk", "notes": "…" }
function readAndroidRelease(dir) {
  try {
    // trimStart also drops the byte-order mark Windows tools often add; JSON.parse rejects it.
    return JSON.parse(fs.readFileSync(path.join(dir, 'android.json'), 'utf8').trimStart());
  } catch {
    return null;
  }
}

import { clock, isWorkDay, today as todayJalali } from './calendar.js';
import { cleanOrphans } from './files.js';
import { bossIds, notify } from './notify.js';
import { runRecurrences } from './recurrences.js';
import { digestFor } from './reports.js';
import { addDaysJalali } from '../shared/jalali.js';
import { OPEN_STATUSES, isOverdue } from '../shared/status.js';

// Reminders are not sent in the middle of the night; they wait for the morning.
const QUIET_BEFORE = '07:00';
const QUIET_AFTER = '21:30';

export function tick(db, now = new Date()) {
  const date = todayJalali(now);
  const time = clock(now);
  const settings = db.settings();
  const workDay = isWorkDay(settings, date);

  runRecurrences(db, now);
  ringAlarms(db, now, date, time);
  if (time < QUIET_BEFORE || time > QUIET_AFTER) return;

  const open = db.all(
    `SELECT t.* FROM tasks t JOIN users u ON u.id = t.assignee_id
     WHERE u.active = 1 AND t.due_date IS NOT NULL AND t.status IN (${OPEN_STATUSES.map(() => '?').join(',')}) AND t.due_date <= ?`,
    [...OPEN_STATUSES, addDaysJalali(date, 1)]
  );
  // A task made in the last few hours already told its owner the deadline; no second "due" message yet.
  const fresh = new Date(now.getTime() - 3 * 3600000).toISOString();
  open.forEach((task) => {
    const link = `/task/${task.id}`;
    if (!isOverdue(task, now) && task.created_at > fresh) return;
    if (isOverdue(task, now)) {
      notify(db, [task.assignee_id], { type: 'overdue', key: `overdue:${task.id}:${task.due_date}`, title: `معوقه شد: ${task.title}`, body: `مهلت ${task.due_date}${task.due_time ? ` ساعت ${task.due_time}` : ''} گذشته است.`, link, taskId: task.id });
    } else if (task.due_date === date) {
      notify(db, [task.assignee_id], { type: 'due', key: `due:${task.id}:${task.due_date}`, title: `سررسید امروز: ${task.title}`, body: task.due_time ? `تا ساعت ${task.due_time}` : 'تا پایان امروز', link, taskId: task.id });
    } else {
      notify(db, [task.assignee_id], { type: 'due', key: `soon:${task.id}:${task.due_date}`, title: `سررسید فردا: ${task.title}`, body: task.due_time ? `فردا ساعت ${task.due_time}` : 'فردا', link, taskId: task.id });
    }
  });

  if (!workDay) return;

  if (time >= settings.report_hour) {
    const missing = db.all(
      `SELECT id FROM users WHERE active = 1 AND role IN ('employee', 'supervisor')
       AND id NOT IN (SELECT user_id FROM daily_reports WHERE date = ?)`, [date]
    );
    notify(db, missing.map((u) => u.id), { type: 'report_reminder', key: `report:${date}`, title: 'گزارش کار امروز را ثبت کنید', body: 'چند خط کوتاه: کارهای امروز، مشکلات، برنامه فردا.', link: '/daily' });
  }

  if (time >= settings.digest_hour) {
    bossIds(db).forEach((id) => {
      const viewer = db.get('SELECT * FROM users WHERE id = ?', [id]);
      const digest = digestFor(db, viewer);
      notify(db, [id], { type: 'digest', key: `digest:${date}`, title: 'گزارش صبحگاهی وضعیت پرسنل', body: digest.text, link: '/reports' });
    });
  }
}

export function startScheduler(db) {
  const run = () => {
    try { tick(db); } catch (error) { console.error('scheduler:', error); }
  };
  const minute = setInterval(run, 60000);
  const hourly = setInterval(() => {
    try { cleanOrphans(db); db.dailyBackup(); } catch (error) { console.error('maintenance:', error); }
  }, 3600000);
  setTimeout(run, 2000);
  return { stop() { clearInterval(minute); clearInterval(hourly); } };
}

// Alarms the assignee set on their own tasks ring at the chosen minute, at any hour (it was their choice).
// The key makes each alarm ring once; one missed while the server was down for less than a day still rings.
export const alarmKey = (task) => `alarm:${task.id}:${task.alarm_date} ${task.alarm_time}`;
export function ringAlarms(db, now, date, time) {
  const due = db.all(
    `SELECT t.* FROM tasks t JOIN users u ON u.id = t.assignee_id
     WHERE u.active = 1 AND t.alarm_date IS NOT NULL AND t.alarm_time IS NOT NULL
       AND t.status IN (${OPEN_STATUSES.map(() => '?').join(',')})
       AND ((t.alarm_date = ? AND t.alarm_time <= ?) OR (t.alarm_date = ? AND t.alarm_time > ?))`,
    [...OPEN_STATUSES, date, time, addDaysJalali(date, -1), time]
  );
  due.forEach((task) => {
    const when = task.due_date ? `سررسید ${task.due_date}${task.due_time ? ` ساعت ${task.due_time}` : ''}` : 'یادآوری که خودتان گذاشتید';
    notify(db, [task.assignee_id], { type: 'alarm', key: alarmKey(task), title: `⏰ ${task.title}`, body: when, link: `/task/${task.id}`, taskId: task.id });
  });
}

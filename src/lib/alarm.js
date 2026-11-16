// Alarms on one's own tasks: a Jalali date + "HH:MM" that rings on the phone and on the desktop app.
import { dateToJalali, jalaliToDate } from '../../shared/jalali.js';

const pad2 = (n) => String(n).padStart(2, '0');

// A Jalali date + "HH:MM" as a local Date.
export function alarmMoment(date, time) {
  const d = date ? jalaliToDate(date) : null;
  if (!d || !/^\d{2}:\d{2}/.test(time || '')) return null;
  const [h, m] = time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

export const fromMoment = (d) => ({ date: dateToJalali(d), time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` });

// Same key as the server's notification (server/scheduler.js), so a phone that already rang an alarm itself can
// skip the copy the background check fetches later.
export const alarmKey = (task) => `alarm:${task.id}:${task.alarmDate} ${task.alarmTime}`;

// Statuses in which an alarm still rings (the same "open" list the server uses).
export const ALARM_STATUSES = ['todo', 'doing', 'blocked', 'returned'];

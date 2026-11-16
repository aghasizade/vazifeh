import { dateToJalali, jalaliWeekday, monthLength, parseJalali } from '../shared/jalali.js';

export const today = (now = new Date()) => dateToJalali(now);

export const clock = (now = new Date()) => `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

export function isWorkDay(settings, date) {
  if ((settings.holidays || []).includes(date)) return false;
  return (settings.work_days || []).includes(jalaliWeekday(date));
}

// Does a recurring task fall on this Jalali date?
export function recurrenceMatches(rule, date, settings) {
  if (date < rule.start_date || (rule.end_date && date > rule.end_date)) return false;
  if (rule.kind === 'daily') return isWorkDay(settings, date);
  if (rule.kind === 'weekly') return (JSON.parse(rule.weekdays || '[]')).includes(jalaliWeekday(date));
  if (rule.kind === 'monthly') {
    const { jy, jm, jd } = parseJalali(date);
    const last = monthLength(jy, jm);
    return jd === Math.min(rule.month_day, last);
  }
  return false;
}

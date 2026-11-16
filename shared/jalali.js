// Jalali calendar helpers shared by the server and the browser client.
import { toJalaali, toGregorian, isValidJalaaliDate, jalaaliMonthLength } from 'jalaali-js';

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

// Index 0 is Saturday, the first day of the Iranian week.
export const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

export const pad = (value, length = 2) => String(value).padStart(length, '0');

export const toEnDigits = (value) => String(value ?? '')
  .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

export function dateToJalali(date = new Date()) {
  const j = toJalaali(date);
  return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
}

export function parseJalali(text) {
  const match = toEnDigits(text).trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (!match) return null;
  const [jy, jm, jd] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!isValidJalaaliDate(jy, jm, jd)) return null;
  return { jy, jm, jd };
}

export function normalizeJalali(text) {
  const p = parseJalali(text);
  return p ? `${p.jy}/${pad(p.jm)}/${pad(p.jd)}` : null;
}

export function jalaliToDate(text) {
  const p = parseJalali(text);
  if (!p) return null;
  const g = toGregorian(p.jy, p.jm, p.jd);
  return new Date(g.gy, g.gm - 1, g.gd, 12);
}

export function addDaysJalali(text, days) {
  const date = jalaliToDate(text);
  date.setDate(date.getDate() + days);
  return dateToJalali(date);
}

export function addMonthsJalali(text, months) {
  const p = parseJalali(text);
  let total = p.jy * 12 + (p.jm - 1) + months;
  const jy = Math.floor(total / 12);
  const jm = (total % 12) + 1;
  const jd = Math.min(p.jd, jalaaliMonthLength(jy, jm));
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

export const diffDays = (from, to) => Math.round((jalaliToDate(to) - jalaliToDate(from)) / 86400000);

export const jalaliWeekday = (text) => (jalaliToDate(text).getDay() + 1) % 7;

export const monthLength = jalaaliMonthLength;

export function monthLabel(yearMonth, short = false) {
  const [y, m] = yearMonth.split('/');
  const name = JALALI_MONTHS[Number(m) - 1];
  return short ? `${name} ${String(y).slice(2)}` : `${name} ${y}`;
}

// Every year/month key ("1405/03") between two dates, inclusive.
export function monthRange(from, to) {
  const keys = [];
  let [y, m] = from.split('/').map(Number);
  const [ty, tm] = to.split('/').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    keys.push(`${y}/${pad(m)}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return keys;
}

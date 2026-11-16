import { addDaysJalali, dateToJalali, diffDays, JALALI_MONTHS, toEnDigits, WEEKDAYS, jalaliWeekday } from '../../shared/jalali.js';

const formatters = new Map();
const nf = (digits) => {
  if (!formatters.has(digits)) {
    formatters.set(digits, new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: 0 }));
  }
  return formatters.get(digits);
};

export const fa = (value, digits = 0) => (value === null || value === undefined || Number.isNaN(value) ? '—' : nf(digits).format(value));
export const faDigits = (text) => String(text ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
export const APP_VERSION = __APP_VERSION__;
export { toEnDigits };

export const pct = (value, digits = 0) => (value === null || value === undefined ? '—' : `${fa(value, digits)}٪`);

export const jDate = (text) => faDigits(text || '—');

export const clockOf = (iso) => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

export function jDateTime(iso) {
  if (!iso) return '—';
  return faDigits(`${dateToJalali(new Date(iso))} — ${clockOf(iso)}`);
}

// "۱۲ آبان" or "۱۲ آبان ۱۴۰۴" when it is another year.
export function shortDate(jalali) {
  if (!jalali) return '';
  const [y, m, d] = jalali.split('/').map(Number);
  const thisYear = Number(dateToJalali().slice(0, 4));
  return faDigits(`${d} ${JALALI_MONTHS[m - 1]}${y !== thisYear ? ` ${y}` : ''}`);
}

export const weekdayName = (jalali) => WEEKDAYS[jalaliWeekday(jalali)];

// Due date in words: "امروز ۱۴:۰۰"، "فردا"، "۳ روز دیگر"، "۲ روز گذشته".
export function dueLabel(task) {
  if (!task.dueDate) return 'بدون مهلت';
  const today = dateToJalali();
  const days = diffDays(today, task.dueDate);
  const time = task.dueTime ? ` ${faDigits(task.dueTime)}` : '';
  if (days === 0) return `امروز${time}`;
  if (days === 1) return `فردا${time}`;
  if (days === -1) return `دیروز${time}`;
  if (days > 1 && days <= 6) return `${weekdayName(task.dueDate)}${time}`;
  return `${shortDate(task.dueDate)}${time}`;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const seconds = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (seconds < 60) return 'همین الان';
  if (seconds < 3600) return `${fa(Math.floor(seconds / 60))} دقیقه پیش`;
  const day = dateToJalali(new Date(iso));
  const today = dateToJalali();
  if (day === today) return `امروز ${faDigits(clockOf(iso))}`;
  if (day === addDaysJalali(today, -1)) return `دیروز ${faDigits(clockOf(iso))}`;
  return `${shortDate(day)} ${faDigits(clockOf(iso))}`;
}

export const fileSize = (bytes) => (bytes >= 1048576 ? `${fa(bytes / 1048576, 1)} مگابایت` : `${fa(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`);

export const duration = (seconds) => {
  const s = Math.round(seconds || 0);
  return faDigits(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
};

// Persian or Latin digits typed by the user, as a plain number string.
export const parseInt10 = (text) => {
  const n = parseInt(toEnDigits(text), 10);
  return Number.isFinite(n) ? n : 0;
};

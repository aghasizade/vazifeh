// Task statuses, priorities and the colour each task shows. Shared by the server and the client.
import { addDaysJalali, dateToJalali, diffDays } from './jalali.js';

export const STATUSES = {
  todo: { label: 'انجام‌نشده', open: true },
  doing: { label: 'در حال انجام', open: true },
  blocked: { label: 'متوقف', open: true },
  returned: { label: 'برگشت‌خورده', open: true },
  review: { label: 'منتظر تأیید', open: false },
  done: { label: 'انجام‌شده', open: false },
  cancelled: { label: 'لغوشده', open: false }
};

export const OPEN_STATUSES = Object.keys(STATUSES).filter((key) => STATUSES[key].open);

export const PRIORITIES = [
  { value: 0, label: 'کم' },
  { value: 1, label: 'عادی' },
  { value: 2, label: 'مهم' },
  { value: 3, label: 'فوری' }
];

export const ROLES = {
  ceo: 'مدیر عامل',
  admin: 'مدیر سامانه',
  supervisor: 'سرپرست واحد',
  employee: 'کارمند'
};

export const isManagerRole = (role) => role === 'ceo' || role === 'admin' || role === 'supervisor';

// Colour keys, in the order the legend shows them. The client maps each key to its palette.
export const TONES = {
  todo: 'انجام‌نشده',
  doing: 'در حال انجام',
  soon: 'سررسید امروز یا فردا',
  overdue: 'معوقه',
  review: 'منتظر تأیید',
  done: 'انجام‌شده',
  blocked: 'متوقف',
  returned: 'برگشت‌خورده',
  cancelled: 'لغوشده'
};

const nowTime = (now) => `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

export function isOverdue(task, now = new Date()) {
  if (!STATUSES[task.status]?.open || !task.due_date) return false;
  const today = dateToJalali(now);
  if (task.due_date < today) return true;
  return task.due_date === today && Boolean(task.due_time) && task.due_time < nowTime(now);
}

// Days past the due date (0 when not late). Open tasks count up to today; finished ones up to submission.
export function lateDays(task, now = new Date()) {
  if (!task.due_date) return 0;
  const open = Boolean(STATUSES[task.status]?.open);
  if (!open && !task.submitted_at) return 0;
  // A task sent for approval and then returned is open again: its earlier submission no longer stops the count.
  const end = open ? dateToJalali(now) : dateToJalali(new Date(task.submitted_at));
  return Math.max(0, diffDays(task.due_date, end));
}

// The date colours ("overdue", "due soon") win over the status colour while the task is still open.
export function taskTone(task, now = new Date()) {
  if (isOverdue(task, now)) return 'overdue';
  if (STATUSES[task.status]?.open && task.due_date) {
    const today = dateToJalali(now);
    if (task.due_date === today || task.due_date === addDaysJalali(today, 1)) return 'soon';
  }
  return task.status;
}

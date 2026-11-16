import { isOverdue, taskTone } from '../../shared/status.js';

// The colour of every task state. One place, so the board, cards, legend and charts agree.
export const TONE_STYLE = {
  overdue: { label: 'معوقه', hex: '#dc2626', card: 'bg-red-50', chip: 'bg-red-100 text-red-800', dot: 'bg-red-600' },
  soon: { label: 'سررسید امروز/فردا', hex: '#ea580c', card: 'bg-orange-50', chip: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500' },
  blocked: { label: 'متوقف', hex: '#a16207', card: 'bg-yellow-50', chip: 'bg-yellow-100 text-yellow-900', dot: 'bg-yellow-600' },
  returned: { label: 'برگشت‌خورده', hex: '#9c6b46', card: 'bg-[#f7efe7]', chip: 'bg-[#efe2d4] text-[#6f4a2f]', dot: 'bg-[#a47148]' },
  review: { label: 'منتظر تأیید', hex: '#7c3aed', card: 'bg-violet-50', chip: 'bg-violet-100 text-violet-800', dot: 'bg-violet-500' },
  doing: { label: 'در حال انجام', hex: '#0284c7', card: 'bg-sky-50', chip: 'bg-sky-100 text-sky-800', dot: 'bg-sky-500' },
  todo: { label: 'انجام‌نشده', hex: '#78716c', card: 'bg-white', chip: 'bg-stone-100 text-stone-700', dot: 'bg-stone-400' },
  done: { label: 'انجام‌شده', hex: '#059669', card: 'bg-emerald-50', chip: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-600' },
  cancelled: { label: 'لغوشده', hex: '#a8a29e', card: 'bg-stone-50 opacity-70', chip: 'bg-stone-100 text-stone-500', dot: 'bg-stone-300' }
};

// Most urgent first: the order cards are shown in each person's row.
export const TONE_ORDER = ['overdue', 'soon', 'blocked', 'returned', 'review', 'doing', 'todo', 'done', 'cancelled'];
export const toneRank = (tone) => TONE_ORDER.indexOf(tone);

export const STATUS_LABEL = {
  todo: 'انجام‌نشده',
  doing: 'در حال انجام',
  blocked: 'متوقف',
  returned: 'برگشت‌خورده',
  review: 'منتظر تأیید',
  done: 'انجام‌شده',
  cancelled: 'لغوشده'
};

export const PRIORITY = [
  { value: 0, label: 'کم', className: 'text-stone-400' },
  { value: 1, label: 'عادی', className: 'text-stone-500' },
  { value: 2, label: 'مهم', className: 'text-orange-600' },
  { value: 3, label: 'فوری', className: 'text-red-600' }
];

export const compareTasks = (a, b) => toneRank(toneOf(a)) - toneRank(toneOf(b))
  || b.priority - a.priority
  || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))
  || String(a.dueTime || '99').localeCompare(String(b.dueTime || '99'))
  || b.id - a.id;

// Recomputed on the device, so a task turns red the minute its deadline passes without a reload.
export const toneOf = (task, now = new Date()) => taskTone({ status: task.status, due_date: task.dueDate, due_time: task.dueTime }, now);
export const overdueNow = (task, now = new Date()) => isOverdue({ status: task.status, due_date: task.dueDate, due_time: task.dueTime }, now);

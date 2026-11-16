import { useMemo } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import { Button, Empty, ErrorBox, PageHeader, Spinner } from '../components/ui.jsx';
import { Legend, TaskCard } from '../components/common.jsx';
import { useApp } from '../lib/app.js';
import { setParams, useApi, useIsMobile, useTick } from '../lib/hooks.js';
import { fa } from '../lib/format.js';
import { compareTasks, toneOf } from '../lib/tones.js';
import { dateToJalali } from '../../shared/jalali.js';

const GROUPS = [
  { key: 'overdue', title: 'معوقه', hint: 'از مهلت گذشته؛ اول این‌ها را انجام دهید.' },
  { key: 'today', title: 'امروز' },
  { key: 'returned', title: 'برگشت‌خورده', hint: 'مدیر برای اصلاح برگردانده است.' },
  { key: 'blocked', title: 'متوقف' },
  { key: 'upcoming', title: 'پیش رو' },
  { key: 'nodate', title: 'بدون مهلت' },
  { key: 'review', title: 'منتظر تأیید مدیر' },
  { key: 'done', title: 'انجام‌شده اخیر' }
];

function groupOf(task, today) {
  const tone = toneOf(task);
  if (tone === 'overdue') return 'overdue';
  if (task.status === 'review') return 'review';
  if (['done', 'cancelled'].includes(task.status)) return 'done';
  if (task.status === 'returned') return 'returned';
  if (task.status === 'blocked') return 'blocked';
  if (task.dueDate === today) return 'today';
  return task.dueDate ? 'upcoming' : 'nodate';
}

export function MyTasks({ onNewTask }) {
  const { user } = useApp();
  const mobile = useIsMobile();
  const { data, error, loading, stale } = useApi('/tasks?mine=1', { live: ['task'] });
  useTick(60000);
  const today = dateToJalali();
  const groups = useMemo(() => {
    const map = Object.fromEntries(GROUPS.map((g) => [g.key, []]));
    (data?.tasks || []).forEach((t) => map[groupOf(t, today)].push(t));
    Object.values(map).forEach((list) => list.sort(compareTasks));
    return map;
  }, [data, today]);
  const open = (data?.tasks || []).filter((t) => !['done', 'cancelled', 'review'].includes(t.status)).length;

  return (
    <div>
      <PageHeader eyebrow={`سلام ${user.fullName}`} title="کارهای من"
        subtitle={stale ? 'بدون اتصال؛ آخرین اطلاعات ذخیره‌شده نمایش داده می‌شود.' : data ? (open ? `${fa(open)} کار باز دارید.` : 'کار بازی ندارید.') : null}
        actions={!mobile && <Button icon={Plus} onClick={() => onNewTask({ selfOnly: true })}>کار جدید برای خودم</Button>} />
      <div className="mb-4"><Legend /></div>
      <ErrorBox error={error} />
      {!data && loading && <Spinner />}
      {data && !data.tasks.length && <Empty icon={ClipboardList} title="کاری برای شما ثبت نشده است">وقتی مدیر کاری به شما بسپارد، این‌جا و در اعلان‌ها می‌بینید.</Empty>}
      <div className="space-y-6">
        {GROUPS.map((g) => groups[g.key].length > 0 && (
          <section key={g.key}>
            <h2 className="mb-2 flex items-baseline gap-2 px-1 text-sm font-extrabold text-ink-800">
              {g.title} <span className="num text-xs text-ink-400">{fa(groups[g.key].length)}</span>
              {g.hint && <span className="text-xs font-normal text-ink-400">{g.hint}</span>}
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {groups[g.key].map((t) => <TaskCard key={t.id} task={t} onOpen={() => setParams({ task: t.id })} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

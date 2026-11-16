import { Pause, Play, Repeat2, Trash2 } from 'lucide-react';
import { Button, Card, cx, Empty, ErrorBox, IconButton, PageHeader, Spinner, useUi } from '../components/ui.jsx';
import { Avatar, PriorityFlag } from '../components/common.jsx';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { fa, faDigits, shortDate, weekdayName } from '../lib/format.js';
import { WEEKDAYS } from '../../shared/jalali.js';

const ruleText = (r) => {
  if (r.kind === 'daily') return 'هر روز کاری';
  if (r.kind === 'weekly') return `هر هفته: ${r.weekdays.map((d) => WEEKDAYS[d]).join('، ')}`;
  return `روز ${faDigits(r.monthDay)} هر ماه`;
};

export function Recurring({ onNewTask }) {
  const { data, error, loading, reload } = useApi('/recurrences', { live: ['task', 'meta'] });
  const { confirm, toast } = useUi();
  const toggle = async (r) => {
    try {
      await api(`/recurrences/${r.id}`, { method: 'PUT', body: { active: !r.active } });
      reload({ quiet: true });
    } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (r) => {
    if (!await confirm({ title: 'حذف تسک تکراری', message: `«${r.title}» دیگر ساخته نمی‌شود. تسک‌هایی که قبلاً ساخته شده‌اند می‌مانند.`, danger: true, confirmLabel: 'حذف' })) return;
    try {
      await api(`/recurrences/${r.id}`, { method: 'DELETE' });
      reload({ quiet: true });
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div>
      <PageHeader title="تسک‌های تکراری" subtitle="هر روز، هر هفته یا هر ماه خودکار ساخته می‌شوند."
        actions={<Button icon={Repeat2} onClick={() => onNewTask({ repeatKind: 'weekly' })}>تسک تکراری جدید</Button>} />
      <ErrorBox error={error} />
      {!data && loading && <Spinner />}
      {data && !data.recurrences.length && <Empty icon={Repeat2} title="هنوز تسک تکراری ندارید">در فرم تسک جدید، بخش «تکرار» را روی روزانه، هفتگی یا ماهانه بگذارید.</Empty>}
      <div className="grid gap-3 md:grid-cols-2">
        {data?.recurrences.map((r) => (
          <Card key={r.id} className={cx(!r.active && 'opacity-60')}>
            <div className="flex items-start gap-3">
              <Avatar name={r.assigneeName} id={r.assigneeId} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-extrabold">{r.title} <PriorityFlag priority={r.priority} /></div>
                <div className="text-xs text-ink-500">{r.assigneeName}{r.tag ? ` · ${r.tag}` : ''}</div>
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-paper px-2.5 py-1 text-xs font-semibold text-ink-700"><Repeat2 className="size-3.5 text-copper-600" />{ruleText(r)}</div>
                <div className="mt-2 text-[11px] leading-5 text-ink-400">
                  مهلت هر بار: {r.dueOffset ? `${fa(r.dueOffset)} روز بعد` : 'همان روز'}{r.dueTime ? ` ساعت ${faDigits(r.dueTime)}` : ''}
                  {' · '}از {shortDate(r.startDate)}{r.endDate ? ` تا ${shortDate(r.endDate)}` : ''}
                  {' · '}{fa(r.generated)} بار ساخته شده
                  {r.nextDate && <>{' · '}<b className="text-ink-600">بعدی: {weekdayName(r.nextDate)} {shortDate(r.nextDate)}</b></>}
                  {r.checklist.length > 0 && ` · چک‌لیست ${fa(r.checklist.length)} مرحله‌ای`}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <IconButton icon={r.active ? Pause : Play} title={r.active ? 'توقف موقت' : 'فعال کردن'} onClick={() => toggle(r)} />
                <IconButton icon={Trash2} title="حذف" onClick={() => remove(r)} className="hover:text-red-600" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

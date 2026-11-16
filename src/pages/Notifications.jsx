import { Bell, CheckCheck } from 'lucide-react';
import { Button, cx, Empty, PageHeader, Spinner } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { openLink, useApi } from '../lib/hooks.js';
import { timeAgo } from '../lib/format.js';

const TYPE_DOT = {
  task_new: 'bg-sky-500', comment: 'bg-stone-400', review: 'bg-violet-500', approved: 'bg-emerald-600', returned: 'bg-[#a47148]',
  blocked: 'bg-yellow-600', overdue: 'bg-red-600', due: 'bg-orange-500', report_reminder: 'bg-copper-500', report_issue: 'bg-red-500',
  report_note: 'bg-copper-500', digest: 'bg-ink-900', cancelled: 'bg-stone-300', task_edit: 'bg-sky-400'
};

export function NotificationList({ data, onOpen, compact }) {
  if (!data) return <Spinner />;
  if (!data.notifications.length) return <Empty icon={Bell} title="اعلانی ندارید" />;
  return (
    <ul className={cx('divide-y divide-line/70', compact && 'max-h-[60vh] overflow-y-auto')}>
      {data.notifications.map((n) => (
        <li key={n.id}>
          <button type="button" onClick={() => onOpen(n)} className={cx('flex w-full items-start gap-3 px-4 py-3 text-right hover:bg-paper/70', !n.readAt && 'bg-copper-50/50')}>
            <span className={cx('mt-1.5 size-2.5 shrink-0 rounded-full', TYPE_DOT[n.type] || 'bg-stone-400', n.readAt && 'opacity-40')} />
            <span className="min-w-0 flex-1">
              <span className={cx('block text-sm leading-6', !n.readAt ? 'font-bold text-ink-900' : 'text-ink-700')}>{n.title}</span>
              {n.body && <span className="line-clamp-2 block text-xs leading-5 text-ink-500">{n.body}</span>}
              <span className="text-[11px] text-ink-400">{timeAgo(n.createdAt)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export async function openNotification(n, reload) {
  if (!n.readAt) await api('/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {});
  openLink(n.link);
  reload?.({ quiet: true });
}

export function Notifications() {
  const { data, reload } = useApi('/notifications', { live: ['notification', 'notifications_read'] });
  return (
    <div>
      <PageHeader title="اعلان‌ها" actions={data?.unread > 0 && (
        <Button variant="outline" size="sm" icon={CheckCheck} onClick={async () => { await api('/notifications/read', { method: 'POST', body: { all: true } }); reload({ quiet: true }); }}>همه خوانده شد</Button>
      )} />
      <div className="card overflow-hidden"><NotificationList data={data} onOpen={(n) => openNotification(n, reload)} /></div>
    </div>
  );
}

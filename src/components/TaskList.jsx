import { useMemo } from 'react';
import { CheckSquare, Clock3, MessageSquare, Paperclip, PenLine } from 'lucide-react';
import { cx, Empty, Modal } from './ui.jsx';
import { Avatar, PriorityFlag, ToneChip } from './common.jsx';
import { setParams, useHashRoute } from '../lib/hooks.js';
import { dueLabel, fa, faDigits } from '../lib/format.js';
import { compareTasks, STATUS_LABEL, TONE_STYLE, toneOf } from '../lib/tones.js';

// The tasks behind a counter, with their details, grouped by person. A row opens the task; while it is open the
// list steps aside and comes back when the task is closed.
export function TaskListModal({ list, onClose }) {
  const { params } = useHashRoute();
  const groups = useMemo(() => {
    const byPerson = new Map();
    [...(list?.tasks || [])].sort(compareTasks).forEach((t) => {
      if (!byPerson.has(t.assigneeId)) byPerson.set(t.assigneeId, { id: t.assigneeId, name: t.assigneeName, tasks: [] });
      byPerson.get(t.assigneeId).tasks.push(t);
    });
    return [...byPerson.values()].sort((a, b) => b.tasks.length - a.tasks.length || a.name.localeCompare(b.name, 'fa'));
  }, [list]);
  const total = list?.tasks.length || 0;

  return (
    <Modal open={Boolean(list) && !params.task} onClose={onClose} width="max-w-3xl"
      title={list && <span className="flex items-center gap-2">{list.tone && <span className={cx('size-2.5 rounded-full', TONE_STYLE[list.tone].dot)} />}{list.title}<span className="num text-sm font-semibold text-ink-400">({fa(total)} کار)</span></span>}>
      {!total && <Empty title="کاری در این دسته نیست" />}
      <div className="space-y-4">
        {groups.map((g) => (
          <section key={g.id}>
            {groups.length > 1 && (
              <h4 className="mb-1.5 flex items-center gap-2 text-sm font-extrabold text-ink-800">
                <Avatar name={g.name} id={g.id} size={24} />{g.name}<span className="num text-xs font-semibold text-ink-400">{fa(g.tasks.length)}</span>
              </h4>
            )}
            <ul className="space-y-1.5">{g.tasks.map((t) => <TaskRow key={t.id} task={t} showAssignee={groups.length === 1} />)}</ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}

function TaskRow({ task, showAssignee }) {
  const tone = toneOf(task);
  const style = TONE_STYLE[tone];
  return (
    <li>
      <button type="button" onClick={() => setParams({ task: task.id })} style={{ borderRightColor: style.hex }}
        className={cx('flex w-full flex-col gap-1.5 rounded-xl border border-black/10 border-r-4 px-3 py-2.5 text-right transition hover:shadow-md', style.card)}>
        <div className="flex items-start justify-between gap-2">
          <span className={cx('min-w-0 text-sm font-bold leading-6 text-ink-900', task.status === 'cancelled' && 'line-through')}>{task.title}</span>
          <PriorityFlag priority={task.priority} withLabel />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
          {showAssignee && <span className="inline-flex items-center gap-1 font-semibold text-ink-700"><Avatar name={task.assigneeName} id={task.assigneeId} size={18} />{task.assigneeName}</span>}
          <ToneChip tone={tone}>{tone === task.status ? undefined : `${style.label} · ${STATUS_LABEL[task.status]}`}</ToneChip>
          <span className={cx('inline-flex items-center gap-1 font-semibold', tone === 'overdue' && 'text-red-700', tone === 'soon' && 'text-orange-700')}>
            <Clock3 className="size-3.5" />{dueLabel(task)}
            {task.lateDays > 0 && <span>({faDigits(task.lateDays)} روز تأخیر)</span>}
          </span>
          {task.progress > 0 && <span className="num">پیشرفت {fa(task.progress)}٪</span>}
          {task.checkTotal > 0 && <span className="inline-flex items-center gap-1"><CheckSquare className="size-3.5" />{faDigits(`${task.checkDone}/${task.checkTotal}`)}</span>}
          {task.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="size-3.5" />{fa(task.commentCount)}</span>}
          {task.fileCount > 0 && <span className="inline-flex items-center gap-1"><Paperclip className="size-3.5" />{fa(task.fileCount)}</span>}
          {task.tag && <span className="rounded-full bg-white/70 px-2 py-0.5 ring-1 ring-black/5">{task.tag}</span>}
          {task.creatorName && task.creatorName !== task.assigneeName && <span className="inline-flex items-center gap-1"><PenLine className="size-3.5" />ثبت: {task.creatorName}</span>}
        </div>
        {task.blockedReason && ['blocked', 'returned'].includes(task.status) && <p className="text-xs leading-6 text-yellow-900">علت: {task.blockedReason}</p>}
        {task.description && <p className="line-clamp-2 text-xs leading-6 text-ink-600">{task.description}</p>}
        {task.progress > 0 && task.progress < 100 && (
          <div className="h-1 overflow-hidden rounded-full bg-black/5"><div className="h-full rounded-full" style={{ width: `${task.progress}%`, background: style.hex }} /></div>
        )}
      </button>
    </li>
  );
}

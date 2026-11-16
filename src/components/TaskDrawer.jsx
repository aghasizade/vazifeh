import { useEffect, useRef, useState } from 'react';
import {
  Ban, Camera, Check, CheckCheck, CheckCircle2, CircleDashed, Clock3, CloudOff, Loader2, Lock, MapPin, MessageSquarePlus, Mic, MoreHorizontal, Paperclip,
  Pause, Pencil, Play, Plus, RotateCcw, Send, Square, Trash2, Undo2, UserRound, X
} from 'lucide-react';
import { Button, cx, Drawer, ErrorBox, IconButton, Spinner, useUi } from './ui.jsx';
import { Attachments, Avatar, LocationLink, PriorityFlag, ToneChip } from './common.jsx';
import { TaskForm } from './TaskForm.jsx';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app.js';
import { useApi, useTick } from '../lib/hooks.js';
import { onOutbox, send } from '../lib/offline.js';
import { compressImage, createRecorder, getLocation } from '../lib/media.js';
import { dueLabel, duration, fa, faDigits, jDate, shortDate, timeAgo } from '../lib/format.js';
import { STATUS_LABEL, TONE_STYLE, toneOf } from '../lib/tones.js';

export function TaskDrawer({ taskId, onClose }) {
  const { user } = useApp();
  const { data, error, loading, reload } = useApi(`/tasks/${taskId}`, { live: ['task'], cache: true });
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState([]);
  useTick(30000);
  // Once the outbox is empty, queued messages have reached the server: the real ones replace the placeholders.
  useEffect(() => onOutbox((count) => {
    if (count) return;
    setPending((p) => {
      if (p.length) reload({ quiet: true });
      return p.length ? [] : p;
    });
  }), [reload]);

  useEffect(() => {
    api('/notifications/read', { method: 'POST', body: { taskId: Number(taskId) } }).catch(() => {});
  }, [taskId, data?.events?.length]);

  // Read receipts: while the conversation is open on screen, tell the server it has been seen (the senders then see
  // two ticks). A drawer left open behind a locked phone or a hidden window does not count.
  const newestEvent = data?.events?.length ? data.events[data.events.length - 1].id : 0;
  useEffect(() => {
    if (!newestEvent) return undefined;
    const mark = () => { if (!document.hidden) api(`/tasks/${taskId}/read`, { method: 'POST' }).catch(() => {}); };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [taskId, newestEvent]);

  const task = data?.task;
  return (
    <Drawer open onClose={onClose} width="max-w-2xl"
      title={task ? <span className="flex items-center gap-2"><span className="truncate">{task.title}</span></span> : 'جزئیات تسک'}>
      {!data && loading && <Spinner />}
      {error && !data && <ErrorBox error={error} />}
      {task && (
        <div className="flex min-h-full flex-col gap-4 pb-2">
          <Header data={data} onEdit={() => setEditing(true)} onChanged={reload} onClose={onClose} />
          <Checklist data={data} onChanged={reload} />
          <Timeline data={data} pending={pending} me={user.id} onChanged={reload} />
          <Composer taskId={task.id} onSent={(item) => { if (item) setPending((p) => [...p, item]); else reload({ quiet: true }); }} />
          <TaskForm open={editing} onClose={() => setEditing(false)} task={task} onSaved={reload} />
        </div>
      )}
    </Drawer>
  );
}

function Header({ data, onEdit, onChanged, onClose }) {
  const { task, permissions: can } = data;
  const { user, meta } = useApp();
  const { confirm, toast } = useUi();
  const [busy, setBusy] = useState(null);
  const [menu, setMenu] = useState(false);
  const [progress, setProgress] = useState(task.progress);
  useEffect(() => setProgress(task.progress), [task.progress]);
  const tone = toneOf(task);
  const open = ['todo', 'doing', 'blocked', 'returned'].includes(task.status);
  const isAssignee = task.assigneeId === user.id;

  const status = async (next, { ask, okMessage } = {}) => {
    let note = '';
    if (ask) {
      note = await confirm(ask);
      if (note === false) return;
    }
    setBusy(next);
    try {
      const result = await send({ path: `/tasks/${task.id}/status`, method: 'POST', body: { status: next, note }, label: 'تغییر وضعیت' });
      toast(result?.queued ? 'بدون اینترنت؛ تغییر وضعیت در صف ارسال ماند.' : okMessage || 'وضعیت به‌روز شد.');
      onChanged({ quiet: true });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setMenu(false);
    if (!await confirm({ title: 'حذف تسک', message: 'تسک و همه پیام‌ها و فایل‌هایش حذف می‌شود. ادامه می‌دهید؟', danger: true, confirmLabel: 'حذف' })) return;
    try {
      await api(`/tasks/${task.id}`, { method: 'DELETE' });
      toast('تسک حذف شد.');
      onClose();
    } catch (error) { toast(error.message, 'error'); }
  };

  const saveProgress = async (value) => {
    try {
      await send({ path: `/tasks/${task.id}/progress`, method: 'POST', body: { progress: value }, label: 'پیشرفت' });
    } catch (error) { toast(error.message, 'error'); }
  };

  const taskFiles = data.events.find((e) => e.type === 'created')?.files || [];
  const returnNote = [...data.events].reverse().find((e) => e.type === 'status' && e.meta?.to === 'returned' && e.body);
  const doneNeedsApproval = meta.settings.requireApproval && !task.personal && isAssignee && !can.approve && !can.cancel;

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ToneChip tone={tone} />
        {tone !== task.status && <ToneChip tone={task.status}>{STATUS_LABEL[task.status]}</ToneChip>}
        <PriorityFlag priority={task.priority} withLabel />
        {task.tag && <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[11px] font-semibold text-ink-600">{task.tag}</span>}
        {task.isPrivate
          ? <span className="inline-flex items-center gap-1 rounded-full bg-ink-900 px-2 py-0.5 text-[11px] font-semibold text-white" title="فقط خودتان این کار را می‌بینید"><Lock className="size-3" />شخصی — فقط خودتان می‌بینید</span>
          : task.personal && <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[11px] text-ink-500">برای خودم</span>}
        <div className="mr-auto flex items-center gap-1">
          {can.edit && <IconButton icon={Pencil} title="ویرایش" onClick={onEdit} />}
          {(can.cancel || can.remove) && (
            <div className="relative">
              <IconButton icon={MoreHorizontal} title="بیشتر" onClick={() => setMenu((m) => !m)} />
              {menu && (
                <div className="rise absolute left-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-white py-1 text-sm shadow-xl" onMouseLeave={() => setMenu(false)}>
                  {can.cancel && task.status !== 'cancelled' && (
                    <button type="button" className="flex w-full items-center gap-2 px-3 py-2 hover:bg-paper" onClick={() => { setMenu(false); status('cancelled', { ask: { title: 'لغو تسک', message: 'تسک لغو می‌شود و در آمار حساب نمی‌شود.', input: 'دلیل لغو (اختیاری)…', confirmLabel: 'لغو تسک' } }); }}>
                      <Ban className="size-4" /> لغو تسک
                    </button>
                  )}
                  {can.remove && <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-red-700 hover:bg-red-50" onClick={remove}><Trash2 className="size-4" /> حذف کامل</button>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
          <Avatar name={task.assigneeName} id={task.assigneeId} size={30} />
          <div className="min-w-0"><dt className="text-[11px] text-ink-400">مسئول</dt><dd className="truncate font-bold">{task.assigneeName}</dd></div>
        </div>
        <div><dt className="text-[11px] text-ink-400">سررسید</dt><dd className={cx('font-bold', tone === 'overdue' && 'text-red-700')}>{dueLabel(task)}{task.dueDate && <span className="mr-1 text-xs font-normal text-ink-400">({jDate(task.dueDate)})</span>}</dd></div>
        <div><dt className="text-[11px] text-ink-400">تعریف‌کننده</dt><dd className="truncate">{task.creatorName}{task.startDate ? <span className="text-xs text-ink-400"> — {shortDate(task.startDate)}</span> : null}</dd></div>
        {tone === 'overdue' && <div className="col-span-2 text-xs font-bold text-red-700 sm:col-span-3">{faDigits(task.lateDays)} روز از مهلت گذشته است.</div>}
        {task.returnCount > 0 && <div className="text-xs text-[#6f4a2f]">{fa(task.returnCount)} بار برگشت خورده</div>}
      </dl>

      {task.description && <p className="mt-3 whitespace-pre-line rounded-xl bg-paper px-3 py-2.5 text-sm leading-7 text-ink-800">{task.description}</p>}
      {/* Files attached when the task was defined belong to the task itself, not to the conversation. */}
      {taskFiles.length > 0 && <div className="mt-2"><span className="text-[11px] font-semibold text-ink-400">پیوست‌های تسک</span><Attachments files={taskFiles} /></div>}
      {task.status === 'returned' && returnNote && (
        <p className="mt-3 rounded-xl bg-[#f7efe7] px-3 py-2 text-sm text-[#6f4a2f]"><b>دلیل برگشت ({returnNote.userName}):</b> {returnNote.body}</p>
      )}
      {task.status === 'blocked' && task.blockedReason && (
        <p className="mt-3 rounded-xl bg-yellow-50 px-3 py-2 text-sm text-yellow-900"><b>دلیل توقف:</b> {task.blockedReason}</p>
      )}

      {/* Progress, start and block are the assignee's own report; managers approve, return or close. */}
      {can.work && isAssignee && open && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-ink-500"><span>پیشرفت</span><span className="num font-bold">{fa(progress)}٪</span></div>
          <input type="range" min="0" max="100" step="10" value={progress} disabled={data.checklist.length > 0}
            onChange={(e) => setProgress(Number(e.target.value))} onPointerUp={(e) => saveProgress(Number(e.currentTarget.value))} onKeyUp={(e) => saveProgress(Number(e.currentTarget.value))}
            className="w-full accent-[#0284c7]" title={data.checklist.length ? 'پیشرفت از روی چک‌لیست حساب می‌شود' : ''} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {can.work && isAssignee && task.status === 'todo' && <Button variant="outline" icon={Play} loading={busy === 'doing'} onClick={() => status('doing', { okMessage: 'کار شروع شد.' })}>شروع کار</Button>}
        {can.work && isAssignee && task.status === 'blocked' && <Button variant="outline" icon={Play} loading={busy === 'doing'} onClick={() => status('doing')}>ادامه کار</Button>}
        {can.work && open && (
          <Button variant="success" icon={CheckCircle2} loading={busy === 'done'}
            onClick={() => status('done', {
              ask: { title: 'اعلام انجام کار', message: doneNeedsApproval ? 'کار برای تأیید به مدیر فرستاده می‌شود. اگر توضیحی دارید بنویسید.' : 'تسک بسته می‌شود.', input: 'توضیح کوتاه (اختیاری)…', confirmLabel: doneNeedsApproval ? 'ارسال برای تأیید' : 'انجام شد', optional: true },
              okMessage: doneNeedsApproval ? 'برای تأیید فرستاده شد.' : 'انجام شد.'
            })}>
            {doneNeedsApproval ? 'انجام شد، برای تأیید' : 'انجام شد'}
          </Button>
        )}
        {can.work && isAssignee && ['doing', 'todo', 'returned'].includes(task.status) && (
          <Button variant="outline" icon={Pause} loading={busy === 'blocked'}
            onClick={() => status('blocked', { ask: { title: 'توقف کار', message: 'چه چیزی جلوی کار را گرفته؟ مدیر باخبر می‌شود.', input: 'مثلاً: منتظر واریز تنخواه…', confirmLabel: 'ثبت توقف' } })}>متوقف شد</Button>
        )}
        {can.approve && <Button variant="success" icon={Check} loading={busy === 'approve'} onClick={() => status('approve', { okMessage: 'تأیید شد.' })}>تأیید انجام</Button>}
        {(can.approve || (can.reopen && task.status === 'done')) && (
          <Button variant="outline" icon={Undo2} loading={busy === 'return'}
            onClick={() => status('return', { ask: { title: 'برگشت به کارمند', message: 'بنویسید چه چیزی باید اصلاح یا تکمیل شود.', input: 'توضیح برگشت…', confirmLabel: 'برگشت' }, okMessage: 'تسک برگشت داده شد.' })}>برگشت با توضیح</Button>
        )}
        {can.reopen && <Button variant="ghost" icon={RotateCcw} loading={busy === 'doing'} onClick={() => status('doing', { okMessage: 'تسک دوباره باز شد.' })}>بازگشایی</Button>}
      </div>
    </section>
  );
}

function Checklist({ data, onChanged }) {
  const { checklist, permissions, task } = data;
  const { toast } = useUi();
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  // A finished task's checklist is a record; it changes again only after the task is reopened or returned.
  const editable = permissions.work && ['todo', 'doing', 'blocked', 'returned'].includes(task.status);
  const can = { work: editable, edit: permissions.edit && editable };
  if (!checklist.length && !can.work) return null;
  const toggle = async (item) => {
    try {
      const r = await send({ path: `/checklist/${item.id}`, method: 'PATCH', body: { done: !item.done }, label: 'چک‌لیست' });
      if (r?.queued) toast('بدون اینترنت؛ تغییر در صف ارسال ماند.');
      onChanged({ quiet: true });
    } catch (error) { toast(error.message, 'error'); }
  };
  const add = async () => {
    if (!text.trim()) return;
    try {
      await api(`/tasks/${task.id}/checklist`, { method: 'POST', body: { text } });
      setText('');
      onChanged({ quiet: true });
    } catch (error) { toast(error.message, 'error'); }
  };
  const remove = async (item) => {
    try {
      await api(`/checklist/${item.id}`, { method: 'DELETE' });
      onChanged({ quiet: true });
    } catch (error) { toast(error.message, 'error'); }
  };
  const done = checklist.filter((i) => i.done).length;
  // No checklist yet: one quiet link instead of an empty card.
  if (!checklist.length && !adding) {
    return (
      <button type="button" onClick={() => setAdding(true)} className="-mt-1 inline-flex items-center gap-1.5 self-start px-1 text-xs font-semibold text-ink-500 hover:text-ink-900">
        <Plus className="size-3.5" /> افزودن چک‌لیست
      </button>
    );
  }
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-extrabold">چک‌لیست {checklist.length > 0 && <span className="num text-ink-400">({faDigits(`${done}/${checklist.length}`)})</span>}</h3>
        {can.work && !adding && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setAdding(true)}>افزودن</Button>}
      </div>
      <ul className="space-y-1">
        {checklist.map((item) => (
          <li key={item.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-paper">
            <button type="button" disabled={!can.work} onClick={() => toggle(item)}
              className={cx('grid size-5 shrink-0 place-items-center rounded-md border-2 transition', item.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-300 bg-white')}>
              {item.done && <Check className="size-3.5" strokeWidth={3} />}
            </button>
            <span className={cx('flex-1 text-sm', item.done && 'text-ink-400 line-through')}>{item.text}</span>
            {can.edit && <button type="button" onClick={() => remove(item)} className="text-ink-300 opacity-0 transition group-hover:opacity-100 hover:text-red-600"><X className="size-4" /></button>}
          </li>
        ))}
      </ul>
      {adding && (
        <div className="mt-2 flex gap-2">
          <input className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="مرحله جدید…" onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Button variant="outline" onClick={add}>افزودن</Button>
          <Button variant="ghost" onClick={() => setAdding(false)}>بستن</Button>
        </div>
      )}
    </section>
  );
}

const FIELD_LABEL = { title: 'عنوان', description: 'شرح', priority: 'اولویت', tag: 'برچسب', start_date: 'تاریخ شروع', start_time: 'ساعت شروع', due_date: 'سررسید', due_time: 'ساعت سررسید', assignee_id: 'مسئول' };

function Timeline({ data, pending, me, onChanged }) {
  const { events } = data;
  const { confirm, toast } = useUi();
  const end = useRef(null);
  const seen = useRef(null);
  // Opening a task shows its top (status and actions); only a message that arrives afterwards scrolls down to it.
  useEffect(() => {
    const count = events.length + pending.length;
    if (seen.current !== null && count > seen.current) end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    seen.current = count;
  }, [events.length, pending.length]);

  const removeComment = async (event) => {
    if (!await confirm({ title: 'حذف پیام', message: 'پیام و پیوست‌هایش حذف می‌شود.', danger: true, confirmLabel: 'حذف' })) return;
    try {
      await api(`/comments/${event.id}`, { method: 'DELETE' });
      onChanged({ quiet: true });
    } catch (error) { toast(error.message, 'error'); }
  };

  return (
    <section className="flex-1 space-y-3">
      <h3 className="px-1 text-sm font-extrabold">گفت‌وگو و سابقه</h3>
      {events.map((e) => {
        if (e.type !== 'comment') {
          return (
            <div key={e.id} className="flex items-start gap-2 px-1 text-xs text-ink-500">
              <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-ink-300" />
              <div className="min-w-0">
                <span className="font-semibold text-ink-700">{e.userName}</span>{' '}
                {e.type === 'created' && 'تسک را تعریف کرد'}
                {e.type === 'edit' && `تسک را ویرایش کرد (${(e.meta?.fields || []).map((f) => FIELD_LABEL[f] || f).join('، ')})`}
                {e.type === 'status' && <>وضعیت را {e.meta?.to && <b className="font-bold" style={{ color: TONE_STYLE[e.meta.to]?.hex }}>{STATUS_LABEL[e.meta.to]}</b>} کرد</>}
                <span className="mr-1.5 text-ink-400">— {timeAgo(e.createdAt)}</span>
                {e.body && <div className="mt-1 whitespace-pre-line rounded-lg bg-white px-2.5 py-1.5 text-[13px] text-ink-800 ring-1 ring-line">{e.body}</div>}
                {e.files?.length > 0 && e.type !== 'created' && <Attachments files={e.files} />}
              </div>
            </div>
          );
        }
        const mine = e.userId === me;
        return (
          <div key={e.id} className={cx('flex gap-2', mine ? 'flex-row-reverse' : '')}>
            <Avatar name={e.userName} id={e.userId} size={30} />
            <div className={cx('group max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-sm', mine ? 'rounded-tl-md bg-copper-50 ring-1 ring-copper-100' : 'rounded-tr-md bg-white ring-1 ring-line')}>
              <div className="mb-0.5 flex items-center gap-2 text-[11px]">
                <span className="font-bold text-ink-800">{e.userName}</span>
                <span className="text-ink-400">{timeAgo(e.createdAt)}</span>
                {mine && Date.now() - new Date(e.createdAt) < 15 * 60000 && (
                  <button type="button" onClick={() => removeComment(e)} className="text-ink-300 opacity-0 group-hover:opacity-100 hover:text-red-600"><Trash2 className="size-3.5" /></button>
                )}
              </div>
              {e.body && <p className="whitespace-pre-line text-sm leading-7 text-ink-900">{e.body}</p>}
              <Attachments files={e.files} />
              <LocationLink lat={e.lat} lng={e.lng} accuracy={e.meta?.accuracy} />
              {mine && <Ticks seenBy={e.seenBy} />}
            </div>
          </div>
        );
      })}
      {pending.map((p) => (
        <div key={p.key} className="flex flex-row-reverse gap-2 opacity-70">
          <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-copper-50 px-3.5 py-2.5 ring-1 ring-copper-100">
            <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-copper-700"><CloudOff className="size-3.5" /> در صف ارسال — با وصل شدن اینترنت فرستاده می‌شود</div>
            {p.body && <p className="whitespace-pre-line text-sm leading-7">{p.body}</p>}
            {p.files?.length > 0 && <div className="text-xs text-ink-500">{faDigits(p.files.length)} پیوست</div>}
            <Ticks queued />
          </div>
        </div>
      ))}
      {/* The margin keeps the newest message clear of the sticky message box. */}
      <div ref={end} className="scroll-mb-48" />
    </section>
  );
}

// Delivery state of one's own message, as in messengers: a clock while it waits in the send queue, one tick once the
// server has it, two coloured ticks once someone else has opened the conversation (tap to see who).
function Ticks({ seenBy, queued }) {
  const { toast } = useUi();
  if (queued) {
    return <div className="mt-1 flex justify-end text-ink-400" title="در صف ارسال"><Clock3 className="size-3.5" aria-label="در صف ارسال" /></div>;
  }
  const seen = seenBy?.length > 0;
  const label = seen ? `دیده شد: ${seenBy.join('، ')}` : 'ارسال شد؛ هنوز دیده نشده';
  return (
    <div className="mt-1 flex justify-end">
      <button type="button" title={label} aria-label={label} onClick={() => toast(label)}
        className={cx('inline-flex items-center rounded p-0.5', seen ? 'text-sky-600' : 'text-ink-400')}>
        {seen ? <CheckCheck className="size-4" strokeWidth={2.5} /> : <Check className="size-4" strokeWidth={2.5} />}
      </button>
    </div>
  );
}

// Message box: text, photos (camera or gallery), files, voice note, current location.
function Composer({ taskId, onSent }) {
  const { toast } = useUi();
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [location, setLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null);
  const recorder = useRef(null);
  const camera = useRef(null);
  const picker = useRef(null);

  useEffect(() => {
    if (!recording) return undefined;
    const id = setInterval(() => setElapsed(recorder.current.elapsed()), 250);
    return () => clearInterval(id);
  }, [recording]);
  useEffect(() => () => recorder.current?.cancel(), []);

  const addFiles = async (list) => {
    const ready = await Promise.all([...list].map(async (file) => {
      const f = await compressImage(file);
      return { key: Math.random(), blob: f, name: f.name, size: f.size, kind: f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'audio' : 'doc', preview: URL.createObjectURL(f) };
    }));
    setFiles((current) => [...current, ...ready]);
  };

  const toggleRecord = async () => {
    if (recording) {
      const result = await recorder.current.stop();
      setRecording(false);
      if (result && result.duration >= 1) {
        setFiles((current) => [...current, { key: Math.random(), blob: result.blob, name: result.name, size: result.blob.size, kind: 'audio', duration: result.duration, preview: URL.createObjectURL(result.blob) }]);
      }
      return;
    }
    recorder.current = createRecorder();
    if (!recorder.current.supported) { toast('ضبط صدا روی این دستگاه پشتیبانی نمی‌شود.', 'error'); return; }
    try {
      await recorder.current.start();
      setElapsed(0);
      setRecording(true);
    } catch (error) { toast(error.message, 'error'); }
  };

  const locate = async () => {
    if (location) { setLocation(null); return; }
    setLocating(true);
    try { setLocation(await getLocation()); } catch (error) { toast(error.message, 'error'); } finally { setLocating(false); }
  };

  const submit = async () => {
    if (recording) await toggleRecord();
    if (!text.trim() && !files.length && !location) return;
    setSending(true);
    if (files.length) setProgress({ total: 0, files: {} });
    try {
      const job = {
        path: `/tasks/${taskId}/comments`,
        method: 'POST',
        label: 'پیام',
        body: { body: text, ...(location ? { lat: location.lat, lng: location.lng, accuracy: location.accuracy } : {}) },
        files: files.map((f) => ({ blob: f.blob, name: f.name, duration: f.duration, key: f.key }))
      };
      const result = await send(job, { onProgress: setProgress });
      onSent(result?.queued ? { key: Math.random(), body: text, files } : null);
      if (result?.queued) toast('بدون اینترنت؛ پیام در صف ارسال ماند.');
      setText('');
      setFiles([]);
      setLocation(null);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSending(false);
      setProgress(null);
    }
  };

  return (
    <section className="sticky -bottom-5 -mx-5 -mb-5 border-t border-line bg-white/95 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur">
      {(files.length > 0 || location) && (
        <div className="mb-2">
          <Attachments files={files} progress={progress?.files} onRemove={(f) => setFiles((list) => list.filter((x) => x.key !== f.key))} />
          {location && <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-sage-50 px-2.5 py-1 text-xs font-semibold text-sage-600"><MapPin className="size-4" /> موقعیت فعلی پیوست شد (دقت {fa(location.accuracy)} متر)</div>}
        </div>
      )}
      {recording ? (
        <div className="flex items-center gap-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="size-2.5 animate-pulse rounded-full bg-red-600" />
          در حال ضبط… <span className="num font-bold">{duration(elapsed)}</span>
          <button type="button" className="mr-auto text-xs text-ink-500" onClick={() => { recorder.current.cancel(); setRecording(false); }}>انصراف</button>
          <Button size="sm" variant="danger" icon={Square} onClick={toggleRecord}>پایان ضبط</Button>
        </div>
      ) : (
        <textarea className="input min-h-11 resize-none" rows={text.split('\n').length > 2 ? 4 : 2} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="گزارش، سؤال یا پاسخ بنویسید…" onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && submit()} />
      )}
      <div className="mt-2 flex items-center gap-1">
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={picker} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <IconButton icon={Camera} title="عکس با دوربین" className="size-10" onClick={() => camera.current.click()} />
        <IconButton icon={Paperclip} title="پیوست فایل یا عکس" className="size-10" onClick={() => picker.current.click()} />
        <IconButton icon={Mic} title="پیام صوتی" className={cx('size-10', recording && 'bg-red-100 text-red-700')} onClick={toggleRecord} />
        <IconButton icon={locating ? Loader2 : MapPin} title="ثبت موقعیت فعلی" className={cx('size-10', location && 'bg-sage-50 text-sage-600', locating && '[&_svg]:animate-spin')} onClick={locate} />
        <Button className="mr-auto" icon={Send} loading={sending} onClick={submit} disabled={!text.trim() && !files.length && !location && !recording}>{progress ? `${fa(Math.round(progress.total * 100))}٪` : 'ارسال'}</Button>
      </div>
    </section>
  );
}

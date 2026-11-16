import { useEffect, useState } from 'react';
import { CheckSquare, Clock3, Flag, Lock, MapPin, MessageSquare, Paperclip, Repeat2, X } from 'lucide-react';
import { cx } from './ui.jsx';
import { PRIORITY, TONE_ORDER, TONE_STYLE, toneOf } from '../lib/tones.js';
import { dueLabel, fa, faDigits, fileSize } from '../lib/format.js';
import { fileHref } from '../lib/config.js';
import { mapLink } from '../lib/media.js';
import { VoicePlayer } from './VoicePlayer.jsx';

const AVATAR_COLORS = ['#0f766e', '#c97422', '#4338ca', '#0369a1', '#a16207', '#be123c', '#4d7c0f', '#7c3aed', '#0e7490', '#9a3412'];

export function Avatar({ name = '', id = 0, size = 36, online }) {
  const parts = name.replace(/^(مهندس|دکتر|خانم|آقای)\s+/, '').trim().split(/\s+/);
  const initials = parts.length > 1 ? `${parts[0][0]}‌${parts[parts.length - 1][0]}` : (parts[0] || '?').slice(0, 2);
  return (
    <span className="relative inline-grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: AVATAR_COLORS[id % AVATAR_COLORS.length] }}>
      {initials}
      {online !== undefined && (
        <span className={cx('absolute -bottom-0.5 -left-0.5 rounded-full ring-2 ring-white', online ? 'bg-emerald-500' : 'bg-stone-300')}
          style={{ width: size * 0.3, height: size * 0.3 }} />
      )}
    </span>
  );
}

export function ToneChip({ tone, className, children }) {
  const style = TONE_STYLE[tone] || TONE_STYLE.todo;
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold', style.chip, className)}>
      <span className={cx('size-1.5 rounded-full', style.dot)} />
      {children || style.label}
    </span>
  );
}

export function Legend({ tones = TONE_ORDER.filter((t) => t !== 'cancelled'), counts, onPick, active }) {
  return (
    <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
      {tones.map((tone) => (
        <button key={tone} type="button" onClick={() => onPick?.(active === tone ? null : tone)}
          className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition',
            active === tone ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-white text-ink-700 hover:border-ink-400',
            !onPick && 'pointer-events-none')}>
          <span className={cx('size-2.5 rounded-full', TONE_STYLE[tone].dot)} />
          {TONE_STYLE[tone].label}
          {counts && <span className="num opacity-70">{fa(counts[tone] || 0)}</span>}
        </button>
      ))}
    </div>
  );
}

export function PriorityFlag({ priority, withLabel }) {
  if (priority < 2 && !withLabel) return null;
  const p = PRIORITY[priority] || PRIORITY[1];
  return (
    <span className={cx('inline-flex items-center gap-1 text-[11px] font-bold', p.className)} title={`اولویت ${p.label}`}>
      <Flag className="size-3.5" fill={priority >= 2 ? 'currentColor' : 'none'} />
      {(withLabel || priority >= 2) && p.label}
    </span>
  );
}

// A task as a coloured card. The colour is the state (see tones.js).
export function TaskCard({ task, onOpen, showAssignee, compact }) {
  const tone = toneOf(task);
  const style = TONE_STYLE[tone];
  return (
    <button type="button" onClick={() => onOpen(task)}
      style={{ borderRightColor: style.hex }}
      className={cx('group relative flex w-full min-w-0 flex-col gap-1.5 rounded-xl border border-black/10 border-r-4 p-2.5 text-right shadow-[0_1px_0_rgba(0,0,0,.03)] transition hover:-translate-y-px hover:shadow-md',
        style.card, compact && 'gap-1 p-2')}>
      <div className="flex items-start justify-between gap-2">
        <span className={cx('min-w-0 text-[13px] font-bold leading-6 text-ink-900', task.status === 'cancelled' && 'line-through', compact ? 'line-clamp-2' : 'line-clamp-3')}>{task.title}</span>
        <PriorityFlag priority={task.priority} />
      </div>
      {showAssignee && <div className="truncate text-[11px] font-semibold text-ink-500">{task.assigneeName}</div>}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-500">
        <span className={cx('inline-flex items-center gap-1 font-semibold', tone === 'overdue' && 'text-red-700', tone === 'soon' && 'text-orange-700')}>
          <Clock3 className="size-3.5" />
          {dueLabel(task)}
          {tone === 'overdue' && task.lateDays > 0 && <span>({faDigits(task.lateDays)} روز)</span>}
        </span>
        {task.checkTotal > 0 && <span className="inline-flex items-center gap-1"><CheckSquare className="size-3.5" />{faDigits(`${task.checkDone}/${task.checkTotal}`)}</span>}
        {task.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="size-3.5" />{fa(task.commentCount)}</span>}
        {task.fileCount > 0 && <span className="inline-flex items-center gap-1"><Paperclip className="size-3.5" />{fa(task.fileCount)}</span>}
        {task.recurrenceId && <Repeat2 className="size-3.5" title="تسک تکراری" />}
        {task.isPrivate && <span className="inline-flex items-center gap-1 font-semibold text-ink-600" title="کار شخصی؛ فقط خودتان می‌بینید"><Lock className="size-3.5" />شخصی</span>}
      </div>
      {task.progress > 0 && task.progress < 100 && !['done', 'review'].includes(task.status) && (
        <div className="h-1 overflow-hidden rounded-full bg-black/5"><div className="h-full rounded-full" style={{ width: `${task.progress}%`, background: style.hex }} /></div>
      )}
      {['blocked', 'review', 'returned'].includes(task.status) && tone !== task.status && (
        <ToneChip tone={task.status} className="self-start" />
      )}
    </button>
  );
}

// Photos as thumbnails, voice notes as players, other files as chips.
// Upload percentage over a file being sent, like messengers do.
function UploadRing({ value }) {
  const pct = Math.round((value || 0) * 100);
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid size-11 place-items-center" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="در حال ارسال">
      <svg viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - (value || 0))} className="transition-[stroke-dashoffset] duration-200" />
      </svg>
      <span className="num text-[10px] font-bold">{fa(pct)}٪</span>
    </span>
  );
}

function UploadBar({ value }) {
  const pct = Math.round((value || 0) * 100);
  return (
    <div className="mt-1 flex items-center gap-2 text-[10px] font-semibold text-copper-700" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="در حال ارسال">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-copper-100"><div className="h-full rounded-full bg-copper-600 transition-[width] duration-200" style={{ width: `${pct}%` }} /></div>
      <span className="num shrink-0">{fa(pct)}٪</span>
    </div>
  );
}

// progress: { [file.key]: 0…1 } while the files are being uploaded (only for files not sent yet).
export function Attachments({ files, onRemove, progress }) {
  const [view, setView] = useState(null);
  useEffect(() => {
    if (!view) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      setView(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [view]);
  if (!files?.length) return null;
  const images = files.filter((f) => f.kind === 'image');
  const others = files.filter((f) => f.kind !== 'image');
  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((f) => (
            <div key={f.id ?? f.key} className="relative">
              <button type="button" onClick={() => setView(f)} className="block overflow-hidden rounded-lg border border-line bg-paper">
                <img src={f.preview || fileHref(f.url)} alt={f.name} loading="lazy" className="size-24 object-cover sm:size-28" />
              </button>
              {progress && progress[f.key] !== undefined && progress[f.key] < 1 && (
                <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/45 text-white"><UploadRing value={progress[f.key]} /></span>
              )}
              {progress && progress[f.key] >= 1 && (
                <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/25 text-white"><CheckSquare className="size-6" /></span>
              )}
              {onRemove && !progress && <RemoveButton onClick={() => onRemove(f)} />}
            </div>
          ))}
        </div>
      )}
      {others.map((f) => (
        <div key={f.id ?? f.key}>
        <div className="relative flex items-center gap-2">
          {f.kind === 'audio' ? (
            <VoicePlayer src={f.url ? fileHref(f.url) : f.preview} blob={f.blob || f.file} duration={f.duration} seed={f.id ?? f.name} />
          ) : (
            <a href={f.preview || fileHref(f.url)} target="_blank" rel="noreferrer"
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-ink-700 hover:border-ink-400">
              <Paperclip className="size-4 shrink-0 text-copper-600" />
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-ink-400">{fileSize(f.size)}</span>
            </a>
          )}
          {onRemove && !progress && <RemoveButton onClick={() => onRemove(f)} inline />}
        </div>
        {progress && progress[f.key] !== undefined && <div className="max-w-xs"><UploadBar value={progress[f.key]} /></div>}
        </div>
      ))}
      {view && (
        <div role="dialog" aria-label={view.name} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4" onClick={() => setView(null)}>
          <img src={view.preview || fileHref(view.url)} alt={view.name} className="max-h-full max-w-full rounded-lg object-contain" />
          <button type="button" className="absolute top-4 left-4 rounded-full bg-white/15 p-2 text-white" onClick={() => setView(null)}><X className="size-5" /></button>
          {view.url && (
            <a href={fileHref(view.url)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
              className="absolute bottom-6 rounded-full bg-white/15 px-4 py-2 text-sm text-white">باز کردن اصل عکس</a>
          )}
        </div>
      )}
    </div>
  );
}

function RemoveButton({ onClick, inline }) {
  return (
    <button type="button" onClick={onClick} title="حذف"
      className={cx('grid size-6 place-items-center rounded-full bg-ink-900 text-white shadow', inline ? '' : 'absolute -top-2 -left-2')}>
      <X className="size-3.5" />
    </button>
  );
}

export function LocationLink({ lat, lng, accuracy }) {
  if (lat === null || lat === undefined) return null;
  return (
    <a href={mapLink(lat, lng)} target="_blank" rel="noreferrer"
      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-sage-50 px-2.5 py-1.5 text-xs font-semibold text-sage-600 hover:underline">
      <MapPin className="size-4" />
      موقعیت ثبت‌شده روی نقشه
      {accuracy ? <span className="font-normal text-ink-400">(دقت {fa(accuracy)} متر)</span> : null}
    </a>
  );
}

export function StatTile({ label, value, tone, onClick, active, hint, className }) {
  const style = tone ? TONE_STYLE[tone] : null;
  // Zero is quiet, so the eye goes to the counters that need attention.
  const empty = typeof value === 'number' && value === 0;
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={cx('card flex min-w-0 flex-col items-start gap-0.5 px-3 py-2 text-right transition disabled:cursor-default sm:py-2.5',
        onClick && 'hover:-translate-y-px hover:shadow-md', active && 'ring-2 ring-ink-900', className)}>
      <span className="flex max-w-full items-center gap-1.5 text-[11px] leading-5 font-semibold whitespace-nowrap text-ink-500 sm:text-xs">
        {style && <span className={cx('size-2 shrink-0 rounded-full', style.dot)} />}
        <span className="truncate">{label}</span>
      </span>
      <span className={cx('num text-xl leading-8 font-black sm:text-2xl', empty ? 'text-ink-300' : 'text-ink-900')} style={style && !empty ? { color: style.hex } : undefined}>{fa(value)}</span>
      {hint && <span className="text-[11px] text-ink-400">{hint}</span>}
    </button>
  );
}

// A row of counters: a grid on wide screens; on phones one line that scrolls sideways, so it never takes half the screen.
export function TileRow({ cols = 'md:grid-cols-7', children }) {
  return <div className={cx('no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:overflow-visible md:px-0 md:pb-0 [&>*]:w-[5.75rem] [&>*]:shrink-0 [&>*]:snap-start md:[&>*]:w-auto', cols)}>{children}</div>;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, Check, ListChecks, Lock, Paperclip, Plus, Repeat2, Search, Trash2, X } from 'lucide-react';
import { Button, cx, ErrorBox, Field, Modal, Segmented, useUi } from './ui.jsx';
import { DatePicker } from './DatePicker.jsx';
import { Attachments } from './common.jsx';
import { api, uploadFile } from '../lib/api.js';
import { isManager, useApp } from '../lib/app.js';
import { compressImage } from '../lib/media.js';
import { faDigits, shortDate, toEnDigits, weekdayName } from '../lib/format.js';
import { PRIORITY } from '../lib/tones.js';
import { addDaysJalali, diffDays, jalaliWeekday, WEEKDAYS } from '../../shared/jalali.js';
import { alarmMoment, fromMoment } from '../lib/alarm.js';

const EMPTY = {
  title: '', description: '', assigneeIds: [], priority: 1, tag: '', startDate: '', startTime: '', dueDate: '', dueTime: '',
  alarmOn: false, alarmDate: '', alarmTime: '', isPrivate: false, checklist: []
};

// The phone's own clock picker (the same one its alarm app uses) on Android, a time box on Windows.
function TimeInput({ value, onChange, label, className }) {
  return (
    <input type="time" className={cx('input num w-28 text-center', className)} dir="ltr" value={value || ''} aria-label={label} title={label}
      onChange={(e) => onChange(e.target.value.slice(0, 5))} />
  );
}

export function TaskForm({ open, onClose, task, defaults, onSaved }) {
  const { user, meta } = useApp();
  const { toast } = useUi();
  const manager = isManager(user);
  const editing = Boolean(task);
  // Opened from "My tasks": the task is for the user themself, so no one else can be chosen here
  // (tasks for others are made from the board, a person's row, or the + button elsewhere).
  const selfOnly = !editing && Boolean(defaults?.selfOnly);
  const [form, setForm] = useState(EMPTY);
  const [repeat, setRepeat] = useState({ kind: '', weekdays: [], monthDay: 1, dueOffset: 0, endDate: '' });
  const [files, setFiles] = useState([]);
  const [newItem, setNewItem] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(null);
  const fileInput = useRef(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFiles([]);
    setNewItem('');
    setRepeat({ kind: task ? '' : defaults?.repeatKind || '', weekdays: [], monthDay: 1, dueOffset: 0, endDate: '' });
    if (task) {
      setForm({
        title: task.title, description: task.description, assigneeIds: [task.assigneeId], priority: task.priority, tag: task.tag,
        startDate: task.startDate || '', startTime: task.startTime || '', dueDate: task.dueDate || '', dueTime: task.dueTime || '',
        alarmOn: Boolean(task.alarmDate), alarmDate: task.alarmDate || '', alarmTime: task.alarmTime || '', isPrivate: Boolean(task.isPrivate), checklist: []
      });
    } else {
      setForm({ ...EMPTY, startDate: meta.today, assigneeIds: defaults?.selfOnly ? [user.id] : defaults?.assigneeId ? [defaults.assigneeId] : manager ? [] : [user.id], ...defaults?.form });
    }
  }, [open, task]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  // The alarm rings for the person who sets it, so it is offered only on one's own task.
  const canAlarm = editing ? task.assigneeId === user.id : form.assigneeIds.length === 1 && form.assigneeIds[0] === user.id;
  const alarmBody = () => (canAlarm && form.alarmOn && form.alarmDate && form.alarmTime
    ? { alarmDate: form.alarmDate, alarmTime: form.alarmTime }
    : { alarmDate: null, alarmTime: null });
  // The personal switch: only on the "new task for myself" form, or when editing a task one made for oneself.
  const canPrivate = editing ? task.assigneeId === user.id && task.createdBy === user.id : selfOnly;

  const addFiles = async (list) => {
    const picked = await Promise.all([...list].map(async (file) => {
      const ready = await compressImage(file);
      return { key: Math.random(), file: ready, name: ready.name, size: ready.size, kind: ready.type.startsWith('image/') ? 'image' : ready.type.startsWith('audio/') ? 'audio' : 'doc', preview: URL.createObjectURL(ready) };
    }));
    setFiles((f) => [...f, ...picked]);
  };

  const addChecklist = () => {
    const text = newItem.trim();
    if (!text) return;
    set('checklist', [...form.checklist, text]);
    setNewItem('');
  };

  const submit = async () => {
    setError(null);
    if (!form.title.trim()) { setError(new Error('عنوان تسک را بنویسید.')); return; }
    if (!form.assigneeIds.length) { setError(new Error('مسئول انجام را انتخاب کنید.')); return; }
    if (canAlarm && form.alarmOn && (!form.alarmDate || !form.alarmTime)) { setError(new Error('برای یادآور هم روز و هم ساعت را انتخاب کنید.')); return; }
    setSaving(true);
    try {
      if (editing) {
        await api(`/tasks/${task.id}`, {
          method: 'PATCH',
          body: { title: form.title, description: form.description, priority: form.priority, tag: form.tag, startDate: form.startDate, startTime: form.startTime, dueDate: form.dueDate, dueTime: form.dueTime, assigneeId: form.assigneeIds[0],
            ...(canAlarm ? alarmBody() : {}), ...(canPrivate ? { isPrivate: form.isPrivate } : {}) }
        });
        toast('تغییرات ذخیره شد.');
      } else {
        const fileIds = [];
        const totalBytes = files.reduce((sum, f) => sum + f.size, 0) || 1;
        const parts = {};
        const report = () => setProgress({
          total: files.reduce((sum, f) => sum + (parts[f.key] || 0) * f.size, 0) / totalBytes,
          files: { ...parts }
        });
        for (const f of files) {
          fileIds.push((await uploadFile(f.file, { name: f.name, onProgress: (v) => { parts[f.key] = v; report(); } })).id);
        }
        const { alarmOn, ...fields } = form;
        const body = { ...fields, ...alarmBody(), isPrivate: canPrivate && form.isPrivate, fileIds };
        if (repeat.kind && !body.isPrivate) {
          const offset = form.dueDate && form.startDate ? Math.max(0, diffDays(form.startDate, form.dueDate)) : Number(repeat.dueOffset) || 0;
          body.recurrence = { kind: repeat.kind, weekdays: repeat.weekdays, monthDay: repeat.monthDay, dueOffset: offset, startDate: form.startDate, endDate: repeat.endDate };
        }
        const created = await api('/tasks', { method: 'POST', body });
        const first = created.nextDate === meta.today ? 'اولین بار همین امروز ساخته شد.' : created.nextDate ? `اولین بار ${weekdayName(created.nextDate)} ${shortDate(created.nextDate)} ساخته می‌شود.` : 'با این تنظیم در دو ماه آینده ساخته نمی‌شود؛ روزها را بررسی کنید.';
        toast(repeat.kind ? `تسک تکراری تعریف شد. ${first}` : form.assigneeIds.length > 1 ? `${faDigits(form.assigneeIds.length)} تسک ساخته شد.` : 'تسک ساخته شد.');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'ویرایش تسک' : selfOnly ? 'کار جدید برای خودم' : 'تسک جدید'} width="max-w-2xl"
      footer={(
        <>
          <Button onClick={submit} loading={saving} icon={Check}>{progress ? `ارسال پیوست ${faDigits(String(Math.round(progress.total * 100)))}٪` : editing ? 'ذخیره' : repeat.kind ? 'تعریف تسک تکراری' : 'ساخت تسک'}</Button>
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
        </>
      )}>
      <div className="space-y-4">
        <Field label="عنوان">
          <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="مثلاً: تهیه صورت‌وضعیت شماره ۸" autoFocus maxLength={200} />
        </Field>

        {manager && !selfOnly && (
          <Field group label={editing ? 'مسئول انجام' : 'مسئول انجام (یک یا چند نفر)'}>
            <PeoplePicker value={form.assigneeIds} onChange={(ids) => set('assigneeIds', ids)} single={editing} />
          </Field>
        )}

        <Field group label="شروع">
          <div className="flex gap-2">
            <DatePicker className="flex-1" value={form.startDate} onChange={(v) => set('startDate', v)} />
            <TimeInput value={form.startTime} onChange={(v) => set('startTime', v)} label="ساعت شروع (اختیاری)" />
          </div>
        </Field>

        <Field group label="سررسید">
          <div className="flex gap-2">
            <DatePicker className="flex-1" value={form.dueDate} onChange={(v) => set('dueDate', v)} placeholder="بدون مهلت" />
            <TimeInput value={form.dueTime} onChange={(v) => set('dueTime', v)} label="ساعت سررسید (اختیاری)" />
          </div>
        </Field>
        {!editing && (
          <div className="-mt-2 flex flex-wrap gap-1.5">
            {[['امروز', 0], ['فردا', 1], ['۳ روز', 3], ['یک هفته', 7], ['دو هفته', 14]].map(([label, n]) => {
              const value = addDaysJalali(meta.today, n);
              return (
                <button key={label} type="button" onClick={() => set('dueDate', value)}
                  className={cx('rounded-full border px-2.5 py-1 text-xs font-semibold transition', form.dueDate === value ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-white text-ink-600 hover:border-ink-400')}>{label}</button>
              );
            })}
          </div>
        )}
        {form.dueDate && !repeat.kind && (meta.settings.holidays.includes(form.dueDate) || !meta.settings.workDays.includes(jalaliWeekday(form.dueDate))) && (
          <p className="-mt-2 text-xs font-semibold text-orange-700">سررسید روز تعطیل است ({weekdayName(form.dueDate)})؛ اگر منظورتان روز کاری قبل است، تاریخ را عوض کنید.</p>
        )}

        {canAlarm && <AlarmField form={form} set={set} today={meta.today} />}

        {canPrivate && <PrivateField on={form.isPrivate} onToggle={() => set('isPrivate', !form.isPrivate)} />}

        <Field group label="اولویت">
          <Segmented size="sm" value={form.priority} onChange={(v) => set('priority', v)} options={PRIORITY.map((p) => ({ value: p.value, label: p.label }))} />
        </Field>

        <Field label="شرح (اختیاری)">
          <textarea className="input min-h-16" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="جزئیات، انتظارات، منابع…" />
        </Field>

        {!editing && (
          <Field label="چک‌لیست (اختیاری)">
            <div className="space-y-1.5">
              {form.checklist.map((item, i) => (
                <div key={`${item}-${i}`} className="flex items-center gap-2 rounded-lg bg-paper px-3 py-1.5 text-sm">
                  <ListChecks className="size-4 text-ink-400" />
                  <span className="flex-1">{item}</span>
                  <button type="button" onClick={() => set('checklist', form.checklist.filter((_, j) => j !== i))} className="text-ink-400 hover:text-red-600"><Trash2 className="size-4" /></button>
                </div>
              ))}
              <div className="flex gap-2">
                <input className="input" value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="یک مرحله از کار…"
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addChecklist())} />
                <Button variant="outline" icon={Plus} onClick={addChecklist}>افزودن</Button>
              </div>
            </div>
          </Field>
        )}

        {!editing && (
          <div>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            <Button variant="outline" size="sm" icon={Paperclip} onClick={() => fileInput.current.click()}>پیوست فایل یا عکس</Button>
            <Attachments files={files} progress={progress?.files} onRemove={(f) => setFiles((list) => list.filter((x) => x.key !== f.key))} />
          </div>
        )}

        <Field label="برچسب / پروژه (اختیاری)">
          <input className="input" list="task-tags" value={form.tag} onChange={(e) => set('tag', e.target.value)} placeholder="مثلاً: خرید، کارگاه، مالی" maxLength={40} />
          <datalist id="task-tags">{meta.tags.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>

        {!editing && manager && !form.isPrivate && (
          <div className="rounded-xl border border-line bg-paper/60 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold"><Repeat2 className="size-4 text-copper-600" /> تکرار</div>
            <Segmented size="sm" value={repeat.kind} onChange={(kind) => setRepeat((r) => ({ ...r, kind }))}
              options={[{ value: '', label: 'یک‌بار' }, { value: 'daily', label: 'هر روز کاری' }, { value: 'weekly', label: 'هفتگی' }, { value: 'monthly', label: 'ماهانه' }]} />
            {repeat.kind === 'weekly' && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {WEEKDAYS.map((name, i) => (
                  <button key={name} type="button" onClick={() => setRepeat((r) => ({ ...r, weekdays: r.weekdays.includes(i) ? r.weekdays.filter((d) => d !== i) : [...r.weekdays, i] }))}
                    className={cx('rounded-lg border px-2.5 py-1 text-xs font-semibold', repeat.weekdays.includes(i) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-white')}>{name}</button>
                ))}
              </div>
            )}
            {repeat.kind === 'monthly' && (
              <label className="mt-3 flex items-center gap-2 text-sm">
                روز
                <input className="input num w-20 text-center" value={faDigits(repeat.monthDay)} onChange={(e) => setRepeat((r) => ({ ...r, monthDay: Number(toEnDigits(e.target.value).replace(/\D/g, '')) || '' }))} />
                هر ماه
              </label>
            )}
            {repeat.kind && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field group label="پایان تکرار (اختیاری)"><DatePicker value={repeat.endDate} onChange={(v) => setRepeat((r) => ({ ...r, endDate: v }))} placeholder="بدون پایان" /></Field>
                <p className="self-end text-xs leading-6 text-ink-500">
                  هر بار یک تسک تازه ساخته می‌شود. فاصله «شروع» تا «سررسید» بالا، مهلت هر بار است
                  {form.dueDate && form.startDate ? ` (${faDigits(Math.max(0, diffDays(form.startDate, form.dueDate)))} روز)` : ' (همان روز)'}.
                </p>
              </div>
            )}
          </div>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

// Optional alarm on one's own task: rings on the phone (even with the app closed) and on the desktop app.
// A personal task is seen by its owner only: not on the board, in reports, or by any manager.
function PrivateField({ on, onToggle }) {
  return (
    <div className={cx('rounded-xl border p-3 transition', on ? 'border-ink-400 bg-ink-900/[0.04]' : 'border-line bg-paper/40')}>
      <button type="button" onClick={onToggle} aria-pressed={on} className="flex w-full items-center gap-2 text-right text-sm font-bold">
        <Lock className={cx('size-4', on ? 'text-ink-900' : 'text-ink-400')} />
        کار شخصی <span className="text-xs font-normal text-ink-400">اختیاری</span>
        <span className={cx('mr-auto inline-flex h-6 w-11 items-center rounded-full p-0.5 transition', on ? 'bg-ink-900' : 'bg-ink-300')}>
          <span className={cx('size-5 rounded-full bg-white shadow transition', on ? '-translate-x-5' : '')} />
        </span>
      </button>
      <p className="mt-1.5 text-xs leading-6 text-ink-500">
        {on
          ? 'فقط خودتان این کار را می‌بینید؛ مدیر عامل، سرپرست و گزارش‌ها آن را نشان نمی‌دهند و روی تابلوی پرسنل نمی‌آید.'
          : 'برای کارهای شخصی خودتان روشن کنید تا هیچ‌کس دیگری آن را نبیند.'}
      </p>
    </div>
  );
}

function AlarmField({ form, set, today }) {
  const on = form.alarmOn;
  const setAt = (d) => { const v = fromMoment(d); set('alarmDate', v.date); set('alarmTime', v.time); };
  const due = form.dueDate ? alarmMoment(form.dueDate, form.dueTime || '09:00') : null;
  const chips = [];
  if (due) {
    if (form.dueTime) {
      chips.push(['سر ساعت سررسید', due]);
      chips.push(['۱۵ دقیقه قبل', new Date(due.getTime() - 15 * 60000)]);
      chips.push(['۱ ساعت قبل', new Date(due.getTime() - 3600000)]);
    }
    chips.push(['صبح روز سررسید (۸:۰۰)', alarmMoment(form.dueDate, '08:00')]);
    chips.push(['یک روز قبل (۹:۰۰)', alarmMoment(addDaysJalali(form.dueDate, -1), '09:00')]);
  }
  chips.push(['یک ساعت دیگر', new Date(Date.now() + 3600000)]);
  chips.push(['فردا ۹:۰۰', alarmMoment(addDaysJalali(today, 1), '09:00')]);
  const at = on ? alarmMoment(form.alarmDate, form.alarmTime) : null;
  const past = at && at.getTime() < Date.now();
  const toggle = () => {
    if (on) { set('alarmOn', false); return; }
    set('alarmOn', true);
    if (!form.alarmDate || !form.alarmTime) setAt(due && form.dueTime ? new Date(due.getTime() - 15 * 60000) : new Date(Date.now() + 3600000));
  };
  return (
    <div className={cx('rounded-xl border p-3 transition', on ? 'border-copper-300 bg-copper-50/60' : 'border-line bg-paper/40')}>
      <button type="button" onClick={toggle} aria-pressed={on} className="flex w-full items-center gap-2 text-right text-sm font-bold">
        <AlarmClock className={cx('size-4', on ? 'text-copper-600' : 'text-ink-400')} />
        یادآور (آلارم) <span className="text-xs font-normal text-ink-400">اختیاری</span>
        <span className={cx('mr-auto inline-flex h-6 w-11 items-center rounded-full p-0.5 transition', on ? 'bg-copper-600' : 'bg-ink-300')}>
          <span className={cx('size-5 rounded-full bg-white shadow transition', on ? '-translate-x-5' : '')} />
        </span>
      </button>
      {on && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <DatePicker className="flex-1" value={form.alarmDate} onChange={(v) => set('alarmDate', v)} />
            <TimeInput value={form.alarmTime} onChange={(v) => set('alarmTime', v)} label="ساعت یادآور" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {chips.filter(([, d]) => d && d.getTime() > Date.now()).map(([label, d]) => {
              const v = fromMoment(d);
              const active = v.date === form.alarmDate && v.time === form.alarmTime;
              return (
                <button key={label} type="button" onClick={() => setAt(d)}
                  className={cx('rounded-full border px-2.5 py-1 text-xs font-semibold transition', active ? 'border-copper-600 bg-copper-600 text-white' : 'border-line bg-white text-ink-600 hover:border-ink-400')}>{label}</button>
              );
            })}
          </div>
          <p className={cx('text-xs', past ? 'font-semibold text-red-700' : 'text-ink-500')}>
            {past ? 'این زمان گذشته است؛ زمان دیگری انتخاب کنید.'
              : at ? `${weekdayName(form.alarmDate)} ${shortDate(form.alarmDate)} ساعت ${faDigits(form.alarmTime)} روی گوشی و برنامه ویندوز زنگ می‌زند.` : 'روز و ساعت را انتخاب کنید.'}
          </p>
        </div>
      )}
    </div>
  );
}

// Choose people, grouped by department, with search and "whole department" shortcuts.
export function PeoplePicker({ value, onChange, single }) {
  const { meta } = useApp();
  const [q, setQ] = useState('');
  const assignable = useMemo(() => {
    const ids = new Set(meta.assignableIds);
    return meta.users.filter((u) => u.active && ids.has(u.id));
  }, [meta]);
  const list = assignable.filter((u) => !q || u.fullName.includes(q) || (u.title || '').includes(q));
  const groups = [...meta.departments, { id: null, name: 'بدون واحد' }]
    .map((d) => ({ ...d, people: list.filter((u) => (u.departmentId ?? null) === d.id) }))
    .filter((g) => g.people.length);
  const toggle = (id) => onChange(single ? [id] : value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search className="size-4 text-ink-400" />
        <input className="h-10 flex-1 bg-transparent text-sm outline-none" placeholder="جستجوی نام…" value={q} onChange={(e) => setQ(e.target.value)} />
        {value.length > 0 && !single && <button type="button" className="text-xs text-ink-400" onClick={() => onChange([])}><X className="inline size-3.5" /> پاک کردن</button>}
      </div>
      {/* One line per department: its name, then its people. */}
      <div className="max-h-64 divide-y divide-line/60 overflow-y-auto px-2">
        {groups.map((g) => (
          <div key={g.id ?? 'none'} className="flex items-start gap-2 py-1.5">
            <div className="w-16 shrink-0 pt-1.5 text-[11px] leading-4 font-bold text-ink-400">
              {g.name}
              {!single && g.people.length > 1 && (
                <button type="button" className="block pt-0.5 text-[10px] font-semibold text-copper-600 hover:underline" onClick={() => {
                  const ids = g.people.map((u) => u.id);
                  const all = ids.every((id) => value.includes(id));
                  onChange(all ? value.filter((id) => !ids.includes(id)) : [...new Set([...value, ...ids])]);
                }}>همه</button>
              )}
            </div>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {g.people.map((u) => (
                <button key={u.id} type="button" onClick={() => toggle(u.id)} aria-pressed={value.includes(u.id)}
                  className={cx('inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition', value.includes(u.id) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-paper/50 text-ink-700 hover:border-ink-400')}>
                  {value.includes(u.id) && <Check className="size-3" strokeWidth={3} />}{u.fullName}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!groups.length && <div className="py-4 text-center text-xs text-ink-400">کسی پیدا نشد.</div>}
      </div>
    </div>
  );
}

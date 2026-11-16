import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, ChevronLeft, ChevronRight, CloudOff, Eye, Loader2, MapPin, MessageSquareReply, Paperclip, Send } from 'lucide-react';
import { Button, Card, cx, Empty, ErrorBox, PageHeader, Segmented, Spinner, useUi } from '../components/ui.jsx';
import { DatePicker } from '../components/DatePicker.jsx';
import { Attachments, Avatar, LocationLink } from '../components/common.jsx';
import { api } from '../lib/api.js';
import { isManager, useApp } from '../lib/app.js';
import { useApi, useHashRoute } from '../lib/hooks.js';
import { send } from '../lib/offline.js';
import { compressImage, getLocation } from '../lib/media.js';
import { fa, faDigits, jDateTime, shortDate, timeAgo, weekdayName } from '../lib/format.js';
import { addDaysJalali, dateToJalali } from '../../shared/jalali.js';

export function Daily() {
  const { user } = useApp();
  const manager = isManager(user);
  const reports = user.role !== 'ceo' && user.role !== 'admin';
  const [tab, setTab] = useState(manager ? 'team' : 'mine');
  return (
    <div>
      <PageHeader title="گزارش کار روزانه" subtitle={manager ? null : 'آخر هر روز کاری، کوتاه بنویسید چه کردید.'}
        actions={manager && reports && <Segmented value={tab} onChange={setTab} options={[{ value: 'team', label: 'گزارش پرسنل' }, { value: 'mine', label: 'گزارش من' }]} />} />
      {tab === 'team' && manager ? <TeamReports /> : <MyReport />}
    </div>
  );
}

function MyReport() {
  const { meta } = useApp();
  const { toast } = useUi();
  const { data, reload } = useApi('/daily/mine', { live: ['report'] });
  const today = meta.today || dateToJalali();
  const [date, setDate] = useState(today);
  const [form, setForm] = useState({ doneText: '', issuesText: '', planText: '' });
  const [files, setFiles] = useState([]);
  const [location, setLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const camera = useRef(null);
  const picker = useRef(null);
  const existing = useMemo(() => data?.reports.find((r) => r.date === date), [data, date]);

  useEffect(() => {
    setForm({ doneText: existing?.doneText || '', issuesText: existing?.issuesText || '', planText: existing?.planText || '' });
    setFiles([]);
    setLocation(null);
  }, [existing?.id, existing?.updatedAt, date]);

  const addFiles = async (list) => {
    const ready = await Promise.all([...list].map(async (file) => {
      const f = await compressImage(file);
      return { key: Math.random(), blob: f, name: f.name, size: f.size, kind: f.type.startsWith('image/') ? 'image' : 'doc', preview: URL.createObjectURL(f) };
    }));
    setFiles((c) => [...c, ...ready]);
  };

  const locate = async () => {
    if (location) { setLocation(null); return; }
    setLocating(true);
    try { setLocation(await getLocation()); } catch (e) { toast(e.message, 'error'); } finally { setLocating(false); }
  };

  const submit = async () => {
    setError(null);
    if (!form.doneText.trim()) { setError(new Error('بنویسید امروز چه کارهایی انجام دادید.')); return; }
    setSaving(true);
    if (files.length) setProgress({ total: 0, files: {} });
    try {
      const result = await send({
        path: '/daily', method: 'PUT', label: 'گزارش روزانه',
        body: { ...form, date, ...(location ? { lat: location.lat, lng: location.lng } : {}) },
        files: files.map((f) => ({ blob: f.blob, name: f.name, key: f.key }))
      }, { onProgress: setProgress });
      toast(result?.queued ? 'بدون اینترنت؛ گزارش در صف ارسال ماند و خودکار فرستاده می‌شود.' : 'گزارش ثبت شد.');
      setFiles([]);
      reload({ quiet: true });
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const yesterday = addDaysJalali(today, -1);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <Card title={existing ? 'ویرایش گزارش' : 'ثبت گزارش'} subtitle={`${weekdayName(date)} ${shortDate(date)}`}
        actions={<Segmented size="sm" value={date} onChange={setDate} options={[{ value: today, label: 'امروز' }, { value: yesterday, label: 'دیروز' }]} />}>
        <div className="space-y-3">
          <label className="block"><span className="label">کارهایی که انجام دادم</span>
            <textarea className="input" rows={5} value={form.doneText} onChange={set('doneText')} placeholder={'- بازدید از کارگاه\n- پیگیری خرید میلگرد'} />
          </label>
          <label className="block"><span className="label">مشکلات و موانع (اختیاری)</span>
            <textarea className="input" rows={2} value={form.issuesText} onChange={set('issuesText')} placeholder="اگر چیزی مانع کار شد بنویسید؛ مدیر فوراً باخبر می‌شود." />
          </label>
          <label className="block"><span className="label">برنامه فردا (اختیاری)</span>
            <textarea className="input" rows={2} value={form.planText} onChange={set('planText')} />
          </label>
          {existing?.files?.length > 0 && <div><span className="label">پیوست‌های قبلی</span><Attachments files={existing.files} /></div>}
          <Attachments files={files} progress={progress?.files} onRemove={(f) => setFiles((l) => l.filter((x) => x.key !== f.key))} />
          {location && <div className="inline-flex items-center gap-1.5 rounded-lg bg-sage-50 px-2.5 py-1 text-xs font-semibold text-sage-600"><MapPin className="size-4" /> موقعیت فعلی ثبت می‌شود</div>}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            <input ref={picker} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            <Button variant="outline" size="sm" icon={Camera} onClick={() => camera.current.click()}>عکس</Button>
            <Button variant="outline" size="sm" icon={Paperclip} onClick={() => picker.current.click()}>فایل</Button>
            <Button variant="outline" size="sm" icon={locating ? Loader2 : MapPin} onClick={locate} className={cx(location && 'border-sage-500 text-sage-600')}>{location ? 'موقعیت ثبت شد' : 'ثبت موقعیت'}</Button>
            <Button className="mr-auto" icon={Send} loading={saving} onClick={submit}>{progress ? `در حال ارسال ${fa(Math.round(progress.total * 100))}٪` : existing ? 'ذخیره تغییرات' : 'ثبت گزارش'}</Button>
          </div>
          <ErrorBox error={error} />
          {existing?.managerNote && (
            <div className="rounded-xl bg-copper-50 px-3 py-2 text-sm"><b>نظر {existing.seenByName}:</b> {existing.managerNote}</div>
          )}
        </div>
      </Card>

      <Card title="گزارش‌های قبلی من">
        {!data ? <Spinner /> : !data.reports.length ? <Empty title="هنوز گزارشی ثبت نکرده‌اید" /> : (
          <ul className="space-y-3">
            {data.reports.slice(0, 20).map((r) => (
              <li key={r.id} className="rounded-xl border border-line p-3">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <button type="button" className="font-bold text-ink-800 hover:text-copper-600" onClick={() => [today, yesterday].includes(r.date) && setDate(r.date)}>{weekdayName(r.date)} {shortDate(r.date)}</button>
                  {r.seenAt ? <span className="inline-flex items-center gap-1 text-emerald-700"><Eye className="size-3.5" /> دیده شد</span> : <span className="text-ink-400">هنوز دیده نشده</span>}
                </div>
                <p className="line-clamp-3 whitespace-pre-line text-sm text-ink-700">{r.doneText}</p>
                {r.managerNote && <p className="mt-1.5 rounded-lg bg-copper-50 px-2.5 py-1.5 text-xs"><b>{r.seenByName}:</b> {r.managerNote}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function TeamReports() {
  const { meta } = useApp();
  const { params } = useHashRoute();
  const [date, setDate] = useState(params.date || meta.today);
  const { data, error, loading, reload } = useApi(`/daily?date=${encodeURIComponent(date)}`, { live: ['report'] });
  const people = data?.people || [];
  const submitted = people.filter((p) => p.report);
  const missing = people.filter((p) => !p.report);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <button type="button" className="rounded-lg p-2 hover:bg-paper" onClick={() => setDate(addDaysJalali(date, -1))} title="روز قبل"><ChevronRight className="size-5" /></button>
        <DatePicker value={date} onChange={(v) => v && setDate(v)} className="w-40" />
        <button type="button" className="rounded-lg p-2 hover:bg-paper disabled:opacity-30" disabled={date >= meta.today} onClick={() => setDate(addDaysJalali(date, 1))} title="روز بعد"><ChevronLeft className="size-5" /></button>
        <span className="text-sm font-bold">{weekdayName(date)} {shortDate(date)}</span>
        {data && (
          <span className="mr-auto text-sm">
            <b className="num text-emerald-700">{fa(submitted.length)}</b> از <b className="num">{fa(people.length)}</b> نفر گزارش داده‌اند
            {!data.workDay && <span className="mr-2 text-xs text-ink-400">(روز تعطیل)</span>}
          </span>
        )}
      </div>
      <ErrorBox error={error} />
      {!data && loading && <Spinner />}
      {missing.length > 0 && data?.workDay && (
        <div className="card border-red-200 bg-red-50/60 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-red-800"><AlertTriangle className="size-4" /> بدون گزارش</div>
          <div className="flex flex-wrap gap-2">
            {missing.map((p) => <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold ring-1 ring-red-200"><Avatar name={p.fullName} id={p.id} size={20} />{p.fullName}</span>)}
          </div>
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {submitted.map((p) => <ReportCard key={p.id} person={p} onChanged={reload} />)}
      </div>
      {data && !submitted.length && <Empty title="برای این روز گزارشی ثبت نشده است" />}
    </div>
  );
}

function ReportCard({ person, onChanged }) {
  const r = person.report;
  const { toast } = useUi();
  const [note, setNote] = useState(r.managerNote);
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async (withNote) => {
    setBusy(true);
    try {
      await api(`/daily/${r.id}/review`, { method: 'POST', body: withNote ? { note } : {} });
      setReplying(false);
      onChanged({ quiet: true });
      if (withNote) toast('نظر شما برای کارمند فرستاده شد.');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <article className="card p-4">
      <header className="mb-2 flex items-center gap-2">
        <Avatar name={person.fullName} id={person.id} size={34} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-extrabold">{person.fullName}</div>
          <div className="text-[11px] text-ink-400">{person.title} · ثبت {timeAgo(r.updatedAt)}</div>
        </div>
        {r.seenAt ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="size-4" /> دیده شد</span>
          : <Button size="sm" variant="ghost" icon={Eye} loading={busy} onClick={() => save(false)}>دیدم</Button>}
      </header>
      <p className="whitespace-pre-line text-sm leading-7 text-ink-800">{r.doneText}</p>
      {r.issuesText && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900"><b>مشکل:</b> {r.issuesText}</p>}
      {r.planText && <p className="mt-2 whitespace-pre-line text-xs leading-6 text-ink-500"><b>برنامه فردا:</b> {r.planText}</p>}
      <Attachments files={r.files} />
      <LocationLink lat={r.lat} lng={r.lng} />
      {r.managerNote && !replying && <p className="mt-2 rounded-lg bg-copper-50 px-3 py-2 text-xs"><b>{r.seenByName}:</b> {r.managerNote}</p>}
      {replying ? (
        <div className="mt-2 flex gap-2">
          <input className="input" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="نظر یا دستور کوتاه…" onKeyDown={(e) => e.key === 'Enter' && save(true)} />
          <Button loading={busy} onClick={() => save(true)}>ارسال</Button>
        </div>
      ) : (
        <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-copper-600" onClick={() => setReplying(true)}><MessageSquareReply className="size-3.5" /> نوشتن نظر</button>
      )}
    </article>
  );
}

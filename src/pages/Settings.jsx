import { useEffect, useState } from 'react';
import { Building2, Database, Download, KeyRound, Pencil, Plus, Save, Sparkles, Trash2, UserPlus, Users } from 'lucide-react';
import { Badge, Button, Card, cx, ErrorBox, Field, IconButton, Modal, PageHeader, Segmented, Spinner, useUi } from '../components/ui.jsx';
import { Avatar } from '../components/common.jsx';
import { api, download } from '../lib/api.js';
import { ROLE_LABEL, useApp } from '../lib/app.js';
import { useApi, useStored } from '../lib/hooks.js';
import { fa, faDigits, fileSize, timeAgo, toEnDigits } from '../lib/format.js';
import { normalizeJalali, WEEKDAYS } from '../../shared/jalali.js';

export function Settings() {
  const [tab, setTab] = useStored('settings_tab', 'users');
  return (
    <div>
      <PageHeader title="تنظیمات" />
      <div className="mb-4 overflow-x-auto"><Segmented value={tab} onChange={setTab} options={[
        { value: 'users', label: 'کاربران' }, { value: 'departments', label: 'واحدها' }, { value: 'general', label: 'عمومی' }, { value: 'system', label: 'داده و پشتیبان' }
      ]} /></div>
      {tab === 'users' && <UsersTab />}
      {tab === 'departments' && <DepartmentsTab />}
      {tab === 'general' && <GeneralTab />}
      {tab === 'system' && <SystemTab />}
    </div>
  );
}

function UsersTab() {
  const { meta, user: me } = useApp();
  const { data, error, reload } = useApi('/users', { live: ['meta'], cache: false });
  const [editing, setEditing] = useState(null);
  const deptName = (id) => meta.departments.find((d) => d.id === id)?.name || '—';
  return (
    <Card title="کاربران" subtitle="هر کارمند با نام کاربری و رمز خودش وارد برنامه گوشی یا دسکتاپ می‌شود."
      actions={<Button size="sm" icon={UserPlus} onClick={() => setEditing({})}>کاربر جدید</Button>} bodyClassName="px-0 pb-0">
      <ErrorBox error={error} />
      {!data ? <Spinner /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper/70 text-right text-xs text-ink-500">
              <tr>{['نام', 'نام کاربری', 'نقش', 'واحد', 'آخرین ورود', ''].map((h, i) => <th key={i} className={cx('px-3 py-2 font-semibold', [1, 3, 4].includes(i) && 'hidden sm:table-cell')}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} onClick={() => setEditing(u)} className={cx('cursor-pointer border-t border-line/70 hover:bg-paper/50', !u.active && 'opacity-50')}>
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><Avatar name={u.fullName} id={u.id} size={28} /><div><div className="font-bold">{u.fullName}</div><div className="text-[11px] text-ink-400">{u.title}</div><div className="code text-[11px] text-ink-400 sm:hidden">{u.username}</div></div></div></td>
                  <td className="code hidden px-3 py-2 text-xs sm:table-cell">{u.username}</td>
                  <td className="px-3 py-2"><Badge tone={u.role === 'ceo' ? 'ink' : u.role === 'admin' ? 'blue' : u.role === 'supervisor' ? 'amber' : 'gray'}>{ROLE_LABEL[u.role]}</Badge>{u.isDemo && <Badge className="mr-1">نمایشی</Badge>}{!u.active && <Badge tone="red" className="mr-1">غیرفعال</Badge>}</td>
                  <td className="hidden px-3 py-2 text-xs sm:table-cell">{deptName(u.departmentId)}</td>
                  <td className="hidden px-3 py-2 text-xs text-ink-500 sm:table-cell">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'هرگز'}</td>
                  <td className="px-3 py-2"><IconButton icon={Pencil} title="ویرایش" onClick={(e) => { e.stopPropagation(); setEditing(u); }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <UserForm open={Boolean(editing)} target={editing} self={me} onClose={() => setEditing(null)} onSaved={reload} />
    </Card>
  );
}

function UserForm({ open, target, self, onClose, onSaved }) {
  const { meta } = useApp();
  const { toast } = useUi();
  const creating = !target?.id;
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(creating
      ? { fullName: '', username: '', title: '', role: 'employee', departmentId: '', phone: '', password: '', active: true }
      : { fullName: target.fullName, username: target.username, title: target.title, role: target.role, departmentId: target.departmentId || '', phone: target.phone, password: '', active: target.active });
  }, [open, target]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = { ...form, departmentId: form.departmentId || null };
      if (!creating && !body.password) delete body.password;
      const result = await api(creating ? '/users' : `/users/${target.id}`, { method: creating ? 'POST' : 'PUT', body });
      toast(creating ? 'کاربر ساخته شد. رمز را به خودش بدهید؛ در اولین ورود عوضش می‌کند.' : 'ذخیره شد.');
      if (result.openTasks) toast(`${target.fullName} ${fa(result.openTasks)} کار باز دارد؛ از تابلو آن‌ها را به نفر دیگری واگذار کنید.`, 'error');
      onSaved();
      onClose();
    } catch (e) { setError(e); } finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={creating ? 'کاربر جدید' : `ویرایش ${target?.fullName || ''}`}
      footer={<><Button icon={Save} loading={saving} onClick={save}>ذخیره</Button><Button variant="ghost" onClick={onClose}>انصراف</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="نام و نام خانوادگی" className="sm:col-span-2"><input className="input" value={form.fullName || ''} onChange={set('fullName')} placeholder="مثلاً: علی رضایی" /></Field>
        <Field label="نام کاربری (انگلیسی)"><input className="input code" dir="ltr" value={form.username || ''} onChange={set('username')} placeholder="saeed" /></Field>
        <Field label="سمت"><input className="input" value={form.title || ''} onChange={set('title')} placeholder="مثلاً: سرپرست کارگاه" /></Field>
        <Field label="نقش" hint={form.role === 'supervisor' ? 'سرپرست فقط افراد واحد خودش را می‌بیند و مدیریت می‌کند.' : form.role === 'ceo' ? 'همه پرسنل و گزارش‌ها را می‌بیند و گزارش صبحگاهی می‌گیرد.' : ''}>
          <select className="input" value={form.role || 'employee'} onChange={set('role')}>
            {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="واحد">
          <select className="input" value={form.departmentId || ''} onChange={set('departmentId')}>
            <option value="">بدون واحد</option>
            {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="موبایل (اختیاری)"><input className="input num" dir="ltr" value={faDigits(form.phone || '')} onChange={(e) => setForm((f) => ({ ...f, phone: toEnDigits(e.target.value) }))} /></Field>
        <Field label={creating ? 'رمز اولیه' : 'رمز جدید (خالی = بدون تغییر)'} hint="حداقل ۶ نویسه"><input className="input code" dir="ltr" value={form.password || ''} onChange={set('password')} /></Field>
        {!creating && target?.id !== self.id && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4" checked={Boolean(form.active)} onChange={set('active')} /> حساب فعال است</label>
        )}
      </div>
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Modal>
  );
}

function DepartmentsTab() {
  const { meta } = useApp();
  const { toast, confirm } = useUi();
  const [name, setName] = useState('');
  const add = async () => {
    try {
      await api('/departments', { method: 'POST', body: { name } });
      setName('');
    } catch (e) { toast(e.message, 'error'); }
  };
  const rename = async (d) => {
    const value = await confirm({ title: 'تغییر نام واحد', message: d.name, input: 'نام جدید…', confirmLabel: 'ذخیره' });
    if (!value) return;
    try { await api(`/departments/${d.id}`, { method: 'PUT', body: { name: value } }); } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async (d) => {
    if (!await confirm({ title: 'حذف واحد', message: `واحد «${d.name}» حذف شود؟`, danger: true, confirmLabel: 'حذف' })) return;
    try { await api(`/departments/${d.id}`, { method: 'DELETE' }); } catch (e) { toast(e.message, 'error'); }
  };
  const count = (id) => meta.users.filter((u) => u.active && u.departmentId === id).length;
  return (
    <Card title="واحدهای سازمان" subtitle="تابلوی رییس بر اساس واحد مرتب می‌شود؛ سرپرست هر واحد فقط افراد همان واحد را می‌بیند.">
      <ul className="mb-3 divide-y divide-line">
        {meta.departments.map((d) => (
          <li key={d.id} className="flex items-center gap-2 py-2">
            <Building2 className="size-4 text-ink-400" />
            <span className="flex-1 font-semibold">{d.name}</span>
            <span className="text-xs text-ink-400">{fa(count(d.id))} نفر</span>
            <IconButton icon={Pencil} title="تغییر نام" onClick={() => rename(d)} />
            <IconButton icon={Trash2} title="حذف" onClick={() => remove(d)} className="hover:text-red-600" />
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="نام واحد جدید…" onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Button icon={Plus} variant="outline" onClick={add}>افزودن</Button>
      </div>
    </Card>
  );
}

function GeneralTab() {
  const { toast } = useUi();
  const { data, reload } = useApi('/settings', { cache: false });
  const [form, setForm] = useState(null);
  const [holiday, setHoliday] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setForm(data); }, [data]);
  if (!form) return <Spinner />;
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const save = async () => {
    setSaving(true);
    try {
      await api('/settings', { method: 'PUT', body: form });
      toast('تنظیمات ذخیره شد.');
      reload({ quiet: true });
    } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };
  const addHoliday = () => {
    const d = normalizeJalali(holiday);
    if (!d) { toast('تاریخ را مثل ۱۴۰۵/۰۹/۰۳ بنویسید.', 'error'); return; }
    set('holidays', [...new Set([...form.holidays, d])].sort());
    setHoliday('');
  };
  return (
    <Card title="تنظیمات عمومی" actions={<Button size="sm" icon={Save} loading={saving} onClick={save}>ذخیره</Button>}>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="نام شرکت"><input className="input" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} /></Field>
        <Field group label="تأیید مدیر برای بستن کارها" hint="روشن: «انجام شد» کارمند تا تأیید مدیر بنفش (منتظر تأیید) می‌ماند.">
          <Segmented value={form.requireApproval} onChange={(v) => set('requireApproval', v)} options={[{ value: true, label: 'لازم است' }, { value: false, label: 'لازم نیست' }]} />
        </Field>
        <Field group label="روزهای کاری" className="md:col-span-2" hint="یادآوری گزارش روزانه و کارنامه فقط روزهای کاری حساب می‌شوند.">
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((name, i) => (
              <button key={name} type="button" onClick={() => set('workDays', form.workDays.includes(i) ? form.workDays.filter((d) => d !== i) : [...form.workDays, i].sort())}
                className={cx('rounded-lg border px-3 py-1.5 text-sm font-semibold', form.workDays.includes(i) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-white')}>{name}</button>
            ))}
          </div>
        </Field>
        <Field label="ساعت یادآوری گزارش روزانه" hint="کسانی که تا این ساعت گزارش نداده‌اند یادآوری می‌گیرند.">
          <input className="input num w-28 text-center" dir="ltr" value={faDigits(form.reportHour)} onChange={(e) => set('reportHour', toEnDigits(e.target.value))} />
        </Field>
        <Field label="ساعت گزارش صبحگاهی مدیر عامل" hint="خلاصه معوقه‌ها، منتظر تأییدها و افراد بدون گزارش دیروز.">
          <input className="input num w-28 text-center" dir="ltr" value={faDigits(form.digestHour)} onChange={(e) => set('digestHour', toEnDigits(e.target.value))} />
        </Field>
        <Field group label="تعطیلات رسمی" className="md:col-span-2">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {form.holidays.map((d) => (
              <span key={d} className="inline-flex items-center gap-1 rounded-full bg-paper-2 px-2.5 py-1 text-xs font-semibold">
                {faDigits(d)}
                <button type="button" onClick={() => set('holidays', form.holidays.filter((x) => x !== d))} className="text-ink-400 hover:text-red-600">×</button>
              </span>
            ))}
            {!form.holidays.length && <span className="text-xs text-ink-400">ثبت نشده</span>}
          </div>
          <div className="flex max-w-sm gap-2">
            <input className="input num" value={holiday} onChange={(e) => setHoliday(e.target.value)} placeholder="۱۴۰۵/۰۹/۰۳" onKeyDown={(e) => e.key === 'Enter' && addHoliday()} />
            <Button variant="outline" icon={Plus} onClick={addHoliday}>افزودن</Button>
          </div>
        </Field>
      </div>
    </Card>
  );
}

function SystemTab() {
  const { toast, confirm } = useUi();
  const demo = useApi('/system/demo', { cache: false });
  const backups = useApi('/system/backups', { cache: false });
  const [busy, setBusy] = useState(false);
  const loadDemo = async () => {
    if (!await confirm({ title: 'بارگذاری داده نمایشی', message: 'هفت کارمند نمایشی با تسک‌ها، گزارش‌ها و سابقه سه ماه ساخته می‌شود. داده‌های واقعی دست نمی‌خورند و بعداً با یک کلیک حذف می‌شوند.', confirmLabel: 'بارگذاری' })) return;
    setBusy(true);
    try { await api('/system/demo', { method: 'POST' }); toast('داده نمایشی بارگذاری شد.'); demo.reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const removeDemo = async () => {
    if (!await confirm({ title: 'حذف داده نمایشی', message: 'همه کاربران، تسک‌ها و گزارش‌های نمایشی حذف می‌شوند.', danger: true, confirmLabel: 'حذف' })) return;
    setBusy(true);
    try { await api('/system/demo', { method: 'DELETE' }); toast('داده نمایشی حذف شد.'); demo.reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="داده نمایشی" subtitle="برای ارائه و آموزش، بدون دست زدن به داده واقعی.">
        {demo.data && (
          <div className="space-y-3 text-sm">
            {demo.data.loaded ? (
              <>
                <p>بارگذاری شده: <b className="num">{fa(demo.data.users)}</b> کاربر، <b className="num">{fa(demo.data.tasks)}</b> تسک، <b className="num">{fa(demo.data.reports)}</b> گزارش روزانه.</p>
                <p className="text-xs text-ink-500">ورود به حساب کارمندان نمایشی: نام کاربری مثل <span className="code">demo.ahmadi</span> با رمز <span className="code">{demo.data.password}</span></p>
                <Button variant="danger" icon={Trash2} loading={busy} onClick={removeDemo}>حذف داده نمایشی</Button>
              </>
            ) : <Button icon={Sparkles} loading={busy} onClick={loadDemo}>بارگذاری داده نمایشی</Button>}
          </div>
        )}
      </Card>
      <Card title="پشتیبان پایگاه داده" subtitle="هر روز یک نسخه خودکار روی سرور نگه داشته می‌شود (۳۰ روز آخر).">
        <Button variant="outline" icon={Download} onClick={() => download('/system/backup/download').catch((e) => toast(e.message, 'error'))}>دریافت نسخه پشتیبان فعلی</Button>
        <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs text-ink-500">
          {backups.data?.backups.map((b) => <li key={b.name} className="flex justify-between"><span className="code">{b.name}</span><span>{fileSize(b.size)}</span></li>)}
        </ul>
      </Card>
    </div>
  );
}

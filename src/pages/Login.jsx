import { useState } from 'react';
import { KeyRound, LogIn, Server } from 'lucide-react';
import { Button, ErrorBox, Field } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { needsServerAddress, serverAddress, setServerAddress, setToken } from '../lib/config.js';
import { APP_VERSION, faDigits } from '../lib/format.js';

function Shell({ children, subtitle }) {
  return (
    <div className="grid-paper flex min-h-full items-center justify-center p-4">
      <div className="rise card w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-3">
          <img src="icon.svg" alt="" className="size-12" />
          <div>
            <h1 className="text-lg font-black">سامانه وظیفه</h1>
            <p className="text-xs text-ink-500">{subtitle}</p>
          </div>
        </div>
        {children}
        <p className="mt-6 text-center text-[11px] text-ink-400">نسخه {faDigits(APP_VERSION)}</p>
      </div>
    </div>
  );
}

export function Login({ onLogin }) {
  const askServer = needsServerAddress();
  const [server, setServer] = useState(serverAddress());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (askServer) {
        if (!server.trim()) throw new Error('آدرس سرور را وارد کنید.');
        setServerAddress(server);
        const info = await api('/public/info').catch(() => null);
        if (info?.app !== 'vazifeh') throw new Error('در این آدرس سرور سامانه وظایف پیدا نشد. آدرس را بررسی کنید.');
      }
      const result = await api('/auth/login', { method: 'POST', body: { username, password, device: navigator.userAgent.slice(0, 100) } });
      setToken(result.token);
      onLogin(result.user);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell subtitle="ورود پرسنل">
      <form onSubmit={submit} className="space-y-4">
        {askServer && (
          <Field label="آدرس سرور" hint="مثلاً tasks.example.com یا ۱۹۲.۱۶۸.۱.۱۰:۸۰۹۰ — یک‌بار وارد می‌شود.">
            <div className="relative"><Server className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
              <input className="input code pl-9" dir="ltr" value={server} onChange={(e) => setServer(e.target.value)} autoCapitalize="off" autoCorrect="off" /></div>
          </Field>
        )}
        <Field label="نام کاربری"><input className="input code" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" autoFocus={!askServer} /></Field>
        <Field label="رمز عبور"><input className="input code" dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        <ErrorBox error={error} />
        <Button type="submit" className="w-full" size="lg" icon={LogIn} loading={busy}>ورود</Button>
      </form>
    </Shell>
  );
}

export function ChangePassword({ forced, onDone, onCancel }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    if (next !== repeat) { setError(new Error('رمز جدید و تکرار آن یکسان نیستند.')); return; }
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const form = (
    <form onSubmit={submit} className="space-y-4">
      {forced && <p className="rounded-xl bg-copper-50 px-3 py-2 text-sm text-copper-700">برای امنیت، پیش از شروع کار رمز عبور خود را عوض کنید.</p>}
      <Field label="رمز فعلی"><input className="input code" dir="ltr" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></Field>
      <Field label="رمز جدید" hint="حداقل ۶ نویسه"><input className="input code" dir="ltr" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
      <Field label="تکرار رمز جدید"><input className="input code" dir="ltr" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" /></Field>
      <ErrorBox error={error} />
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" icon={KeyRound} loading={busy}>تغییر رمز</Button>
        {onCancel && <Button variant="ghost" onClick={onCancel}>انصراف</Button>}
      </div>
    </form>
  );
  return forced ? <Shell subtitle="تغییر رمز عبور">{form}</Shell> : form;
}

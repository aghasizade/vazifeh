import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell, BellRing, CalendarCheck2, ChevronLeft, ChartColumnBig, ClipboardList, CloudOff, KanbanSquare, LogOut, Menu, Plus, Repeat2, Settings as SettingsIcon, UserRound, Wifi, WifiOff
} from 'lucide-react';
import { Button, Card, cx, HeaderExtra, PageHeader, Spinner, UiProvider, useUi } from './components/ui.jsx';
import { Avatar } from './components/common.jsx';
import { TaskDrawer } from './components/TaskDrawer.jsx';
import { TaskForm } from './components/TaskForm.jsx';
import { AlarmDialog } from './components/AlarmDialog.jsx';
import { VersionDialog } from './components/VersionDialog.jsx';
import { api, cacheClear, cacheRead, cacheWrite, isOfflineError } from './lib/api.js';
import { AppContext, isBoss, isManager, ROLE_LABEL, useApp } from './lib/app.js';
import { isNative, serverAddress, setToken, getToken } from './lib/config.js';
import { navigate, setParams, useHashRoute, useIsMobile } from './lib/hooks.js';
import { nudgeLive, onLive, startLive, stopLive } from './lib/live.js';
import { flushOutbox, onOutbox, startOutbox } from './lib/offline.js';
import { askNotificationPermission, notificationPermission, systemNotify } from './lib/platform.js';
import { APP_VERSION, fa, faDigits } from './lib/format.js';
import { Board } from './pages/Board.jsx';
import { MyTasks } from './pages/MyTasks.jsx';
import { Daily } from './pages/Daily.jsx';
import { Reports } from './pages/Reports.jsx';
import { Recurring } from './pages/Recurring.jsx';
import { Settings } from './pages/Settings.jsx';
import { NotificationList, Notifications, openNotification } from './pages/Notifications.jsx';
import { ChangePassword, Login } from './pages/Login.jsx';

export default function App() {
  return (
    <UiProvider>
      <Root />
    </UiProvider>
  );
}

function Root() {
  const [state, setState] = useState({ phase: 'boot', user: null, meta: null, mustChange: false });

  const loadMeta = useCallback(async () => {
    const meta = await api('/meta');
    cacheWrite('/meta', meta);
    setState((s) => ({ ...s, meta }));
  }, []);

  const boot = useCallback(async () => {
    if (!getToken()) { setState({ phase: 'login' }); return; }
    try {
      const me = await api('/auth/me');
      cacheWrite('/auth/me', me);
      if (me.user.mustChangePassword) { setState({ phase: 'ready', user: me.user, meta: null, mustChange: true }); return; }
      const meta = await api('/meta');
      cacheWrite('/meta', meta);
      setState({ phase: 'ready', user: me.user, meta, mustChange: false });
    } catch (error) {
      // Without internet the app still opens with the last saved data.
      const me = cacheRead('/auth/me');
      const meta = cacheRead('/meta');
      if (isOfflineError(error) && me && meta) setState({ phase: 'ready', user: me.data.user, meta: meta.data, mustChange: false, offlineBoot: true });
      else if (error.status === 401) setState({ phase: 'login' });
      else if (error.data?.code === 'MUST_CHANGE_PASSWORD') setState({ phase: 'ready', mustChange: true, user: null, meta: null });
      else setState({ phase: 'error', error });
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    stopLive();
    setToken('');
    cacheClear();
    setState({ phase: 'login' });
  }, []);

  useEffect(() => {
    const onUnauthorized = () => { stopLive(); setToken(''); cacheClear(); setState({ phase: 'login' }); };
    const onMustChange = () => setState((s) => ({ ...s, mustChange: true }));
    window.addEventListener('stt:unauthorized', onUnauthorized);
    window.addEventListener('stt:must-change', onMustChange);
    return () => {
      window.removeEventListener('stt:unauthorized', onUnauthorized);
      window.removeEventListener('stt:must-change', onMustChange);
    };
  }, []);

  if (state.phase === 'boot') return <div className="grid h-full place-items-center"><Spinner label="در حال اتصال…" /></div>;
  // A new sign-in starts on the home page, not on whatever page the previous person left open.
  if (state.phase === 'login') return <Login onLogin={() => { window.location.hash = '#/'; setState({ phase: 'boot' }); boot(); }} />;
  if (state.phase === 'error') {
    return (
      <div className="grid h-full place-items-center p-6">
        <Card className="max-w-sm text-center">
          <p className="mb-4 text-sm">{state.error?.message}</p>
          <div className="flex justify-center gap-2"><Button onClick={boot}>تلاش دوباره</Button><Button variant="ghost" onClick={logout}>خروج</Button></div>
        </Card>
      </div>
    );
  }
  if (state.mustChange) return <ChangePassword forced onDone={() => { setState({ phase: 'boot' }); boot(); }} />;
  if (!state.meta) return <div className="grid h-full place-items-center"><Spinner /></div>;
  return (
    <AppContext.Provider value={{ user: state.user, meta: state.meta, reloadMeta: loadMeta, logout }}>
      <Shell offlineBoot={state.offlineBoot} />
    </AppContext.Provider>
  );
}

function Shell({ offlineBoot }) {
  const { user, meta, reloadMeta, logout } = useApp();
  const { toast } = useUi();
  const { path, params } = useHashRoute();
  const mobile = useIsMobile();
  const manager = isManager(user);
  const [connected, setConnected] = useState(!offlineBoot);
  const [unread, setUnread] = useState(0);
  const [outbox, setOutbox] = useState(0);
  const [form, setForm] = useState(null);
  const [alarm, setAlarm] = useState(null);
  const [bellOpen, setBellOpen] = useState(false);
  // While typing on a phone the keyboard takes half the screen; the bottom bar and the + button step aside.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const editable = (el) => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'file'].includes(el.type)));
    const onFocus = () => setTyping(editable(document.activeElement));
    const onBlur = () => setTimeout(onFocus, 0);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    return () => { document.removeEventListener('focusin', onFocus); document.removeEventListener('focusout', onBlur); };
  }, []);
  // Opening a page or a task closes the notification list, so it never covers the task.
  useEffect(() => setBellOpen(false), [path, params.task]);

  const refreshUnread = useCallback(() => api('/notifications').then((d) => { setUnread(d.unread); cacheWrite('/notifications', d); }).catch(() => {}), []);

  useEffect(() => {
    startLive();
    startOutbox();
    refreshUnread();
    const off = onLive((event) => {
      if (event.type === '_connection') {
        setConnected(event.connected);
        if (event.connected) { flushOutbox(); refreshUnread(); reloadMeta().catch(() => {}); }
      } else if (event.type === 'meta') {
        reloadMeta().catch(() => {});
      } else if (event.type === 'notification') {
        setUnread((n) => n + 1);
        const n = event.notification;
        // An alarm the user set rings in a dialog of its own; everything else is a short toast.
        if (n.type === 'alarm') setAlarm(n);
        else toast(n.title);
        systemNotify(n);
      } else if (event.type === 'notifications_read') {
        refreshUnread();
      }
    });
    const offOutbox = onOutbox(setOutbox);
    const onVisible = () => { if (!document.hidden) { nudgeLive({ force: true, quietMs: 30000 }); flushOutbox(); refreshUnread(); } };
    document.addEventListener('visibilitychange', onVisible);
    const onDropped = (event) => toast(`«${event.detail.label}» که بدون اینترنت نوشته بودید ثبت نشد: ${event.detail.message}`, 'error');
    window.addEventListener('stt:outbox-dropped', onDropped);
    if (isNative()) import('./lib/native.js').then((m) => m.startNative?.()).catch(() => {});
    return () => { off(); offOutbox(); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('stt:outbox-dropped', onDropped); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const home = manager ? '/board' : '/mine';
  const page = path === '/' ? home : path;
  const onNewTask = (defaults) => setForm(defaults || {});

  const nav = [
    manager && { path: '/board', label: 'تابلوی پرسنل', short: 'تابلو', icon: KanbanSquare },
    { path: '/mine', label: 'کارهای من', short: 'کارهای من', icon: ClipboardList },
    { path: '/daily', label: 'گزارش روزانه', short: 'گزارش روز', icon: CalendarCheck2 },
    manager && { path: '/reports', label: 'گزارش‌های مدیریتی', short: 'گزارش‌ها', icon: ChartColumnBig },
    manager && { path: '/recurring', label: 'تسک‌های تکراری', short: 'تکراری', icon: Repeat2 },
    { path: '/notifications', label: 'اعلان‌ها', short: 'اعلان‌ها', icon: Bell, badge: unread },
    isBoss(user) && { path: '/settings', label: 'تنظیمات', short: 'تنظیمات', icon: SettingsIcon },
    { path: '/profile', label: 'حساب من', short: 'حساب', icon: UserRound }
  ].filter(Boolean);
  const mobileNav = nav.filter((n) => (manager ? ['/board', '/mine', '/daily', '/reports', '/profile'] : ['/mine', '/daily', '/notifications', '/profile']).includes(n.path));

  let content;
  if (page === '/board' && manager) content = <Board onNewTask={onNewTask} />;
  else if (page === '/mine') content = <MyTasks onNewTask={onNewTask} />;
  else if (page === '/daily') content = <Daily />;
  else if (page === '/reports' && manager) content = <Reports />;
  else if (page === '/recurring' && manager) content = <Recurring onNewTask={onNewTask} />;
  else if (page === '/notifications') content = <Notifications />;
  else if (page === '/settings' && isBoss(user)) content = <Settings />;
  else if (page === '/profile') content = <Profile connected={connected} more={mobile ? nav.filter((n) => !mobileNav.includes(n) && n.path !== '/profile') : []} />;
  else content = <MyTasks onNewTask={onNewTask} />;

  return (
    <div className="flex h-full">
      {!mobile && (
        <aside className="no-print flex w-64 shrink-0 flex-col bg-ink-900 text-white">
          <div className="flex items-center gap-3 px-5 py-5">
            <img src="icon.svg" alt="" className="size-10" />
            <div className="min-w-0">
              <div className="truncate font-black">سامانه وظایف</div>
              <div className="truncate text-[11px] text-white/50">{meta.settings.companyName}</div>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 px-3">
            {nav.map((item) => (
              <a key={item.path} href={`#${item.path}`}
                className={cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                  page === item.path ? 'bg-white/12 text-white' : 'text-white/65 hover:bg-white/6 hover:text-white')}>
                <item.icon className="size-[18px]" />
                <span className="flex-1">{item.label}</span>
                {item.badge > 0 && <span className="num rounded-full bg-copper-500 px-1.5 text-[11px] font-bold">{fa(item.badge)}</span>}
              </a>
            ))}
          </nav>
          <div className="space-y-2 border-t border-white/10 p-4 text-xs">
            <StatusLine connected={connected} outbox={outbox} dark />
            <div className="flex items-center gap-2">
              <Avatar name={user.fullName} id={user.id} size={32} />
              <div className="min-w-0 flex-1"><div className="truncate font-bold">{user.fullName}</div><div className="text-white/50">{ROLE_LABEL[user.role]}</div></div>
              <button type="button" onClick={logout} title="خروج" className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white"><LogOut className="size-4" /></button>
            </div>
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {mobile && (
          <header className="no-print flex items-center gap-2 border-b border-line bg-white px-4 pt-[max(10px,env(safe-area-inset-top))] pb-2.5">
            <img src="icon.svg" alt="" className="size-8" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black">سامانه وظایف</div>
              <StatusLine connected={connected} outbox={outbox} />
            </div>
            {manager && (
              <button type="button" onClick={() => navigate('/recurring')} className="rounded-lg p-2 text-ink-500" title="تسک‌های تکراری"><Repeat2 className="size-5" /></button>
            )}
            <button type="button" onClick={() => navigate('/notifications')} className="relative rounded-lg p-2 text-ink-600" title="اعلان‌ها">
              <Bell className="size-5" />
              {unread > 0 && <span className="num absolute top-0.5 left-0.5 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{fa(unread)}</span>}
            </button>
          </header>
        )}
        <main className={cx('flex-1 overflow-y-auto', mobile ? 'px-4 pt-3 pb-24' : 'px-8 pt-6 pb-10')}>
          {/* On desktop the bell sits at the end of each page's own header row. */}
          <HeaderExtra.Provider value={mobile ? null : (
            <div className="no-print relative">
              <button type="button" onClick={() => setBellOpen((o) => !o)} className="relative grid size-10 place-items-center rounded-xl border border-line bg-white text-ink-600 hover:border-ink-400" title="اعلان‌ها">
                {unread > 0 ? <BellRing className="size-5 text-copper-600" /> : <Bell className="size-5" />}
                {unread > 0 && <span className="num absolute -top-1.5 -left-1.5 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">{fa(unread)}</span>}
              </button>
              {bellOpen && <BellPanel onClose={() => setBellOpen(false)} />}
            </div>
          )}>
            <div className="mx-auto max-w-[1500px]">{content}</div>
          </HeaderExtra.Provider>
        </main>
        {mobile && !typing && (
          <nav className="no-print fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
            {mobileNav.map((item) => (
              <a key={item.path} href={`#${item.path}`} className={cx('relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold', page === item.path ? 'text-copper-600' : 'text-ink-400')}>
                <item.icon className="size-5" />
                {item.short}
                {item.badge > 0 && <span className="num absolute top-1 right-[calc(50%-18px)] grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] text-white">{fa(item.badge)}</span>}
              </a>
            ))}
          </nav>
        )}
        {mobile && !typing && ['/board', '/mine'].includes(page) && (
          <button type="button" onClick={() => onNewTask(page === '/mine' ? { selfOnly: true } : undefined)} title="تسک جدید"
            className="fixed bottom-20 left-4 z-30 grid size-14 place-items-center rounded-2xl bg-copper-500 text-white shadow-xl shadow-copper-500/30 active:scale-95">
            <Plus className="size-7" />
          </button>
        )}
      </div>

      {params.task && <TaskDrawer key={params.task} taskId={params.task} onClose={() => setParams({ task: null })} />}
      <TaskForm open={Boolean(form)} defaults={form} onClose={() => setForm(null)} />
      <AlarmDialog alarm={alarm} onClose={() => setAlarm(null)} />
      <VersionDialog hidden={Boolean(alarm)} />
    </div>
  );
}

function StatusLine({ connected, outbox, dark }) {
  return (
    <div className={cx('flex items-center gap-1.5 text-[11px]', dark ? 'text-white/55' : 'text-ink-400')}>
      {connected ? <Wifi className="size-3.5 text-emerald-500" /> : <WifiOff className="size-3.5 text-red-500" />}
      {connected ? 'متصل و همگام' : 'بدون اتصال به سرور'}
      {outbox > 0 && <span className="inline-flex items-center gap-1 text-copper-500"><CloudOff className="size-3.5" />{fa(outbox)} در صف ارسال</span>}
    </div>
  );
}

function BellPanel({ onClose }) {
  const [data, setData] = useState(null);
  const box = useRef(null);
  const load = useCallback(() => api('/notifications').then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const onDown = (e) => !box.current?.contains(e.target) && onClose();
    setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => document.removeEventListener('mousedown', onDown);
  }, [load, onClose]);
  return (
    <div ref={box} className="rise absolute left-0 z-40 mt-2 w-96 overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <b className="text-sm">اعلان‌ها</b>
        <button type="button" className="text-xs text-copper-600" onClick={async () => { await api('/notifications/read', { method: 'POST', body: { all: true } }); load(); }}>همه خوانده شد</button>
      </div>
      <NotificationList data={data} compact onOpen={(n) => { onClose(); openNotification(n); }} />
      <a href="#/notifications" onClick={onClose} className="block border-t border-line py-2 text-center text-xs font-semibold text-ink-500 hover:bg-paper">همه اعلان‌ها</a>
    </div>
  );
}

function Profile({ connected, more = [] }) {
  const { user, logout } = useApp();
  const { toast } = useUi();
  const [changing, setChanging] = useState(false);
  const [permission, setPermission] = useState(notificationPermission());
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title="حساب من" />
      <Card>
        <div className="flex items-center gap-3">
          <Avatar name={user.fullName} id={user.id} size={52} />
          <div>
            <div className="text-lg font-black">{user.fullName}</div>
            <div className="text-sm text-ink-500">{[user.title, ROLE_LABEL[user.role]].filter((v, i, list) => v && list.indexOf(v) === i).join(' — ')}</div>
            <div className="code text-xs text-ink-400">{user.username}</div>
          </div>
        </div>
      </Card>
      {/* On phones the bottom bar has room for five pages; the rest (settings, recurring tasks…) are here. */}
      {more.length > 0 && (
        <nav className="card divide-y divide-line/70 overflow-hidden">
          {more.map((item) => (
            <a key={item.path} href={`#${item.path}`} className="flex items-center gap-3 px-4 py-3 text-sm font-semibold text-ink-800 active:bg-paper">
              <item.icon className="size-5 text-ink-400" />
              <span className="flex-1">{item.label}</span>
              {item.badge > 0 && <span className="num rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white">{fa(item.badge)}</span>}
              <ChevronLeft className="size-4 text-ink-300" />
            </a>
          ))}
        </nav>
      )}
      <Card title="رمز عبور">
        {changing ? <ChangePassword onDone={() => { setChanging(false); toast('رمز عوض شد.'); }} onCancel={() => setChanging(false)} />
          : <Button variant="outline" onClick={() => setChanging(true)}>تغییر رمز عبور</Button>}
      </Card>
      {permission !== 'native' && permission !== 'unsupported' && (
        <Card title="اعلان روی صفحه" subtitle="وقتی پنجره برنامه پشت پنجره‌های دیگر است، اعلان ویندوز نشان داده می‌شود.">
          {permission === 'granted' ? <p className="text-sm text-emerald-700">فعال است.</p>
            : permission === 'denied' ? <p className="text-sm text-ink-500">در تنظیمات مرورگر/برنامه مسدود شده است.</p>
              : <Button variant="outline" icon={BellRing} onClick={async () => { await askNotificationPermission(); setPermission(notificationPermission()); }}>فعال کردن اعلان</Button>}
        </Card>
      )}
      {isNative() && <NativeSettings />}
      <Card>
        <div className="space-y-1 text-xs text-ink-500">
          <div>وضعیت اتصال: {connected ? 'متصل' : 'بدون اتصال'}</div>
          {isNative() && <div>سرور: <span className="code">{serverAddress()}</span></div>}
          <div>نسخه برنامه: {faDigits(APP_VERSION)}</div>
        </div>
        <Button variant="danger" icon={LogOut} className="mt-4" onClick={logout}>خروج از حساب</Button>
      </Card>
    </div>
  );
}

function NativeSettings() {
  const [mod, setMod] = useState(null);
  useEffect(() => { import('./lib/native.js').then(setMod).catch(() => {}); }, []);
  if (!mod?.NativePanel) return null;
  return <mod.NativePanel />;
}

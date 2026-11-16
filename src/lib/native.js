// Android-only helpers (Capacitor). Loaded on demand, never in the browser or the desktop app.
import { createElement as h, useEffect, useState } from 'react';
import { BatteryCharging, Download, Server } from 'lucide-react';
import { api } from './api.js';
import { apiBase, getToken, serverAddress } from './config.js';
import { onLive } from './live.js';
import { openLink } from './hooks.js';
import { askNotificationPermission, hookNativeTaps } from './platform.js';
import { ALARM_STATUSES, alarmKey, alarmMoment } from './alarm.js';
import { APP_VERSION, faDigits } from './format.js';

const P = () => window.Capacitor.Plugins;

// The background check (NotificationWorker.java) reads these from Android storage.
async function syncForBackground() {
  await P().Preferences.set({ key: 'stt_server', value: apiBase() });
  await P().Preferences.set({ key: 'stt_token', value: getToken() });
}

async function markSeen(id) {
  const { value } = await P().Preferences.get({ key: 'stt_last_notification' });
  if (Number(id) > Number(value || 0)) await P().Preferences.set({ key: 'stt_last_notification', value: String(id) });
}

async function openPendingLink() {
  const { value } = await P().Preferences.get({ key: 'stt_pending_link' });
  if (value) {
    await P().Preferences.remove({ key: 'stt_pending_link' });
    openLink(value);
  }
}

// Alarms on the user's own tasks are scheduled on the phone itself, so they ring at the exact minute even with the
// app closed and no internet. The list is rebuilt whenever tasks change. The keys of alarms from the last day are
// kept in Android storage: the background check (NotificationWorker.java) skips the server's copy of those.
const ALARM_BASE = 1000000000;
let alarmTimer = null;
export async function syncAlarms() {
  const ln = P().LocalNotifications;
  if (!ln) return;
  try {
    const { tasks } = await api('/tasks?mine=1');
    const now = Date.now();
    const recent = tasks
      .filter((t) => t.alarmDate && t.alarmTime && ALARM_STATUSES.includes(t.status))
      .map((t) => ({ t, at: alarmMoment(t.alarmDate, t.alarmTime) }))
      .filter((x) => x.at && x.at.getTime() > now - 26 * 3600000);
    const future = recent.filter((x) => x.at.getTime() > now + 5000);
    const pending = await ln.getPending();
    const ours = (pending.notifications || []).filter((n) => n.id >= ALARM_BASE);
    if (ours.length) await ln.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
    if (future.length) {
      await ln.schedule({
        notifications: future.map(({ t, at }) => ({
          id: ALARM_BASE + t.id,
          title: `⏰ ${t.title}`,
          body: t.dueDate ? `سررسید ${faDigits(t.dueDate)}${t.dueTime ? ` ساعت ${faDigits(t.dueTime)}` : ''}` : 'یادآوری که خودتان گذاشتید',
          schedule: { at, allowWhileIdle: true },
          channelId: 'alarms',
          smallIcon: 'ic_stat_notify',
          extra: { link: `/task/${t.id}`, alarmKey: alarmKey(t) }
        }))
      });
    }
    await P().Preferences.set({ key: 'stt_alarm_keys', value: recent.map(({ t }) => alarmKey(t)).join('\n') });
  } catch { /* offline: the alarms scheduled last time stay in place */ }
}
const syncAlarmsSoon = () => { clearTimeout(alarmTimer); alarmTimer = setTimeout(syncAlarms, 1500); };

let started = false;
export async function startNative() {
  if (started) return;
  started = true;
  await syncForBackground();
  // Everything already in the list counts as seen, so the background check does not repeat it.
  api('/notifications').then((d) => d.notifications[0] && markSeen(d.notifications[0].id)).catch(() => {});
  onLive((event) => {
    if (event.type === 'notification') markSeen(event.notification.id);
    if (event.type === 'task' || (event.type === '_connection' && event.connected)) syncAlarmsSoon();
  });
  P().LocalNotifications?.createChannel?.({ id: 'tasks', name: 'وظایف و پیام‌ها', importance: 5, visibility: 1 }).catch(() => {});
  P().LocalNotifications?.createChannel?.({ id: 'alarms', name: 'یادآورهای من', description: 'آلارم‌هایی که روی کارهای خودتان گذاشته‌اید', importance: 5, visibility: 1, vibration: true }).catch(() => {});
  // Tapping a notification (an alarm or a message) opens its task.
  hookNativeTaps();
  syncAlarms();
  askNotificationPermission().catch(() => {});
  openPendingLink();
  // A newer APK on the server: a popup introduces it with its list of changes and installs it in one tap.
  api('/public/info').then((info) => {
    if (info.android && newer(info.android.version, APP_VERSION)) {
      window.dispatchEvent(new CustomEvent('stt:update', { detail: { ...info.android, changelog: info.changelog || [] } }));
    }
  }).catch(() => {});
  // Attachments and map links open in the phone's browser or viewer, not inside the app.
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[target=_blank]');
    if (!link) return;
    event.preventDefault();
    P().SttNative.openExternal({ url: link.href });
  });
  P().App.addListener('resume', () => { syncForBackground(); openPendingLink(); syncAlarmsSoon(); });
  P().App.addListener('backButton', ({ canGoBack }) => {
    // An open form, list or photo closes first, as the back button does everywhere on Android.
    if (document.querySelector('[role=dialog]')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return;
    }
    if (window.location.hash.includes('task=')) window.history.back();
    else if (canGoBack && !['#/', '#/board', '#/mine', ''].includes(window.location.hash)) window.history.back();
    else P().App.minimizeApp();
  });
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

// Excel exports: written to the app's cache, then handed to the share sheet (Bale, email, Drive…).
export async function saveAndShare(blob, fileName) {
  const { uri } = await P().Filesystem.writeFile({ path: fileName, data: await toBase64(blob), directory: 'CACHE' });
  await P().Share.share({ title: fileName, url: uri, dialogTitle: 'ارسال یا ذخیره فایل' });
}

// The update button's text: the version, then the download percentage while it downloads.
export const downloadLabel = (state, version) => (!state
  ? `دریافت و نصب نسخه ${faDigits(version)}`
  : state.v == null ? 'در حال دریافت نسخه جدید…'
    : state.v >= 1 ? 'دریافت شد؛ نصب را تأیید کنید'
      : `در حال دریافت… ${faDigits(Math.round(state.v * 100))}٪`);

const newer = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

// Downloads the new APK inside the app and opens Android's installer. onProgress(0…1, or null when the server
// sends no size) follows the download; the browser is the fallback if it fails. Returns true when the installer
// opened, 'busy' when a download is already running (a second tap), false when it failed.
export async function installApk(release, onProgress) {
  const url = `${apiBase()}/downloads/${encodeURIComponent(release.file)}`;
  const listener = await P().SttNative.addListener?.('updateProgress', ({ loaded, total }) => {
    onProgress?.(total > 0 ? Math.min(1, loaded / total) : null);
  });
  try {
    onProgress?.(0);
    await P().SttNative.installUpdate({ url });
    return true;
  } catch (error) {
    if (error?.code === 'BUSY') return 'busy';
    P().SttNative.openExternal({ url });
    return false;
  } finally {
    listener?.remove?.();
  }
}

// Profile page section: battery saver (so notifications arrive with the app closed) and updates.
export function NativePanel() {
  const [battery, setBattery] = useState(null);
  const [release, setRelease] = useState(undefined);
  useEffect(() => {
    P().SttNative.batteryStatus().then(setBattery).catch(() => {});
    api('/public/info').then((info) => setRelease(info.android || null)).catch(() => setRelease(null));
    const off = P().App.addListener('resume', () => P().SttNative.batteryStatus().then(setBattery).catch(() => {}));
    return () => { off.then?.((l) => l.remove()); };
  }, []);
  const [downloading, setDownloading] = useState(null);
  const [updateError, setUpdateError] = useState('');
  const update = release && newer(release.version, APP_VERSION);
  // The app fetches the APK itself and opens the installer; the browser is only a fallback.
  const installUpdate = async () => {
    setUpdateError('');
    const ok = await installApk(release, (v) => setDownloading({ v }));
    if (ok === 'busy') setUpdateError('نسخه جدید همین حالا در حال دریافت است؛ چند لحظه صبر کنید.');
    else if (!ok) setUpdateError('دریافت در برنامه ناموفق بود؛ فایل در مرورگر باز می‌شود.');
    setDownloading(null);
  };
  const card = (title, children) => h('section', { className: 'card p-5' }, h('h3', { className: 'mb-2 text-[15px] font-extrabold' }, title), children);
  return h('div', { className: 'space-y-4' },
    card('اعلان وقتی برنامه بسته است', h('div', { className: 'space-y-2 text-sm leading-7 text-ink-600' },
      h('p', null, 'برنامه هر چند دقیقه یک‌بار از سرور می‌پرسد اعلان تازه‌ای هست یا نه. برای این‌که گوشی این کار را متوقف نکند، صرفه‌جویی باتری را برای برنامه خاموش کنید.'),
      battery?.ignoring
        ? h('p', { className: 'font-semibold text-emerald-700' }, 'انجام شده است.')
        : h('button', { type: 'button', className: 'inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-semibold', onClick: () => P().SttNative.requestBatteryExemption() },
          h(BatteryCharging, { className: 'size-4' }), 'خاموش کردن صرفه‌جویی باتری'),
      /xiaomi|redmi|poco|huawei|honor|oppo|vivo|realme/i.test(battery?.manufacturer || '')
        && h('p', { className: 'text-xs text-ink-500' }, 'در گوشی‌های شیائومی، هوآوی و مشابه: تنظیمات ← برنامه‌ها ← وظیفه ← «شروع خودکار» را روشن و «صرفه‌جویی باتری» را روی «بدون محدودیت» بگذارید.')
    )),
    card('سرور و نسخه', h('div', { className: 'space-y-2 text-sm' },
      h('div', { className: 'flex items-center gap-2 text-ink-600' }, h(Server, { className: 'size-4' }), h('span', { className: 'code' }, serverAddress())),
      h('div', { className: 'text-ink-600' }, `نسخه نصب‌شده: ${faDigits(APP_VERSION)}`),
      update
        ? h('button', { type: 'button', disabled: Boolean(downloading), className: 'relative mt-1 inline-flex h-10 items-center gap-2 overflow-hidden rounded-xl bg-copper-500 px-4 text-sm font-bold text-white', onClick: installUpdate },
          downloading?.v != null && h('span', { className: 'absolute inset-y-0 right-0 bg-copper-700 transition-[width] duration-200', style: { width: `${Math.round(downloading.v * 100)}%` } }),
          h(Download, { className: 'relative size-4' }),
          h('span', { className: 'relative' }, downloadLabel(downloading, release.version)))
        : release !== undefined && h('div', { className: 'text-xs text-ink-400' }, 'آخرین نسخه نصب است.'),
      updateError && h('p', { className: 'text-xs text-red-700' }, updateError),
      update && release.notes && h('p', { className: 'text-xs leading-6 text-ink-500' }, release.notes)
    ))
  );
}

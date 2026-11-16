// System notifications: Windows/desktop through the Notification API, Android through the
// Capacitor LocalNotifications plugin (no Google push service is involved).
import { isNative } from './config.js';
import { openLink } from './hooks.js';

const plugin = (name) => window.Capacitor?.Plugins?.[name];

export async function askNotificationPermission() {
  if (isNative()) {
    const ln = plugin('LocalNotifications');
    if (!ln) return false;
    const status = await ln.checkPermissions();
    if (status.display === 'granted') return true;
    return (await ln.requestPermissions()).display === 'granted';
  }
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

export function notificationPermission() {
  if (isNative()) return 'native';
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

let nativeTapHooked = false;
export function hookNativeTaps() {
  const ln = plugin('LocalNotifications');
  if (nativeTapHooked || !ln) return;
  nativeTapHooked = true;
  ln.addListener('localNotificationActionPerformed', (event) => openLink(event.notification?.extra?.link));
}

export function systemNotify({ id, title, body, link, type }) {
  try {
    if (isNative()) {
      // The phone already rang this alarm itself at the exact minute (scheduled in native.js).
      if (type === 'alarm') return;
      // On screen the in-app toast is enough; the shade is for when the app is in the background.
      const ln = plugin('LocalNotifications');
      if (!ln || !document.hidden) return;
      hookNativeTaps();
      ln.schedule({ notifications: [{ id: Number(id) % 2147483647 || Date.now() % 2147483647, title, body: body || '', extra: { link }, smallIcon: 'ic_stat_notify', channelId: 'tasks' }] });
      return;
    }
    // Inside an open, visible window the in-app toast is enough.
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body: body || '', icon: '/icon-192.png', tag: `stt-${id}`, lang: 'fa', dir: 'rtl' });
    n.onclick = () => {
      // In the desktop app the window may be hidden in the tray; focus() alone would not show it.
      window.sttDesktop?.show?.();
      window.focus();
      openLink(link);
      n.close();
    };
  } catch (error) {
    console.warn('notification failed', error);
  }
}

// Where the server is and who is signed in.
// In the browser and the desktop app the page comes from the server itself, so the API is same-origin.
// The Android app carries its own copy of the UI and talks to the address saved at first start.

const SERVER_KEY = 'stt_server';
const TOKEN_KEY = 'stt_token';

export const isNative = () => Boolean(window.Capacitor?.isNativePlatform?.());

const read = (key) => {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
};
const write = (key, value) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* storage blocked */ }
};

export const needsServerAddress = () => isNative();

export function apiBase() {
  return isNative() ? read(SERVER_KEY) : '';
}

export const serverAddress = () => read(SERVER_KEY);

// Accepts "192.168.1.10:8090", "tasks.example.ir" or a full URL and stores a clean origin.
export function setServerAddress(text) {
  let value = String(text || '').trim().replace(/\/+$/, '');
  if (!value) { write(SERVER_KEY, ''); return ''; }
  if (!/^https?:\/\//i.test(value)) value = `${/^[\d.]+(:\d+)?$/.test(value) || value.startsWith('localhost') ? 'http' : 'https'}://${value}`;
  const url = new URL(value);
  write(SERVER_KEY, url.origin);
  return url.origin;
}

export const getToken = () => read(TOKEN_KEY);
export function setToken(token) {
  write(TOKEN_KEY, token);
  // On Android the background notification check reads the token from native storage; signing out clears it there too.
  const prefs = window.Capacitor?.Plugins?.Preferences;
  if (isNative() && prefs) (token ? prefs.set({ key: TOKEN_KEY, value: token }) : prefs.remove({ key: TOKEN_KEY })).catch(() => {});
}

// Absolute link for a file path the API returned ("/api/files/…").
export const fileHref = (url) => (url ? `${apiBase()}${url}` : '');

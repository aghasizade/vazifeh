import { apiBase, getToken, isNative } from './config.js';

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const isOfflineError = (error) => error instanceof ApiError && error.status === 0;

const authHeader = () => {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
};

const OFFLINE_MESSAGE = 'اتصال به سرور برقرار نشد. اینترنت یا آدرس سرور را بررسی کنید.';

// The live stream listens to these: a failed request makes it check its own connection right away
// (it may be stuck on a network that is gone, e.g. after a VPN was switched off), a good one wakes it up.
const networkFailed = () => window.dispatchEvent(new Event('stt:network-failed'));
const networkOk = () => window.dispatchEvent(new Event('stt:network-ok'));

// After a network change a request can hang on a dead socket instead of failing. Without a time limit the
// screen would spin until the app is restarted; with one it fails, counts as "offline" and is retried.
const REQUEST_TIMEOUT_MS = 30000;

export async function api(path, { method = 'GET', body, headers = {}, signal, timeout = REQUEST_TIMEOUT_MS } = {}) {
  const isRaw = body instanceof Blob || body instanceof ArrayBuffer;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  const forward = () => controller.abort();
  signal?.addEventListener('abort', forward);
  let res;
  let data = null;
  try {
    try {
      res = await fetch(`${apiBase()}/api${path}`, {
        method,
        signal: controller.signal,
        headers: { ...authHeader(), ...(body !== undefined && !isRaw ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body)
      });
      const type = res.headers.get('content-type') || '';
      data = type.includes('application/json') ? await res.json() : null;
    } catch (error) {
      if (error.name === 'AbortError' && !timedOut) throw error;
      networkFailed();
      throw new ApiError(OFFLINE_MESSAGE, 0, { offline: true, timedOut });
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
  networkOk();
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('stt:unauthorized'));
  if (data?.code === 'MUST_CHANGE_PASSWORD') window.dispatchEvent(new Event('stt:must-change'));
  if (!res.ok) throw new ApiError(data?.error || 'پاسخ نامعتبر از سرور.', res.status, data);
  return data;
}

// Uploads one file and returns its record ({ id, url, kind, … }).
// XMLHttpRequest instead of fetch, because only it reports upload progress: onProgress(0…1) is called as the
// bytes leave the device, so the sender sees a percentage instead of a frozen screen. An upload that makes no
// progress for STALL_MS (dead network) is aborted and reported as offline, so it goes to the send queue.
const STALL_MS = 30000;

export function uploadFile(blob, { name, duration, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stalled = false;
    let timer = null;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { stalled = true; xhr.abort(); }, STALL_MS);
    };
    const offline = () => {
      clearTimeout(timer);
      networkFailed();
      reject(new ApiError(OFFLINE_MESSAGE, 0, { offline: true, timedOut: stalled }));
    };
    xhr.open('POST', `${apiBase()}/api/files`);
    const token = getToken();
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', blob.type || 'application/octet-stream');
    xhr.setRequestHeader('x-file-name', encodeURIComponent(name || blob.name || 'file'));
    if (duration) xhr.setRequestHeader('x-file-duration', String(Math.round(duration)));
    xhr.upload.onprogress = (event) => {
      arm();
      if (event.lengthComputable && event.total) onProgress?.(Math.min(1, event.loaded / event.total));
    };
    // All bytes sent: now only the server's answer is awaited (it stores the file first).
    xhr.upload.onload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { stalled = true; xhr.abort(); }, REQUEST_TIMEOUT_MS * 2);
    };
    xhr.onerror = offline;
    xhr.onabort = offline;
    xhr.ontimeout = offline;
    xhr.onload = () => {
      clearTimeout(timer);
      networkOk();
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 401) window.dispatchEvent(new Event('stt:unauthorized'));
      if (data?.code === 'MUST_CHANGE_PASSWORD') window.dispatchEvent(new Event('stt:must-change'));
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(data?.error || 'پاسخ نامعتبر از سرور.', xhr.status, data));
        return;
      }
      onProgress?.(1);
      resolve(data);
    };
    arm();
    onProgress?.(0);
    xhr.send(blob);
  });
}

// Fetches a file from the API and saves it (Excel exports).
export async function download(path) {
  let res;
  try {
    res = await fetch(`${apiBase()}/api${path}`, { headers: authHeader() });
  } catch {
    networkFailed();
    throw new ApiError('اتصال به سرور برقرار نشد.', 0, { offline: true });
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || 'دریافت فایل ناموفق بود.', res.status, data);
  }
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
  const fileName = match ? decodeURIComponent(match[1]) : 'download';
  const blob = await res.blob();
  if (isNative()) {
    const { saveAndShare } = await import('./native.js');
    return saveAndShare(blob, fileName);
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Last good answer of a GET, so the app still shows something without internet.
const CACHE_PREFIX = 'stt_cache:';
export function cacheRead(path) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + path);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function cacheWrite(path, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + path, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Full storage: drop old entries and keep going without a cache.
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  }
}
export function cacheClear() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

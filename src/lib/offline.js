// Things written without internet (messages, photos, status changes, the daily report) wait here
// in IndexedDB and are sent, in order, once the server can be reached again.
import { api, isOfflineError, uploadFile } from './api.js';

const DB_NAME = 'vazifeh';
const STORE = 'outbox';
const listeners = new Set();
let flushing = false;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
  });
}

const all = () => withStore('readonly', (store) => store.getAll());
const add = (item) => withStore('readwrite', (store) => store.add(item));
const remove = (id) => withStore('readwrite', (store) => store.delete(id));

async function notifyCount() {
  let count = 0;
  try { count = (await all()).length; } catch { /* IndexedDB unavailable */ }
  listeners.forEach((fn) => fn(count));
  return count;
}

export function onOutbox(fn) {
  listeners.add(fn);
  notifyCount();
  return () => listeners.delete(fn);
}

// files: [{ blob, name, duration, key }] — uploaded first, then their ids go with the request.
// onProgress({ total: 0…1, files: { [key]: 0…1 } }) follows the upload by bytes, for the progress display.
async function perform(job, onProgress) {
  const fileIds = [...(job.body?.fileIds || [])];
  const list = job.files || [];
  const totalBytes = list.reduce((sum, f) => sum + (f.blob?.size || 0), 0) || 1;
  const done = {};
  const report = () => {
    if (!onProgress) return;
    const sent = list.reduce((sum, f, i) => sum + (done[f.key ?? i] || 0) * (f.blob?.size || 0), 0);
    onProgress({ total: sent / totalBytes, files: { ...done } });
  };
  for (const [i, file] of list.entries()) {
    const key = file.key ?? i;
    const uploaded = await uploadFile(file.blob, {
      name: file.name,
      duration: file.duration,
      onProgress: (part) => { done[key] = part; report(); }
    });
    fileIds.push(uploaded.id);
  }
  const body = job.files?.length ? { ...job.body, fileIds } : job.body;
  return api(job.path, { method: job.method, body });
}

// Nothing is wrong with the job itself in these cases, so it must never be thrown away.
const mustWait = (error) => isOfflineError(error) || [401, 408, 423, 429].includes(error.status) || error.status >= 500
  || error.data?.code === 'MUST_CHANGE_PASSWORD';

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

// A message carries its own id, so one that reached the server but whose answer was lost is not posted twice
// when it is sent again.
const withClientId = (job) => (job.method === 'POST' && /\/comments$/.test(job.path) && !job.body?.clientId
  ? { ...job, body: { ...job.body, clientId: randomId() } } : job);

// Sends now if possible; without a connection the job is stored and { queued: true } comes back.
export async function send(rawJob, { onProgress } = {}) {
  const job = withClientId(rawJob);
  try {
    return await perform(job, onProgress);
  } catch (error) {
    if (!isOfflineError(error)) throw error;
    await add({ ...job, label: job.label || 'ارسال', queuedAt: Date.now() });
    notifyCount();
    return { queued: true };
  }
}

export async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  try {
    const jobs = await all();
    for (const job of jobs) {
      try {
        await perform(job);
        await remove(job.id);
      } catch (error) {
        // Still offline, signed out, or the server restarting or busy: the job stays and is tried again later.
        if (mustWait(error)) break;
        // Really refused (e.g. the task was deleted): it cannot be sent any more, and the user is told.
        console.warn('outbox job dropped', job, error);
        await remove(job.id);
        window.dispatchEvent(new CustomEvent('stt:outbox-dropped', { detail: { label: job.label, message: error.message } }));
      }
    }
  } catch { /* IndexedDB unavailable */ } finally {
    flushing = false;
    notifyCount();
  }
}

export const outboxItems = () => all().catch(() => []);

export function startOutbox() {
  window.addEventListener('online', flushOutbox);
  setInterval(() => { notifyCount().then((n) => n && flushOutbox()); }, 30000);
  flushOutbox();
}

// One streaming connection to /api/live per signed-in app. EventSource cannot send the login header,
// so the stream is read with fetch. It reconnects on its own with a growing pause.
//
// A network change (VPN on/off, Wi-Fi to mobile data) can leave the stream "half dead": the old socket never
// errors, it just stops delivering. The server pings every 25 s, so a watchdog drops a stream that has been
// silent for STALE_MS and opens a fresh one; a stream that cannot even get its headers is dropped after CONNECT_MS.
import { apiBase, getToken } from './config.js';

const listeners = new Set();
let controller = null;
let running = false;
let connected = false;
let wake = null;
// Each start gets a number, so a loop left over from before a sign-out stops by itself.
let generation = 0;
let lastActivity = 0;
let watchdog = null;
const STALE_MS = 45000;
const CONNECT_MS = 15000;

const emit = (event) => listeners.forEach((fn) => {
  try { fn(event); } catch (error) { console.error(error); }
});

function setConnected(value) {
  if (connected === value) return;
  connected = value;
  emit({ type: '_connection', connected: value });
}

export const isConnected = () => connected;

export function onLive(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function loop(gen) {
  let pause = 2000;
  while (running && gen === generation) {
    controller = new AbortController();
    lastActivity = Date.now();
    try {
      const res = await fetch(`${apiBase()}/api/live`, { headers: { authorization: `Bearer ${getToken()}` }, signal: controller.signal });
      if (res.status === 401) {
        window.dispatchEvent(new Event('stt:unauthorized'));
        running = false;
        break;
      }
      if (!res.ok || !res.body) throw new Error(`live ${res.status}`);
      setConnected(true);
      lastActivity = Date.now();
      pause = 2000;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        lastActivity = Date.now();
        buffer += value;
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const data = chunk.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
          if (data) {
            try { emit(JSON.parse(data)); } catch { /* not JSON */ }
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError' && !running) break;
    }
    setConnected(false);
    if (!running || gen !== generation) break;
    await new Promise((resolve) => { wake = resolve; setTimeout(resolve, pause); });
    wake = null;
    pause = Math.min(pause * 2, 30000);
  }
}

function checkStale() {
  if (!running) return;
  const silent = Date.now() - lastActivity;
  if (connected ? silent > STALE_MS : (!wake && silent > CONNECT_MS)) controller?.abort();
}

const onNetworkChange = () => nudgeLive({ force: true });

export function startLive() {
  if (running) return;
  running = true;
  generation += 1;
  watchdog = setInterval(checkStale, 5000);
  window.addEventListener('online', onNetworkChange);
  window.addEventListener('stt:network-failed', onNetworkChange);
  window.addEventListener('stt:network-ok', nudgeLive);
  loop(generation);
}

export function stopLive() {
  running = false;
  clearInterval(watchdog);
  window.removeEventListener('online', onNetworkChange);
  window.removeEventListener('stt:network-failed', onNetworkChange);
  window.removeEventListener('stt:network-ok', nudgeLive);
  controller?.abort();
  setConnected(false);
}

// Reconnect right away instead of waiting out the pause: coming back from the background, the network
// changing, or a normal request reaching the server while the stream is down. With force, a stream that
// looks connected but has been quiet for a while is replaced too (it may be stuck on the old network).
export function nudgeLive({ force = false, quietMs = 3000 } = {}) {
  if (!running) return;
  if (!connected) {
    if (wake) wake();
    else controller?.abort();
  } else if (force && Date.now() - lastActivity > quietMs) {
    controller?.abort();
  }
}

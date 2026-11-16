import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, cacheRead, cacheWrite, isOfflineError } from './api.js';
import { onLive } from './live.js';

// Loads an API path and exposes { data, error, loading, stale, reload }.
// `live`: event types that trigger a quiet reload (e.g. ['task']). Without internet the last copy is shown (stale).
export function useApi(path, { live = [], cache = true } = {}) {
  const [state, setState] = useState(() => {
    const cached = cache && path ? cacheRead(path) : null;
    return { data: cached?.data ?? null, error: null, loading: Boolean(path), stale: false };
  });
  const seq = useRef(0);
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!path) return;
    const id = ++seq.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path);
      if (cache) cacheWrite(path, data);
      if (id === seq.current) setState({ data, error: null, loading: false, stale: false });
    } catch (error) {
      if (id !== seq.current) return;
      const cached = cache && isOfflineError(error) ? cacheRead(path) : null;
      setState((s) => (cached ? { data: cached.data, error: null, loading: false, stale: true } : { data: s.data, error, loading: false, stale: s.stale }));
    }
  }, [path, cache]);

  useEffect(() => { load(); }, [load]);

  const liveKey = live.join(',');
  useEffect(() => {
    if (!liveKey) return undefined;
    const types = liveKey.split(',');
    let timer = null;
    const off = onLive((event) => {
      const reconnect = event.type === '_connection' && event.connected;
      if (!reconnect && !types.includes(event.type)) return;
      // Several changes at once (a batch of new tasks) cause one reload.
      clearTimeout(timer);
      timer = setTimeout(() => load({ quiet: true }), 250);
    });
    return () => { off(); clearTimeout(timer); };
  }, [liveKey, load]);

  return { ...state, reload: load };
}

// Hash routes: "#/board?task=12" → { path: '/board', params: { task: '12' } }.
function readHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: Object.fromEntries(new URLSearchParams(query)) };
}

export function useHashRoute() {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const onChange = () => setRoute(readHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const navigate = (path) => { window.location.hash = path; };

// Sets or clears query parameters of the current route, keeping the page.
export function setParams(changes) {
  const { path, params } = readHash();
  const next = { ...params, ...changes };
  Object.keys(next).forEach((key) => (next[key] === null || next[key] === undefined || next[key] === '') && delete next[key]);
  const query = new URLSearchParams(next).toString();
  window.location.hash = `${path}${query ? `?${query}` : ''}`;
}

// Opens a notification's link ("/task/12", "/daily", "/reports") from wherever the user is.
export function openLink(link) {
  if (!link) return;
  const match = link.match(/^\/task\/(\d+)/);
  if (match) setParams({ task: match[1] });
  else navigate(link);
}

export function useIsMobile(query = '(max-width: 767px)') {
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return mobile;
}

// Remembers a small per-device preference (view mode, filters).
export function useStored(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(`stt_pref:${key}`);
      return raw === null ? initial : JSON.parse(raw);
    } catch { return initial; }
  });
  const set = useCallback((next) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      try { localStorage.setItem(`stt_pref:${key}`, JSON.stringify(resolved)); } catch { /* ignore */ }
      return resolved;
    });
  }, [key]);
  return [value, set];
}

// Re-renders every `ms` so "۵ دقیقه پیش" and overdue colours stay current.
export function useTick(ms = 60000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export const useSorted = (list, compare) => useMemo(() => [...(list || [])].sort(compare), [list, compare]);

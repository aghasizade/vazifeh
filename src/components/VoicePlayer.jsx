// Voice notes, messenger style: round play button, a waveform that fills as it plays, tap or drag the
// waveform to jump, elapsed / total time and a 1× / 1.5× / 2× speed button.
//
// Phones record WebM/Opus without a duration or seek index, so an <audio> tag on the original file often shows
// "0:00 / Infinity" and cannot jump. The note is therefore decoded once (Web Audio), drawn as a waveform, and
// re-packed as a small 16 kHz mono WAV that an <audio> tag plays with a known length and exact seeking.
// Playback itself stays on <audio> because only it keeps the voice's pitch at 1.5× / 2× (preservesPitch);
// speeding up a Web Audio source plays it like a fast tape and the voice comes out thin and high.
// If decoding fails (old WebView, unusual format) the original file is played as it is.
import { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play } from 'lucide-react';
import { cx } from './ui.jsx';
import { faDigits } from '../lib/format.js';

const BARS = 40;
const SPEEDS = [1, 1.5, 2];

let context = null;
const audioContext = () => {
  if (!context) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) context = new Ctx();
  }
  return context;
};

// Decoded files, shared by every player showing the same voice note.
const decoded = new Map();

function peaksOf(buffer) {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / BARS));
  const peaks = [];
  for (let i = 0; i < BARS; i += 1) {
    let max = 0;
    for (let j = i * step, end = Math.min(data.length, j + step); j < end; j += 1) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  const top = Math.max(...peaks) || 1;
  return peaks.map((p) => Math.max(0.12, Math.sqrt(p / top)));
}

// Mono, 16 kHz, 16-bit WAV: plenty for speech and about 1.9 MB per minute.
const WAV_RATE = 16000;
async function toWavUrl(buffer) {
  let pcm = buffer;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (Offline) {
    try {
      const offline = new Offline(1, Math.max(1, Math.ceil(buffer.duration * WAV_RATE)), WAV_RATE);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start();
      pcm = await offline.startRendering();
    } catch { pcm = buffer; }
  }
  const data = pcm.getChannelData(0);
  const rate = pcm.sampleRate;
  const view = new DataView(new ArrayBuffer(44 + data.length * 2));
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + data.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i += 1) {
    const v = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return URL.createObjectURL(new Blob([view], { type: 'audio/wav' }));
}

function decode(key, getBytes) {
  if (!decoded.has(key)) {
    decoded.set(key, (async () => {
      const ctx = audioContext();
      if (!ctx) throw new Error('no web audio');
      const bytes = await getBytes();
      // Safari-style callback signature is still needed on some older WebViews.
      const buffer = await new Promise((resolve, reject) => {
        const result = ctx.decodeAudioData(bytes, resolve, reject);
        if (result?.then) result.then(resolve, reject);
      });
      let wav = null;
      return { buffer, peaks: peaksOf(buffer), wavUrl: () => (wav ||= toWavUrl(buffer)) };
    })());
    decoded.get(key).catch(() => decoded.delete(key));
  }
  return decoded.get(key);
}

// A steady, file-specific look for the waveform until (or instead of) the real one.
function placeholderPeaks(seed) {
  let x = [...String(seed)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) || 1;
  return Array.from({ length: BARS }, (_, i) => {
    x = (x * 1103515245 + 12345) >>> 0;
    const wave = 0.55 + 0.35 * Math.sin(i / 3.1);
    return Math.max(0.15, Math.min(1, wave * (0.5 + (x % 1000) / 1000)));
  });
}

// Only one voice note plays at a time.
let stopCurrent = null;

const clock = (seconds) => {
  const s = Math.max(0, Math.round(seconds || 0));
  return faDigits(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
};

export function VoicePlayer({ src, blob, duration: knownDuration, seed, className }) {
  const key = blob ? blob : src;
  const [peaks, setPeaks] = useState(() => placeholderPeaks(seed ?? src));
  const [total, setTotal] = useState(Number.isFinite(knownDuration) ? knownDuration : 0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const root = useRef(null);
  const wave = useRef(null);
  const engine = useRef({ offset: 0 });
  const speedRef = useRef(1);

  const getBytes = async () => {
    if (blob) return blob.arrayBuffer();
    const res = await fetch(src);
    if (!res.ok) throw new Error(`voice ${res.status}`);
    return res.arrayBuffer();
  };

  // Draw the real waveform once the note scrolls into view (files are small: 32 kbit/s).
  useEffect(() => {
    if (!key || !root.current) return undefined;
    let cancelled = false;
    const load = () => decode(key, getBytes).then(({ buffer, peaks: real }) => {
      if (cancelled) return;
      setPeaks(real);
      setTotal(buffer.duration);
    }).catch(() => { /* keep the placeholder; playback falls back to <audio> */ });
    if (!('IntersectionObserver' in window)) { load(); return () => { cancelled = true; }; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); load(); }
    }, { rootMargin: '200px' });
    observer.observe(root.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => engine.current.stop?.(true), []);

  // A short timer rather than requestAnimationFrame: it keeps the timeline moving even when the window is not
  // being drawn (desktop app minimised to the tray while a note plays).
  const tick = () => {
    const e = engine.current;
    if (e.playing) setPosition(e.now());
  };

  const finish = () => {
    const e = engine.current;
    e.playing = false;
    e.offset = 0;
    clearInterval(e.frame);
    setPlaying(false);
    setPosition(0);
    if (stopCurrent === e.stop) stopCurrent = null;
  };

  const startAt = async (offset, rate = speedRef.current) => {
    const e = engine.current;
    e.stop?.(true);
    if (stopCurrent && stopCurrent !== e.stop) stopCurrent(true);
    setLoading(true);
    let ready = null;
    if (!failed) {
      try { ready = await decode(key, getBytes); } catch { setFailed(true); }
    }
    setLoading(false);

    let url = src || (blob && URL.createObjectURL(blob));
    if (ready) {
      // Pressing play before the note scrolled into view decodes it here; show the real waveform and length.
      setPeaks(ready.peaks);
      setTotal(ready.buffer.duration);
      try { url = await ready.wavUrl(); } catch { /* play the original file */ }
    }
    if (!e.audio || e.audioUrl !== url) {
      e.audio?.pause();
      e.audio = new Audio(url);
      e.audioUrl = url;
    }
    const audio = e.audio;
    // Faster, not higher: keep the speaker's pitch when the speed changes (default in browsers, set explicitly).
    audio.preservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.webkitPreservesPitch = true;
    audio.playbackRate = rate;
    audio.onended = finish;
    audio.onloadedmetadata = () => { if (Number.isFinite(audio.duration)) setTotal(audio.duration); };
    try {
      if (offset > 0) {
        if (audio.readyState < 1) await new Promise((resolve) => audio.addEventListener('loadedmetadata', resolve, { once: true }));
        audio.currentTime = offset;
      } else if (audio.currentTime) audio.currentTime = 0;
    } catch { /* not seekable */ }
    try { await audio.play(); } catch { return; }
    e.now = () => audio.currentTime;
    e.stop = (keep) => {
      audio.pause();
      e.offset = keep ? audio.currentTime : e.offset;
      e.playing = false;
      clearInterval(e.frame);
      setPlaying(false);
    };
    e.playing = true;
    stopCurrent = e.stop;
    setPlaying(true);
    clearInterval(e.frame);
    e.frame = setInterval(tick, 100);
  };

  const toggle = () => {
    const e = engine.current;
    if (e.playing) { e.stop(true); setPosition(e.offset); return; }
    startAt(e.offset);
  };

  const seekTo = (clientX) => {
    const rect = wave.current.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const e = engine.current;
    if (!total) {
      // Length not known yet: load the note, then put the playhead where it was tapped.
      decode(key, getBytes).then((ready) => {
        setPeaks(ready.peaks);
        setTotal(ready.buffer.duration);
        e.offset = fraction * ready.buffer.duration;
        setPosition(e.offset);
      }).catch(() => setFailed(true));
      return;
    }
    const target = fraction * total;
    e.offset = target;
    setPosition(target);
    if (e.playing && e.audio) {
      try { e.audio.currentTime = target; } catch { startAt(target); }
    }
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speedRef.current) + 1) % SPEEDS.length];
    speedRef.current = next;
    setSpeed(next);
    const e = engine.current;
    if (e.audio) e.audio.playbackRate = next;
  };

  const progress = total ? Math.min(1, position / total) : 0;
  const Icon = loading ? Loader2 : playing ? Pause : Play;

  return (
    <div ref={root} dir="ltr" className={cx('flex w-[260px] max-w-full items-center gap-2.5 rounded-2xl border border-copper-100 bg-copper-50/60 py-1.5 pr-3 pl-1.5', className)}>
      <button type="button" onClick={toggle} aria-label={playing ? 'توقف' : 'پخش پیام صوتی'}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-copper-600 text-white shadow-sm transition active:scale-95">
        <Icon className={cx('size-5', loading && 'animate-spin', !playing && !loading && 'translate-x-px')} fill={loading ? 'none' : 'currentColor'} />
      </button>
      <div className="min-w-0 flex-1">
        <div ref={wave} role="slider" tabIndex={0} aria-label="جابه‌جایی در پیام صوتی" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(position)}
          className="flex h-7 cursor-pointer touch-none items-center justify-between"
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); seekTo(event.clientX); }}
          onPointerMove={(event) => { if (event.buttons) seekTo(event.clientX); }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            const rect = wave.current.getBoundingClientRect();
            const step = (event.key === 'ArrowRight' ? 5 : -5) / (total || 1);
            seekTo(rect.left + Math.min(1, Math.max(0, progress + step)) * rect.width);
          }}>
          {peaks.map((p, i) => (
            <span key={i} className={cx('w-[3px] rounded-full transition-colors', (i + 0.5) / peaks.length <= progress ? 'bg-copper-600' : 'bg-ink-300')}
              style={{ height: `${Math.round(p * 100)}%` }} />
          ))}
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[11px] text-ink-500">
          <span className="num">{playing || position > 0 ? `${clock(position)} / ${clock(total)}` : clock(total)}</span>
          <button type="button" onClick={cycleSpeed} className="num rounded-full bg-white/80 px-1.5 py-px text-[10px] font-bold text-copper-700 ring-1 ring-copper-100"
            aria-label="سرعت پخش">{faDigits(String(speed))}×</button>
        </div>
      </div>
    </div>
  );
}

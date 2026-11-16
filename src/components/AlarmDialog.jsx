// The alarm going off while the app is open: a full dialog that rings and vibrates like a phone alarm until it is
// stopped, snoozed for 10 minutes, or opened. (With the app closed the phone's own scheduled notification rings.)
import { useEffect, useRef, useState } from 'react';
import { AlarmClock, BellOff, ExternalLink, TimerReset } from 'lucide-react';
import { Button, useUi } from './ui.jsx';
import { api } from '../lib/api.js';
import { fromMoment } from '../lib/alarm.js';
import { setParams } from '../lib/hooks.js';
import { fa } from '../lib/format.js';

const RING_MS = 60000;
const SNOOZE_MIN = 10;

// beep-beep-beep, pause — made with Web Audio, so no sound file is needed.
function startRinging() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let timer = null;
  try { ctx = Ctx ? new Ctx() : null; } catch { ctx = null; }
  const burst = () => {
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    [0, 0.22, 0.44].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      const t = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    });
    navigator.vibrate?.([200, 100, 200, 100, 200]);
  };
  burst();
  timer = setInterval(burst, 1500);
  return () => {
    clearInterval(timer);
    navigator.vibrate?.(0);
    ctx?.close?.().catch(() => {});
  };
}

export function AlarmDialog({ alarm, onClose }) {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const stop = useRef(null);

  useEffect(() => {
    if (!alarm) return undefined;
    stop.current = startRinging();
    const limit = setTimeout(() => stop.current?.(), RING_MS);
    return () => { clearTimeout(limit); stop.current?.(); stop.current = null; };
  }, [alarm]);

  if (!alarm) return null;

  const close = () => { stop.current?.(); onClose(); };
  const open = () => { close(); if (alarm.taskId) setParams({ task: alarm.taskId }); };
  const snooze = async () => {
    stop.current?.();
    setBusy(true);
    const next = fromMoment(new Date(Date.now() + SNOOZE_MIN * 60000));
    try {
      await api(`/tasks/${alarm.taskId}`, { method: 'PATCH', body: { alarmDate: next.date, alarmTime: next.time } });
      toast(`${fa(SNOOZE_MIN)} دقیقه دیگر دوباره یادآوری می‌شود.`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <div role="alertdialog" aria-modal="true" aria-label="یادآور" className="fixed inset-0 z-[90] grid place-items-center bg-ink-950/70 p-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 grid size-20 place-items-center rounded-full bg-copper-50 text-copper-600">
          <AlarmClock className="size-10 animate-bounce" />
        </div>
        <div className="text-xs font-bold text-copper-700">یادآور</div>
        <h2 className="mt-1 text-lg leading-8 font-extrabold text-ink-900">{String(alarm.title || '').replace(/^⏰\s*/, '')}</h2>
        {alarm.body && <p className="mt-1 text-sm text-ink-500">{alarm.body}</p>}
        <div className="mt-6 grid gap-2">
          <Button size="lg" icon={ExternalLink} onClick={open}>باز کردن کار</Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" icon={TimerReset} loading={busy} onClick={snooze}>{`${fa(SNOOZE_MIN)} دقیقه دیگر`}</Button>
            <Button variant="ghost" icon={BellOff} onClick={close}>خاموش</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

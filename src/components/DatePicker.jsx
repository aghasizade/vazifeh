import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { dateToJalali, JALALI_MONTHS, jalaliWeekday, monthLength, normalizeJalali, pad, parseJalali } from '../../shared/jalali.js';
import { faDigits } from '../lib/format.js';
import { cx } from './ui.jsx';

const WEEK_HEAD = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

// Jalali date field: type "1405/3/12" (Persian or Latin digits) or pick from the calendar.
export function DatePicker({ value, onChange, placeholder = '۱۴۰۵/۰۱/۰۱', max, className, invalid }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(faDigits(value || ''));
  const parsed = parseJalali(value) || parseJalali(dateToJalali());
  const [view, setView] = useState({ y: parsed.jy, m: parsed.jm });
  const box = useRef(null);

  useEffect(() => { setText(faDigits(value || '')); }, [value]);
  useEffect(() => {
    if (!open) return undefined;
    const p = parseJalali(value) || parseJalali(dateToJalali());
    setView({ y: p.jy, m: p.jm });
    const onDown = (event) => !box.current?.contains(event.target) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, value]);

  const commit = (raw) => {
    if (!raw.trim()) { onChange(''); return; }
    const normalized = normalizeJalali(raw);
    if (normalized) onChange(normalized);
    else setText(faDigits(value || ''));
  };

  const shift = (delta) => setView(({ y, m }) => {
    const total = y * 12 + (m - 1) + delta;
    return { y: Math.floor(total / 12), m: (total % 12) + 1 };
  });

  const first = `${view.y}/${pad(view.m)}/01`;
  const offset = jalaliWeekday(first);
  const days = monthLength(view.y, view.m);
  const today = dateToJalali();

  return (
    <div className={cx('relative', className)} ref={box}>
      <div className="relative">
        <input
          className={cx('input num pl-9', invalid && 'invalid')}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit(e.currentTarget.value))}
          onFocus={() => setOpen(true)}
        />
        <button type="button" className="absolute inset-y-0 left-2 flex items-center text-ink-400 hover:text-copper-600" onClick={() => setOpen((o) => !o)} tabIndex={-1}>
          <CalendarDays className="size-4" />
        </button>
      </div>
      {open && (
        <div className="rise absolute z-30 mt-1.5 w-72 rounded-2xl border border-line bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className="rounded-lg p-1 hover:bg-paper" onClick={() => shift(-1)}><ChevronRight className="size-4" /></button>
            <div className="text-sm font-bold">{JALALI_MONTHS[view.m - 1]} {faDigits(view.y)}</div>
            <button type="button" className="rounded-lg p-1 hover:bg-paper" onClick={() => shift(1)}><ChevronLeft className="size-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-ink-400">
            {WEEK_HEAD.map((d) => <div key={d} className="py-1 font-bold">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-sm">
            {Array.from({ length: offset }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: days }).map((_, i) => {
              const date = `${view.y}/${pad(view.m)}/${pad(i + 1)}`;
              const disabled = max && date > max;
              const selected = date === value;
              return (
                <button key={date} type="button" disabled={disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange(date); setOpen(false); }}
                  className={cx('num h-8 rounded-lg transition-colors disabled:text-stone-300',
                    selected ? 'bg-ink-900 font-bold text-white' : date === today ? 'bg-copper-50 font-bold text-copper-700' : 'hover:bg-paper',
                    (offset + i) % 7 === 6 && !selected && 'text-red-500')}>
                  {faDigits(i + 1)}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between border-t border-line pt-2 text-xs">
            <button type="button" className="font-semibold text-copper-600" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(today); setOpen(false); }}>امروز</button>
            <button type="button" className="text-ink-400" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(''); setOpen(false); }}>پاک کردن</button>
          </div>
        </div>
      )}
    </div>
  );
}

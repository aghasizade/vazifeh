import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';


const cx = (...parts) => parts.filter(Boolean).join(' ');
export { cx };

const BUTTON = {
  primary: 'bg-ink-900 text-white hover:bg-ink-800 shadow-sm',
  accent: 'bg-copper-500 text-white hover:bg-copper-600 shadow-sm',
  ghost: 'bg-transparent text-ink-700 hover:bg-paper-2',
  outline: 'bg-white text-ink-800 border border-line hover:border-ink-400',
  danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50',
  success: 'bg-sage-500 text-white hover:bg-sage-600 shadow-sm'
};

export function Button({ variant = 'primary', size = 'md', icon: Icon, loading, className, children, ...props }) {
  const sizes = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-base gap-2' };
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx('inline-flex items-center justify-center rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap', sizes[size], BUTTON[variant], className)}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, title, className, ...props }) {
  return (
    <button type="button" title={title} aria-label={title} {...props}
      className={cx('inline-flex size-8 items-center justify-center rounded-lg text-ink-500 hover:bg-paper-2 hover:text-ink-900 transition-colors disabled:opacity-40', className)}>
      <Icon className="size-4" />
    </button>
  );
}

const TONES = {
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  blue: 'bg-sky-50 text-sky-800 ring-sky-600/20',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  gray: 'bg-stone-100 text-stone-600 ring-stone-500/20',
  ink: 'bg-ink-900 text-white ring-ink-900'
};

export function Badge({ tone = 'gray', children, className, dot }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap', TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

export function Card({ title, subtitle, actions, children, className, bodyClassName }) {
  return (
    <section className={cx('card min-w-0', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
          <div className="min-w-0">
            {title && <h3 className="text-[15px] font-extrabold text-ink-900">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cx('px-5 pb-5', !title && !actions && 'pt-5', bodyClassName)}>{children}</div>
    </section>
  );
}

// Something the app shell adds to every page header (the notification bell on desktop), so it needs no row of its own.
export const HeaderExtra = createContext(null);

export function PageHeader({ title, subtitle, actions, eyebrow }) {
  const extra = useContext(HeaderExtra);
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 md:mb-5 md:items-end">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1 hidden md:block">{eyebrow}</div>}
        <h1 className="text-xl font-black tracking-tight text-ink-900 md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-ink-500 md:mt-1 md:text-sm">{subtitle}</p>}
      </div>
      {(actions || extra) && <div className="flex flex-wrap items-center gap-2">{actions}{extra}</div>}
    </div>
  );
}

// `group`: several controls (buttons, a picker) under one caption. A <label> there would press its first button
// whenever the caption is clicked, so it becomes a plain block.
export function Field({ label, hint, error, children, className, group }) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className={cx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span>
        : hint ? <span className="mt-1 block text-xs text-ink-400">{hint}</span> : null}
    </Tag>
  );
}


export function Spinner({ label = 'در حال بارگذاری…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-500">
      <Loader2 className="size-5 animate-spin text-copper-500" /> {label}
    </div>
  );
}

export function Empty({ icon: Icon = Info, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-paper text-ink-400"><Icon className="size-6" /></div>
      <div className="font-bold text-ink-800">{title}</div>
      {children && <div className="max-w-md text-sm text-ink-500">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <div>{error.message || String(error)}</div>
        {error.data?.errors?.length > 1 && (
          <ul className="mt-1 list-disc pr-4 text-xs">{error.data.errors.slice(1).map((e) => <li key={e}>{e}</li>)}</ul>
        )}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return undefined;
    // Captured first and stopped, so Escape closes only this dialog and not the task drawer under it.
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      onClose?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={cx('rise card flex max-h-[90vh] w-full flex-col overflow-hidden', width)} role="dialog" aria-modal="true">
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="font-extrabold">{title}</h3>
          {onClose && <IconButton icon={X} title="بستن" onClick={onClose} />}
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-start gap-2 border-t border-line bg-paper/60 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, footer, width = 'max-w-2xl' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex bg-ink-950/40" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <aside className={cx('flex h-full w-full flex-col bg-paper shadow-2xl', width)} style={{ animation: 'rise .25s ease both' }}>
        <header className="flex items-center justify-between border-b border-line bg-white px-5 py-3.5">
          <div className="min-w-0 font-extrabold">{title}</div>
          <IconButton icon={X} title="بستن" onClick={onClose} />
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex flex-wrap gap-2 border-t border-line bg-white px-5 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}

// ---- Toasts & confirm dialog, provided app-wide ----
const UiContext = createContext(null);
export const useUi = () => useContext(UiContext);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const toast = useCallback((message, tone = 'success') => {
    const id = Math.random();
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4200);
  }, []);

  const confirm = useCallback((options) => new Promise((resolve) => {
    setConfirmState({ ...options, resolve });
  }), []);

  const close = (value) => {
    confirmState?.resolve(value);
    setConfirmState(null);
  };

  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 top-4 z-[60] flex flex-col items-center gap-2 no-print lg:inset-x-auto lg:top-auto lg:bottom-5 lg:left-5 lg:items-start">
        {toasts.map((t) => (
          <div key={t.id} className={cx('rise pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl px-4 py-3 text-sm text-white shadow-xl',
            t.tone === 'error' ? 'bg-red-700' : 'bg-ink-900')}>
            {t.tone === 'error' ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-copper-300" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      <Modal open={Boolean(confirmState)} onClose={() => close(false)} title={confirmState?.title || 'تأیید'}
        footer={(
          <>
            <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => close(confirmState?.input ? confirmState.value || '' : true)}
              disabled={confirmState?.input && !confirmState.optional && !(confirmState.value || '').trim()}>
              {confirmState?.confirmLabel || 'تأیید'}
            </Button>
            <Button variant="ghost" onClick={() => close(false)}>انصراف</Button>
          </>
        )}>
        <p className="text-sm leading-7 text-ink-700">{confirmState?.message}</p>
        {confirmState?.input && (
          <textarea className="input mt-3" rows={3} placeholder={confirmState.input} autoFocus
            value={confirmState.value || ''} onChange={(e) => setConfirmState((s) => ({ ...s, value: e.target.value }))} />
        )}
      </Modal>
    </UiContext.Provider>
  );
}

export function Segmented({ value, onChange, options, size = 'md' }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-white p-0.5">
      {options.map((opt) => (
        <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
          className={cx('rounded-[10px] font-semibold transition-colors whitespace-nowrap',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
            value === opt.value ? 'bg-ink-900 text-white shadow-sm' : 'text-ink-500 hover:text-ink-900')}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

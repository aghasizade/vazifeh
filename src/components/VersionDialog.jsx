// The "new version" popup, in two cases:
// - news: the first time the app opens on a new version (phone, Windows or browser), it lists what changed;
// - update (Android): a newer APK is on the server; it lists the changes and downloads/installs it with a percentage.
// It replaces the small orange "version" pill the header used to show.
import { useEffect, useState } from 'react';
import { Download, Sparkles } from 'lucide-react';
import { Button, cx, Modal } from './ui.jsx';
import { APP_VERSION, faDigits } from '../lib/format.js';
import { CHANGELOG, changesBetween } from '../../shared/changelog.js';

const SEEN_KEY = 'stt_seen_version';
const LATER_KEY = 'stt_update_later';
const LATER_MS = 12 * 3600000;

const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
// A version number keeps its left-to-right order inside Persian text (1.0.10, not 10.0.1).
const Ver = ({ v }) => <bdi dir="ltr" className="num">{faDigits(v)}</bdi>;

function ChangeList({ entries }) {
  return (
    <div className="space-y-4">
      {entries.map((entry) => (
        <section key={entry.version}>
          {entries.length > 1 && <h4 className="mb-1.5 text-xs font-bold text-ink-500">نسخه <Ver v={entry.version} /></h4>}
          <ul className="space-y-2">
            {entry.items.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-7 text-ink-700">
                <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-copper-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function VersionDialog({ hidden }) {
  const [news, setNews] = useState(null);
  const [update, setUpdate] = useState(null);
  const [download, setDownload] = useState(null);
  const [failed, setFailed] = useState(false);

  // What is new in the version now running: shown once per version.
  useEffect(() => {
    const seen = read(SEEN_KEY);
    if (seen === APP_VERSION) return;
    const entries = changesBetween(CHANGELOG, seen, APP_VERSION);
    if (entries.length) setNews(entries);
    else write(SEEN_KEY, APP_VERSION);
  }, []);

  // A newer APK waiting on the server (Android only). "Later" keeps it quiet for 12 hours.
  useEffect(() => {
    const onUpdate = (event) => {
      const release = event.detail;
      const [version, at] = String(read(LATER_KEY) || '').split('|');
      if (version === release.version && Date.now() - Number(at) < LATER_MS) return;
      setUpdate(release);
    };
    window.addEventListener('stt:update', onUpdate);
    return () => window.removeEventListener('stt:update', onUpdate);
  }, []);

  const closeNews = () => { write(SEEN_KEY, APP_VERSION); setNews(null); };
  const later = () => { write(LATER_KEY, `${update.version}|${Date.now()}`); setUpdate(null); };
  const install = async () => {
    setFailed(false);
    setDownload({ v: 0 });
    const { installApk } = await import('../lib/native.js');
    const ok = await installApk(update, (v) => setDownload({ v }));
    // 'busy': a download started elsewhere (the Profile page) is still running; it opens the installer itself.
    setDownload(ok === true ? { v: 1 } : null);
    if (ok !== true) setFailed(ok === 'busy' ? 'busy' : true);
  };

  if (hidden) return null;
  if (news) {
    return (
      <Modal open onClose={closeNews} title={<span className="inline-flex items-center gap-2"><Sparkles className="size-5 text-copper-600" />تازه‌های نسخه <Ver v={APP_VERSION} /></span>}
        footer={<Button onClick={closeNews}>متوجه شدم</Button>}>
        <p className="mb-3 text-sm text-ink-500">برنامه به‌روز شد. این‌ها تغییرات تازه است:</p>
        <ChangeList entries={news} />
      </Modal>
    );
  }

  if (update) {
    const entries = changesBetween(update.changelog || [], APP_VERSION, update.version);
    const pct = download?.v != null ? Math.round(download.v * 100) : null;
    return (
      <Modal open onClose={download ? undefined : later} title={<span className="inline-flex items-center gap-2"><Download className="size-5 text-copper-600" />نسخه جدید <Ver v={update.version} /> آماده است</span>}
        footer={(
          <>
            <button type="button" onClick={install} disabled={Boolean(download) && pct !== 100}
              className="relative inline-flex h-10 items-center gap-2 overflow-hidden rounded-xl bg-copper-500 px-4 text-sm font-bold text-white">
              {pct != null && <span className="absolute inset-y-0 right-0 bg-copper-700 transition-[width] duration-200" style={{ width: `${pct}%` }} />}
              <Download className="relative size-4" />
              <span className="relative num">
                {!download ? 'دریافت و نصب' : pct === 100 ? 'نصب دوباره' : pct == null ? 'در حال دریافت…' : `در حال دریافت… ${faDigits(pct)}٪`}
              </span>
            </button>
            {!download && <Button variant="ghost" onClick={later}>بعداً</Button>}
            {pct === 100 && <Button variant="ghost" onClick={() => setUpdate(null)}>بستن</Button>}
          </>
        )}>
        <p className="mb-3 text-sm text-ink-500">نسخه نصب‌شده روی گوشی شما <Ver v={APP_VERSION} /> است. تغییرات نسخه جدید:</p>
        {entries.length ? <ChangeList entries={entries} /> : <p className="text-sm leading-7 text-ink-700">{update.notes || 'بهبودها و رفع اشکال.'}</p>}
        {pct === 100 && <p className="mt-3 text-sm font-semibold text-emerald-700">دریافت شد؛ در صفحه‌ای که اندروید باز کرد «نصب» را بزنید. اطلاعات شما سر جایش می‌ماند.</p>}
        {failed && (
          <p className={cx('mt-3 text-sm', failed === 'busy' ? 'text-ink-600' : 'text-red-700')}>
            {failed === 'busy' ? 'نسخه جدید همین حالا در حال دریافت است؛ چند لحظه صبر کنید تا صفحه نصب باز شود.' : 'دریافت در برنامه ناموفق بود؛ فایل در مرورگر باز شد.'}
          </p>
        )}
      </Modal>
    );
  }
  return null;
}

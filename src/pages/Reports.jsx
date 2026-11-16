import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react';
import { Button, Card, cx, Empty, ErrorBox, PageHeader, Segmented, Spinner, useUi } from '../components/ui.jsx';
import { Avatar, PriorityFlag, StatTile, TileRow, ToneChip } from '../components/common.jsx';
import { axisStyle, Chart } from '../components/Chart.jsx';
import { download } from '../lib/api.js';
import { useApp } from '../lib/app.js';
import { setParams, useApi, useStored } from '../lib/hooks.js';
import { dueLabel, fa, faDigits, pct, timeAgo } from '../lib/format.js';
import { overdueNow, STATUS_LABEL, TONE_STYLE, toneOf } from '../lib/tones.js';
import { TaskListModal } from '../components/TaskList.jsx';
import { STATUSES } from '../../shared/status.js';
import { addMonthsJalali, dateToJalali, monthLabel, monthLength, pad } from '../../shared/jalali.js';

export function Reports() {
  const [tab, setTab] = useStored('reports_tab', 'staff');
  const { toast } = useUi();
  const [month, setMonth] = useState(null);
  const exportKind = tab === 'score' ? `scorecard${month ? `?month=${encodeURIComponent(month)}` : ''}` : tab;
  const exportExcel = async () => {
    try { await download(`/export/${exportKind}`); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div>
      <PageHeader title="گزارش‌های مدیریتی"
        actions={(
          <>
            <Button variant="outline" size="sm" icon={Printer} onClick={() => window.print()} className="no-print">چاپ</Button>
            <Button variant="outline" size="sm" icon={Download} onClick={exportExcel} className="no-print">اکسل</Button>
          </>
        )} />
      <div className="no-print mb-4"><Segmented value={tab} onChange={setTab} options={[{ value: 'staff', label: 'وضعیت پرسنل' }, { value: 'overdue', label: 'کارهای معوقه' }, { value: 'score', label: 'کارنامه ماهانه' }]} /></div>
      {tab === 'staff' && <StaffStatus />}
      {tab === 'overdue' && <Overdue />}
      {tab === 'score' && <Scorecard month={month} setMonth={setMonth} />}
    </div>
  );
}

// What each counter of the staff report counts, so a click can list the same tasks.
const WEEK_MS = 7 * 86400000;
const STAFF_COUNTS = {
  open: { title: 'کارهای باز', match: (t) => STATUSES[t.status]?.open },
  todo: { title: 'انجام‌نشده', tone: 'todo', match: (t) => t.status === 'todo' },
  overdue: { title: 'معوقه', tone: 'overdue', match: (t) => toneOf(t) === 'overdue' },
  soon: { title: 'سررسید امروز/فردا', tone: 'soon', match: (t) => toneOf(t) === 'soon' },
  blocked: { title: 'متوقف', tone: 'blocked', match: (t) => t.status === 'blocked' },
  review: { title: 'منتظر تأیید', tone: 'review', match: (t) => t.status === 'review' },
  doneWeek: { title: 'انجام‌شده ۷ روز', tone: 'done', match: (t) => t.status === 'done' && t.doneAt && Date.now() - new Date(t.doneAt) < WEEK_MS },
  // Segments of the workload chart, one colour per task as on the board.
  barBlocked: { title: 'متوقف / برگشتی', tone: 'blocked', match: (t) => ['blocked', 'returned'].includes(toneOf(t)) },
  barOpen: { title: 'سایر کارهای باز', tone: 'doing', match: (t) => ['doing', 'todo'].includes(toneOf(t)) }
};
const CHART_KEYS = ['overdue', 'soon', 'barBlocked', 'barOpen', 'review', 'doneWeek'];

function StaffStatus() {
  const { data, error, loading } = useApi('/reports/staff', { live: ['task', 'report'] });
  const { data: taskData } = useApi('/tasks', { live: ['task'] });
  const [pick, setPick] = useState(null);
  const list = useMemo(() => {
    if (!pick || !data) return null;
    const count = STAFF_COUNTS[pick.key];
    const ids = new Set(pick.person ? [pick.person.id] : data.people.map((p) => p.id));
    return {
      title: pick.person ? `${count.title} — ${pick.person.fullName}` : count.title,
      tone: count.tone,
      tasks: (taskData?.tasks || []).filter((t) => ids.has(t.assigneeId) && count.match(t))
    };
  }, [pick, data, taskData]);
  // A number that opens its list of tasks.
  const cell = (p, key, className) => (
    <td className={cx('num px-1.5 py-1', className)}>
      <button type="button" disabled={!p[key]} onClick={() => setPick({ key, person: p })}
        className="min-w-8 rounded-lg px-1.5 py-1 hover:bg-paper-2 hover:underline disabled:pointer-events-none">{fa(p[key])}</button>
    </td>
  );
  const option = useMemo(() => {
    if (!data) return null;
    const people = [...data.people].reverse();
    const series = [
      // Each task in exactly one segment (same colour as its card), so bar length = number of tasks.
      ['overdue', 'معوقه', (p) => p.bars?.overdue ?? 0],
      ['soon', 'امروز/فردا', (p) => p.bars?.soon ?? 0],
      ['blocked', 'متوقف / برگشتی', (p) => p.bars?.blocked ?? 0],
      ['doing', 'سایر کارهای باز', (p) => p.bars?.open ?? 0],
      ['review', 'منتظر تأیید', (p) => p.bars?.review ?? 0],
      ['done', 'انجام‌شده ۷ روز', (p) => p.doneWeek]
    ];
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { top: 0, right: 0, textStyle: { fontSize: 11 } },
      grid: { left: 10, right: 12, top: 34, bottom: 10, containLabel: true },
      // Bars grow from the right, next to the names, as Persian reads.
      xAxis: { type: 'value', minInterval: 1, inverse: true, ...axisStyle },
      yAxis: { type: 'category', position: 'right', data: people.map((p) => p.fullName), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, fontSize: 12, color: '#14202e' } },
      series: series.map(([tone, name, fn]) => ({ name, type: 'bar', stack: 'all', barMaxWidth: 22, itemStyle: { color: TONE_STYLE[tone].hex }, data: people.map(fn) }))
    };
  }, [data]);
  if (error) return <ErrorBox error={error} />;
  if (!data && loading) return <Spinner />;
  if (!data) return null;
  const t = data.totals;
  return (
    <div className="space-y-4">
      <TileRow cols="md:grid-cols-8">
        <StatTile label="پرسنل" value={t.people} />
        <StatTile label="کارهای باز" value={t.open} onClick={() => setPick({ key: 'open' })} />
        <StatTile label="انجام‌نشده" value={t.todo ?? 0} tone="todo" onClick={() => setPick({ key: 'todo' })} />
        <StatTile label="معوقه" value={t.overdue} tone="overdue" onClick={() => setPick({ key: 'overdue' })} />
        <StatTile label="متوقف" value={t.blocked ?? 0} tone="blocked" onClick={() => setPick({ key: 'blocked' })} />
        <StatTile label="منتظر تأیید" value={t.review} tone="review" onClick={() => setPick({ key: 'review' })} />
        <StatTile label="انجام‌شده ۷ روز" value={t.doneWeek} tone="done" onClick={() => setPick({ key: 'doneWeek' })} />
        <StatTile label="گزارش امروز" value={t.reportToday} hint={`از ${fa(t.reporters ?? t.people)} نفر`} />
      </TileRow>
      <TaskListModal list={list} onClose={() => setPick(null)} />
      {data.people.length > 0 && (
        <Card title="بار کاری و وضعیت هر نفر" subtitle="روی هر رنگ کلیک کنید تا کارهای آن را ببینید.">
          <Chart option={option} height={Math.max(220, data.people.length * 38 + 60)}
            onClick={(e) => setPick({ key: CHART_KEYS[e.seriesIndex], person: [...data.people].reverse()[e.dataIndex] })} />
        </Card>
      )}
      <Card title="جزئیات پرسنل" bodyClassName="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper/70 text-right text-xs text-ink-500">
              <tr>{['نام', 'باز', 'انجام‌نشده', 'معوقه', 'امروز/فردا', 'متوقف', 'منتظر تأیید', 'انجام‌شده ۷ روز', 'گزارش امروز', 'آخرین حضور'].map((h) => <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.id} className="border-t border-line/70">
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><Avatar name={p.fullName} id={p.id} size={28} online={p.online} /><div><div className="font-bold whitespace-nowrap">{p.fullName}{!p.active && <span className="mr-1 text-[10px] font-bold text-red-700">(غیرفعال)</span>}</div><div className="text-[11px] text-ink-400">{p.departmentName || p.title}</div></div></div></td>
                  {cell(p, 'open')}
                  {cell(p, 'todo', 'text-stone-600')}
                  {cell(p, 'overdue', p.overdue && 'font-black text-red-700')}
                  {cell(p, 'soon', p.soon && 'font-bold text-orange-700')}
                  {cell(p, 'blocked', p.blocked && 'font-bold text-yellow-800')}
                  {cell(p, 'review', p.review && 'font-bold text-violet-700')}
                  {cell(p, 'doneWeek', 'text-emerald-700')}
                  <td className="px-3 py-2">{p.reportsRequired === false ? <span className="text-xs text-ink-400">—</span> : p.reportToday ? <ToneChip tone="done">ثبت شد</ToneChip> : <ToneChip tone={data.workDay ? 'overdue' : 'todo'}>{data.workDay ? 'ثبت نشده' : 'تعطیل'}</ToneChip>}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap text-ink-500">{p.online ? 'آنلاین' : p.lastSeenAt ? timeAgo(p.lastSeenAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.people.length && <Empty title="هنوز کارمندی تعریف نشده است">از بخش تنظیمات، کاربران را اضافه کنید.</Empty>}
      </Card>
    </div>
  );
}

function Overdue() {
  const { data, error, loading } = useApi('/reports/overdue', { live: ['task'] });
  if (error) return <ErrorBox error={error} />;
  if (!data && loading) return <Spinner />;
  if (!data) return null;
  if (!data.total) return <Empty title="هیچ کار معوقه‌ای وجود ندارد">همه کارها در مهلت خودشان هستند.</Empty>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600"><b className="num text-red-700">{fa(data.total)}</b> کار از مهلت گذشته است.</p>
      {data.people.map((p) => (
        <Card key={p.id} title={<span className="flex items-center gap-2"><Avatar name={p.fullName} id={p.id} size={28} />{p.fullName}</span>}
          subtitle={`${fa(p.count)} کار معوقه — بیشترین تأخیر ${fa(p.maxLate)} روز`} bodyClassName="px-0 pb-1">
          <ul>
            {p.tasks.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setParams({ task: t.id })} className="flex w-full items-center gap-3 border-t border-line/70 px-5 py-2.5 text-right hover:bg-paper/60">
                  <span className="num grid size-10 shrink-0 place-items-center rounded-xl bg-red-50 text-sm font-black text-red-700">{faDigits(t.lateDays)}<span className="-mt-2 text-[9px] font-semibold">روز</span></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{t.title}</span>
                    <span className="text-[11px] text-ink-400">مهلت: {dueLabel(t)} · {STATUS_LABEL[t.status]} · پیشرفت {fa(t.progress)}٪</span>
                  </span>
                  <PriorityFlag priority={t.priority} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

const scoreTone = (score) => (score === null ? 'bg-stone-100 text-stone-500' : score >= 85 ? 'bg-emerald-100 text-emerald-800' : score >= 70 ? 'bg-sky-100 text-sky-800' : score >= 50 ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800');

function Sparkline({ values }) {
  const points = values.map((v, i) => [i, v]).filter(([, v]) => v !== null);
  if (points.length < 2) return <span className="text-[11px] text-ink-300">—</span>;
  const w = 84; const h = 26;
  const x = (i) => w - (i / (values.length - 1)) * w;
  const y = (v) => h - 2 - (v / 100) * (h - 4);
  const d = points.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-label="روند شش ماه">
      <path d={d} fill="none" stroke="#c97422" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last[0])} cy={y(last[1])} r="2.6" fill="#c97422" />
    </svg>
  );
}

// The tasks behind each scorecard number, judged the way the server's scoreFor does.
const SCORE_COUNTS = { due: 'سررسیدشده', onTime: 'انجام به‌موقع', lateDone: 'انجام با تأخیر', openLate: 'هنوز معوقه', returns: 'برگشتی', completed: 'انجام‌شده در ماه' };
const SCORE_TONE = { onTime: 'done', lateDone: 'soon', openLate: 'overdue', returns: 'returned', completed: 'done' };

function inScore(t, key, { from, to, today }) {
  if (key === 'completed') {
    const day = t.status === 'done' && t.doneAt ? dateToJalali(new Date(t.doneAt)) : null;
    return Boolean(day) && day >= from && day <= to;
  }
  const end = to < today ? to : today;
  if (!t.dueDate || t.dueDate < from || t.dueDate > end || t.status === 'cancelled') return false;
  if (key === 'returns') return t.returnCount > 0;
  const sent = t.submittedAt && !STATUSES[t.status]?.open ? dateToJalali(new Date(t.submittedAt)) : null;
  const kind = sent ? (sent <= t.dueDate ? 'onTime' : 'lateDone') : overdueNow(t) ? 'openLate' : null;
  return key === 'due' ? Boolean(kind) : kind === key;
}

function Scorecard({ month, setMonth }) {
  const { meta } = useApp();
  const current = meta.today.slice(0, 7);
  const target = month || current;
  const { data, error, loading } = useApi(`/reports/scorecard?month=${encodeURIComponent(target)}`, { live: ['task', 'report'] });
  const { data: taskData } = useApi('/tasks?scope=all', { live: ['task'] });
  const [pick, setPick] = useState(null);
  const list = useMemo(() => {
    if (!pick) return null;
    const [y, m] = target.split('/').map(Number);
    const range = { from: `${target}/01`, to: `${target}/${pad(monthLength(y, m))}`, today: meta.today };
    return {
      title: `${SCORE_COUNTS[pick.key]} — ${pick.person.fullName} — ${faDigits(monthLabel(target))}`,
      tone: SCORE_TONE[pick.key],
      tasks: (taskData?.tasks || []).filter((t) => t.assigneeId === pick.person.id && inScore(t, pick.key, range))
    };
  }, [pick, taskData, target, meta.today]);
  const cell = (p, key, className, children) => (
    <td className={cx('num px-1.5 py-1', className)}>
      <button type="button" disabled={!p[key]} onClick={() => setPick({ key, person: p })}
        className="rounded-lg px-1.5 py-1 hover:bg-paper-2 hover:underline disabled:pointer-events-none">{children ?? fa(p[key])}</button>
    </td>
  );
  const shift = (n) => setMonth(addMonthsJalali(`${target}/01`, n).slice(0, 7));
  const option = useMemo(() => data && ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 10, right: 10, top: 16, bottom: 10, containLabel: true },
    xAxis: { type: 'category', inverse: true, data: data.people.map((p) => p.fullName), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, interval: 0, rotate: data.people.length > 6 || (window.innerWidth < 768 && data.people.length > 2) ? 40 : 0 } },
    yAxis: { type: 'value', max: 100, position: 'right', ...axisStyle },
    series: [{
      type: 'bar', barMaxWidth: 36, name: 'امتیاز',
      data: data.people.map((p) => ({ value: p.score, itemStyle: { color: p.score >= 85 ? '#059669' : p.score >= 70 ? '#0284c7' : p.score >= 50 ? '#ea580c' : '#dc2626', borderRadius: [6, 6, 0, 0] } })),
      label: { show: true, position: 'top', fontSize: 11, formatter: ({ value }) => (value === null || value === undefined ? '' : faDigits(value)) }
    }]
  }), [data]);

  return (
    <div className="space-y-4">
      <div className="no-print card flex items-center gap-2 p-2">
        <button type="button" className="rounded-lg p-2 hover:bg-paper" onClick={() => shift(-1)} title="ماه قبل"><ChevronRight className="size-5" /></button>
        <span className="min-w-32 text-center font-extrabold">{faDigits(monthLabel(target))}</span>
        <button type="button" className="rounded-lg p-2 hover:bg-paper disabled:opacity-30" disabled={target >= current} onClick={() => shift(1)} title="ماه بعد"><ChevronLeft className="size-5" /></button>
        <p className="mr-auto hidden text-xs leading-6 text-ink-500 md:block">امتیاز از ۱۰۰: ۶۰ برای انجام به‌موقع، ۲۵ برای نظم گزارش روزانه، ۱۵ برای کار بدون برگشت.</p>
      </div>
      {error && <ErrorBox error={error} />}
      {!data && loading && <Spinner />}
      {data && (
        <>
          {data.people.some((p) => p.score !== null) && <Card title={`امتیاز پرسنل — ${faDigits(monthLabel(data.month))}`}><Chart option={option} height={260} /></Card>}
          <Card bodyClassName="px-0 pb-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper/70 text-right text-xs text-ink-500">
                  <tr>{['', 'نام', 'امتیاز', 'روند ۶ ماه', 'سررسیدشده', 'به‌موقع', 'با تأخیر', 'هنوز معوقه', 'میانگین تأخیر', 'برگشتی', 'گزارش روزانه', 'انجام‌شده در ماه'].map((h, i) => <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {data.people.map((p, i) => (
                    <tr key={p.id} className="border-t border-line/70">
                      <td className="num px-3 py-2 text-xs text-ink-400">{fa(i + 1)}</td>
                      <td className="px-3 py-2"><div className="flex items-center gap-2"><Avatar name={p.fullName} id={p.id} size={26} /><span className="font-bold whitespace-nowrap">{p.fullName}{!p.active && <span className="mr-1 text-[10px] font-bold text-red-700">(غیرفعال)</span>}</span></div></td>
                      <td className="px-3 py-2"><span className={cx('num inline-block min-w-10 rounded-lg px-2 py-1 text-center text-sm font-black', scoreTone(p.score))}>{p.score === null ? '—' : fa(p.score)}</span></td>
                      <td className="px-3 py-2"><Sparkline values={p.trend.map((t) => t.score)} /></td>
                      {cell(p, 'due')}
                      {cell(p, 'onTime', 'text-emerald-700', <>{fa(p.onTime)} <span className="text-[11px] text-ink-400">({pct(p.onTimeRate)})</span></>)}
                      {cell(p, 'lateDone', 'text-orange-700')}
                      {cell(p, 'openLate', p.openLate && 'font-bold text-red-700')}
                      <td className="num px-3 py-2">{p.avgDelay ? `${fa(p.avgDelay, 1)} روز` : '—'}</td>
                      {cell(p, 'returns')}
                      <td className="num px-3 py-2">{p.reportsExpected ? <>{faDigits(`${p.reportsSubmitted}/${p.reportsExpected}`)} <span className="text-[11px] text-ink-400">({pct(p.reportRate)})</span></> : '—'}</td>
                      {cell(p, 'completed')}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.people.length && <Empty title="کارمندی برای ارزیابی نیست" />}
          </Card>
          <TaskListModal list={list} onClose={() => setPick(null)} />
        </>
      )}
    </div>
  );
}

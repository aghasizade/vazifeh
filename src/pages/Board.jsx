import { useMemo, useState } from 'react';
import { ChevronDown, Columns3, Download, LayoutGrid, Plus, RefreshCw, Rows3, Search, SlidersHorizontal } from 'lucide-react';
import { Button, cx, Empty, ErrorBox, IconButton, PageHeader, Segmented, Spinner, useUi } from '../components/ui.jsx';
import { Avatar, PriorityFlag, StatTile, TaskCard, TileRow, ToneChip } from '../components/common.jsx';
import { TaskListModal } from '../components/TaskList.jsx';
import { STATUSES } from '../../shared/status.js';
import { download } from '../lib/api.js';
import { useApp } from '../lib/app.js';
import { setParams, useApi, useIsMobile, useStored, useTick } from '../lib/hooks.js';
import { dueLabel, fa, faDigits, timeAgo } from '../lib/format.js';
import { compareTasks, PRIORITY, STATUS_LABEL, TONE_STYLE, toneOf } from '../lib/tones.js';

const openTask = (task) => setParams({ task: task.id });

// Counters: overdue / due-soon go by the deadline, every other colour by the task's status, so a blocked task that is
// also due today still counts as blocked (the card itself shows the deadline colour). "open" is every task still to be
// finished. Each counter opens the list of its tasks.
const DATE_TONES = ['overdue', 'soon'];
const matches = (task, key) => (key === 'open' ? STATUSES[task.status]?.open : DATE_TONES.includes(key) ? toneOf(task) === key : task.status === key);
const TILES = [
  { key: 'open', label: 'کارهای باز' },
  { key: 'overdue', label: 'معوقه' },
  { key: 'soon', label: 'امروز و فردا' },
  { key: 'todo', label: 'انجام‌نشده' },
  { key: 'doing', label: 'در حال انجام' },
  { key: 'blocked', label: 'متوقف' },
  { key: 'returned', label: 'برگشتی' },
  { key: 'review', label: 'منتظر تأیید' },
  { key: 'done', label: 'انجام‌شده اخیر' }
];
const ONLINE_MS = 5 * 60000;

export function Board({ onNewTask }) {
  const { meta, user } = useApp();
  const { toast } = useUi();
  const mobile = useIsMobile();
  const { data, error, loading, stale, reload } = useApi('/tasks', { live: ['task', 'meta'] });
  const [view, setView] = useStored('board_view', 'people');
  const [filters, setFilters] = useStored('board_filters', { department: '', tag: '', priority: '', showDone: false });
  // The counter whose tasks are listed: { key, person? }.
  const [pick, setPick] = useState(null);
  const [q, setQ] = useState('');
  // On phones the extra filters sit behind one button so the cards start higher up.
  const [showFilters, setShowFilters] = useState(false);
  const activeFilters = [filters.department, filters.tag, filters.priority !== '' && filters.priority !== undefined ? 'p' : '', filters.showDone ? 'd' : ''].filter(Boolean).length;
  useTick(60000);

  const tasks = data?.tasks || [];
  const counts = useMemo(() => {
    const c = {};
    tasks.forEach((t) => TILES.forEach(({ key }) => { if (matches(t, key)) c[key] = (c[key] || 0) + 1; }));
    return c;
  }, [tasks]);

  const filtered = useMemo(() => tasks.filter((t) => {
    if (!filters.showDone && ['done', 'cancelled'].includes(t.status)) return false;
    if (filters.department && String(t.departmentId) !== String(filters.department)) return false;
    if (filters.tag && t.tag !== filters.tag) return false;
    if (filters.priority !== '' && filters.priority !== undefined && String(t.priority) !== String(filters.priority)) return false;
    if (q && !`${t.title} ${t.assigneeName} ${t.tag}`.includes(q.trim())) return false;
    return true;
  }).sort(compareTasks), [tasks, filters, q]);

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const exportExcel = async () => {
    try { await download('/export/tasks'); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <PageHeader eyebrow={meta.settings.companyName} title="تابلوی پرسنل"
        subtitle={stale ? 'بدون اتصال؛ آخرین اطلاعات ذخیره‌شده نمایش داده می‌شود.' : null}
        actions={(
          <>
            <IconButton icon={RefreshCw} title="به‌روزرسانی" onClick={() => reload()} />
            {!mobile && <IconButton icon={Download} title="خروجی اکسل همه تسک‌ها" onClick={exportExcel} />}
            {!mobile && <Button icon={Plus} onClick={() => onNewTask()}>تسک جدید</Button>}
          </>
        )} />

      {/* Counters in one row; on phones the row scrolls sideways instead of taking half the screen. */}
      <div className="mb-3"><TileRow cols="md:grid-cols-9">
        {TILES.map((tile) => (
          <StatTile key={tile.key} label={tile.label} tone={tile.key === 'open' ? undefined : tile.key} value={counts[tile.key] || 0}
            onClick={() => setPick({ key: tile.key })} active={pick?.key === tile.key && !pick.person} />
        ))}
      </TileRow></div>
      <TaskListModal onClose={() => setPick(null)} list={pick && {
        title: `${TILES.find((t) => t.key === pick.key).label}${pick.person ? ` — ${pick.person.fullName}` : ''}`,
        tone: pick.key === 'open' ? null : pick.key,
        tasks: tasks.filter((t) => matches(t, pick.key) && (!pick.person || t.assigneeId === pick.person.id))
      }} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-400" />
          <input type="search" className="input pr-9" placeholder="جستجو…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {mobile && (
          <Button variant="outline" icon={SlidersHorizontal} onClick={() => setShowFilters((v) => !v)}>
            فیلتر{activeFilters > 0 ? ` (${fa(activeFilters)})` : ''}
          </Button>
        )}
        {(!mobile || showFilters) && <>
          {meta.departments.length > 0 && (
            <select className="input w-auto" value={filters.department} onChange={(e) => setFilter('department', e.target.value)}>
              <option value="">همه واحدها</option>
              {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          {meta.tags.length > 0 && (
            <select className="input w-auto" value={filters.tag} onChange={(e) => setFilter('tag', e.target.value)}>
              <option value="">همه برچسب‌ها</option>
              {meta.tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <select className="input w-auto" value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)}>
            <option value="">هر اولویت</option>
            {PRIORITY.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-ink-600">
            <input type="checkbox" className="size-4 accent-[#14202e]" checked={filters.showDone} onChange={(e) => setFilter('showDone', e.target.checked)} />
            انجام‌شده‌ها
          </label>
        </>}
        {!mobile && (
          <div className="mr-auto">
            <Segmented size="sm" value={view} onChange={setView} options={[
              { value: 'people', label: <span className="inline-flex items-center gap-1"><Rows3 className="size-3.5" /> پرسنل</span> },
              { value: 'kanban', label: <span className="inline-flex items-center gap-1"><Columns3 className="size-3.5" /> وضعیت</span> },
              { value: 'table', label: <span className="inline-flex items-center gap-1"><LayoutGrid className="size-3.5" /> جدول</span> }
            ]} />
          </div>
        )}
      </div>

      <ErrorBox error={error} />
      {!data && loading && <Spinner />}
      {data && (view === 'people' || mobile) && <PeopleView tasks={filtered} meta={meta} me={user} onNewTask={onNewTask} onPick={setPick} filters={filters} narrowed={Boolean(q)} />}
      {data && !mobile && view === 'kanban' && <KanbanView tasks={filtered} />}
      {data && !mobile && view === 'table' && <TableView tasks={filtered} />}
    </div>
  );
}

// Workload of one person, so the busiest and most urgent people come first on the board.
// Each unfinished task weighs by priority (low 1, normal 2, important 3, urgent 5) and gets extra weight when it
// is overdue (+4), due today or tomorrow (+2), or returned for rework (+1). A task waiting for approval counts a
// little (0.5: the ball is with the manager); finished and cancelled tasks count nothing.
const PRIORITY_WEIGHT = [1, 2, 3, 5];
export function workload(tasks) {
  let score = 0;
  let overdue = 0;
  let open = 0;
  let top = -1;
  tasks.forEach((t) => {
    if (t.status === 'review') { score += 0.5; return; }
    if (!STATUSES[t.status]?.open) return;
    open += 1;
    top = Math.max(top, t.priority);
    const tone = toneOf(t);
    score += PRIORITY_WEIGHT[t.priority] ?? 2;
    if (tone === 'overdue') { score += 4; overdue += 1; } else if (tone === 'soon') score += 2;
    if (t.status === 'returned') score += 1;
  });
  return { score, overdue, open, top };
}

function PeopleView({ tasks, meta, onNewTask, onPick, filters, narrowed }) {
  const mobile = useIsMobile();
  const [collapsed, setCollapsed] = useStored('board_collapsed', {});
  const [order, setOrder] = useStored('board_people_order', 'load');
  const people = useMemo(() => {
    const ids = new Set([...meta.staffIds, ...tasks.map((t) => t.assigneeId)]);
    const byId = new Map(meta.users.map((u) => [u.id, u]));
    const deptOrder = new Map(meta.departments.map((d, i) => [d.id, i]));
    const loads = new Map([...ids].map((id) => [id, workload(tasks.filter((t) => t.assigneeId === id))]));
    const byDept = (a, b) => (deptOrder.get(a.departmentId) ?? 99) - (deptOrder.get(b.departmentId) ?? 99);
    const byName = (a, b) => a.fullName.localeCompare(b.fullName, 'fa');
    const byLoad = (a, b) => {
      const x = loads.get(a.id);
      const y = loads.get(b.id);
      return y.score - x.score || y.overdue - x.overdue || y.top - x.top || y.open - x.open;
    };
    return [...ids].map((id) => byId.get(id)).filter(Boolean)
      .filter((u) => !filters.department || String(u.departmentId) === String(filters.department))
      .filter((u) => !narrowed || tasks.some((t) => t.assigneeId === u.id))
      .sort((a, b) => (order === 'dept' ? byDept(a, b) || byName(a, b) : byLoad(a, b) || byName(a, b)));
  }, [meta, tasks, filters.department, narrowed, order]);

  if (!people.length) return <Empty title="کاری با این فیلترها پیدا نشد" />;
  const deptName = (id) => meta.departments.find((d) => d.id === id)?.name || '';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="text-xs text-ink-400">{order === 'dept' ? 'به ترتیب واحد و نام' : 'اول کسی که بیشترین و فوری‌ترین کار را دارد (معوقه، اولویت، تعداد)'}</span>
        <Segmented size="sm" value={order} onChange={setOrder}
          options={[{ value: 'load', label: 'بار کاری' }, { value: 'dept', label: 'واحد و نام' }]} />
      </div>
      {people.map((person) => {
        const mine = tasks.filter((t) => t.assigneeId === person.id);
        const overdue = mine.filter((t) => toneOf(t) === 'overdue').length;
        const open = mine.filter((t) => !['done', 'cancelled', 'review'].includes(t.status)).length;
        const online = person.lastSeenAt && Date.now() - new Date(person.lastSeenAt) < ONLINE_MS;
        const isCollapsed = collapsed[person.id];
        return (
          <section key={person.id} className="card overflow-hidden">
            <header className="flex items-center gap-3 border-b border-line/70 bg-paper/40 px-4 py-2.5">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-right" onClick={() => setCollapsed((c) => ({ ...c, [person.id]: !c[person.id] }))}>
                <Avatar name={person.fullName} id={person.id} size={38} online={Boolean(online)} />
                <div className="min-w-0">
                  <div className="truncate font-extrabold text-ink-900">{person.fullName}{!person.active && <span className="mr-2 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">غیرفعال — کارهایش را واگذار کنید</span>}</div>
                  <div className="truncate text-[11px] text-ink-400">
                    {[person.title, deptName(person.departmentId)].filter(Boolean).join(' — ')}
                    {person.lastSeenAt && <span> · {online ? 'آنلاین' : `آخرین حضور ${timeAgo(person.lastSeenAt)}`}</span>}
                  </div>
                </div>
                <ChevronDown className={cx('size-4 shrink-0 text-ink-400 transition', isCollapsed && 'rotate-90')} />
              </button>
              <div className="flex shrink-0 items-center gap-1.5">
                {overdue > 0 && <button type="button" onClick={() => onPick({ key: 'overdue', person })}><ToneChip tone="overdue" className="hover:underline">{fa(overdue)} معوقه</ToneChip></button>}
                <button type="button" disabled={!open} onClick={() => onPick({ key: 'open', person })}
                  className="hidden rounded-lg px-1.5 py-1 text-xs text-ink-500 hover:bg-paper-2 hover:text-ink-900 disabled:pointer-events-none sm:inline">{fa(open)} کار باز</button>
                <IconButton icon={Plus} title={`تسک جدید برای ${person.fullName}`} onClick={() => onNewTask({ assigneeId: person.id })} />
              </div>
            </header>
            {!isCollapsed && (
              mine.length ? (
                <div className={cx('p-3', mobile ? 'no-scrollbar flex snap-x gap-2 overflow-x-auto' : 'grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2')}>
                  {mine.map((t) => (
                    <div key={t.id} className={mobile ? 'w-[72vw] max-w-64 shrink-0 snap-start' : ''}>
                      <TaskCard task={t} onOpen={openTask} compact={mobile} />
                    </div>
                  ))}
                </div>
              ) : <div className="px-4 py-3 text-xs text-ink-400">کار بازی ندارد.</div>
            )}
          </section>
        );
      })}
    </div>
  );
}

const COLUMNS = [
  { key: 'todo', title: 'انجام‌نشده', match: (t) => t.status === 'todo' },
  { key: 'doing', title: 'در حال انجام', match: (t) => t.status === 'doing' },
  { key: 'blocked', title: 'متوقف / برگشتی', match: (t) => t.status === 'blocked' || t.status === 'returned' },
  { key: 'review', title: 'منتظر تأیید', match: (t) => t.status === 'review' },
  { key: 'done', title: 'انجام‌شده', match: (t) => t.status === 'done' || t.status === 'cancelled' }
];

function KanbanView({ tasks }) {
  return (
    <div className="grid grid-cols-5 gap-3">
      {COLUMNS.map((col) => {
        const list = tasks.filter(col.match);
        return (
          <section key={col.key} className="min-w-0 rounded-2xl bg-paper-2/60 p-2">
            <header className="mb-2 flex items-center justify-between px-1.5 pt-1 text-sm font-extrabold">
              <span className="flex items-center gap-1.5"><span className={cx('size-2.5 rounded-full', TONE_STYLE[col.key].dot)} />{col.title}</span>
              <span className="num text-xs text-ink-400">{fa(list.length)}</span>
            </header>
            <div className="space-y-2">{list.map((t) => <TaskCard key={t.id} task={t} onOpen={openTask} showAssignee compact />)}</div>
          </section>
        );
      })}
    </div>
  );
}

function TableView({ tasks }) {
  const [sort, setSort] = useState({ key: 'tone', dir: 1 });
  const sorted = useMemo(() => {
    const list = [...tasks];
    const key = sort.key;
    if (key !== 'tone') list.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'fa') * sort.dir || compareTasks(a, b));
    else if (sort.dir < 0) list.reverse();
    return list;
  }, [tasks, sort]);
  const th = (key, label) => (
    <th className="cursor-pointer px-3 py-2 font-semibold whitespace-nowrap hover:text-ink-900" onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}>
      {label}{sort.key === key ? (sort.dir > 0 ? ' ▾' : ' ▴') : ''}
    </th>
  );
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-paper/70 text-right text-xs text-ink-500">
          <tr>{th('title', 'عنوان')}{th('assigneeName', 'مسئول')}{th('tone', 'وضعیت')}{th('dueDate', 'سررسید')}{th('priority', 'اولویت')}{th('progress', 'پیشرفت')}{th('tag', 'برچسب')}</tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const tone = toneOf(t);
            return (
              <tr key={t.id} className="cursor-pointer border-t border-line/70 hover:bg-paper/50" onClick={() => openTask(t)}>
                <td className="max-w-80 truncate px-3 py-2 font-semibold" style={{ boxShadow: `inset -3px 0 0 ${TONE_STYLE[tone].hex}` }}>{t.title}</td>
                <td className="px-3 py-2 whitespace-nowrap">{t.assigneeName}</td>
                <td className="px-3 py-2"><ToneChip tone={tone}>{tone === t.status ? undefined : `${TONE_STYLE[tone].label} · ${STATUS_LABEL[t.status]}`}</ToneChip></td>
                <td className={cx('px-3 py-2 whitespace-nowrap', tone === 'overdue' && 'font-bold text-red-700')}>{dueLabel(t)}{tone === 'overdue' && t.lateDays ? ` (${faDigits(t.lateDays)} روز)` : ''}</td>
                <td className="px-3 py-2"><PriorityFlag priority={t.priority} withLabel /></td>
                <td className="num px-3 py-2">{fa(t.progress)}٪</td>
                <td className="px-3 py-2 text-xs text-ink-500">{t.tag}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!sorted.length && <Empty title="کاری با این فیلترها پیدا نشد" />}
    </div>
  );
}

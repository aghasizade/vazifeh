// Realistic demo data for presentations. Every row is marked is_demo and can be removed in one step.
import crypto from 'node:crypto';
import { hashPassword } from './auth.js';
import { isWorkDay } from './calendar.js';
import { addDaysJalali, dateToJalali, jalaliToDate } from '../shared/jalali.js';

const DEPARTMENTS = ['فنی و اجرایی', 'تأسیسات', 'مالی و اداری', 'بازرگانی و تدارکات'];

const PEOPLE = [
  { key: 'reza', username: 'demo.karimi', name: 'مهندس رضا کریمی', title: 'سرپرست فنی', role: 'supervisor', dept: 0, reliability: 0.9, reports: 0.95 },
  { key: 'negar', username: 'demo.ahmadi', name: 'مهندس نگار احمدی', title: 'کارشناس دفتر فنی', role: 'employee', dept: 0, reliability: 0.95, reports: 1 },
  { key: 'ali', username: 'demo.rostami', name: 'علی رستمی', title: 'سرپرست کارگاه', role: 'employee', dept: 0, reliability: 0.7, reports: 0.8 },
  { key: 'amir', username: 'demo.hosseini', name: 'مهندس امیر حسینی', title: 'کارشناس تأسیسات', role: 'employee', dept: 1, reliability: 0.8, reports: 0.85 },
  { key: 'maryam', username: 'demo.salehi', name: 'مریم صالحی', title: 'حسابدار', role: 'employee', dept: 2, reliability: 0.92, reports: 0.9 },
  { key: 'zahra', username: 'demo.nouri', name: 'زهرا نوری', title: 'مسئول دفتر', role: 'employee', dept: 2, reliability: 0.88, reports: 0.7 },
  { key: 'hossein', username: 'demo.moradi', name: 'حسین مرادی', title: 'کارپرداز', role: 'employee', dept: 3, reliability: 0.6, reports: 0.6 }
];

// Routine work used to fill the last three months, so scorecards and trends have history.
const ROUTINE = {
  0: ['کنترل نقشه‌های اجرایی', 'تهیه دستور کار پیمانکار', 'بررسی متره و برآورد', 'کنترل کیفیت بتن‌ریزی', 'به‌روزرسانی برنامه زمان‌بندی', 'تهیه گزارش پیشرفت هفتگی', 'بازدید از کارگاه و ثبت صورت‌جلسه', 'کنترل آرماتوربندی پیش از بتن‌ریزی'],
  1: ['بازدید سیستم تصفیه استخر', 'کنترل لوله‌کشی موتورخانه', 'تست فشار خط آب گرم', 'بررسی پیشنهاد فنی چیلر', 'کنترل کانال‌کشی سالن'],
  2: ['ثبت فاکتورهای خرید هفته', 'تهیه لیست حقوق و دستمزد', 'تطبیق حساب تنخواه کارگاه', 'پیگیری چک‌های دریافتنی', 'ارسال لیست بیمه', 'بایگانی قراردادها'],
  3: ['استعلام قیمت مصالح', 'خرید سیمان و ملات', 'پیگیری ارسال بار از تهران', 'تحویل مصالح به انبار کارگاه', 'مقایسه پیش‌فاکتورها']
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (jalali, hour, minute = 0) => {
  const date = jalaliToDate(jalali);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

export function demoStatus(db) {
  return {
    loaded: Boolean(db.get('SELECT id FROM users WHERE is_demo = 1 LIMIT 1')),
    users: db.get('SELECT COUNT(*) AS n FROM users WHERE is_demo = 1').n,
    tasks: db.get('SELECT COUNT(*) AS n FROM tasks WHERE is_demo = 1').n,
    reports: db.get('SELECT COUNT(*) AS n FROM daily_reports WHERE is_demo = 1').n,
    password: db.getSetting('demo_password') || null
  };
}

export function removeDemoData(db) {
  db.transaction(() => {
    const taskIds = 'SELECT id FROM tasks WHERE is_demo = 1';
    db.run(`DELETE FROM files WHERE event_id IN (SELECT id FROM task_events WHERE task_id IN (${taskIds}))`);
    db.run(`DELETE FROM task_events WHERE task_id IN (${taskIds})`);
    db.run(`DELETE FROM task_checklist WHERE task_id IN (${taskIds})`);
    db.run(`DELETE FROM notifications WHERE task_id IN (${taskIds}) OR user_id IN (SELECT id FROM users WHERE is_demo = 1)`);
    db.run('DELETE FROM tasks WHERE is_demo = 1');
    db.run('DELETE FROM recurrences WHERE is_demo = 1');
    db.run('DELETE FROM files WHERE report_id IN (SELECT id FROM daily_reports WHERE is_demo = 1)');
    db.run('DELETE FROM daily_reports WHERE is_demo = 1');
    db.run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)');
    db.run('DELETE FROM users WHERE is_demo = 1');
    db.run('UPDATE users SET department_id = NULL WHERE department_id IN (SELECT id FROM departments WHERE is_demo = 1)');
    db.run('DELETE FROM departments WHERE is_demo = 1');
    db.run("DELETE FROM meta WHERE key = 'demo_password'");
  });
}

const newDemoPassword = () => crypto.randomBytes(5).toString('hex');

// Demo accounts made by an earlier version all had one published password. At start they get a random one
// (shown to the admin in Settings) and are signed out everywhere.
export function secureDemoAccounts(db) {
  if (db.getSetting('demo_password') || !db.get('SELECT id FROM users WHERE is_demo = 1 LIMIT 1')) return;
  const plain = newDemoPassword();
  db.transaction(() => {
    db.run('UPDATE users SET password_hash = ? WHERE is_demo = 1', [hashPassword(plain)]);
    db.run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)');
    db.setSetting('demo_password', plain);
  });
}

export function loadDemoData(db, boss) {
  removeDemoData(db);
  const random = rng(1405);
  const today = dateToJalali();
  const d = (n) => addDaysJalali(today, n);
  const settings = db.settings();
  const nowIso = new Date().toISOString();

  db.transaction(() => {
    const deptIds = DEPARTMENTS.map((name, i) => db.run('INSERT INTO departments (name, sort_order, is_demo) VALUES (?, ?, 1)', [name, 100 + i]).lastId);
    const plain = newDemoPassword();
    db.setSetting('demo_password', plain);
    const password = hashPassword(plain);
    const ids = {};
    PEOPLE.forEach((p) => {
      ids[p.key] = db.run(
        `INSERT INTO users (username, full_name, title, role, department_id, password_hash, is_demo, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        // Joined 100 days ago, so three months of demo history counts in their scorecards.
        [p.username, p.name, p.title, p.role, deptIds[p.dept], password, new Date(Date.now() - 100 * 86400000).toISOString(), new Date(Date.now() - random() * 6 * 3600000).toISOString()]
      ).lastId;
    });
    const bossId = boss.id;

    const event = (taskId, userId, type, createdAt, { body = null, meta = null, lat = null, lng = null } = {}) => db.run(
      'INSERT INTO task_events (task_id, user_id, type, body, meta, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [taskId, userId, type, body, meta ? JSON.stringify(meta) : null, lat, lng, createdAt]
    );

    // t: one hand-written task with its story.
    const task = (who, title, o = {}) => {
      const assignee = ids[who];
      const start = o.start ?? d(-3);
      const status = o.status || 'todo';
      const submitted = o.submitted !== undefined ? at(o.submitted, 15, 20) : null;
      const created = at(start, 8, 40);
      const updated = submitted || (o.updated !== undefined ? at(o.updated, 11, 10) : created);
      const { lastId } = db.run(
        `INSERT INTO tasks (title, description, assignee_id, created_by, priority, status, tag, start_date, due_date, due_time, progress,
           blocked_reason, submitted_at, done_at, approved_by, return_count, created_at, updated_at, is_demo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [title, o.desc || '', assignee, o.by ? ids[o.by] : bossId, o.priority ?? 1, status, o.tag || null, start, o.due ?? null, o.time ?? null,
          o.progress ?? (status === 'done' ? 100 : 0), o.blocked || null, submitted, status === 'done' ? (o.doneAt ? at(o.doneAt, 17) : submitted || updated) : null,
          status === 'done' ? bossId : null, o.returns || 0, created, updated]
      );
      event(lastId, o.by ? ids[o.by] : bossId, 'created', created);
      (o.checklist || []).forEach(([text, done], i) => db.run('INSERT INTO task_checklist (task_id, text, done, sort_order, done_by, done_at) VALUES (?, ?, ?, ?, ?, ?)',
        [lastId, text, done ? 1 : 0, i, done ? assignee : null, done ? updated : null]));
      if (status !== 'todo') event(lastId, assignee, 'status', at(start, 9, 30), { meta: { from: 'todo', to: 'doing' } });
      (o.chat || []).forEach(([speaker, text, day, extra]) => event(lastId, speaker === 'boss' ? bossId : ids[speaker], 'comment', at(day, 10 + Math.floor(random() * 7), Math.floor(random() * 59)), { body: text, ...(extra || {}) }));
      if (o.returns) event(lastId, bossId, 'status', at(o.returnedOn || d(-1), 12), { body: o.returnNote, meta: { from: 'review', to: 'returned' } });
      if (status === 'blocked') event(lastId, assignee, 'status', updated, { body: o.blocked, meta: { from: 'doing', to: 'blocked' } });
      if (status === 'review' || status === 'done') event(lastId, assignee, 'status', submitted || updated, { meta: { from: 'doing', to: 'review' } });
      if (status === 'done') event(lastId, bossId, 'status', o.doneAt ? at(o.doneAt, 17) : submitted || updated, { meta: { from: 'review', to: 'done' } });
      return lastId;
    };

    // Overdue
    task('hossein', 'خرید ۲۰ تن میلگرد A3 سایز ۱۶ و ۱۸', { priority: 3, tag: 'خرید', start: d(-9), due: d(-4), status: 'doing', progress: 40,
      desc: 'طبق درخواست دفتر فنی برای سقف سالن ورزشی. حداقل سه پیش‌فاکتور گرفته شود.',
      checklist: [['استعلام از سه فروشنده', true], ['تأیید پیش‌فاکتور توسط مدیرعامل', true], ['پرداخت و حواله بار', false], ['تحویل در کارگاه و ثبت در انبار', false]],
      chat: [['hossein', 'پیش‌فاکتورها رسید؛ ذوب آهن اصفهان ارزان‌تر است ولی تحویل ۵ روز طول می‌کشد.', d(-6)], ['boss', 'همان را بگیرید، فقط تاریخ تحویل را کتبی بگیرید.', d(-6)]] });
    task('ali', 'رفع نواقص صورت‌جلسه بازدید ناظر (دیوار حائل شرقی)', { priority: 2, tag: 'کارگاه', start: d(-12), due: d(-2), status: 'doing', progress: 60,
      checklist: [['ترمیم کرم‌بندی بتن', true], ['اصلاح شیب زهکش پشت دیوار', true], ['عایق‌کاری قیری', false]] });
    task('zahra', 'تمدید بیمه‌نامه مسئولیت مدنی کارگاه', { priority: 3, tag: 'اداری', start: d(-10), due: d(-1), time: '12:00', status: 'todo' });
    task('amir', 'پیگیری تأییدیه نقشه‌های تأسیسات استخر از نظام مهندسی', { priority: 2, tag: 'مجوز', start: d(-20), due: d(-7), status: 'doing', progress: 70,
      chat: [['amir', 'پرونده ارجاع شده به کارشناس؛ گفتند تا آخر هفته جواب می‌دهند.', d(-5)]] });

    // Due today / tomorrow
    task('negar', 'تهیه صورت‌وضعیت شماره ۷ پیمانکار سازه', { priority: 2, tag: 'صورت‌وضعیت', start: d(-4), due: d(0), time: '14:00', status: 'doing', progress: 75,
      checklist: [['کنترل متره بتن و آرماتور', true], ['کسر پیش‌پرداخت و سپرده', true], ['تأیید ناظر مقیم', false]] });
    task('maryam', 'ارسال اسناد هزینه آبان به حسابداری مرکزی', { tag: 'مالی', start: d(-2), due: d(1), status: 'doing', progress: 50 });
    task('ali', 'هماهنگی بتن‌ریزی سقف سالن ورزشی', { priority: 3, tag: 'کارگاه', start: d(-1), due: d(1), time: '07:00', status: 'todo',
      desc: 'پمپ دکل ۳۶ متری و دو تراک‌میکسر رزرو شود. نمونه‌گیری آزمایشگاه هماهنگ شود.',
      checklist: [['رزرو پمپ بتن', false], ['هماهنگی آزمایشگاه بتن', false], ['کنترل قالب و آرماتور با ناظر', false]] });

    // Waiting for approval
    task('negar', 'به‌روزرسانی برنامه زمان‌بندی (MSP) فاز ۲', { tag: 'برنامه‌ریزی', start: d(-6), due: d(-1), status: 'review', submitted: d(-1), progress: 100,
      chat: [['negar', 'برنامه به‌روز شد. مسیر بحرانی از سقف سالن عبور می‌کند؛ هر روز تأخیر بتن‌ریزی یک روز به کل پروژه اضافه می‌کند.', d(-1)]] });
    task('maryam', 'تطبیق حساب تنخواه کارگاه — مهر و آبان', { tag: 'مالی', start: d(-5), due: d(0), status: 'review', submitted: d(0), progress: 100 });
    task('amir', 'بررسی پیشنهاد فنی سه شرکت برای سیستم تصفیه استخر', { priority: 2, tag: 'تأسیسات', start: d(-8), due: d(-2), status: 'review', submitted: d(-3), progress: 100,
      chat: [['amir', 'جدول مقایسه پیوست شد. پیشنهاد من شرکت دوم است (فیلتر شنی با پمپ دور متغیر).', d(-3)]] });

    // Blocked and returned
    task('hossein', 'خرید و نصب کانکس نگهبانی', { tag: 'خرید', start: d(-7), due: d(3), status: 'blocked', progress: 20, blocked: 'منتظر واریز تنخواه هستم؛ فروشنده بدون پیش‌پرداخت کانکس را نگه نمی‌دارد.', updated: d(-1) });
    task('zahra', 'تنظیم قرارداد پیمانکار کاشی‌کاری استخر', { priority: 2, tag: 'قرارداد', start: d(-6), due: d(2), status: 'returned', returns: 1, returnedOn: d(-1), progress: 80,
      returnNote: 'بند تضمین و جریمه تأخیر روزانه اضافه شود. مبلغ سپرده حسن انجام کار ۱۰٪ باشد.' });

    // In progress, not yet due
    task('reza', 'گزارش پیشرفت فیزیکی ماهانه برای هیئت‌مدیره', { priority: 2, tag: 'گزارش', start: d(-2), due: d(5), status: 'doing', progress: 30 });
    task('reza', 'بازدید مشترک با مشاور سازه از اسکلت سالن', { tag: 'کارگاه', start: d(0), due: d(2), status: 'todo' });
    task('negar', 'استخراج احجام کاشی و سرامیک استخر اصلی', { tag: 'متره', by: 'reza', start: d(-1), due: d(6), status: 'doing', progress: 20 });
    task('amir', 'تست فشار لوله‌کشی آب گرم موتورخانه', { tag: 'تأسیسات', start: d(0), due: d(4), status: 'todo',
      checklist: [['پر کردن خط و هواگیری', false], ['فشار ۱۰ بار به مدت ۲۴ ساعت', false], ['صورت‌جلسه با ناظر', false]] });
    task('hossein', 'استعلام قیمت پمپ‌های تصفیه و گرمایش استخر', { tag: 'خرید', start: d(0), due: d(7), status: 'todo' });
    task('maryam', 'تهیه لیست حقوق و دستمزد آبان', { priority: 2, tag: 'مالی', start: d(-1), due: d(8), status: 'doing', progress: 10 });
    task('zahra', 'تمدید پروانه ساخت فاز ۲ در شهرداری', { priority: 2, tag: 'مجوز', start: d(-3), due: d(14), status: 'doing', progress: 35,
      chat: [['zahra', 'نوبت کمیسیون برای هفته آینده گرفته شد.', d(-1)]] });
    task('ali', 'ثبت آمار روزانه نیروی انسانی و ماشین‌آلات', { tag: 'کارگاه', start: d(0), due: d(0), time: '17:00', status: 'todo' });

    // Recently finished
    task('negar', 'تهیه دستور کار پیمانکار تأسیسات', { tag: 'دفتر فنی', start: d(-9), due: d(-5), status: 'done', submitted: d(-6), doneAt: d(-5) });
    task('ali', 'بازدید ایمنی هفتگی کارگاه', { tag: 'ایمنی', start: d(-7), due: d(-7), status: 'done', submitted: d(-7),
      chat: [['ali', 'دو کارگر بدون کلاه ایمنی تذکر گرفتند؛ نرده موقت لبه گود نصب شد.', d(-7), { lat: 36.2972, lng: 59.6067 }]] });
    task('maryam', 'پرداخت قسط سوم پیمانکار آرماتوربندی', { tag: 'مالی', start: d(-6), due: d(-3), status: 'done', submitted: d(-3) });
    task('hossein', 'خرید سیمان تیپ ۲ (۴۰۰ کیسه)', { tag: 'خرید', start: d(-8), due: d(-6), status: 'done', submitted: d(-4) });

    // History: routine tasks over the last ~95 days, completed with each person's typical punctuality.
    PEOPLE.forEach((p, index) => {
      const pool = ROUTINE[p.dept];
      for (let day = -95; day <= -8; day += 3 + Math.floor(random() * 3)) {
        const start = d(day);
        const due = d(day + 2 + Math.floor(random() * 3));
        const late = random() > p.reliability ? 1 + Math.floor(random() * 5) : -Math.floor(random() * 2);
        const sent = addDaysJalali(due, late);
        const returns = random() > 0.9 ? 1 : 0;
        const { lastId } = db.run(
          `INSERT INTO tasks (title, description, assignee_id, created_by, priority, status, tag, start_date, due_date, progress, submitted_at,
             done_at, approved_by, return_count, created_at, updated_at, is_demo)
           VALUES (?, '', ?, ?, ?, 'done', ?, ?, ?, 100, ?, ?, ?, ?, ?, ?, 1)`,
          [pool[(index + day + 200) % pool.length], ids[p.key], bossId, random() > 0.8 ? 2 : 1, null, start, due, at(sent, 14),
            at(sent, 18), bossId, returns, at(start, 9), at(sent, 18)]
        );
        event(lastId, bossId, 'created', at(start, 9));
        event(lastId, ids[p.key], 'status', at(sent, 14), { meta: { from: 'doing', to: 'review' } });
        event(lastId, bossId, 'status', at(sent, 18), { meta: { from: 'review', to: 'done' } });
      }
    });

    // Daily reports for past working days.
    const REPORT_LINES = {
      0: ['کنترل آرماتوربندی محور C تا F', 'جلسه هماهنگی با پیمانکار سازه', 'بازدید از قالب‌بندی سقف', 'تهیه صورت‌جلسه کارگاهی'],
      1: ['بازدید موتورخانه', 'کنترل لوله‌کشی رایزرها', 'هماهنگی با فروشنده پمپ', 'بررسی نقشه کانال‌کشی'],
      2: ['ثبت فاکتورهای هفته', 'پیگیری چک‌ها از بانک', 'تکمیل پرونده بیمه', 'بایگانی اسناد'],
      3: ['استعلام قیمت از بازار', 'پیگیری حمل بار', 'تحویل مصالح به انبار', 'خرید اقلام مصرفی کارگاه']
    };
    const ISSUES = ['', '', '', '', 'تأخیر در رسیدن بتن', 'کمبود نیروی کارگر ساده', 'قطعی برق کارگاه از ساعت ۱۰ تا ۱۲', 'فروشنده قیمت را افزایش داد'];
    PEOPLE.forEach((p) => {
      for (let day = -30; day <= -1; day += 1) {
        const date = d(day);
        if (!isWorkDay(settings, date) || random() > p.reports) continue;
        const lines = REPORT_LINES[p.dept];
        const done = [lines[Math.floor(random() * lines.length)], lines[Math.floor(random() * lines.length)]].filter((v, i, a) => a.indexOf(v) === i).map((l) => `- ${l}`).join('\n');
        const issue = ISSUES[Math.floor(random() * ISSUES.length)];
        db.run(
          `INSERT INTO daily_reports (user_id, date, done_text, issues_text, plan_text, lat, lng, seen_by, seen_at, created_at, updated_at, is_demo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [ids[p.key], date, done, issue, `- ادامه ${lines[Math.floor(random() * lines.length)]}`, p.dept === 0 ? 36.2972 + random() / 500 : null,
            p.dept === 0 ? 59.6067 + random() / 500 : null, day < -2 ? bossId : null, day < -2 ? at(date, 19) : null, at(date, 16, 40), at(date, 16, 40)]
        );
      }
    });
    // Two people already reported today.
    ['negar', 'maryam'].forEach((key) => db.run(
      `INSERT INTO daily_reports (user_id, date, done_text, issues_text, plan_text, created_at, updated_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [ids[key], today, key === 'negar' ? '- کنترل صورت‌وضعیت ۷\n- به‌روزرسانی برنامه زمان‌بندی' : '- تطبیق تنخواه\n- آماده‌سازی اسناد آبان', '', '- ادامه کارهای امروز', nowIso, nowIso]
    ));

    // Recurring templates.
    const recurring = (who, title, kind, extra) => db.run(
      `INSERT INTO recurrences (title, assignee_id, priority, tag, checklist, kind, weekdays, month_day, due_offset, due_time, start_date, last_generated, created_by, created_at, is_demo)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [title, ids[who], extra.tag, JSON.stringify(extra.checklist || []), kind, JSON.stringify(extra.weekdays || []), extra.monthDay ?? null,
        extra.offset ?? 0, extra.time ?? null, d(-60), today, bossId, nowIso]
    );
    recurring('ali', 'بازدید ایمنی هفتگی کارگاه', 'weekly', { tag: 'ایمنی', weekdays: [0], checklist: ['کلاه و کفش ایمنی', 'نرده‌های لبه گود', 'کپسول‌های آتش‌نشانی', 'سیم‌کشی موقت'] });
    recurring('ali', 'ثبت آمار روزانه نیروی انسانی و ماشین‌آلات', 'daily', { tag: 'کارگاه', time: '17:00' });
    recurring('maryam', 'گزارش هزینه‌های هفته برای مدیرعامل', 'weekly', { tag: 'مالی', weekdays: [3], time: '15:00' });
    recurring('zahra', 'پرداخت لیست بیمه کارگاه', 'monthly', { tag: 'اداری', monthDay: 25, offset: 5 });
  });
}

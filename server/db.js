import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  title TEXT,
  role TEXT NOT NULL,
  department_id INTEGER,
  phone TEXT,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  device TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  assignee_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'todo',
  tag TEXT,
  start_date TEXT,
  due_date TEXT,
  due_time TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  personal INTEGER NOT NULL DEFAULT 0,
  recurrence_id INTEGER,
  submitted_at TEXT,
  done_at TEXT,
  approved_by INTEGER,
  return_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_checklist (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  done_by INTEGER,
  done_at TEXT
);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  body TEXT,
  meta TEXT,
  lat REAL,
  lng REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  stored TEXT NOT NULL,
  duration REAL,
  event_id INTEGER,
  report_id INTEGER,
  uploaded_by INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recurrences (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  assignee_id INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  tag TEXT,
  checklist TEXT,
  kind TEXT NOT NULL,
  weekdays TEXT,
  month_day INTEGER,
  due_offset INTEGER NOT NULL DEFAULT 0,
  due_time TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  last_generated TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  done_text TEXT,
  issues_text TEXT,
  plan_text TEXT,
  lat REAL,
  lng REAL,
  manager_note TEXT,
  seen_by INTEGER,
  seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  key TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  task_id INTEGER,
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  user_id INTEGER,
  at TEXT NOT NULL,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_checklist_task ON task_checklist(task_id);
CREATE INDEX IF NOT EXISTS idx_files_event ON files(event_id);
CREATE INDEX IF NOT EXISTS idx_files_report ON files(report_id);
CREATE INDEX IF NOT EXISTS idx_reports_date ON daily_reports(date);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
`;

export const DEFAULT_SETTINGS = {
  company_name: 'شرکت نمونه',
  // 0 = Saturday … 6 = Friday.
  work_days: [0, 1, 2, 3, 4],
  holidays: [],
  require_approval: true,
  report_hour: '16:30',
  digest_hour: '08:00'
};

const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p));

export class Database {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'tasks.db');
    this.backupDir = path.join(dataDir, 'backups');
    this.uploadDir = path.join(dataDir, 'uploads');
    fs.mkdirSync(this.uploadDir, { recursive: true });
    this.db = new DatabaseSync(this.filePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
    // Columns added after the first release (there is no migration system; each one is guarded).
    const eventColumns = this.db.prepare('PRAGMA table_info(task_events)').all().map((c) => c.name);
    if (!eventColumns.includes('client_id')) this.db.exec('ALTER TABLE task_events ADD COLUMN client_id TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_client ON task_events(task_id, client_id)');
    // 1.0.9: start time, and an alarm (Jalali date + time) that rings for the assignee.
    const taskColumns = this.db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
    if (!taskColumns.includes('start_time')) this.db.exec('ALTER TABLE tasks ADD COLUMN start_time TEXT');
    if (!taskColumns.includes('alarm_date')) this.db.exec('ALTER TABLE tasks ADD COLUMN alarm_date TEXT');
    if (!taskColumns.includes('alarm_time')) this.db.exec('ALTER TABLE tasks ADD COLUMN alarm_time TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_alarm ON tasks(alarm_date)');
    // 1.0.10: a personal task (made for oneself with the "personal" switch) is seen by its owner only.
    if (!taskColumns.includes('is_private')) this.db.exec('ALTER TABLE tasks ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0');
    // 1.0.9: read receipts — how far each person has read a task's conversation (the newest event id they saw).
    this.db.exec(`CREATE TABLE IF NOT EXISTS task_reads (
      task_id INTEGER NOT NULL, user_id INTEGER NOT NULL, last_event_id INTEGER NOT NULL, read_at TEXT NOT NULL,
      PRIMARY KEY (task_id, user_id))`);
    this.statements = new Map();
    this.inTransaction = false;
  }

  prepare(sql) {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  all(sql, params = []) { return this.prepare(sql).all(...clean(params)); }

  get(sql, params = []) { return this.prepare(sql).get(...clean(params)); }

  run(sql, params = []) {
    const result = this.prepare(sql).run(...clean(params));
    return { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) };
  }

  transaction(fn) {
    if (this.inTransaction) return fn();
    this.db.exec('BEGIN');
    this.inTransaction = true;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  getSetting(key) {
    const row = this.get('SELECT value FROM meta WHERE key = ?', [key]);
    return row ? JSON.parse(row.value) : DEFAULT_SETTINGS[key];
  }

  setSetting(key, value) {
    this.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
  }

  settings() {
    return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, this.getSetting(key)]));
  }

  audit(entity, entityId, action, userId, details = null) {
    this.run(
      'INSERT INTO audit (entity, entity_id, action, user_id, at, details) VALUES (?, ?, ?, ?, ?, ?)',
      [entity, entityId, action, userId, new Date().toISOString(), details ? JSON.stringify(details) : null]
    );
  }

  // A secret that signs file links, so <img>/<audio> tags can load attachments without a login header.
  fileSecret() {
    let secret = this.getSetting('file_secret');
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex');
      this.setSetting('file_secret', secret);
    }
    return secret;
  }

  // A consistent copy of the live database (safe while others write).
  snapshot(target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) fs.rmSync(target);
    this.db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
    return target;
  }

  // One copy per calendar day, keeping the newest 30. Attachments live in uploads/ and are not copied.
  dailyBackup() {
    const stamp = new Date().toISOString().slice(0, 10);
    const target = path.join(this.backupDir, `tasks-${stamp}.db`);
    if (!fs.existsSync(target)) this.snapshot(target);
    this.listBackups().slice(30).forEach((file) => fs.rmSync(path.join(this.backupDir, file.name)));
  }

  listBackups() {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir)
      .filter((name) => name.endsWith('.db'))
      .map((name) => ({ name, size: fs.statSync(path.join(this.backupDir, name)).size }))
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  close() { this.db.close(); }
}

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const database = new Database(dataDir);
  if (!database.get('SELECT id FROM users LIMIT 1')) {
    database.run(
      `INSERT INTO users (username, full_name, title, role, password_hash, must_change_password, created_at)
       VALUES ('admin', 'مدیر سامانه', 'مدیر سامانه', 'admin', ?, 1, ?)`,
      [hashPassword('admin'), new Date().toISOString()]
    );
  }
  database.dailyBackup();
  return database;
}

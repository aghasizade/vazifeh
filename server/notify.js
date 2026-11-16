import { publish } from './live.js';

// Phone notification shades show text as-is, so dates and times go out in Persian digits.
const faDigits = (text) => String(text ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

// Stores an in-app notification and pushes it to the user's open clients.
// `key` makes it once-only: a second call with the same key for the same user does nothing.
export function notify(db, userIds, { type, title: rawTitle, body: rawBody = '', link = '', taskId = null, key = null }) {
  const title = faDigits(rawTitle);
  const body = faDigits(rawBody);
  const now = new Date().toISOString();
  const ids = [...new Set(userIds.filter(Boolean))];
  ids.forEach((userId) => {
    const { changes, lastId } = db.run(
      `INSERT OR IGNORE INTO notifications (user_id, key, type, title, body, link, task_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, key, type, title, body, link, taskId, now]
    );
    if (changes) publish([userId], { type: 'notification', notification: { id: lastId, type, title, body, link, taskId, createdAt: now } });
  });
}

// Everyone who manages a user: CEO and admins, plus the supervisor of the user's department.
export function managersOf(db, userId) {
  const user = db.get('SELECT department_id FROM users WHERE id = ?', [userId]);
  return db.all(
    `SELECT id FROM users WHERE active = 1 AND id != ? AND (role IN ('ceo', 'admin')
      OR (role = 'supervisor' AND department_id IS NOT NULL AND department_id = ?))`,
    [userId, user?.department_id ?? -1]
  ).map((row) => row.id);
}

export const bossIds = (db) => db.all("SELECT id FROM users WHERE active = 1 AND role IN ('ceo', 'admin')").map((row) => row.id);

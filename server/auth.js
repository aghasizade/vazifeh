import crypto from 'node:crypto';

// Phones stay signed in for a month after their last use; the expiry is pushed forward at most once a day.
const SESSION_DAYS = 30;

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// Only a hash of the token is stored, so a copied database cannot be used to sign in.
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function createSession(db, userId, device = '') {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  db.run('DELETE FROM sessions WHERE expires_at < ?', [now.toISOString()]);
  db.run(
    'INSERT INTO sessions (token_hash, user_id, device, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    [tokenHash(token), userId, String(device).slice(0, 120), now.toISOString(), expires.toISOString()]
  );
  return token;
}

export const deleteSession = (db, token) => db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);

// After a password change every other device signs in again.
export const deleteOtherSessions = (db, userId, keepToken) => db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', [userId, tokenHash(keepToken)]);

export const publicUser = (user) => user && ({
  id: user.id,
  username: user.username,
  fullName: user.full_name,
  title: user.title || '',
  role: user.role,
  departmentId: user.department_id,
  phone: user.phone || '',
  active: Boolean(user.active),
  mustChangePassword: Boolean(user.must_change_password),
  isDemo: Boolean(user.is_demo),
  createdAt: user.created_at,
  lastLoginAt: user.last_login_at,
  lastSeenAt: user.last_seen_at
});

export function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

export function userForToken(db, token) {
  if (!token) return null;
  const now = new Date();
  const row = db.get(
    `SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    [tokenHash(token), now.toISOString()]
  );
  if (!row) return null;
  if (new Date(row.session_expires) - now < (SESSION_DAYS - 1) * 86400000) {
    db.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?',
      [new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString(), tokenHash(token)]);
  }
  return row;
}

export function authenticate(db) {
  return (req, res, next) => {
    const token = bearerToken(req);
    const user = userForToken(db, token);
    if (user) {
      req.user = user;
      req.sessionToken = token;
      // "Last seen" is written at most once a minute per user.
      if (!user.last_seen_at || Date.now() - new Date(user.last_seen_at) > 60000) {
        db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [new Date().toISOString(), user.id]);
      }
    }
    next();
  };
}

export const requireUser = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'ابتدا وارد سامانه شوید.' });
  if (req.user.must_change_password && !req.path.startsWith('/auth/')) {
    return res.status(403).json({ error: 'ابتدا رمز عبور خود را تغییر دهید.', code: 'MUST_CHANGE_PASSWORD' });
  }
  next();
};

export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ error: 'دسترسی به این بخش برای نقش شما مجاز نیست.' });
  }
  next();
};

// Simple brake on password guessing: 10 failures per 10 minutes per address.
const failures = new Map();
export function loginThrottle(ip) {
  const now = Date.now();
  const entry = failures.get(ip);
  if (entry && now - entry.first > 10 * 60 * 1000) failures.delete(ip);
  return {
    blocked: (failures.get(ip)?.count || 0) >= 10,
    fail() {
      const current = failures.get(ip) || { count: 0, first: now };
      current.count += 1;
      failures.set(ip, current);
    },
    reset() { failures.delete(ip); }
  };
}

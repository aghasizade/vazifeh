import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from './auth.js';

export const MAX_FILE_MB = 25;

// Only plain media and PDFs open in place. Anything that could run script on this site (SVG, HTML, XML…) is
// always downloaded, and even a file response may not run anything.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|bmp|heic|heif)|audio\/[\w.+-]+|video\/(mp4|webm|ogg|3gpp|quicktime)|application\/pdf)$/;

const kindOf = (mime) => (mime.startsWith('image/') && mime !== 'image/svg+xml' ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'doc');

const signature = (db, id) => crypto.createHmac('sha256', db.fileSecret()).update(String(id)).digest('hex').slice(0, 32);

// Links carry a per-file signature instead of a login, so images and voice notes load in plain tags.
export const fileUrl = (db, file) => `/api/files/${file.id}/${signature(db, file.id)}/${encodeURIComponent(file.name)}`;

export const publicFile = (db, file) => ({
  id: file.id,
  name: file.name,
  mime: file.mime,
  kind: file.kind,
  size: file.size,
  duration: file.duration,
  url: fileUrl(db, file)
});

export function saveUpload(db, userId, { buffer, name, mime, duration }) {
  if (!buffer?.length) throw new HttpError(422, 'فایلی دریافت نشد.');
  if (buffer.length > MAX_FILE_MB * 1024 * 1024) throw new HttpError(413, `حجم فایل بیشتر از ${MAX_FILE_MB} مگابایت است.`);
  const safeName = String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';
  const type = String(mime || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const month = new Date().toISOString().slice(0, 7);
  const ext = path.extname(safeName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
  const stored = `${month}/${crypto.randomBytes(12).toString('hex')}${ext}`;
  fs.mkdirSync(path.join(db.uploadDir, month), { recursive: true });
  fs.writeFileSync(path.join(db.uploadDir, stored), buffer);
  const { lastId } = db.run(
    `INSERT INTO files (name, mime, size, kind, stored, duration, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [safeName, type, buffer.length, kindOf(type), stored, Number(duration) || null, userId, new Date().toISOString()]
  );
  return db.get('SELECT * FROM files WHERE id = ?', [lastId]);
}

export function sendFile(db, req, res) {
  const id = Number(req.params.id);
  if (!id || req.params.sig !== signature(db, id)) return res.status(404).json({ error: 'فایل پیدا نشد.' });
  const file = db.get('SELECT * FROM files WHERE id = ?', [id]);
  const full = file && path.join(db.uploadDir, file.stored);
  if (!file || !fs.existsSync(full)) return res.status(404).json({ error: 'فایل پیدا نشد.' });
  const inline = INLINE_TYPES.test(file.mime);
  res.setHeader('Content-Type', inline ? file.mime : 'application/octet-stream');
  // (Not on PDFs: the browser's PDF viewer will not open a sandboxed document.)
  if (file.mime !== 'application/pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="file"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  // Range requests let audio players seek.
  res.sendFile(full, { acceptRanges: true, dotfiles: 'allow' });
}

// Claims uploaded files for an event or a daily report. Only the uploader's own, still-unattached files count.
export function attachFiles(db, userId, fileIds, { eventId = null, reportId = null }) {
  const ids = [...new Set((fileIds || []).map(Number).filter(Boolean))];
  ids.forEach((id) => {
    db.run('UPDATE files SET event_id = ?, report_id = ? WHERE id = ? AND uploaded_by = ? AND event_id IS NULL AND report_id IS NULL',
      [eventId, reportId, id, userId]);
  });
}

export function removeFiles(db, rows) {
  rows.forEach((file) => {
    try { fs.rmSync(path.join(db.uploadDir, file.stored), { force: true }); } catch { /* already gone */ }
    db.run('DELETE FROM files WHERE id = ?', [file.id]);
  });
}

// Uploads nobody attached within a day (a closed form, a failed send) are removed.
export function cleanOrphans(db) {
  const cutoff = new Date(Date.now() - 86400000).toISOString();
  removeFiles(db, db.all('SELECT * FROM files WHERE event_id IS NULL AND report_id IS NULL AND created_at < ?', [cutoff]));
}

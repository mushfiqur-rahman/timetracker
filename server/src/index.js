import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { q, initDb } from './db.js';

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || '';

// While the configuration is wrong the server stays up and explains the problem on every page,
// instead of crashing (which hosting panels only show as "503").
let setupError = 'The server is starting. Reload in a few seconds.';

function describeStartupProblem(e) {
  const missing = ['DB_NAME', 'DB_USER', 'DB_PASSWORD'].filter(n => !process.env[n]);
  if (!process.env.DATABASE_URL && missing.length)
    return `These environment variables are not set: ${missing.join(', ')}.`;
  switch (e && e.code) {
    case 'ER_ACCESS_DENIED_ERROR': return 'The database refused the user name or password. Check DB_USER and DB_PASSWORD.';
    case 'ER_DBACCESS_DENIED_ERROR':
    case 'ER_BAD_DB_ERROR': return 'The database was not found or this user may not use it. Check DB_NAME, and that the user is assigned to that database.';
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH': return `Cannot reach the database server (${e.code}). Check DB_HOST: try 127.0.0.1, localhost, or the host shown next to the database in your hosting panel.`;
    default: return `The database could not be prepared (${(e && e.code) || 'unknown error'}).`;
  }
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (!setupError) return next();
  const text = `Time Tracker is not configured yet.\n\n${setupError}\n\nFix the environment variables in your hosting panel, then restart the app.`;
  if (req.path.startsWith('/api/')) return res.status(503).json({ error: text });
  res.status(503).type('text/plain').send(text);
});
app.use(express.json({ limit: '1mb' }));

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isDuplicate = e => e && e.code === 'ER_DUP_ENTRY';

function normMac(v) {
  const hex = String(v || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g).join(':');
}

/** from/to query parameters as whole minutes since 1970. */
function parseRange(req, maxDays = 100) {
  const from = new Date(req.query.from), to = new Date(req.query.to);
  if (isNaN(from) || isNaN(to) || to <= from) throw new HttpError(400, 'Invalid from/to range');
  if (to - from > maxDays * 86400e3) throw new HttpError(400, `Range too large (max ${maxDays} days)`);
  return [Math.ceil(from.getTime() / 60e3), Math.ceil(to.getTime() / 60e3)];
}

const publicUser = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: !!u.active });

function publicDevice(d) {
  let macs = [];
  try { macs = JSON.parse(d.last_macs || '[]'); } catch { /* ignore */ }
  return { ...d, last_macs: Array.isArray(macs) ? macs : [] };
}

const userById = async id => (await q('SELECT * FROM users WHERE id = ?', [id]))[0];
const deviceById = async id => (await q('SELECT * FROM devices WHERE id = ?', [id]))[0];

// Small in-memory limiter for login attempts: 10 failures per 15 min per ip+email.
const fails = new Map();
function checkLoginLimit(key) {
  const now = Date.now(), e = fails.get(key);
  if (e && now - e.first < 15 * 60e3 && e.count >= 10) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
}
function noteLoginFail(key) {
  const now = Date.now(), e = fails.get(key);
  if (!e || now - e.first > 15 * 60e3) fails.set(key, { first: now, count: 1 }); else e.count++;
}
setInterval(() => { const now = Date.now(); for (const [k, e] of fails) if (now - e.first > 15 * 60e3) fails.delete(k); }, 60e3).unref();

async function verifyCredentials(req) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const key = `${req.ip}|${email}`;
  checkLoginLimit(key);
  const user = (await q('SELECT * FROM users WHERE email = ?', [email]))[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    noteLoginFail(key);
    throw new HttpError(401, 'Wrong email or password');
  }
  if (!user.active) throw new HttpError(403, 'This account is disabled. Contact your admin.', 'USER_DISABLED');
  fails.delete(key);
  return user;
}

// kind: 'web' (browser) or 'desktop' (bound to one approved device)
function auth(kind) {
  return wrap(async (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new HttpError(401, 'Not signed in');
    let p;
    try { p = jwt.verify(token, JWT_SECRET); } catch { throw new HttpError(401, 'Session expired, please sign in again'); }
    if (p.kind !== kind) throw new HttpError(401, 'Invalid token');
    const user = await userById(p.uid);
    if (!user || !user.active) throw new HttpError(401, 'Account not available');
    req.user = user;
    if (kind === 'desktop') {
      const device = (await q('SELECT * FROM devices WHERE id = ? AND user_id = ?', [p.did, user.id]))[0];
      if (!device || device.status !== 'approved')
        throw new HttpError(403, 'This device is no longer approved', 'DEVICE_NOT_APPROVED');
      req.device = device;
    }
    next();
  });
}
const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : next(new HttpError(403, 'Admins only'));

// ---------- web auth ----------

app.post('/api/auth/login', wrap(async (req, res) => {
  const user = await verifyCredentials(req);
  const token = jwt.sign({ uid: user.id, kind: 'web' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: publicUser(user) });
}));

const web = express.Router();
web.use(auth('web'));

web.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

web.post('/me/password', wrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (!(await bcrypt.compare(String(current || ''), req.user.password_hash))) throw new HttpError(400, 'Current password is wrong');
  if (String(next || '').length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
  await q('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(String(next), 10), req.user.id]);
  res.json({ ok: true });
}));

// Minute rows for a range. Users get their own; admins may pass userId.
// Row format is compact: [epochMinute, seconds, mouse, keys]
web.get('/activity', wrap(async (req, res) => {
  const [from, to] = parseRange(req, 32);
  let uid = req.user.id;
  if (req.query.userId && Number(req.query.userId) !== uid) {
    if (req.user.role !== 'admin') throw new HttpError(403, 'Admins only');
    uid = Number(req.query.userId);
  }
  const rows = await q(
    'SELECT t, seconds, mouse, key_presses FROM activity_minutes WHERE user_id = ? AND t >= ? AND t < ? ORDER BY t',
    [uid, from, to]
  );
  res.json({ minutes: rows.map(r => [r.t, r.seconds, r.mouse, r.key_presses]) });
}));

web.get('/devices', wrap(async (req, res) => {
  const devices = await q(
    'SELECT id, mac, hostname, os, label, status, created_at, last_seen_at FROM devices WHERE user_id = ? ORDER BY created_at',
    [req.user.id]
  );
  res.json({ devices });
}));

// ---------- admin ----------

const admin = express.Router();
admin.use(adminOnly);

admin.get('/users', wrap(async (req, res) => {
  const rows = await q(`
    SELECT u.id, u.email, u.name, u.role, u.active, u.created_at,
           COALESCE(SUM(d.status = 'approved'), 0) AS approved_devices,
           COALESCE(SUM(d.status = 'pending'), 0)  AS pending_devices,
           MAX(d.last_seen_at) AS last_seen_at
      FROM users u LEFT JOIN devices d ON d.user_id = u.id
     GROUP BY u.id ORDER BY u.name`);
  res.json({
    users: rows.map(u => ({ ...u, active: !!u.active, approved_devices: Number(u.approved_devices), pending_devices: Number(u.pending_devices) })),
  });
}));

admin.post('/users', wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address');
  if (!name) throw new HttpError(400, 'Name is required');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  try {
    const r = await q('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)',
      [email, name, await bcrypt.hash(password, 10), role]);
    res.status(201).json({ user: publicUser(await userById(r.insertId)) });
  } catch (e) {
    if (isDuplicate(e)) throw new HttpError(409, 'A user with this email already exists');
    throw e;
  }
}));

admin.patch('/users/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const sets = [], vals = [];
  const set = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
  if (b.email !== undefined) {
    const email = String(b.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address');
    set('email', email);
  }
  if (b.name !== undefined) {
    if (!String(b.name).trim()) throw new HttpError(400, 'Name is required');
    set('name', String(b.name).trim());
  }
  if (b.password) {
    if (String(b.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    set('password_hash', await bcrypt.hash(String(b.password), 10));
  }
  if (b.role !== undefined || b.active !== undefined) {
    if (id === req.user.id) throw new HttpError(400, 'You cannot change your own role or disable yourself');
    if (b.role !== undefined) set('role', b.role === 'admin' ? 'admin' : 'user');
    if (b.active !== undefined) set('active', b.active ? 1 : 0);
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  if (!(await userById(id))) throw new HttpError(404, 'User not found');
  try {
    await q(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  } catch (e) {
    if (isDuplicate(e)) throw new HttpError(409, 'A user with this email already exists');
    throw e;
  }
  res.json({ user: publicUser(await userById(id)) });
}));

admin.delete('/users/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'You cannot delete yourself');
  const r = await q('DELETE FROM users WHERE id = ?', [id]);
  if (!r.affectedRows) throw new HttpError(404, 'User not found');
  res.json({ ok: true });
}));

admin.get('/devices', wrap(async (req, res) => {
  const rows = await q(`
    SELECT d.id, d.user_id, u.name AS user_name, u.email AS user_email, d.mac, d.machine_id, d.last_macs,
           d.hostname, d.os, d.label, d.status, d.created_at, d.decided_at, d.last_seen_at
      FROM devices d JOIN users u ON u.id = d.user_id
     ORDER BY (d.status = 'pending') DESC, d.created_at DESC, d.id DESC`);
  res.json({ devices: rows.map(publicDevice) });
}));

// Admin assigns a device to a user by MAC address ahead of time (already approved).
admin.post('/users/:id/devices', wrap(async (req, res) => {
  const userId = Number(req.params.id);
  const mac = normMac(req.body?.mac);
  if (!mac) throw new HttpError(400, 'Enter a valid MAC address, e.g. 3C:52:82:1A:9F:10');
  if (!(await userById(userId))) throw new HttpError(404, 'User not found');
  const existing = await q('SELECT mac, last_macs FROM devices WHERE user_id = ?', [userId]);
  if (existing.some(d => d.mac === mac || publicDevice(d).last_macs.includes(mac)))
    throw new HttpError(409, 'This MAC address is already listed for this user');
  const r = await q(
    `INSERT INTO devices (user_id, mac, label, status, decided_at) VALUES (?,?,?,'approved', NOW())`,
    [userId, mac, String(req.body?.label || '').trim() || null]
  );
  res.status(201).json({ device: publicDevice(await deviceById(r.insertId)) });
}));

admin.patch('/devices/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const sets = [], vals = [];
  if (b.status !== undefined) {
    if (!['approved', 'revoked', 'pending'].includes(b.status)) throw new HttpError(400, 'Invalid status');
    sets.push('status = ?', 'decided_at = NOW()'); vals.push(b.status);
  }
  if (b.label !== undefined) { sets.push('label = ?'); vals.push(String(b.label).trim() || null); }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  if (!(await deviceById(id))) throw new HttpError(404, 'Device not found');
  await q(`UPDATE devices SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  res.json({ device: publicDevice(await deviceById(id)) });
}));

admin.delete('/devices/:id', wrap(async (req, res) => {
  const r = await q('DELETE FROM devices WHERE id = ?', [Number(req.params.id)]);
  if (!r.affectedRows) throw new HttpError(404, 'Device not found');
  res.json({ ok: true });
}));

// Worked / idle seconds per user for a range (team report).
admin.get('/summary', wrap(async (req, res) => {
  const [from, to] = parseRange(req);
  const rows = await q(`
    SELECT u.id, u.name, u.email, u.active,
           COALESCE(SUM(a.seconds), 0) AS total,
           COALESCE(SUM(CASE WHEN a.mouse + a.key_presses = 0 THEN a.seconds ELSE 0 END), 0) AS idle,
           MAX(a.t) AS last_t
      FROM users u LEFT JOIN activity_minutes a ON a.user_id = u.id AND a.t >= ? AND a.t < ?
     GROUP BY u.id ORDER BY u.name`, [from, to]);
  res.json({
    users: rows.map(u => ({
      id: u.id, name: u.name, email: u.email, active: !!u.active,
      total: Number(u.total), idle: Number(u.idle),
      last_activity: u.last_t == null ? null : new Date(u.last_t * 60e3).toISOString(),
    })),
  });
}));

web.use('/admin', admin);
app.use('/api/desktop', desktopRouter());
app.use('/api', web);

// ---------- desktop app ----------

function desktopRouter() {
  const r = express.Router();

  // Login is tied to a device. Unknown devices are registered as "pending" and refused until an admin approves.
  r.post('/login', wrap(async (req, res) => {
    const user = await verifyCredentials(req);
    const b = req.body || {};
    const macs = [...new Set((Array.isArray(b.macs) ? b.macs : []).map(normMac).filter(Boolean))].slice(0, 16);
    const machineId = String(b.machineId || '').trim().slice(0, 100);
    const hostname = String(b.hostname || '').trim().slice(0, 190) || null;
    const os = String(b.os || '').trim().slice(0, 100) || null;
    if (!macs.length || !machineId) throw new HttpError(400, 'Could not read this device\'s MAC address', 'NO_DEVICE_ID');

    // 1) same machine as before  2) a MAC the admin pre-assigned that no machine has claimed yet
    let device = (await q('SELECT * FROM devices WHERE user_id = ? AND machine_id = ?', [user.id, machineId]))[0];
    if (!device) {
      device = (await q(
        'SELECT * FROM devices WHERE user_id = ? AND machine_id IS NULL AND mac IN (?) ORDER BY id LIMIT 1',
        [user.id, macs]
      ))[0];
    }
    let deviceId;
    if (device) {
      deviceId = device.id;
      await q('UPDATE devices SET machine_id = ?, last_macs = ?, hostname = ?, os = ?, last_seen_at = NOW() WHERE id = ?',
        [machineId, JSON.stringify(macs), hostname, os, deviceId]);
    } else {
      const ins = await q(
        `INSERT INTO devices (user_id, mac, machine_id, last_macs, hostname, os, status, last_seen_at)
         VALUES (?,?,?,?,?,?,'pending', NOW())`,
        [user.id, macs[0], machineId, JSON.stringify(macs), hostname, os]
      );
      deviceId = ins.insertId;
    }
    device = await deviceById(deviceId);

    if (device.status === 'pending')
      throw new HttpError(403, 'This device is waiting for admin approval. Ask your admin to approve it, then sign in again.', 'DEVICE_PENDING');
    if (device.status === 'revoked')
      throw new HttpError(403, 'This device has been blocked by your admin.', 'DEVICE_REVOKED');

    const token = jwt.sign({ uid: user.id, did: device.id, kind: 'desktop' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: publicUser(user), device: { id: device.id, mac: device.mac } });
  }));

  r.use(auth('desktop'));

  // Upload tracked minutes. Safe to retry: a minute is only ever raised, never double counted.
  r.post('/activity', wrap(async (req, res) => {
    const list = Array.isArray(req.body?.minutes) ? req.body.minutes : null;
    if (!list || list.length > 5000) throw new HttpError(400, 'Invalid payload');
    const nowMin = Math.floor(Date.now() / 60e3);
    const byMinute = new Map();
    for (const m of list) {
      const t = Number(m.t), s = Math.floor(Number(m.s));
      if (!Number.isInteger(t) || !(s >= 1)) continue;
      if (t > nowMin + 5 || t < nowMin - 30 * 1440) continue; // ignore future / very old data
      const mouse = Math.max(0, Math.min(100000, Math.floor(Number(m.m)) || 0));
      const keys = Math.max(0, Math.min(100000, Math.floor(Number(m.k)) || 0));
      const prev = byMinute.get(t);
      byMinute.set(t, prev
        ? [req.user.id, t, req.device.id, Math.max(prev[3], Math.min(60, s)), Math.max(prev[4], mouse), Math.max(prev[5], keys)]
        : [req.user.id, t, req.device.id, Math.min(60, s), mouse, keys]);
    }
    const rows = [...byMinute.values()];
    for (let i = 0; i < rows.length; i += 500) {
      await q(
        `INSERT INTO activity_minutes (user_id, t, device_id, seconds, mouse, key_presses) VALUES ?
         ON DUPLICATE KEY UPDATE
           seconds     = GREATEST(seconds, VALUES(seconds)),
           mouse       = GREATEST(mouse, VALUES(mouse)),
           key_presses = GREATEST(key_presses, VALUES(key_presses)),
           device_id   = VALUES(device_id)`,
        [rows.slice(i, i + 500)]
      );
    }
    await q('UPDATE devices SET last_seen_at = NOW() WHERE id = ?', [req.device.id]);
    res.json({ ok: true, saved: rows.length });
  }));

  // Totals shown in the app. The app passes its own local day / week start.
  r.get('/summary', wrap(async (req, res) => {
    const day = new Date(req.query.dayStart), week = new Date(req.query.weekStart);
    if (isNaN(day) || isNaN(week)) throw new HttpError(400, 'Invalid dates');
    const dayMin = Math.ceil(day.getTime() / 60e3), weekMin = Math.ceil(week.getTime() / 60e3);
    const row = (await q(
      `SELECT COALESCE(SUM(CASE WHEN t >= ? THEN seconds ELSE 0 END), 0) AS today,
              COALESCE(SUM(CASE WHEN t >= ? AND mouse + key_presses = 0 THEN seconds ELSE 0 END), 0) AS today_idle,
              COALESCE(SUM(seconds), 0) AS week
         FROM activity_minutes WHERE user_id = ? AND t >= ?`,
      [dayMin, dayMin, req.user.id, Math.min(dayMin, weekMin)]
    ))[0];
    res.json({ today: Number(row.today), todayIdle: Number(row.today_idle), week: Number(row.week), user: publicUser(req.user) });
  }));

  return r;
}

// ---------- static website + errors ----------

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// The built website: server/public (committed, used by Hostinger and Docker) or a fresh web/dist build.
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = [process.env.PUBLIC_DIR, path.join(here, '../public'), path.join(here, '../../web/dist')]
  .find(dir => dir && fs.existsSync(path.join(dir, 'index.html')));
if (publicDir) {
  app.use(express.static(publicDir, { maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
}

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => console.log(`Time tracker server listening on :${PORT}`));

async function boot() {
  if (JWT_SECRET.length < 16) {
    setupError = 'JWT_SECRET is missing or too short. Set it to a random string of at least 32 characters.';
    console.error(setupError);
    return;
  }
  try {
    await initDb();
    setupError = null;
    console.log('Database ready');
  } catch (e) {
    setupError = describeStartupProblem(e);
    console.error('Startup problem:', setupError, '-', e.message || e);
    setTimeout(boot, 5000).unref();   // also covers a database that is still starting (Docker)
  }
}
boot();

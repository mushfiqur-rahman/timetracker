import pg from 'pg';
import bcrypt from 'bcryptjs';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://timetracker:timetracker@localhost:5432/timetracker',
  max: 10,
});

export const q = (text, params) => pool.query(text, params);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mac          TEXT NOT NULL,              -- MAC the device was registered / approved with
  machine_id   TEXT,                       -- Windows MachineGuid; NULL until first login when admin pre-adds by MAC
  last_macs    TEXT[] NOT NULL DEFAULT '{}',
  hostname     TEXT,
  os           TEXT,
  label        TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','revoked')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at   TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS devices_user_machine_idx ON devices(user_id, machine_id) WHERE machine_id IS NOT NULL;

-- One row per tracked minute. seconds = how much of that minute the timer was running.
-- A minute with mouse + keys = 0 is idle time.
CREATE TABLE IF NOT EXISTS activity_minutes (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  t         TIMESTAMPTZ NOT NULL,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  seconds   SMALLINT NOT NULL,
  mouse     INTEGER NOT NULL DEFAULT 0,
  keys      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, t)
);
`;

export async function initDb() {
  // Wait for Postgres to accept connections (docker compose start order).
  for (let i = 0; ; i++) {
    try { await q('SELECT 1'); break; }
    catch (e) {
      if (i >= 30) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  await q(SCHEMA);

  const { rows } = await q(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`);
  if (rows.length === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'admin12345';
    await q(
      `INSERT INTO users (email, name, password_hash, role) VALUES ($1, 'Administrator', $2, 'admin')
       ON CONFLICT (email) DO UPDATE SET role = 'admin', active = TRUE`,
      [email, await bcrypt.hash(password, 10)]
    );
    console.log(`Created first admin account: ${email}`);
  }
}

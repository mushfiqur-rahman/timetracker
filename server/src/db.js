import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

// Works with MySQL 8 and MariaDB 10.4+ (Hostinger's databases are MariaDB/MySQL).
// Either set DATABASE_URL=mysql://user:password@host:3306/database
// or DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME.
function config() {
  const base = { waitForConnections: true, connectionLimit: 5, timezone: 'Z', dateStrings: false, charset: 'utf8mb4' };
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    return {
      ...base, host: u.hostname, port: Number(u.port || 3306),
      user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    };
  }
  return {
    ...base, host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'timetracker', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'timetracker',
  };
}

function finalConfig() {
  const c = config();
  // "localhost" can resolve to IPv6 first in Node.js while MySQL listens on IPv4 only
  if (c.host === 'localhost') c.host = '127.0.0.1';
  return c;
}

export const pool = mysql.createPool(finalConfig());
// keep every DATETIME in UTC, whatever the hosting server's time zone is
pool.on('connection', conn => conn.query("SET time_zone = '+00:00'"));

/** Runs a query. SELECT returns an array of rows; INSERT/UPDATE/DELETE returns { insertId, affectedRows }. */
export async function q(sql, params = []) {
  const [result] = await pool.query(sql, params);
  return result;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id            INT AUTO_INCREMENT PRIMARY KEY,
     email         VARCHAR(191) NOT NULL UNIQUE,
     name          VARCHAR(191) NOT NULL,
     password_hash VARCHAR(100) NOT NULL,
     role          VARCHAR(10)  NOT NULL DEFAULT 'user',
     active        TINYINT(1)   NOT NULL DEFAULT 1,
     created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // mac        = MAC the device was registered / approved with
  // machine_id = hardware id of the computer; NULL until first login when an admin pre-adds a device by MAC
  // last_macs  = JSON list of the MACs the device reported at its last sign-in
  `CREATE TABLE IF NOT EXISTS devices (
     id           INT AUTO_INCREMENT PRIMARY KEY,
     user_id      INT NOT NULL,
     mac          VARCHAR(17)  NOT NULL,
     machine_id   VARCHAR(100) NULL,
     last_macs    TEXT NULL,
     hostname     VARCHAR(191) NULL,
     os           VARCHAR(100) NULL,
     label        VARCHAR(191) NULL,
     status       VARCHAR(10)  NOT NULL DEFAULT 'pending',
     created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     decided_at   DATETIME NULL,
     last_seen_at DATETIME NULL,
     UNIQUE KEY devices_user_machine (user_id, machine_id),
     CONSTRAINT devices_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // One row per tracked minute. t = minutes since 1970 (UTC), seconds = how much of that minute the timer ran.
  // A minute with mouse + key_presses = 0 is idle time.
  `CREATE TABLE IF NOT EXISTS activity_minutes (
     user_id     INT NOT NULL,
     t           INT NOT NULL,
     device_id   INT NULL,
     seconds     SMALLINT NOT NULL,
     mouse       INT NOT NULL DEFAULT 0,
     key_presses INT NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, t),
     CONSTRAINT activity_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
     CONSTRAINT activity_device_fk FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

export async function initDb() {
  await q('SELECT 1');
  for (const sql of SCHEMA) await q(sql);

  const admins = await q(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`);
  if (admins.length === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'admin12345';
    await q(
      `INSERT INTO users (email, name, password_hash, role) VALUES (?, 'Administrator', ?, 'admin')
       ON DUPLICATE KEY UPDATE role = 'admin', active = 1`,
      [email, await bcrypt.hash(password, 10)]
    );
    console.log(`Created first admin account: ${email}`);
  }
}

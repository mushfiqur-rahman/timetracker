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
     password_hash VARCHAR(100) NULL,
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
  await migrate();

  const adminRole = (await q(`SELECT id FROM roles WHERE access = 'admin' ORDER BY id LIMIT 1`))[0];
  const admins = await q(`SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE r.access = 'admin' LIMIT 1`);
  if (admins.length === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'admin12345';
    await q(
      `INSERT INTO users (email, name, password_hash, role_id) VALUES (?, 'Administrator', ?, ?)
       ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), active = 1`,
      [email, await bcrypt.hash(password, 10), adminRole.id]
    );
    console.log(`Created first admin account: ${email}`);
  }
}

async function hasColumn(table, column) {
  const rows = await q(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, column]);
  return rows.length > 0;
}

// Brings an existing database up to date. Every step is safe to run again.
async function migrate() {
  await q(`CREATE TABLE IF NOT EXISTS departments (
     id         INT AUTO_INCREMENT PRIMARY KEY,
     name       VARCHAR(100) NOT NULL UNIQUE,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // access = what people with this role may do: admin (everything), manager (see their department's time), user (own time)
  await q(`CREATE TABLE IF NOT EXISTS roles (
     id        INT AUTO_INCREMENT PRIMARY KEY,
     name      VARCHAR(100) NOT NULL UNIQUE,
     access    VARCHAR(10)  NOT NULL DEFAULT 'user',
     is_system TINYINT(1)   NOT NULL DEFAULT 0
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  if ((await q('SELECT 1 FROM roles LIMIT 1')).length === 0) {
    await q(`INSERT INTO roles (name, access, is_system) VALUES ('Admin', 'admin', 1), ('Manager', 'manager', 1), ('User', 'user', 1)`);
  }

  if (!(await hasColumn('users', 'role_id'))) {
    await q(`ALTER TABLE users
               MODIFY password_hash VARCHAR(100) NULL,
               ADD COLUMN role_id INT NULL,
               ADD COLUMN department_id INT NULL,
               ADD COLUMN setup_token_hash VARCHAR(64) NULL,
               ADD COLUMN setup_expires DATETIME NULL,
               ADD CONSTRAINT users_role_fk FOREIGN KEY (role_id) REFERENCES roles(id),
               ADD CONSTRAINT users_department_fk FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL`);
    // "role" was the old admin/user column
    await q(`UPDATE users u JOIN roles r ON r.is_system = 1 AND r.access = u.role SET u.role_id = r.id`);
  }
  await q(`UPDATE users SET role_id = (SELECT id FROM roles WHERE access = 'user' AND is_system = 1 LIMIT 1) WHERE role_id IS NULL`);

  // approved = 0: the person signed up themselves and an admin has not accepted the account yet
  if (!(await hasColumn('users', 'approved'))) {
    await q('ALTER TABLE users ADD COLUMN approved TINYINT(1) NOT NULL DEFAULT 1');
  }
}

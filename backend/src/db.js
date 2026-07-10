const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const raw = new DatabaseSync(path.join(dataDir, 'app.db'));
raw.exec('PRAGMA journal_mode = WAL');
raw.exec('PRAGMA foreign_keys = ON');

// Thin shim so the rest of the code reads like better-sqlite3 usage.
const db = {
  raw,
  exec: sql => raw.exec(sql),
  prepare: sql => raw.prepare(sql),
  transaction: (fn) => (...args) => {
    raw.exec('BEGIN');
    try {
      const r = fn(...args);
      raw.exec('COMMIT');
      return r;
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  },
};

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    employeeNo TEXT,
    department TEXT,
    position TEXT,
    hourlyRate REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    updatedAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    manager TEXT,
    startDate TEXT,
    endDate TEXT,
    status TEXT DEFAULT 'active',
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    updatedAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS project_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employeeId INTEGER NOT NULL,
    projectId INTEGER NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    role TEXT,
    effectiveFrom TEXT NOT NULL,
    effectiveTo TEXT,
    note TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_pm_emp   ON project_memberships(employeeId);
  CREATE INDEX IF NOT EXISTS idx_pm_proj  ON project_memberships(projectId);
  CREATE INDEX IF NOT EXISTS idx_pm_range ON project_memberships(effectiveFrom, effectiveTo);

  CREATE TABLE IF NOT EXISTS attendance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employeeId INTEGER NOT NULL,
    employeeName TEXT NOT NULL,
    date TEXT NOT NULL,
    clockIn TEXT,
    clockOut TEXT,
    workHours REAL DEFAULT 0,
    status TEXT DEFAULT 'normal',
    isLate INTEGER DEFAULT 0,
    isEarlyLeave INTEGER DEFAULT 0,
    overrideType TEXT,
    overrideNote TEXT,
    source TEXT DEFAULT 'import',
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    updatedAt TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE (employeeId, date)
  );
  CREATE INDEX IF NOT EXISTS idx_att_date ON attendance_logs(date);
  CREATE INDEX IF NOT EXISTS idx_att_emp  ON attendance_logs(employeeId);

  CREATE TABLE IF NOT EXISTS adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendanceLogId INTEGER,
    employeeId INTEGER,
    date TEXT,
    type TEXT,
    reason TEXT,
    operator TEXT DEFAULT 'admin',
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );
`);

module.exports = db;

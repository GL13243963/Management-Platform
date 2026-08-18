const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const configuredDbPath = process.env.APP_DB_PATH ? path.resolve(process.env.APP_DB_PATH) : null;
const dataDir = configuredDbPath ? path.dirname(configuredDbPath) : path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const raw = new DatabaseSync(configuredDbPath || path.join(dataDir, 'app.db'));
raw.exec('PRAGMA journal_mode = WAL');
raw.exec('PRAGMA foreign_keys = ON');
let savepointId = 0;

// Thin shim so the rest of the code reads like better-sqlite3 usage.
const db = {
  raw,
  exec: sql => raw.exec(sql),
  prepare: sql => raw.prepare(sql),
  transaction: (fn) => (...args) => {
    const nested = raw.isTransaction;
    const savepoint = nested ? `app_transaction_${++savepointId}` : null;
    raw.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN');
    try {
      const r = fn(...args);
      raw.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
      return r;
    } catch (e) {
      // Some SQLite failures can end the transaction themselves. Never mask
      // the original application error with "no transaction is active".
      try {
        if (nested && raw.isTransaction) {
          raw.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
        } else if (!nested && raw.isTransaction) {
          raw.exec('ROLLBACK');
        }
      } catch (rollbackError) {
        e.rollbackError = rollbackError;
      }
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
    completionPercent REAL DEFAULT 0,
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
    isMissedPunch INTEGER DEFAULT 0,
    rawClockIn TEXT,
    rawClockOut TEXT,
    sourceRow INTEGER,
    sourceColumn INTEGER,
    overrideType TEXT,
    overrideNote TEXT,
    source TEXT DEFAULT 'import',
    sourceOvertime INTEGER DEFAULT 0,
    sourceBusinessTrip INTEGER DEFAULT 0,
    sourceOutside INTEGER DEFAULT 0,
    sourceOvertimeHours REAL DEFAULT 0,
    sourceBusinessTripHours REAL DEFAULT 0,
    sourceOutsideHours REAL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS comp_leave_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employeeId INTEGER NOT NULL,
    date TEXT NOT NULL,
    note TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(employeeId, date)
  );
  CREATE INDEX IF NOT EXISTS idx_comp_leave_employee ON comp_leave_records(employeeId);
  CREATE INDEX IF NOT EXISTS idx_comp_leave_date ON comp_leave_records(date);
`);

// Lightweight migrations for databases created by earlier versions.
const employeeColumns = raw.prepare('PRAGMA table_info(employees)').all();
if (!employeeColumns.some(column => column.name === 'team')) {
  raw.exec('ALTER TABLE employees ADD COLUMN team TEXT');
}
// Earlier UI versions stored the team directly in `department`.
raw.prepare(`
  UPDATE employees SET team=department
  WHERE team IS NULL AND department IN ('规划组', '方案组', '建筑组')
`).run();
raw.prepare(`UPDATE employees SET team='方案组' WHERE team='建筑组'`).run();
raw.prepare(`UPDATE employees SET department='方案组' WHERE department='建筑组'`).run();

// Move legacy comp-leave markers out of attendance so they are independent
// from imports and excluded from work-hour and attendance statistics.
raw.prepare(`
  INSERT OR IGNORE INTO comp_leave_records (employeeId, date, note, createdAt)
  SELECT employeeId, date, overrideNote, createdAt FROM attendance_logs
  WHERE overrideType='comp_leave'
`).run();
raw.prepare(`
  DELETE FROM attendance_logs
  WHERE overrideType='comp_leave' AND rawClockIn IS NULL AND rawClockOut IS NULL
`).run();
raw.prepare(`
  UPDATE attendance_logs SET overrideType=NULL, overrideNote=NULL,
    clockIn=rawClockIn, clockOut=rawClockOut,
    workHours=CASE
      WHEN rawClockIn IS NOT NULL AND rawClockOut IS NOT NULL THEN
        MAX(0, (CAST(substr(rawClockOut,1,2) AS INTEGER)*60 + CAST(substr(rawClockOut,4,2) AS INTEGER)
          - CAST(substr(rawClockIn,1,2) AS INTEGER)*60 - CAST(substr(rawClockIn,4,2) AS INTEGER)) / 60.0)
      ELSE 0 END
  WHERE overrideType='comp_leave'
`).run();

const projectColumns = raw.prepare('PRAGMA table_info(projects)').all();
if (!projectColumns.some(column => column.name === 'completionPercent')) {
  raw.exec('ALTER TABLE projects ADD COLUMN completionPercent REAL DEFAULT 0');
}

const attendanceColumns = raw.prepare('PRAGMA table_info(attendance_logs)').all();
for (const [name, definition] of [
  ['isMissedPunch', 'INTEGER DEFAULT 0'],
  ['rawClockIn', 'TEXT'],
  ['rawClockOut', 'TEXT'],
  ['sourceRow', 'INTEGER'],
  ['sourceColumn', 'INTEGER'],
  ['sourceOvertime', 'INTEGER DEFAULT 0'],
  ['sourceBusinessTrip', 'INTEGER DEFAULT 0'],
  ['sourceOutside', 'INTEGER DEFAULT 0'],
  ['sourceOvertimeHours', 'REAL DEFAULT 0'],
  ['sourceBusinessTripHours', 'REAL DEFAULT 0'],
  ['sourceOutsideHours', 'REAL DEFAULT 0'],
]) {
  if (!attendanceColumns.some(column => column.name === name)) {
    raw.exec(`ALTER TABLE attendance_logs ADD COLUMN ${name} ${definition}`);
  }
}
raw.prepare(`
  UPDATE attendance_logs SET isMissedPunch=1
  WHERE status IN ('missed_punch', 'absent') AND isMissedPunch=0
`).run();
// Historical imports used zero hours for every missed-punch day. A record
// with exactly one valid punch retains the unaffected half-day (4 hours).
raw.prepare(`
  UPDATE attendance_logs SET workHours=4
  WHERE isMissedPunch=1 AND overrideType IS NULL
    AND ((clockIn IS NOT NULL AND clockOut IS NULL)
      OR (clockIn IS NULL AND clockOut IS NOT NULL))
`).run();
raw.exec(`
  UPDATE attendance_logs SET sourceOvertime=1,
    sourceOvertimeHours=CASE WHEN sourceOvertimeHours=0 THEN MAX(0, workHours-8) ELSE sourceOvertimeHours END
  WHERE (coalesce(rawClockIn,'') || coalesce(rawClockOut,'')) LIKE '%加班%';
  UPDATE attendance_logs SET sourceBusinessTrip=1,
    sourceBusinessTripHours=CASE WHEN sourceBusinessTripHours=0 THEN workHours ELSE sourceBusinessTripHours END
  WHERE (coalesce(rawClockIn,'') || coalesce(rawClockOut,'')) LIKE '%出差%';
  UPDATE attendance_logs SET sourceOutside=1,
    sourceOutsideHours=CASE WHEN sourceOutsideHours=0 THEN workHours ELSE sourceOutsideHours END
  WHERE (coalesce(rawClockIn,'') || coalesce(rawClockOut,'')) LIKE '%外出%';
`);

module.exports = db;

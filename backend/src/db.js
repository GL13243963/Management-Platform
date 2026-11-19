require('./utils/runtime').assertSupportedRuntime();

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
    missedPunchCount INTEGER DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS attendance_import_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sourceName TEXT,
    startDate TEXT NOT NULL,
    endDate TEXT NOT NULL,
    recordCount INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_att_import_period
    ON attendance_import_history(startDate, endDate);

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
    type TEXT NOT NULL DEFAULT 'comp_leave',
    standardHours REAL NOT NULL DEFAULT 8,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(employeeId, date)
  );
  CREATE INDEX IF NOT EXISTS idx_comp_leave_employee ON comp_leave_records(employeeId);
  CREATE INDEX IF NOT EXISTS idx_comp_leave_date ON comp_leave_records(date);

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employeeId INTEGER UNIQUE,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    passwordHash TEXT NOT NULL,
    mustChangePassword INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    failedLoginCount INTEGER NOT NULL DEFAULT 0,
    lockedUntil TEXT,
    lastLoginAt TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    updatedAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (employeeId) REFERENCES employees(id)
  );
  CREATE INDEX IF NOT EXISTS idx_users_employee ON users(employeeId);

  CREATE TABLE IF NOT EXISTS user_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    role TEXT NOT NULL,
    team TEXT NOT NULL DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(userId, role, team),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(userId);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    userId INTEGER NOT NULL,
    tokenHash TEXT NOT NULL UNIQUE,
    expiresAt TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expiresAt);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    entityType TEXT,
    entityId TEXT,
    details TEXT,
    ipAddress TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (userId) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(createdAt);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(userId);

  CREATE TABLE IF NOT EXISTS weekly_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employeeId INTEGER NOT NULL,
    weekStart TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    submittedAt TEXT,
    reviewedAt TEXT,
    reviewerUserId INTEGER,
    lockedAt TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    updatedAt TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(employeeId, weekStart),
    FOREIGN KEY (employeeId) REFERENCES employees(id),
    FOREIGN KEY (reviewerUserId) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_weekly_reports_week ON weekly_reports(weekStart, status);
  CREATE INDEX IF NOT EXISTS idx_weekly_reports_employee ON weekly_reports(employeeId);

  CREATE TABLE IF NOT EXISTS weekly_report_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reportId INTEGER NOT NULL,
    period TEXT NOT NULL,
    projectId INTEGER NOT NULL,
    projectName TEXT NOT NULL,
    weight REAL NOT NULL,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (reportId) REFERENCES weekly_reports(id) ON DELETE CASCADE,
    FOREIGN KEY (projectId) REFERENCES projects(id)
  );
  CREATE INDEX IF NOT EXISTS idx_weekly_items_report ON weekly_report_items(reportId, period);
  CREATE INDEX IF NOT EXISTS idx_weekly_items_project ON weekly_report_items(projectId);

  CREATE TABLE IF NOT EXISTS project_name_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL,
    suggestedProjectId INTEGER,
    submittedByEmployeeId INTEGER,
    submittedName TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    resolvedByUserId INTEGER,
    resolvedAt TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (projectId) REFERENCES projects(id),
    FOREIGN KEY (suggestedProjectId) REFERENCES projects(id),
    FOREIGN KEY (submittedByEmployeeId) REFERENCES employees(id),
    FOREIGN KEY (resolvedByUserId) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_project_name_reviews_status ON project_name_reviews(status);

  CREATE TABLE IF NOT EXISTS render_gallery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seedKey TEXT UNIQUE,
    title TEXT NOT NULL,
    imageUrl TEXT NOT NULL,
    storedFilename TEXT,
    originalFilename TEXT,
    mimeType TEXT,
    fileSize INTEGER,
    parameterImageUrl TEXT,
    parameterStoredFilename TEXT,
    parameterOriginalFilename TEXT,
    parameterMimeType TEXT,
    parameterFileSize INTEGER,
    platforms TEXT NOT NULL,
    category TEXT NOT NULL,
    prompt TEXT NOT NULL,
    projectId INTEGER,
    isPractice INTEGER NOT NULL DEFAULT 0,
    legacyProjectLabel TEXT,
    uploaderUserId INTEGER,
    uploaderName TEXT NOT NULL,
    starCount INTEGER NOT NULL DEFAULT 0,
    deletedAt TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    updatedAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (projectId) REFERENCES projects(id),
    FOREIGN KEY (uploaderUserId) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_render_gallery_popular ON render_gallery_items(deletedAt, starCount DESC, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_render_gallery_platform ON render_gallery_items(platforms, deletedAt);
  CREATE INDEX IF NOT EXISTS idx_render_gallery_category ON render_gallery_items(category, deletedAt);

  CREATE TABLE IF NOT EXISTS render_gallery_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    itemId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    username TEXT NOT NULL,
    eventType TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (itemId) REFERENCES render_gallery_items(id),
    FOREIGN KEY (userId) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_render_gallery_events_item ON render_gallery_events(itemId, eventType, createdAt);
  CREATE INDEX IF NOT EXISTS idx_render_gallery_events_user ON render_gallery_events(userId, eventType, createdAt);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_render_gallery_one_like
    ON render_gallery_events(itemId, userId) WHERE eventType='like';

  CREATE TABLE IF NOT EXISTS tool_matrix_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seedKey TEXT UNIQUE,
    name TEXT NOT NULL,
    englishName TEXT,
    icon TEXT,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    scene TEXT NOT NULL,
    summary TEXT NOT NULL,
    functionDescription TEXT NOT NULL,
    usageSteps TEXT NOT NULL,
    versionDescription TEXT,
    officialUrl TEXT,
    storedFilename TEXT,
    originalFilename TEXT,
    mimeType TEXT,
    fileSize INTEGER,
    developerUserId INTEGER,
    developerName TEXT,
    contributorUserId INTEGER,
    contributorName TEXT NOT NULL,
    useCount INTEGER NOT NULL DEFAULT 0,
    favoriteCount INTEGER NOT NULL DEFAULT 0,
    deletedAt TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    updatedAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (developerUserId) REFERENCES users(id),
    FOREIGN KEY (contributorUserId) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_tool_matrix_filter ON tool_matrix_items(deletedAt, type, source, scene);
  CREATE INDEX IF NOT EXISTS idx_tool_matrix_popular ON tool_matrix_items(deletedAt, useCount DESC, favoriteCount DESC);

  CREATE TABLE IF NOT EXISTS tool_matrix_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    itemId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(itemId, userId),
    FOREIGN KEY (itemId) REFERENCES tool_matrix_items(id),
    FOREIGN KEY (userId) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_tool_matrix_favorites_item ON tool_matrix_favorites(itemId);
`);

// Lightweight migrations for databases created by earlier versions.
const employeeColumns = raw.prepare('PRAGMA table_info(employees)').all();
if (!employeeColumns.some(column => column.name === 'team')) {
  raw.exec('ALTER TABLE employees ADD COLUMN team TEXT');
}
for (const [name, definition] of [
  ['personnelVisible', 'INTEGER NOT NULL DEFAULT 1'],
  ['attendanceRequired', 'INTEGER NOT NULL DEFAULT 1'],
  ['weeklyReportRequired', 'INTEGER NOT NULL DEFAULT 1'],
  ['workYears', 'REAL'],
  ['undergraduateSchool', 'TEXT'],
  ['graduateSchool', 'TEXT'],
]) {
  if (!employeeColumns.some(column => column.name === name)) {
    raw.exec(`ALTER TABLE employees ADD COLUMN ${name} ${definition}`);
  }
}
// Earlier UI versions stored the team directly in `department`.
raw.prepare(`
  UPDATE employees SET team=department
  WHERE team IS NULL AND department IN ('规划组', '方案组', '建筑组')
`).run();
raw.prepare(`UPDATE employees SET team='方案组' WHERE team='建筑组'`).run();
raw.prepare(`UPDATE employees SET department='方案组' WHERE department='建筑组'`).run();
// 李亮兼任规划组长，同时保留个人填报角色。该迁移可重复执行，
// 用于已有线上数据库升级，不会删除他的其他权限。
raw.prepare(`UPDATE employees SET team='规划组' WHERE name='李亮'`).run();
raw.prepare(`
  INSERT OR IGNORE INTO user_roles (userId, role, team)
  SELECT u.id, 'team_leader', '规划组'
  FROM users u LEFT JOIN employees e ON e.id=u.employeeId
  WHERE u.username='李亮' OR e.name='李亮'
`).run();

const projectColumns = raw.prepare('PRAGMA table_info(projects)').all();
if (!projectColumns.some(column => column.name === 'completionPercent')) {
  raw.exec('ALTER TABLE projects ADD COLUMN completionPercent REAL DEFAULT 0');
}
if (!projectColumns.some(column => column.name === 'team')) {
  raw.exec('ALTER TABLE projects ADD COLUMN team TEXT');
}
// Early allocation imports generated temporary PRJ-001 style identifiers.
// They are not real project numbers and should be completed by a team leader.
raw.prepare("UPDATE projects SET code=NULL WHERE code GLOB 'PRJ-[0-9]*'").run();

const attendanceColumns = raw.prepare('PRAGMA table_info(attendance_logs)').all();
for (const [name, definition] of [
  ['isMissedPunch', 'INTEGER DEFAULT 0'],
  ['missedPunchCount', 'INTEGER DEFAULT 0'],
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

const dayArrangementColumns = raw.prepare('PRAGMA table_info(comp_leave_records)').all();
if (!dayArrangementColumns.some(column => column.name === 'type')) {
  raw.exec("ALTER TABLE comp_leave_records ADD COLUMN type TEXT NOT NULL DEFAULT 'comp_leave'");
}
if (!dayArrangementColumns.some(column => column.name === 'standardHours')) {
  raw.exec('ALTER TABLE comp_leave_records ADD COLUMN standardHours REAL NOT NULL DEFAULT 8');
}
// Historical attendance data corrections require an explicit migration.

module.exports = db;

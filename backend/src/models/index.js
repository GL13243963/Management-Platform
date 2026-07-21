const db = require('../db');

function boolify(row, boolCols = []) {
  if (!row) return row;
  for (const c of boolCols) if (c in row) row[c] = !!row[c];
  return row;
}
function buildUpdate(table, patch, allowedCols, touchUpdatedAt = true) {
  const cols = Object.keys(patch).filter(k => allowedCols.includes(k));
  if (!cols.length) return null;
  const set = cols.map(c => `${c}=?`).join(', ');
  const values = cols.map(c => {
    const v = patch[c];
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v === undefined ? null : v;
  });
  const tail = touchUpdatedAt ? `, updatedAt=datetime('now','localtime')` : '';
  return { sql: `UPDATE ${table} SET ${set}${tail} WHERE id=?`, values };
}

/** Employees */
const EMP_COLS = ['name', 'employeeNo', 'department', 'team', 'position', 'hourlyRate', 'active'];
const Employee = {
  all() {
    return db.prepare('SELECT * FROM employees ORDER BY id ASC').all()
      .map(r => boolify(r, ['active']));
  },
  find(id) { return boolify(db.prepare('SELECT * FROM employees WHERE id=?').get(id), ['active']); },
  findByName(name) { return boolify(db.prepare('SELECT * FROM employees WHERE name=?').get(name), ['active']); },
  create(data) {
    const info = db.prepare(
      `INSERT INTO employees (name, employeeNo, department, team, position, hourlyRate, active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.name,
      data.employeeNo ?? null,
      data.department ?? null,
      data.team ?? null,
      data.position ?? null,
      data.hourlyRate ?? 0,
      data.active === false ? 0 : 1,
    );
    return this.find(Number(info.lastInsertRowid));
  },
  update(id, patch) {
    const u = buildUpdate('employees', patch, EMP_COLS);
    if (u) db.prepare(u.sql).run(...u.values, id);
    return this.find(id);
  },
  destroy(id) { return db.prepare('DELETE FROM employees WHERE id=?').run(id); },
};

/** Projects */
const PROJ_COLS = ['code', 'name', 'description', 'manager', 'startDate', 'endDate', 'status'];
const Project = {
  all() { return db.prepare('SELECT * FROM projects ORDER BY id DESC').all(); },
  find(id) { return db.prepare('SELECT * FROM projects WHERE id=?').get(id); },
  create(data) {
    const info = db.prepare(
      `INSERT INTO projects (code, name, description, manager, startDate, endDate, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.code ?? null, data.name,
      data.description ?? null, data.manager ?? null,
      data.startDate ?? null, data.endDate ?? null,
      data.status ?? 'active',
    );
    return this.find(Number(info.lastInsertRowid));
  },
  update(id, patch) {
    const u = buildUpdate('projects', patch, PROJ_COLS);
    if (u) db.prepare(u.sql).run(...u.values, id);
    return this.find(id);
  },
  destroy(id) { return db.prepare('DELETE FROM projects WHERE id=?').run(id); },
};

/** ProjectMemberships (time-series) */
const ProjectMembership = {
  find(id) { return db.prepare('SELECT * FROM project_memberships WHERE id=?').get(id); },
  create(data) {
    const info = db.prepare(
      `INSERT INTO project_memberships (employeeId, projectId, weight, role, effectiveFrom, effectiveTo, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.employeeId, data.projectId,
      data.weight ?? 1.0, data.role ?? 'member',
      data.effectiveFrom, data.effectiveTo ?? null,
      data.note ?? null,
    );
    return this.find(Number(info.lastInsertRowid));
  },
  update(id, patch) {
    const cols = ['weight', 'role', 'effectiveFrom', 'effectiveTo', 'note'];
    const u = buildUpdate('project_memberships', patch, cols, false);
    if (u) db.prepare(u.sql).run(...u.values, id);
    return this.find(id);
  },
  activeForProject(projectId, date) {
    return db.prepare(`
      SELECT pm.*, e.name AS empName, e.department AS empDepartment, e.position AS empPosition
      FROM project_memberships pm
      LEFT JOIN employees e ON e.id = pm.employeeId
      WHERE pm.projectId=?
        AND pm.effectiveFrom <= ?
        AND (pm.effectiveTo IS NULL OR pm.effectiveTo >= ?)
      ORDER BY pm.effectiveFrom DESC
    `).all(projectId, date, date);
  },
  historyForProject(projectId) {
    return db.prepare(`
      SELECT pm.*, e.name AS empName, e.department AS empDepartment, e.position AS empPosition
      FROM project_memberships pm
      LEFT JOIN employees e ON e.id = pm.employeeId
      WHERE pm.projectId=?
      ORDER BY pm.effectiveFrom DESC, pm.id DESC
    `).all(projectId);
  },
  activeForEmployee(employeeId, date) {
    return db.prepare(`
      SELECT * FROM project_memberships
      WHERE employeeId=?
        AND effectiveFrom <= ?
        AND (effectiveTo IS NULL OR effectiveTo >= ?)
    `).all(employeeId, date, date);
  },
};

/** Attendance */
const ATT_COLS = ['clockIn', 'clockOut', 'workHours', 'status', 'isLate', 'isEarlyLeave', 'overrideType', 'overrideNote'];
const AttendanceLog = {
  find(id) { return boolify(db.prepare('SELECT * FROM attendance_logs WHERE id=?').get(id), ['isLate', 'isEarlyLeave']); },
  findByEmpDate(employeeId, date) {
    return boolify(db.prepare('SELECT * FROM attendance_logs WHERE employeeId=? AND date=?').get(employeeId, date), ['isLate', 'isEarlyLeave']);
  },
  upsert({ employeeId, employeeName, date, clockIn, clockOut, workHours, status, isLate, isEarlyLeave }) {
    const existing = this.findByEmpDate(employeeId, date);
    if (existing) {
      db.prepare(`
        UPDATE attendance_logs SET clockIn=?, clockOut=?, workHours=?, status=?, isLate=?, isEarlyLeave=?,
          updatedAt=datetime('now','localtime') WHERE id=?
      `).run(clockIn, clockOut, workHours, status, isLate?1:0, isEarlyLeave?1:0, existing.id);
      return { row: this.find(existing.id), created: false };
    }
    const info = db.prepare(`
      INSERT INTO attendance_logs (employeeId, employeeName, date, clockIn, clockOut, workHours, status, isLate, isEarlyLeave)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(employeeId, employeeName, date, clockIn, clockOut, workHours, status, isLate?1:0, isEarlyLeave?1:0);
    return { row: this.find(Number(info.lastInsertRowid)), created: true };
  },
  update(id, patch) {
    const u = buildUpdate('attendance_logs', patch, ATT_COLS);
    if (u) db.prepare(u.sql).run(...u.values, id);
    return this.find(id);
  },
  query({ startDate, endDate, employeeId, status } = {}) {
    const where = [];
    const params = [];
    if (startDate) { where.push('date >= ?'); params.push(startDate); }
    if (endDate) { where.push('date <= ?'); params.push(endDate); }
    if (employeeId) { where.push('employeeId = ?'); params.push(Number(employeeId)); }
    if (status) { where.push('status = ?'); params.push(status); }
    const sql = `SELECT * FROM attendance_logs
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY date DESC, employeeName ASC LIMIT 2000`;
    return db.prepare(sql).all(...params).map(r => boolify(r, ['isLate', 'isEarlyLeave']));
  },
  /** 查询所有记录（无LIMIT，用于统计） */
  queryAll({ startDate, endDate, employeeId, status } = {}) {
    const where = [];
    const params = [];
    if (startDate) { where.push('date >= ?'); params.push(startDate); }
    if (endDate) { where.push('date <= ?'); params.push(endDate); }
    if (employeeId) { where.push('employeeId = ?'); params.push(Number(employeeId)); }
    if (status) { where.push('status = ?'); params.push(status); }
    const sql = `SELECT * FROM attendance_logs
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY date DESC, employeeName ASC`;
    return db.prepare(sql).all(...params).map(r => boolify(r, ['isLate', 'isEarlyLeave']));
  },
};

/** Adjustments */
const Adjustment = {
  create(data) {
    const info = db.prepare(`
      INSERT INTO adjustments (attendanceLogId, employeeId, date, type, reason, operator)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.attendanceLogId ?? null, data.employeeId ?? null, data.date ?? null,
      data.type ?? null, data.reason ?? null, data.operator ?? 'admin',
    );
    return db.prepare('SELECT * FROM adjustments WHERE id=?').get(Number(info.lastInsertRowid));
  },
};

module.exports = { db, Employee, Project, ProjectMembership, AttendanceLog, Adjustment };

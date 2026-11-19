const db = require('../db');
const { isWeekendDate, isAttendanceExcluded } = require('../services/attendance');

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
const EMP_BOOL_COLS = ['active', 'personnelVisible', 'attendanceRequired', 'weeklyReportRequired'];
const EMP_COLS = ['name', 'employeeNo', 'department', 'team', 'position', 'hourlyRate',
  'workYears', 'undergraduateSchool', 'graduateSchool', ...EMP_BOOL_COLS];
function normalizeEmployee(row) {
  if (row && 'monthlySalary' in row) delete row.monthlySalary;
  return boolify(row, EMP_BOOL_COLS);
}
const Employee = {
  all() {
    return db.prepare('SELECT * FROM employees ORDER BY id ASC').all()
      .map(normalizeEmployee);
  },
  find(id) { return normalizeEmployee(db.prepare('SELECT * FROM employees WHERE id=?').get(id)); },
  findByName(name) { return normalizeEmployee(db.prepare('SELECT * FROM employees WHERE name=?').get(name)); },
  create(data) {
    const info = db.prepare(
      `INSERT INTO employees (name, employeeNo, department, team, position, hourlyRate,
        workYears, undergraduateSchool, graduateSchool, active,
        personnelVisible, attendanceRequired, weeklyReportRequired)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.name,
      data.employeeNo ?? null,
      data.department ?? null,
      data.team ?? null,
      data.position ?? null,
      data.hourlyRate ?? 0,
      data.workYears ?? null,
      data.undergraduateSchool ?? null,
      data.graduateSchool ?? null,
      data.active === false ? 0 : 1,
      data.personnelVisible === false ? 0 : 1,
      data.attendanceRequired === false ? 0 : 1,
      data.weeklyReportRequired === false ? 0 : 1,
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
const PROJ_COLS = ['code', 'name', 'description', 'manager', 'startDate', 'endDate', 'completionPercent', 'status', 'team'];
const Project = {
  all() { return db.prepare('SELECT * FROM projects ORDER BY id DESC').all(); },
  find(id) { return db.prepare('SELECT * FROM projects WHERE id=?').get(id); },
  create(data) {
    const info = db.prepare(
      `INSERT INTO projects (code, name, description, manager, startDate, endDate, completionPercent, status, team)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.code ?? null, data.name,
      data.description ?? null, data.manager ?? null,
      data.startDate ?? null, data.endDate ?? null,
      data.completionPercent ?? 0,
      data.status ?? 'active',
      data.team ?? null,
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
      SELECT pm.*, e.name AS empName, e.department AS empDepartment,
             e.position AS empPosition, e.team AS empTeam
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
      SELECT pm.*, e.name AS empName, e.department AS empDepartment,
             e.position AS empPosition, e.team AS empTeam
      FROM project_memberships pm
      LEFT JOIN employees e ON e.id = pm.employeeId
      WHERE pm.projectId=?
      ORDER BY pm.effectiveFrom DESC, pm.id DESC
    `).all(projectId);
  },
  /** Memberships overlapping the requested overview period. */
  allWithNames({ startDate, endDate } = {}) {
    const where = [];
    const params = [];
    if (endDate) { where.push('pm.effectiveFrom <= ?'); params.push(endDate); }
    if (startDate) { where.push('(pm.effectiveTo IS NULL OR pm.effectiveTo >= ?)'); params.push(startDate); }
    return db.prepare(`
      SELECT pm.employeeId, pm.projectId, pm.weight,
             e.name AS empName, e.team AS empTeam,
             p.name AS projectName
      FROM project_memberships pm
      LEFT JOIN employees e ON e.id = pm.employeeId
      LEFT JOIN projects  p ON p.id = pm.projectId
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    `).all(...params);
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
function attendanceForReporting(row) {
  if (row.overrideType === 'remote_work' || row.status === 'remote_work') {
    return { ...row, clockIn: null, clockOut: null, isLate: false, isEarlyLeave: false, isMissedPunch: false, missedPunchCount: 0 };
  }
  if (isWeekendDate(row.date) && !isAttendanceExcluded(row)) {
    const worked = row.clockIn || row.clockOut || row.workHours > 0 || row.sourceOvertime;
    return { ...row, status: worked ? 'weekend_overtime' : row.status, isLate: false, isEarlyLeave: false, isMissedPunch: false, missedPunchCount: 0 };
  }
  return row;
}

const ATT_COLS = ['clockIn', 'clockOut', 'workHours', 'status', 'isLate', 'isEarlyLeave', 'isMissedPunch', 'missedPunchCount', 'rawClockIn', 'rawClockOut', 'sourceRow', 'sourceColumn', 'overrideType', 'overrideNote', 'sourceOvertime', 'sourceBusinessTrip', 'sourceOutside', 'sourceOvertimeHours', 'sourceBusinessTripHours', 'sourceOutsideHours'];
const AttendanceLog = {
  find(id) { return boolify(db.prepare('SELECT * FROM attendance_logs WHERE id=?').get(id), ['isLate', 'isEarlyLeave', 'isMissedPunch']); },
  findByEmpDate(employeeId, date) {
    return boolify(db.prepare('SELECT * FROM attendance_logs WHERE employeeId=? AND date=?').get(employeeId, date), ['isLate', 'isEarlyLeave']);
  },
  upsert({ employeeId, employeeName, date, clockIn, clockOut, workHours, status, isLate, isEarlyLeave, isMissedPunch, missedPunchCount, rawClockIn, rawClockOut, sourceRow, sourceColumn, sourceOvertime, sourceBusinessTrip, sourceOutside, sourceOvertimeHours, sourceBusinessTripHours, sourceOutsideHours }) {
    const existing = this.findByEmpDate(employeeId, date);
    if (existing) {
      const finalWorkHours = existing.overrideType ? existing.workHours : workHours;
      const finalIsLate = existing.overrideType ? existing.isLate : isLate;
      const finalIsEarlyLeave = existing.overrideType ? existing.isEarlyLeave : isEarlyLeave;
      const finalIsMissedPunch = existing.overrideType ? existing.isMissedPunch : isMissedPunch;
      const finalMissedPunchCount = existing.overrideType ? existing.missedPunchCount : missedPunchCount;
      const finalClockIn = existing.overrideType === 'remote_work' ? null : clockIn;
      const finalClockOut = existing.overrideType === 'remote_work' ? null : clockOut;
      db.prepare(`
        UPDATE attendance_logs SET clockIn=?, clockOut=?, workHours=?, status=?, isLate=?, isEarlyLeave=?, isMissedPunch=?, missedPunchCount=?,
          rawClockIn=?, rawClockOut=?, sourceRow=?, sourceColumn=?, sourceOvertime=?, sourceBusinessTrip=?, sourceOutside=?, sourceOvertimeHours=?, sourceBusinessTripHours=?, sourceOutsideHours=?,
          updatedAt=datetime('now','localtime') WHERE id=?
      `).run(finalClockIn, finalClockOut, finalWorkHours, existing.overrideType || status, finalIsLate?1:0, finalIsEarlyLeave?1:0, finalIsMissedPunch?1:0, finalMissedPunchCount||0,
        rawClockIn ?? null, rawClockOut ?? null, sourceRow ?? null, sourceColumn ?? null, sourceOvertime?1:0, sourceBusinessTrip?1:0, sourceOutside?1:0, sourceOvertimeHours||0, sourceBusinessTripHours||0, sourceOutsideHours||0, existing.id);
      return { row: this.find(existing.id), created: false };
    }
    const info = db.prepare(`
      INSERT INTO attendance_logs (employeeId, employeeName, date, clockIn, clockOut, workHours, status, isLate, isEarlyLeave,
        isMissedPunch, missedPunchCount, rawClockIn, rawClockOut, sourceRow, sourceColumn, sourceOvertime, sourceBusinessTrip, sourceOutside, sourceOvertimeHours, sourceBusinessTripHours, sourceOutsideHours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(employeeId, employeeName, date, clockIn, clockOut, workHours, status, isLate?1:0, isEarlyLeave?1:0,
      isMissedPunch?1:0, missedPunchCount||0, rawClockIn ?? null, rawClockOut ?? null, sourceRow ?? null, sourceColumn ?? null, sourceOvertime?1:0, sourceBusinessTrip?1:0, sourceOutside?1:0, sourceOvertimeHours||0, sourceBusinessTripHours||0, sourceOutsideHours||0);
    return { row: this.find(Number(info.lastInsertRowid)), created: true };
  },
  update(id, patch) {
    const u = buildUpdate('attendance_logs', patch, ATT_COLS);
    if (u) db.prepare(u.sql).run(...u.values, id);
    return this.find(id);
  },
  deleteMissingInRange(employeeIds, startDate, endDate, sourceKeys) {
    if (!employeeIds.length) return 0;
    const placeholders = employeeIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT id, employeeId, date FROM attendance_logs
      WHERE employeeId IN (${placeholders}) AND date >= ? AND date <= ?
        AND COALESCE(overrideType,'') <> 'remote_work'
    `).all(...employeeIds, startDate, endDate);
    let removed = 0;
    for (const row of rows) {
      if (!sourceKeys.has(`${row.employeeId}:${row.date}`)) {
        db.prepare('DELETE FROM attendance_logs WHERE id=?').run(row.id);
        removed += 1;
      }
    }
    return removed;
  },
  query(options = {}) {
    return this.queryAll(options, 2000);
  },
  /** 查询所有记录（无LIMIT，用于统计） */
  queryAll({ startDate, endDate, employeeId, status } = {}, limit = null) {
    const where = [`EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id=attendance_logs.employeeId AND COALESCE(e.attendanceRequired,1)=1
    )`, `NOT EXISTS (
      SELECT 1 FROM comp_leave_records c
      WHERE c.employeeId=attendance_logs.employeeId AND c.date=attendance_logs.date
        AND COALESCE(c.type,'comp_leave')='comp_leave'
    )`];
    const params = [];
    if (startDate) { where.push('date >= ?'); params.push(startDate); }
    if (endDate) { where.push('date <= ?'); params.push(endDate); }
    if (employeeId) { where.push('employeeId = ?'); params.push(Number(employeeId)); }
    const sql = `SELECT * FROM attendance_logs
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY date DESC, employeeName ASC${limit && !status ? ' LIMIT ?' : ''}`;
    if (limit && !status) params.push(limit);
    const rows = db.prepare(sql).all(...params)
      .map(row => attendanceForReporting(boolify(row, ['isLate', 'isEarlyLeave', 'isMissedPunch'])))
      .filter(row => !status || row.status === status);
    return limit && status ? rows.slice(0, limit) : rows;
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

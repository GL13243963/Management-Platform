const express = require('express');
const { showOnDashboard } = require('../services/dashboard-visibility');
const dayjs = require('dayjs');
const { db, Employee, ProjectMembership, AttendanceLog, Adjustment } = require('../models');
const { summarizeEmployees } = require('../services/analytics');
const { computeDaily, remoteWorkPatch, STANDARD_WORKDAY_HOURS } = require('../services/attendance');
const { requireAnyRole, canViewEmployee } = require('../middleware/auth');
const router = express.Router();

function visibleEmployees(req) {
  return Employee.all().filter(employee => employee.personnelVisible && canViewEmployee(req.auth.user, employee));
}

function clearRemoteWorkAttendance(employeeId, date) {
  const existing = AttendanceLog.findByEmpDate(employeeId, date);
  if (existing?.overrideType !== 'remote_work') return;
  if (existing.rawClockIn || existing.rawClockOut || existing.sourceRow || existing.sourceOvertime || existing.sourceBusinessTrip || existing.sourceOutside) {
    const daily = computeDaily({ date, clockIn: existing.rawClockIn, clockOut: existing.rawClockOut,
      sourceText: `${existing.rawClockIn || ''} ${existing.rawClockOut || ''}`,
      overtimeHours: existing.sourceOvertimeHours || null, businessTripHours: existing.sourceBusinessTripHours || null,
      outsideHours: existing.sourceOutsideHours || null, preferSourceStatus: true });
    AttendanceLog.update(existing.id, { ...daily, overrideType: null, overrideNote: null });
  } else {
    db.prepare('DELETE FROM attendance_logs WHERE id=?').run(existing.id);
  }
}

router.get('/', (req, res) => res.json(visibleEmployees(req)
  .filter(employee => req.query.dashboard !== 'true' || showOnDashboard(employee.name))));

// Overview: employees enriched with period hours and project participation.
router.get('/overview', (req, res) => {
  const { startDate, endDate } = req.query;

  const employees = visibleEmployees(req);
  const summaries = summarizeEmployees({ startDate, endDate });
  const sumMap = new Map(summaries.map(s => [s.employeeId, s]));
  const memberships = ProjectMembership.allWithNames({ startDate, endDate });

  // employeeId → Map(projectId → projectName)
  const projMap = new Map();
  for (const m of memberships) {
    if (!projMap.has(m.employeeId)) projMap.set(m.employeeId, new Map());
    const set = projMap.get(m.employeeId);
    if (!set.has(m.projectId)) set.set(m.projectId, m.projectName);
  }

  const result = employees.map(emp => {
    const s = sumMap.get(emp.id);
    const projs = projMap.get(emp.id);
    const projectNames = projs ? Array.from(projs.values()) : [];
    return {
      ...emp,
      totalHours: s?.totalHours || 0,
      attendanceDays: s?.days || 0,
      lateDays: s?.lateDays || 0,
      earlyDays: s?.earlyDays || 0,
      missedPunchDays: s?.missedPunchDays || 0,
      projectCount: projectNames.length,
      projectNames,
    };
  });

  res.json(result);
});

// --- Comp leave (调休) management ---

// List all comp-leave records for an employee
router.get('/:id/comp-leave', (req, res) => {
  const employee = Employee.find(req.params.id);
  if (!canViewEmployee(req.auth.user, employee)) return res.status(403).json({ error: '没有权限查看该员工' });
  const rows = db.prepare(`
    SELECT id, date, note, type, standardHours, createdAt FROM comp_leave_records
    WHERE employeeId = ?
    ORDER BY date DESC
  `).all(req.params.id);
  res.json(rows);
});

router.get('/comp-leave/all', (req, res) => {
  const allowed = new Set(visibleEmployees(req).map(employee => employee.id));
  res.json(db.prepare(`SELECT c.*, e.name AS employeeName FROM comp_leave_records c
    JOIN employees e ON e.id=c.employeeId ORDER BY c.date DESC, e.name`).all()
    .filter(row => allowed.has(row.employeeId)));
});

router.post('/comp-leave/batch', requireAnyRole('admin'), (req, res) => {
  const employeeIds = Array.isArray(req.body.employeeIds) ? req.body.employeeIds.map(Number) : [];
  const dates = Array.isArray(req.body.dates) ? req.body.dates : [];
  const type = req.body.type === 'remote_work' ? 'remote_work' : 'comp_leave';
  const standardHours = type === 'remote_work' ? STANDARD_WORKDAY_HOURS : 0;
  if (!employeeIds.length || !dates.length) return res.status(400).json({ error: '请选择员工和日期' });
  const validEmployees = new Set(Employee.all().filter(employee => employee.attendanceRequired).map(employee => employee.id));
  const employeesById = new Map(Employee.all().map(employee => [employee.id, employee]));
  const insert = db.prepare(`INSERT INTO comp_leave_records (employeeId,date,note,type,standardHours) VALUES (?,?,?,?,?)
    ON CONFLICT(employeeId,date) DO UPDATE SET note=excluded.note,type=excluded.type,standardHours=excluded.standardHours`);
  let created = 0;
  db.transaction(() => { for (const employeeId of employeeIds) for (const date of dates) {
    if (validEmployees.has(employeeId) && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      created += Number(insert.run(employeeId, date, req.body.note || null, type, standardHours).changes || 0);
      const employee = employeesById.get(employeeId);
      if (type === 'remote_work') {
        let existing = AttendanceLog.findByEmpDate(employeeId, date);
        if (!existing) existing = AttendanceLog.upsert({ employeeId, employeeName: employee.name, date, clockIn: null, clockOut: null,
          workHours: standardHours, status: 'remote_work', isLate: false, isEarlyLeave: false, isMissedPunch: false }).row;
        AttendanceLog.update(existing.id, { ...remoteWorkPatch(existing, standardHours),
          overrideType: 'remote_work', overrideNote: req.body.note || '居家办公' });
      } else {
        clearRemoteWorkAttendance(employeeId, date);
      }
    }
  } })();
  res.json({ ok: true, created, type, employees: employeeIds.length, dates: dates.length });
});

// Batch add comp-leave dates
router.post('/:id/comp-leave', requireAnyRole('admin'), (req, res) => {
  const emp = Employee.find(req.params.id);
  if (!emp) return res.status(404).json({ error: '员工不存在' });

  const { dates = [], note = '' } = req.body;
  if (!Array.isArray(dates) || !dates.length) {
    return res.status(400).json({ error: '请至少选择一个日期' });
  }

  const insert = db.prepare('INSERT OR IGNORE INTO comp_leave_records (employeeId,date,note) VALUES (?,?,?)');
  let created = 0;
  db.transaction(() => { for (const date of dates) if (/^\d{4}-\d{2}-\d{2}$/.test(date)) created += Number(insert.run(emp.id, date, note || null).changes || 0); })();
  res.json({ ok: true, created, updated: 0, total: created });
});

// Cancel a single comp-leave date
router.delete('/:id/comp-leave/:date', requireAnyRole('admin'), (req, res) => {
  const emp = Employee.find(req.params.id);
  if (!emp) return res.status(404).json({ error: '员工不存在' });

  const arrangement = db.prepare('SELECT type FROM comp_leave_records WHERE employeeId=? AND date=?').get(emp.id, req.params.date);
  if (!arrangement) return res.status(404).json({ error: '该日期没有工作安排' });
  db.transaction(() => {
    db.prepare('DELETE FROM comp_leave_records WHERE employeeId=? AND date=?').run(emp.id, req.params.date);
    if (arrangement.type === 'remote_work') clearRemoteWorkAttendance(emp.id, req.params.date);
  })();
  res.json({ ok: true });
});

router.post('/', requireAnyRole('admin'), (req, res) => {
  try { res.json(Employee.create(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', requireAnyRole('admin'), (req, res) => {
  const emp = Employee.find(req.params.id);
  if (!emp) return res.status(404).json({ error: 'not found' });
  res.json(Employee.update(req.params.id, req.body));
});

router.delete('/:id', requireAnyRole('admin'), (req, res) => {
  const emp = Employee.find(req.params.id);
  if (!emp) return res.status(404).json({ error: 'not found' });
  const attendanceCount = db.prepare('SELECT COUNT(*) AS count FROM attendance_logs WHERE employeeId=?').get(emp.id).count;
  const membershipCount = db.prepare('SELECT COUNT(*) AS count FROM project_memberships WHERE employeeId=?').get(emp.id).count;
  if (attendanceCount || membershipCount) {
    return res.status(409).json({
      error: '该员工已有考勤或项目历史，不能删除，可将其设为停用',
    });
  }
  Employee.destroy(emp.id);
  res.json({ ok: true });
});

module.exports = router;

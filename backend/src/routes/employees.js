const express = require('express');
const dayjs = require('dayjs');
const { db, Employee, ProjectMembership, AttendanceLog, Adjustment } = require('../models');
const { summarizeEmployees } = require('../services/analytics');
const { computeDaily } = require('../services/attendance');
const router = express.Router();

router.get('/', (req, res) => res.json(Employee.all()));

// Overview: employees enriched with period hours and project participation.
router.get('/overview', (req, res) => {
  const { startDate, endDate } = req.query;

  const employees = Employee.all();
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
  const rows = db.prepare(`
    SELECT id, date, note, createdAt FROM comp_leave_records
    WHERE employeeId = ?
    ORDER BY date DESC
  `).all(req.params.id);
  res.json(rows);
});

router.get('/comp-leave/all', (req, res) => {
  res.json(db.prepare(`SELECT c.*, e.name AS employeeName FROM comp_leave_records c
    JOIN employees e ON e.id=c.employeeId ORDER BY c.date DESC, e.name`).all());
});

router.post('/comp-leave/batch', (req, res) => {
  const employeeIds = Array.isArray(req.body.employeeIds) ? req.body.employeeIds.map(Number) : [];
  const dates = Array.isArray(req.body.dates) ? req.body.dates : [];
  if (!employeeIds.length || !dates.length) return res.status(400).json({ error: '请选择员工和调休日期' });
  const validEmployees = new Set(Employee.all().map(employee => employee.id));
  const insert = db.prepare('INSERT OR IGNORE INTO comp_leave_records (employeeId,date,note) VALUES (?,?,?)');
  let created = 0;
  db.transaction(() => { for (const employeeId of employeeIds) for (const date of dates) {
    if (validEmployees.has(employeeId) && /^\d{4}-\d{2}-\d{2}$/.test(date)) created += Number(insert.run(employeeId, date, req.body.note || null).changes || 0);
  } })();
  res.json({ ok: true, created, employees: employeeIds.length, dates: dates.length });
});

// Batch add comp-leave dates
router.post('/:id/comp-leave', (req, res) => {
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
router.delete('/:id/comp-leave/:date', (req, res) => {
  const emp = Employee.find(req.params.id);
  if (!emp) return res.status(404).json({ error: '员工不存在' });

  const result = db.prepare('DELETE FROM comp_leave_records WHERE employeeId=? AND date=?').run(emp.id, req.params.date);
  if (!result.changes) return res.status(404).json({ error: '该日期没有调休记录' });
  res.json({ ok: true });
});

router.post('/', (req, res) => {
  try { res.json(Employee.create(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', (req, res) => {
  const emp = Employee.find(req.params.id);
  if (!emp) return res.status(404).json({ error: 'not found' });
  res.json(Employee.update(req.params.id, req.body));
});

router.delete('/:id', (req, res) => {
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

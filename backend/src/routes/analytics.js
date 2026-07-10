const express = require('express');
const { AttendanceLog, Employee, Project } = require('../models');
const { aggregateProjectHours, distributeHours } = require('../services/allocation');

const router = express.Router();

router.get('/summary', (req, res) => {
  const { startDate, endDate } = req.query;
  const logs = AttendanceLog.query({ startDate, endDate });

  const totalHours = logs.reduce((s, l) => s + (l.workHours || 0), 0);
  const totalDays = logs.length;
  const lateDays = logs.filter(l => l.isLate && !l.overrideType).length;
  const earlyDays = logs.filter(l => l.isEarlyLeave && !l.overrideType).length;
  const overrideDays = logs.filter(l => !!l.overrideType).length;
  const attendedDays = logs.filter(l => l.workHours > 0 || l.overrideType).length;
  const attendanceRate = totalDays ? Math.round((attendedDays / totalDays) * 10000) / 100 : 0;

  res.json({
    totalHours: Math.round(totalHours * 100) / 100,
    totalDays, lateDays, earlyDays, overrideDays,
    attendanceRate,
    employeeCount: new Set(logs.map(l => l.employeeId)).size,
  });
});

router.get('/by-project', (req, res) => {
  const rows = aggregateProjectHours(req.query);
  const projects = Project.all();
  res.json(rows.map(r => ({
    ...r,
    projectName: projects.find(p => p.id === r.projectId)?.name || `#${r.projectId}`,
  })));
});

router.get('/by-employee', (req, res) => {
  const { startDate, endDate } = req.query;
  const logs = AttendanceLog.query({ startDate, endDate });
  const map = new Map();
  for (const l of logs) {
    const cur = map.get(l.employeeId) || {
      employeeId: l.employeeId, name: l.employeeName,
      totalHours: 0, days: 0, lateDays: 0, earlyDays: 0,
    };
    cur.totalHours = Math.round((cur.totalHours + (l.workHours || 0)) * 100) / 100;
    cur.days += 1;
    if (l.isLate && !l.overrideType) cur.lateDays += 1;
    if (l.isEarlyLeave && !l.overrideType) cur.earlyDays += 1;
    map.set(l.employeeId, cur);
  }
  res.json(Array.from(map.values()));
});

router.get('/labor-cost', (req, res) => {
  const { startDate, endDate } = req.query;
  const logs = AttendanceLog.query({ startDate, endDate });
  const employees = Employee.all();
  const projects = Project.all();
  const rateOf = id => employees.find(e => e.id === id)?.hourlyRate || 0;

  const map = new Map();
  for (const l of logs) {
    const parts = distributeHours(l);
    const rate = rateOf(l.employeeId);
    for (const p of parts) {
      const cur = map.get(p.projectId) || { projectId: p.projectId, hours: 0, cost: 0 };
      cur.hours = Math.round((cur.hours + p.hours) * 100) / 100;
      cur.cost = Math.round((cur.cost + p.hours * rate) * 100) / 100;
      map.set(p.projectId, cur);
    }
  }
  res.json(Array.from(map.values()).map(r => ({
    ...r,
    projectName: projects.find(p => p.id === r.projectId)?.name || `#${r.projectId}`,
  })));
});

module.exports = router;

const express = require('express');
const { showOnDashboard } = require('../services/dashboard-visibility');
const { AttendanceLog, Project } = require('../models');
const { aggregateProjectHours } = require('../services/allocation');
const { summarizeEmployees, summarizeLaborCost, round2, importedMarkedHours, importedOvertimeHours } = require('../services/analytics');
const { summarizeResourceGraph } = require('../services/analytics');
const { Employee } = require('../models');
const { buildLeadershipReport } = require('../services/leadership-report');
const { requireAnyRole } = require('../middleware/auth');
const { isAttendanceExcluded, isWorkHoursExcluded } = require('../services/attendance');

const router = express.Router();

router.get('/summary', requireAnyRole('admin', 'leader'), (req, res) => {
  const { startDate, endDate } = req.query;
  const logs = AttendanceLog.queryAll({ startDate, endDate }).filter(log => showOnDashboard(log.employeeName));
  const countedLogs = logs.filter(log => !isAttendanceExcluded(log));
  const workedLogs = logs.filter(log => !isWorkHoursExcluded(log));

  const totalHours = workedLogs.reduce((s, l) => s + (l.workHours || 0), 0);
  const totalDays = countedLogs.length;
  const lateDays = countedLogs.filter(l => l.isLate).length;
  const earlyDays = countedLogs.filter(l => l.isEarlyLeave).length;
  const lateOrEarlyDays = countedLogs.reduce((sum, l) => sum + Number(!!l.isLate) + Number(!!l.isEarlyLeave), 0);
  const missedPunchDays = countedLogs.reduce((sum, log) => sum + (Number(log.missedPunchCount) || Number(!!log.isMissedPunch)), 0);
  const overtimeHours = round2(countedLogs.reduce((sum, l) => sum + importedOvertimeHours(l), 0));
  const businessTripHours = round2(logs.reduce((sum, l) => sum + importedMarkedHours(l, '出差', 'sourceBusinessTripHours'), 0));
  const outsideHours = round2(logs.reduce((sum, l) => sum + importedMarkedHours(l, '外出', 'sourceOutsideHours'), 0));
  const overrideDays = logs.length - countedLogs.length;
  const attendedDays = countedLogs.filter(l => l.workHours > 0).length;
  const attendanceRate = totalDays ? Math.round((attendedDays / totalDays) * 10000) / 100 : 0;

  res.json({
    totalHours: round2(totalHours),
    totalDays, lateDays, earlyDays, lateOrEarlyDays, missedPunchDays, overrideDays, overtimeHours, businessTripHours, outsideHours,
    attendanceRate,
    employeeCount: new Set(logs.map(l => l.employeeId)).size,
  });
});

router.get('/by-project', requireAnyRole('admin', 'leader', 'team_leader'), (req, res) => {
  const rows = aggregateProjectHours(req.query);
  const projects = Project.all();
  res.json(rows.map(r => ({
    ...r,
    projectName: projects.find(p => p.id === r.projectId)?.name || `#${r.projectId}`,
  })));
});

router.get('/by-employee', requireAnyRole('admin', 'leader'), (req, res) => {
  res.json(summarizeEmployees({ ...req.query, dashboard: true }));
});

router.get('/labor-cost', requireAnyRole('admin', 'leader'), (req, res) => {
  res.json(summarizeLaborCost(req.query));
});

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

router.get('/leadership-report', requireAnyRole('admin', 'leader'), (req, res) => {
  const { startDate, endDate } = req.query;
  const logs = AttendanceLog.queryAll({ startDate, endDate }).filter(log => showOnDashboard(log.employeeName));
  const countedLogs = logs.filter(log => !isAttendanceExcluded(log));
  const workedLogs = logs.filter(log => !isWorkHoursExcluded(log));
  const employees = summarizeEmployees({ startDate, endDate, dashboard: true });
  const graph = summarizeResourceGraph({ startDate, endDate, dashboard: true });
  const projects = graph.projects.filter(project => project.memberCount || project.hours);
  const employeeMaster = new Map(Employee.all().map(employee => [employee.id, employee]));
  const graphById = new Map(graph.employees.map(employee => [employee.id, employee]));
  const reportEmployees = employees.map(employee => ({
    ...employee,
    team: employeeMaster.get(employee.employeeId)?.team || null,
    projectCount: graphById.get(employee.employeeId)?.projectCount || 0,
  }));
  const fullAttendanceRate = reportEmployees.length
    ? Math.round(reportEmployees.filter(employee => employee.lateDays === 0 && employee.earlyDays === 0 && employee.missedPunchDays === 0).length / reportEmployees.length * 100)
    : 0;
  const totalHours = round2(workedLogs.reduce((sum, row) => sum + (row.workHours || 0), 0));
  const abnormal = countedLogs.reduce((sum, row) => sum + Number(!!row.isLate) + Number(!!row.isEarlyLeave) + Number(!!row.isMissedPunch), 0);
  const teamRows = ['规划组', '方案组'].map(team => {
    const ids = new Set(graph.employees.filter(employee => employee.team === team).map(employee => employee.id));
    const rows = countedLogs.filter(row => ids.has(row.employeeId));
    const workRows = workedLogs.filter(row => ids.has(row.employeeId));
    return { team, people: ids.size, hours: round2(workRows.reduce((sum, row) => sum + (row.workHours || 0), 0)), abnormal: rows.reduce((sum, row) => sum + Number(!!row.isLate) + Number(!!row.isEarlyLeave) + Number(!!row.isMissedPunch), 0) };
  });
  const avgHours = reportEmployees.length ? round2(totalHours / reportEmployees.length) : 0;
  const avgCompletion = projects.length ? round2(projects.reduce((sum, project) => sum + project.completionPercent, 0) / projects.length) : 0;
  const html = buildLeadershipReport({
    title: esc(req.query.title || '创新中心运营看板'), startDate: startDate || '不限', endDate: endDate || '不限',
    generatedAt: new Date().toLocaleString('zh-CN'), logs, employees: reportEmployees, graph,
    summary: { totalHours, totalDays: countedLogs.length, employeeCount: new Set(countedLogs.map(log => log.employeeId)).size, fullAttendanceRate, lateDays: countedLogs.filter(log => log.isLate).length, earlyDays: countedLogs.filter(log => log.isEarlyLeave).length, lateOrEarlyDays: countedLogs.reduce((sum, log) => sum + Number(!!log.isLate) + Number(!!log.isEarlyLeave), 0), missedPunchDays: countedLogs.reduce((sum, log) => sum + (Number(log.missedPunchCount) || Number(!!log.isMissedPunch)), 0), avgHours, overtimeHours: round2(countedLogs.reduce((sum, log) => sum + importedOvertimeHours(log), 0)), businessTripHours: round2(logs.reduce((sum, log) => sum + importedMarkedHours(log, '出差', 'sourceBusinessTripHours'), 0)), outsideHours: round2(logs.reduce((sum, log) => sum + importedMarkedHours(log, '外出', 'sourceOutsideHours'), 0)), attendanceRate: countedLogs.length ? round2(countedLogs.filter(log => log.workHours > 0).length / countedLogs.length * 100) : 0, abnormal, loadAbnormal: reportEmployees.filter(employee => employee.totalHours > avgHours * 1.3 || employee.totalHours < avgHours * 0.6).length, avgCompletion },
    teams: teamRows.map(team => { const rows = logs.filter(log => employeeMaster.get(log.employeeId)?.team === team.team); const active = rows.filter(log => !isAttendanceExcluded(log)); const teamEmployees = reportEmployees.filter(employee => employee.team === team.team); const overtimeTop = [...teamEmployees].filter(employee => employee.overtimeHours > 0).sort((a, b) => b.overtimeHours - a.overtimeHours)[0] || null; const normal = active.filter(log => ['normal', 'remote_work'].includes(log.status)).length, late = active.filter(log => log.status === 'late').length, early = active.filter(log => log.status === 'early').length, lateAndEarly = active.filter(log => log.status === 'late_and_early').length, missed = active.filter(log => ['missed_punch', 'absent'].includes(log.status)).length, attended = normal + late + early + lateAndEarly + missed; return { ...team, avgHours: team.people ? round2(team.hours / team.people) : 0, normal, late, early, lateAndEarly, lateOrEarly: active.reduce((sum, log) => sum + Number(!!log.isLate) + Number(!!log.isEarlyLeave), 0), overtimeHours: round2(active.reduce((sum, log) => sum + importedOvertimeHours(log), 0)), businessTripHours: round2(rows.reduce((sum, log) => sum + importedMarkedHours(log, '出差', 'sourceBusinessTripHours'), 0)), outsideHours: round2(rows.reduce((sum, log) => sum + importedMarkedHours(log, '外出', 'sourceOutsideHours'), 0)), missed, rate: attended ? Math.round(normal / attended * 100) : 0, fullAttendancePeople: teamEmployees.filter(employee => employee.lateDays === 0 && employee.earlyDays === 0 && employee.missedPunchDays === 0).map(employee => employee.name), overtimeTop: overtimeTop ? { name: overtimeTop.name, hours: overtimeTop.overtimeHours } : null }; }),
  });
  const filename = `innovation-center-${startDate || 'all'}-${endDate || 'all'}.html`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(html);
});

module.exports = router;

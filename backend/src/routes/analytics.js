const express = require('express');
const { AttendanceLog, Project } = require('../models');
const { aggregateProjectHours } = require('../services/allocation');
const { summarizeEmployees, summarizeLaborCost, round2, importedMarkedHours, importedOvertimeHours } = require('../services/analytics');
const { summarizeResourceGraph } = require('../services/analytics');
const { Employee } = require('../models');
const { buildLeadershipReport } = require('../services/leadership-report');

const router = express.Router();

router.get('/summary', (req, res) => {
  const { startDate, endDate } = req.query;
  const logs = AttendanceLog.queryAll({ startDate, endDate });

  const totalHours = logs.reduce((s, l) => s + (l.workHours || 0), 0);
  const totalDays = logs.length;
  const lateDays = logs.filter(l => l.isLate && !l.overrideType).length;
  const earlyDays = logs.filter(l => l.isEarlyLeave && !l.overrideType).length;
  const lateOrEarlyDays = logs.reduce((sum, l) => sum + (!l.overrideType ? Number(!!l.isLate) + Number(!!l.isEarlyLeave) : 0), 0);
  const missedPunchDays = logs.filter(l => l.isMissedPunch && !l.overrideType).length;
  const overtimeHours = round2(logs.reduce((sum, l) => sum + importedOvertimeHours(l), 0));
  const businessTripHours = round2(logs.reduce((sum, l) => sum + importedMarkedHours(l, '出差', 'sourceBusinessTripHours'), 0));
  const outsideHours = round2(logs.reduce((sum, l) => sum + importedMarkedHours(l, '外出', 'sourceOutsideHours'), 0));
  const overrideDays = logs.filter(l => !!l.overrideType).length;
  const attendedDays = logs.filter(l => l.workHours > 0 || l.overrideType).length;
  const attendanceRate = totalDays ? Math.round((attendedDays / totalDays) * 10000) / 100 : 0;

  res.json({
    totalHours: round2(totalHours),
    totalDays, lateDays, earlyDays, lateOrEarlyDays, missedPunchDays, overrideDays, overtimeHours, businessTripHours, outsideHours,
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
  res.json(summarizeEmployees(req.query));
});

router.get('/labor-cost', (req, res) => {
  res.json(summarizeLaborCost(req.query));
});

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

router.get('/leadership-report', (req, res) => {
  const { startDate, endDate } = req.query;
  const logs = AttendanceLog.queryAll({ startDate, endDate });
  const employees = summarizeEmployees({ startDate, endDate });
  const graph = summarizeResourceGraph({ startDate, endDate });
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
  const totalHours = round2(logs.reduce((sum, row) => sum + (row.workHours || 0), 0));
  const abnormal = logs.reduce((sum, row) => sum + (!row.overrideType ? Number(!!row.isLate) + Number(!!row.isEarlyLeave) + Number(!!row.isMissedPunch) : 0), 0);
  const teamRows = ['规划组', '方案组'].map(team => {
    const ids = new Set(graph.employees.filter(employee => employee.team === team).map(employee => employee.id));
    const rows = logs.filter(row => ids.has(row.employeeId));
    return { team, people: ids.size, hours: round2(rows.reduce((sum, row) => sum + (row.workHours || 0), 0)), abnormal: rows.reduce((sum, row) => sum + (!row.overrideType ? Number(!!row.isLate) + Number(!!row.isEarlyLeave) + Number(!!row.isMissedPunch) : 0), 0) };
  });
  const avgHours = reportEmployees.length ? round2(totalHours / reportEmployees.length) : 0;
  const avgCompletion = projects.length ? round2(projects.reduce((sum, project) => sum + project.completionPercent, 0) / projects.length) : 0;
  const html = buildLeadershipReport({
    title: esc(req.query.title || '创新中心运营看板'), startDate: startDate || '不限', endDate: endDate || '不限',
    generatedAt: new Date().toLocaleString('zh-CN'), logs, employees: reportEmployees, graph,
    summary: { totalHours, totalDays: logs.length, employeeCount: new Set(logs.map(log => log.employeeId)).size, fullAttendanceRate, lateDays: logs.filter(log => log.isLate && !log.overrideType).length, earlyDays: logs.filter(log => log.isEarlyLeave && !log.overrideType).length, lateOrEarlyDays: logs.reduce((sum, log) => sum + (!log.overrideType ? Number(!!log.isLate) + Number(!!log.isEarlyLeave) : 0), 0), missedPunchDays: logs.filter(log => log.isMissedPunch && !log.overrideType).length, avgHours, overtimeHours: round2(logs.reduce((sum, log) => sum + importedOvertimeHours(log), 0)), businessTripHours: round2(logs.reduce((sum, log) => sum + importedMarkedHours(log, '出差', 'sourceBusinessTripHours'), 0)), outsideHours: round2(logs.reduce((sum, log) => sum + importedMarkedHours(log, '外出', 'sourceOutsideHours'), 0)), attendanceRate: logs.length ? round2(logs.filter(log => log.workHours > 0 || log.overrideType).length / logs.length * 100) : 0, abnormal, loadAbnormal: reportEmployees.filter(employee => employee.totalHours > avgHours * 1.3 || employee.totalHours < avgHours * 0.6).length, avgCompletion },
    teams: teamRows.map(team => { const rows = logs.filter(log => employeeMaster.get(log.employeeId)?.team === team.team); const active = rows.filter(log => !log.overrideType); const teamEmployees = reportEmployees.filter(employee => employee.team === team.team); const overtimeTop = [...teamEmployees].filter(employee => employee.overtimeHours > 0).sort((a, b) => b.overtimeHours - a.overtimeHours)[0] || null; const normal = active.filter(log => log.status === 'normal').length, late = active.filter(log => log.status === 'late').length, early = active.filter(log => log.status === 'early').length, lateAndEarly = active.filter(log => log.status === 'late_and_early').length, missed = active.filter(log => ['missed_punch', 'absent'].includes(log.status)).length, attended = normal + late + early + lateAndEarly + missed; return { ...team, avgHours: team.people ? round2(team.hours / team.people) : 0, normal, late, early, lateAndEarly, lateOrEarly: active.reduce((sum, log) => sum + Number(!!log.isLate) + Number(!!log.isEarlyLeave), 0), overtimeHours: round2(rows.reduce((sum, log) => sum + importedOvertimeHours(log), 0)), businessTripHours: round2(rows.reduce((sum, log) => sum + importedMarkedHours(log, '出差', 'sourceBusinessTripHours'), 0)), outsideHours: round2(rows.reduce((sum, log) => sum + importedMarkedHours(log, '外出', 'sourceOutsideHours'), 0)), missed, rate: attended ? Math.round(normal / attended * 100) : 0, fullAttendancePeople: teamEmployees.filter(employee => employee.lateDays === 0 && employee.earlyDays === 0 && employee.missedPunchDays === 0).map(employee => employee.name), overtimeTop: overtimeTop ? { name: overtimeTop.name, hours: overtimeTop.overtimeHours } : null }; }),
  });
  const filename = `innovation-center-${startDate || 'all'}-${endDate || 'all'}.html`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(html);
});

module.exports = router;

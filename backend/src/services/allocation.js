const { ProjectMembership, AttendanceLog } = require('../models');

/** For a given (employeeId, date), returns [{projectId, weight, role}] with normalized weights (sum=1). */
function getActiveMemberships(employeeId, date) {
  const rows = ProjectMembership.activeForEmployee(employeeId, date);
  const total = rows.reduce((s, m) => s + (m.weight || 0), 0);
  if (total <= 0) return [];
  return rows.map(m => ({ projectId: m.projectId, weight: m.weight / total, role: m.role }));
}

/** Distribute a single log's workHours across active projects. */
function distributeHours(log) {
  if (!log.workHours || log.overrideType) return [];
  const allocs = getActiveMemberships(log.employeeId, log.date);
  return allocs.map(a => ({
    projectId: a.projectId,
    hours: Math.round(log.workHours * a.weight * 100) / 100,
  }));
}

/** Aggregate hours grouped by project across a date range. */
function aggregateProjectHours({ startDate, endDate, employeeId, projectId } = {}) {
  // Analytics must not inherit the 2000-row pagination cap used by the list view.
  const logs = AttendanceLog.queryAll({ startDate, endDate, employeeId });
  const projMap = new Map();
  for (const log of logs) {
    for (const p of distributeHours(log)) {
      if (projectId && p.projectId !== Number(projectId)) continue;
      const cur = projMap.get(p.projectId) || { projectId: p.projectId, hours: 0, days: 0 };
      cur.hours = Math.round((cur.hours + p.hours) * 100) / 100;
      cur.days += 1;
      projMap.set(p.projectId, cur);
    }
  }
  return Array.from(projMap.values());
}

module.exports = { getActiveMemberships, distributeHours, aggregateProjectHours };

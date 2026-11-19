const { ProjectMembership, AttendanceLog } = require('../models');
const { showOnDashboard } = require('./dashboard-visibility');
const { isWorkHoursExcluded } = require('./attendance');
const dayjs = require('dayjs');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/** For a given (employeeId, date), returns [{projectId, weight, role}] with normalized weights (sum=1). */
function getActiveMemberships(employeeId, date) {
  const rows = ProjectMembership.activeForEmployee(employeeId, date);
  const total = rows.reduce((s, m) => s + (m.weight || 0), 0);
  if (total <= 0) return [];
  return rows.map(m => ({ projectId: m.projectId, weight: m.weight / total, role: m.role }));
}

/** Distribute a single log's workHours across active projects. */
function distributeHours(log) {
  if (!log.workHours || isWorkHoursExcluded(log)) return [];
  const allocs = getActiveMemberships(log.employeeId, log.date);
  return allocs.map(a => ({
    projectId: a.projectId,
    hours: Math.round(log.workHours * a.weight * 100) / 100,
  }));
}

/** Aggregate hours grouped by project across a date range. */
function aggregateProjectHours({ startDate, endDate, employeeId, projectId, dashboard = false } = {}) {
  // Analytics must not inherit the 2000-row pagination cap used by the list view.
  const logs = AttendanceLog.queryAll({ startDate, endDate, employeeId })
    .filter(log => !dashboard || showOnDashboard(log.employeeName));
  const projMap = new Map();
  for (const log of logs) {
    for (const p of distributeHours(log)) {
      if (projectId && p.projectId !== Number(projectId)) continue;
      const cur = projMap.get(p.projectId) || { projectId: p.projectId, hours: 0, days: 0 };
      cur.hours += p.hours;
      cur.days += 1;
      projMap.set(p.projectId, cur);
    }
  }
  return Array.from(projMap.values()).map(r => ({ ...r, hours: round2(r.hours) }));
}

/**
 * Aggregate allocated project hours into Monday-to-Sunday buckets. Keeping the
 * time buckets on the server gives every client the same timeline semantics
 * and avoids repeatedly distributing the same attendance row in the browser.
 */
function summarizeProjectTimeline({ startDate, endDate, employeeIds, projectIds } = {}) {
  const employeeSet = employeeIds ? new Set(employeeIds.map(Number)) : null;
  const projectSet = projectIds ? new Set(projectIds.map(Number)) : null;
  const buckets = new Map();
  for (const log of AttendanceLog.queryAll({ startDate, endDate })) {
    if (employeeSet && !employeeSet.has(Number(log.employeeId))) continue;
    const date = dayjs(log.date);
    const weekStart = date.subtract((date.day() + 6) % 7, 'day').format('YYYY-MM-DD');
    const weekEnd = dayjs(weekStart).add(6, 'day').format('YYYY-MM-DD');
    for (const allocation of distributeHours(log)) {
      if (projectSet && !projectSet.has(Number(allocation.projectId))) continue;
      const key = `${allocation.projectId}:${weekStart}`;
      const current = buckets.get(key) || {
        projectId: Number(allocation.projectId), weekStart, weekEnd, hours: 0,
      };
      current.hours += Number(allocation.hours) || 0;
      buckets.set(key, current);
    }
  }
  return Array.from(buckets.values())
    .map(row => ({ ...row, hours: round2(row.hours) }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.projectId - b.projectId);
}

module.exports = { getActiveMemberships, distributeHours, aggregateProjectHours, summarizeProjectTimeline };

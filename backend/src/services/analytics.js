const { AttendanceLog, Employee, Project, ProjectMembership } = require('../models');
const { showOnDashboard } = require('./dashboard-visibility');
const { distributeHours } = require('./allocation');
const { isAttendanceExcluded, isWorkHoursExcluded, overtimeHoursFromText } = require('./attendance');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

function importedMarkedHours(log, label, storedField) {
  const stored = Number(log[storedField]) || 0;
  if (stored > 0) return stored;
  const text = `${log.rawClockIn || ''} ${log.rawClockOut || ''}`;
  const match = text.match(new RegExp(`${label}[^\\d]{0,10}(\\d+(?:\\.\\d+)?)\\s*(?:小时|h|H)`));
  return match ? Number(match[1]) : 0;
}

function importedOvertimeHours(log) {
  if (isAttendanceExcluded(log)) return 0;
  if (log.overrideType === 'remote_work' || log.status === 'remote_work') return 0;
  const stored = Number(log.sourceOvertimeHours) || 0;
  const explicitHours = stored > 0 ? stored : overtimeHoursFromText(`${log.rawClockIn || ''} ${log.rawClockOut || ''}`);
  if (explicitHours !== null) return round2(explicitHours);
  const day = new Date(`${log.date}T00:00:00`).getDay();
  // Without an explicit overtime duration, every worked weekend hour is
  // overtime. Do not add the after-21:00 rule again or hours would duplicate.
  if (day === 0 || day === 6) return round2(log.workHours);
  const match = String(log.clockOut || log.rawClockOut || '').match(/(\d{1,2}):(\d{2})/);
  const minutes = match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  const afterNineHours = Math.max(0, minutes - 21 * 60) / 60;
  return round2(afterNineHours);
}

/** Per-employee attendance summary for a date range. */
function summarizeEmployees({ startDate, endDate, status, dashboard = false } = {}) {
  const logs = AttendanceLog.queryAll({ startDate, endDate, status })
    .filter(log => !dashboard || showOnDashboard(log.employeeName));

  // first attendance date per employee (across all dates)
  const firstDateMap = new Map();
  for (const l of AttendanceLog.queryAll()) {
    const cur = firstDateMap.get(l.employeeId);
    if (!cur || l.date < cur) firstDateMap.set(l.employeeId, l.date);
  }

  const map = new Map();
  for (const l of logs) {
    const cur = map.get(l.employeeId) || {
      employeeId: l.employeeId,
      name: l.employeeName,
      totalHours: 0,
      days: 0,
      lateDays: 0,
      earlyDays: 0,
      lateOrEarlyDays: 0,
      missedPunchDays: 0,
      overtimeHours: 0,
      businessTripHours: 0,
      outsideHours: 0,
      abnormalDays: 0,
      excludedDays: 0,
      firstAttendanceDate: firstDateMap.get(l.employeeId) || null,
    };
    cur.businessTripHours += importedMarkedHours(l, '出差', 'sourceBusinessTripHours');
    cur.outsideHours += importedMarkedHours(l, '外出', 'sourceOutsideHours');
    if (!isWorkHoursExcluded(l)) cur.totalHours += (l.workHours || 0);
    if (isAttendanceExcluded(l)) {
      cur.excludedDays += 1;
      map.set(l.employeeId, cur);
      continue;
    }
    cur.days += 1;
    if (l.isLate && !l.overrideType) cur.lateDays += 1;
    if (l.isEarlyLeave && !l.overrideType) cur.earlyDays += 1;
    if (!l.overrideType) cur.lateOrEarlyDays += Number(!!l.isLate) + Number(!!l.isEarlyLeave);
    if (l.isMissedPunch && !l.overrideType) cur.missedPunchDays += Number(l.missedPunchCount) || 1;
    cur.overtimeHours += importedOvertimeHours(l);
    if (!l.overrideType && (l.isLate || l.isEarlyLeave || l.isMissedPunch)) {
      cur.abnormalDays += 1;
    }
    map.set(l.employeeId, cur);
  }

  return Array.from(map.values()).map(emp => {
    const normalDays = emp.days - emp.abnormalDays;
    const personalFullAttendanceRate = emp.days > 0
      ? Math.round((normalDays / emp.days) * 100)
      : 0;
    return {
      ...emp,
      totalHours: round2(emp.totalHours),
      overtimeHours: round2(emp.overtimeHours),
      businessTripHours: round2(emp.businessTripHours),
      outsideHours: round2(emp.outsideHours),
      workingDays: emp.days,
      personalFullAttendanceRate,
    };
  });
}

/** Per-project hours and labour cost for a date range. */
function summarizeLaborCost({ startDate, endDate } = {}) {
  const logs = AttendanceLog.queryAll({ startDate, endDate });
  const employees = Employee.all();
  const projects = Project.all();
  const rateOf = id => employees.find(e => e.id === id)?.hourlyRate || 0;

  const map = new Map();
  for (const l of logs) {
    const parts = distributeHours(l);
    const rate = rateOf(l.employeeId);
    for (const p of parts) {
      const cur = map.get(p.projectId) || { projectId: p.projectId, hours: 0, cost: 0 };
      cur.hours += p.hours;
      cur.cost += p.hours * rate;
      map.set(p.projectId, cur);
    }
  }

  return Array.from(map.values()).map(r => ({
    projectId: r.projectId,
    projectName: projects.find(p => p.id === r.projectId)?.name || `#${r.projectId}`,
    hours: round2(r.hours),
    cost: round2(r.cost),
  }));
}

/** Person-to-project graph using attendance hours distributed by active weights. */
function summarizeResourceGraph({ startDate, endDate, dashboard = false } = {}) {
  const employees = Employee.all().filter(employee => !dashboard || showOnDashboard(employee.name));
  const employeeIds = new Set(employees.map(employee => employee.id));
  const logs = AttendanceLog.queryAll({ startDate, endDate })
    .filter(log => !dashboard || (employeeIds.has(log.employeeId) && showOnDashboard(log.employeeName)));
  const projects = Project.all();
  const memberships = ProjectMembership.allWithNames({ startDate, endDate })
    .filter(row => !dashboard || employeeIds.has(row.employeeId));
  const employeeById = new Map(employees.map(employee => [employee.id, employee]));
  const projectById = new Map(projects.map(project => [project.id, project]));

  const employeeHours = new Map();
  const allocatableHours = new Map();
  const links = new Map();
  const relationshipWeights = new Map();

  for (const membership of memberships) {
    const key = `${membership.employeeId}:${membership.projectId}`;
    const current = relationshipWeights.get(key) || { sum: 0, count: 0 };
    current.sum += Number(membership.weight) || 0;
    current.count += 1;
    relationshipWeights.set(key, current);
    if (!links.has(key)) {
      links.set(key, {
        employeeId: membership.employeeId,
        projectId: membership.projectId,
        hours: 0,
        cost: 0,
      });
    }
  }

  for (const log of logs) {
    employeeHours.set(log.employeeId, (employeeHours.get(log.employeeId) || 0) + (log.workHours || 0));
    if (!isWorkHoursExcluded(log)) {
      allocatableHours.set(log.employeeId, (allocatableHours.get(log.employeeId) || 0) + (log.workHours || 0));
    }
    const rate = employeeById.get(log.employeeId)?.hourlyRate || 0;
    for (const part of distributeHours(log)) {
      const key = `${log.employeeId}:${part.projectId}`;
      const current = links.get(key) || {
        employeeId: log.employeeId, projectId: part.projectId, hours: 0, cost: 0,
      };
      current.hours += part.hours;
      current.cost += part.hours * rate;
      links.set(key, current);
    }
  }

  const normalizedLinks = Array.from(links.entries()).map(([key, link]) => {
    const weights = relationshipWeights.get(key);
    return {
      ...link,
      employeeName: employeeById.get(link.employeeId)?.name || `#${link.employeeId}`,
      projectName: projectById.get(link.projectId)?.name || `#${link.projectId}`,
      hours: round2(link.hours),
      cost: round2(link.cost),
      weight: weights?.count ? round2(weights.sum / weights.count) : 0,
      hasActualHours: link.hours > 0,
    };
  }).filter(link => !['placeholder', 'merged', 'deleted'].includes(projectById.get(link.projectId)?.status));

  const employeeLinks = new Map();
  const projectLinks = new Map();
  for (const link of normalizedLinks) {
    if (!employeeLinks.has(link.employeeId)) employeeLinks.set(link.employeeId, []);
    employeeLinks.get(link.employeeId).push(link);
    if (!projectLinks.has(link.projectId)) projectLinks.set(link.projectId, []);
    projectLinks.get(link.projectId).push(link);
  }

  const graphEmployees = employees
    .filter(employee => employee.active || employeeHours.has(employee.id) || employeeLinks.has(employee.id))
    .map(employee => {
      const related = employeeLinks.get(employee.id) || [];
      const totalHours = round2(employeeHours.get(employee.id) || 0);
      const allocatedHours = round2(related.reduce((sum, link) => sum + link.hours, 0));
      const available = round2(allocatableHours.get(employee.id) || 0);
      return {
        id: employee.id,
        name: employee.name,
        team: employee.team || null,
        totalHours,
        allocatedHours,
        unallocatedHours: round2(Math.max(0, available - allocatedHours)),
        projectCount: related.length,
        multiProject: related.length >= 2,
      };
    });

  const graphProjects = projects
    .filter(project => project.status === 'active' || (projectLinks.has(project.id) && !['placeholder', 'merged', 'deleted'].includes(project.status)))
    .map(project => {
      const related = projectLinks.get(project.id) || [];
      const hours = round2(related.reduce((sum, link) => sum + link.hours, 0));
      const cost = round2(related.reduce((sum, link) => sum + link.cost, 0));
      const maxContributor = related.reduce((best, link) => link.hours > (best?.hours || 0) ? link : best, null);
      const dependencyRate = hours > 0 ? round2((maxContributor?.hours || 0) / hours * 100) : 0;
      return {
        id: project.id,
        code: project.code,
        name: project.name,
        status: project.status,
        completionPercent: Number(project.completionPercent) || 0,
        startDate: project.startDate || null,
        endDate: project.endDate || null,
        hours,
        cost,
        memberCount: related.length,
        topContributor: maxContributor?.employeeName || null,
        dependencyRate,
        singlePointRisk: dependencyRate >= 60,
      };
    });

  return {
    startDate: startDate || null,
    endDate: endDate || null,
    summary: {
      totalAllocatedHours: round2(normalizedLinks.reduce((sum, link) => sum + link.hours, 0)),
      activeProjectCount: graphProjects.filter(project => project.hours > 0 || project.memberCount > 0).length,
      multiProjectEmployeeCount: graphEmployees.filter(employee => employee.multiProject).length,
      unallocatedEmployeeCount: graphEmployees.filter(employee => employee.unallocatedHours > 0.01).length,
      zeroHourRelationCount: normalizedLinks.filter(link => !link.hasActualHours).length,
      singlePointRiskCount: graphProjects.filter(project => project.singlePointRisk).length,
    },
    employees: graphEmployees,
    projects: graphProjects,
    links: normalizedLinks,
  };
}

module.exports = { round2, importedMarkedHours, importedOvertimeHours, summarizeEmployees, summarizeLaborCost, summarizeResourceGraph };

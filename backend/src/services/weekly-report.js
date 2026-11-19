const dayjs = require('dayjs');
const db = require('../db');
const { Employee, Project } = require('../models');
const { syncMembershipPeriod } = require('./allocation-import');

const PERIODS = new Set(['current', 'next']);

function mondayOf(value = dayjs()) {
  const date = dayjs(value);
  const offset = (date.day() + 6) % 7;
  return date.subtract(offset, 'day').format('YYYY-MM-DD');
}

function validateWeekStart(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && mondayOf(value) === value;
}

function lockDeadline(weekStart) {
  return dayjs(weekStart).add(7, 'day').hour(18).minute(0).second(0).millisecond(0);
}

function lockExpiredReports(now = dayjs()) {
  const rows = db.prepare("SELECT id, weekStart FROM weekly_reports WHERE status<>'locked'").all();
  const update = db.prepare("UPDATE weekly_reports SET status='locked', lockedAt=?, updatedAt=datetime('now','localtime') WHERE id=?");
  let locked = 0;
  for (const row of rows) {
    if (!now.isBefore(lockDeadline(row.weekStart))) {
      update.run(now.toISOString(), row.id);
      locked += 1;
    }
  }
  return locked;
}

function reportRow(employeeId, weekStart) {
  return db.prepare(`SELECT r.*, e.name AS employeeName, e.team AS employeeTeam
    FROM weekly_reports r JOIN employees e ON e.id=r.employeeId
    WHERE r.employeeId=? AND r.weekStart=?`).get(employeeId, weekStart);
}

function ensureReport(employeeId, weekStart) {
  let row = reportRow(employeeId, weekStart);
  if (row) return row;
  db.prepare('INSERT INTO weekly_reports (employeeId, weekStart) VALUES (?, ?)').run(employeeId, weekStart);
  return reportRow(employeeId, weekStart);
}

function itemsForReport(reportId) {
  return db.prepare(`SELECT i.*, p.code AS projectCode, p.team AS projectTeam
    FROM weekly_report_items i JOIN projects p ON p.id=i.projectId
    WHERE i.reportId=? ORDER BY i.period, i.id`).all(reportId);
}

function loadReport(employeeId, weekStart) {
  lockExpiredReports();
  const report = reportRow(employeeId, weekStart);
  if (!report) return null;
  const items = itemsForReport(report.id);
  return { ...report, items };
}

function normalizeProjectName(value) {
  return String(value || '').trim().replace(/\s+/g, '').replace(/[（）()【】\[\]·.,，。\-_]/g, '').replace(/(方案|规划)$/u, '');
}

function diceSimilarity(left, right) {
  const a = normalizeProjectName(left);
  const b = normalizeProjectName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length === 1 || b.length === 1) return 0;
  const grams = new Map();
  for (let i = 0; i < a.length - 1; i += 1) grams.set(a.slice(i, i + 2), (grams.get(a.slice(i, i + 2)) || 0) + 1);
  let matches = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const count = grams.get(gram) || 0;
    if (count) { matches += 1; grams.set(gram, count - 1); }
  }
  return (2 * matches) / (a.length + b.length - 2);
}

function unassignedProject() {
  let project = db.prepare("SELECT * FROM projects WHERE code='SYS-UNASSIGNED' LIMIT 1").get();
  if (!project) project = Project.create({ code: 'SYS-UNASSIGNED', name: '待安排', status: 'placeholder', team: null });
  return project;
}

function resolveProject(item, employee) {
  if (item.projectId) {
    const project = Project.find(Number(item.projectId));
    if (!project) throw new Error('所选项目不存在');
    if (project.status === 'placeholder' && project.code === 'SYS-UNASSIGNED') return project;
    if (project.status !== 'active') throw new Error('所选项目已停用');
    const associatedTeams = project.team ? [project.team] : db.prepare(`SELECT DISTINCT e.team
      FROM project_memberships pm JOIN employees e ON e.id=pm.employeeId
      WHERE pm.projectId=? AND e.team IN ('方案组','规划组')`).all(project.id).map(row => row.team);
    if (!associatedTeams.includes(employee.team)) throw new Error('不能选择其他小组的项目');
    return project;
  }
  const submittedName = String(item.projectName || '').trim();
  if (normalizeProjectName(submittedName) === '待安排') return unassignedProject();
  throw new Error('项目名称只能从项目名单中选择');
}

function validateItems(items, submitting) {
  if (!Array.isArray(items)) throw new Error('填报内容格式错误');
  const normalized = items.map(item => ({
    period: item.period,
    projectId: item.projectId ? Number(item.projectId) : null,
    projectName: String(item.projectName || '').trim(),
    weight: Number(item.weight),
  }));
  for (const item of normalized) {
    if (!PERIODS.has(item.period)) throw new Error('填报周期无效');
    if (!Number.isFinite(item.weight) || item.weight <= 0 || item.weight > 1) throw new Error('项目比例必须大于0且不超过1');
    if (!item.projectId && normalizeProjectName(item.projectName) !== '待安排') throw new Error('请选择项目名单中的项目');
  }
  if (submitting) {
    for (const period of PERIODS) {
      const rows = normalized.filter(item => item.period === period);
      const total = rows.reduce((sum, item) => sum + item.weight, 0);
      if (!rows.length || Math.abs(total - 1) > 0.0001) throw new Error(`${period === 'current' ? '本周实际' : '下周计划'}比例必须合计为1.0`);
    }
  }
  return normalized;
}

function saveReport({ employeeId, weekStart, items, submit = false, editorUserId, allowLocked = false, markReviewed = false }) {
  if (!validateWeekStart(weekStart)) throw new Error('weekStart必须是星期一');
  lockExpiredReports();
  if (!allowLocked && !dayjs().isBefore(lockDeadline(weekStart))) {
    throw new Error('本周填报已锁定，请联系组长或管理员修改');
  }
  const employee = Employee.find(employeeId);
  if (!employee || !employee.active) throw new Error('员工不存在或已停用');
  if (!employee.weeklyReportRequired) throw new Error('该账号不需要填写个人周报');
  const normalized = validateItems(items, submit || markReviewed);
  return db.transaction(() => {
    const report = ensureReport(employeeId, weekStart);
    if (report.status === 'locked' && !allowLocked) throw new Error('本周填报已锁定，请联系组长或管理员修改');
    db.prepare('DELETE FROM weekly_report_items WHERE reportId=?').run(report.id);
    const insert = db.prepare(`INSERT INTO weekly_report_items
      (reportId, period, projectId, projectName, weight) VALUES (?, ?, ?, ?, ?)`);
    const allocations = { current: [], next: [] };
    for (const item of normalized) {
      const project = resolveProject(item, employee);
      insert.run(report.id, item.period, project.id, project.name, item.weight);
      allocations[item.period].push({ projectId: project.id, weight: item.weight });
    }
    if (submit || markReviewed) {
      const currentFrom = dayjs(weekStart);
      const periods = {
        current: {
          from: currentFrom.format('YYYY-MM-DD'),
          to: currentFrom.add(6, 'day').format('YYYY-MM-DD'),
          label: `${weekStart} 本周实际`,
          note: '员工周填报（本周实际）',
        },
        next: {
          from: currentFrom.add(7, 'day').format('YYYY-MM-DD'),
          to: currentFrom.add(13, 'day').format('YYYY-MM-DD'),
          label: `${weekStart} 下周计划`,
          note: '员工周填报（下周计划）',
        },
      };
      syncMembershipPeriod(employeeId, periods.current, allocations.current);
      syncMembershipPeriod(employeeId, periods.next, allocations.next);
    }
    const now = new Date().toISOString();
    const status = report.status === 'locked' ? 'locked' : markReviewed ? 'reviewed' : submit ? 'submitted' : 'draft';
    db.prepare(`UPDATE weekly_reports SET status=?, submittedAt=CASE WHEN ? THEN COALESCE(submittedAt,?) ELSE submittedAt END,
      reviewedAt=CASE WHEN ? THEN ? ELSE reviewedAt END,
      reviewerUserId=CASE WHEN ? THEN ? ELSE reviewerUserId END,
      updatedAt=datetime('now','localtime') WHERE id=?`
    ).run(status, submit || markReviewed ? 1 : 0, now, markReviewed ? 1 : 0, now, markReviewed ? 1 : 0, editorUserId || null, report.id);
    return loadReport(employeeId, weekStart);
  })();
}

function previousPlan(employeeId, weekStart) {
  const previous = reportRow(employeeId, dayjs(weekStart).subtract(7, 'day').format('YYYY-MM-DD'));
  if (!previous) return [];
  return itemsForReport(previous.id).filter(item => item.period === 'next').map(item => ({ ...item, period: 'current' }));
}

function listTeamReports(team, weekStart) {
  lockExpiredReports();
  const employees = Employee.all().filter(employee => employee.active && employee.weeklyReportRequired && employee.team === team);
  return employees.map(employee => {
    const report = loadReport(employee.id, weekStart);
    const items = report?.items || [];
    return {
      employee,
      report,
      hasData: items.length > 0,
      currentTotal: items.filter(item => item.period === 'current').reduce((sum, item) => sum + item.weight, 0),
      nextTotal: items.filter(item => item.period === 'next').reduce((sum, item) => sum + item.weight, 0),
    };
  });
}

function pendingProjectReviews(team) {
  return db.prepare(`SELECT r.*, p.name AS projectName, p.team AS projectTeam,
    s.name AS suggestedProjectName, s.team AS suggestedProjectTeam, e.name AS employeeName
    FROM project_name_reviews r
    JOIN projects p ON p.id=r.projectId
    LEFT JOIN projects s ON s.id=r.suggestedProjectId
    LEFT JOIN employees e ON e.id=r.submittedByEmployeeId
    WHERE r.status='pending' AND p.team=? ORDER BY r.id DESC`).all(team);
}

function resolveProjectReview({ reviewId, action, userId }) {
  const review = db.prepare('SELECT * FROM project_name_reviews WHERE id=?').get(reviewId);
  if (!review || review.status !== 'pending') throw new Error('待确认记录不存在');
  if (action === 'merge') {
    if (!review.suggestedProjectId) throw new Error('没有可合并的目标项目');
    const target = Project.find(review.suggestedProjectId);
    db.prepare('UPDATE weekly_report_items SET projectId=?, projectName=? WHERE projectId=?')
      .run(target.id, target.name, review.projectId);
    Project.update(review.projectId, { status: 'merged' });
  } else if (action !== 'separate') {
    throw new Error('处理方式无效');
  }
  db.prepare(`UPDATE project_name_reviews SET status=?, resolvedByUserId=?, resolvedAt=? WHERE id=?`)
    .run(action === 'merge' ? 'merged' : 'separate', userId, new Date().toISOString(), review.id);
  return { ok: true };
}

module.exports = {
  mondayOf, validateWeekStart, lockDeadline, lockExpiredReports, loadReport, saveReport,
  previousPlan, listTeamReports, pendingProjectReviews, resolveProjectReview,
  normalizeProjectName, diceSimilarity,
};

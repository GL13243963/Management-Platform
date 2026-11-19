const express = require('express');
const { showOnDashboard, dashboardName } = require('../services/dashboard-visibility');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const { db, Employee, Project, ProjectMembership } = require('../models');
const { aggregateProjectHours, summarizeProjectTimeline } = require('../services/allocation');
const { round2, summarizeResourceGraph } = require('../services/analytics');
const { importAllocations, previewAllocationImport } = require('../services/allocation-import');
const { requireAnyRole, hasRole, teamLeaderTeams, canViewAllPeople, canViewEmployee } = require('../middleware/auth');
const { parseMilestones, summarizeProject } = require('../services/project-summary');
const router = express.Router();
const VALID_TEAMS = new Set(['方案组', '规划组']);
const HIDDEN_PROJECT_STATUSES = new Set(['placeholder', 'merged', 'deleted']);

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  return dayjs(value).format('YYYY-MM-DD') === value;
}

function isExpectedEndDate(value) {
  return value === '待定' || isIsoDate(value);
}

function isVisibleProject(project) {
  return project && !HIDDEN_PROJECT_STATUSES.has(project.status);
}

function visibleProjectIds(user, memberships) {
  if (canViewAllPeople(user) || hasRole(user, 'team_leader')) return null;
  return new Set(memberships.filter(row => row.employeeId === user.employeeId).map(row => row.projectId));
}

function projectTeams(project) {
  if (VALID_TEAMS.has(project.team)) return [project.team];
  return db.prepare(`SELECT DISTINCT e.team
    FROM project_memberships pm JOIN employees e ON e.id=pm.employeeId
    WHERE pm.projectId=? AND e.team IN ('方案组','规划组')
    ORDER BY e.team`).all(project.id).map(row => row.team);
}

function canCreateProject(user) {
  return hasRole(user, 'admin') || hasRole(user, 'leader') || hasRole(user, 'team_leader');
}

function canRenameProject(user, project) {
  if (hasRole(user, 'admin') || hasRole(user, 'leader')) return true;
  const ownTeams = teamLeaderTeams(user);
  const teams = projectTeams(project);
  return teams.length === 1 && ownTeams.includes(teams[0]);
}

function creationTeam(user, requestedTeam) {
  const ownTeams = teamLeaderTeams(user);
  if (!hasRole(user, 'admin') && !hasRole(user, 'leader')) {
    if (ownTeams.length !== 1) throw new Error('组长账号必须明确所属小组');
    return ownTeams[0];
  }
  const team = String(requestedTeam || '').trim();
  if (!VALID_TEAMS.has(team)) throw new Error('请选择方案组或规划组');
  return team;
}

function decorateProjectForUser(project, user) {
  const teams = projectTeams(project);
  return {
    ...project,
    effectiveTeam: teams.length === 1 ? teams[0] : null,
    associatedTeams: teams,
    canRename: canRenameProject(user, project),
    canDelete: canRenameProject(user, project),
    canMerge: canRenameProject(user, project),
    canEditProgress: canRenameProject(user, project),
  };
}

// A report can expose named attendance aggregates, so a project edit role alone
// does not grant access. The legacy manager field must identify one employee.
function summaryAccess(user) {
  if (hasRole(user, 'admin')) return () => true;
  const name = String(user.employee?.name || '').trim();
  if (!name || !user.employeeId) return () => false;
  const matches = Employee.all().filter(employee => employee.name.trim() === name);
  const owns = matches.length === 1 && Number(matches[0].id) === Number(user.employeeId);
  return project => owns && String(project.manager || '').trim() === name;
}

router.get('/summary-options', (req, res) => {
  const allowed = summaryAccess(req.auth.user);
  const projects = Project.all().filter(project => isVisibleProject(project) && allowed(project));
  res.json(projects.map(({ id, name, code, startDate, manager }) => ({
    id, name, code, startDate: isIsoDate(startDate) ? startDate : null, manager: dashboardName(manager),
  })));
});

router.post('/:id/summary', (req, res) => {
  const project = Project.find(req.params.id);
  if (!isVisibleProject(project)) return res.status(404).json({ error: '项目不存在' });
  if (!summaryAccess(req.auth.user)(project)) return res.status(403).json({ error: '仅项目负责人和管理员可以生成总结' });
  const { startDate, endDate, confirmed, progressTable } = req.body || {};
  if (confirmed !== true || !isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate
    || endDate > dayjs().format('YYYY-MM-DD')) {
    return res.status(400).json({ error: '请填写有效的实际起止日期，并确认项目已结束' });
  }
  let milestones;
  try { milestones = parseMilestones(progressTable); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  res.json(summarizeProject({
    project: { ...project, manager: dashboardName(project.manager) }, startDate, endDate, milestones,
    memberships: ProjectMembership.historyForProject(project.id).filter(row => showOnDashboard(row.empName)),
  }));
});

router.get('/', (req, res) => {
  const memberships = ProjectMembership.allWithNames();
  const ids = visibleProjectIds(req.auth.user, memberships);
  res.json(Project.all().filter(project => isVisibleProject(project) && (!ids || ids.has(project.id))));
});

// Official project choices for weekly reporting. Employees can only load the
// list for their own team; team leaders are likewise limited to their team.
router.get('/options', (req, res) => {
  const user = req.auth.user;
  const requestedTeam = String(req.query.team || user.employee?.team || '').trim();
  let allowedTeams;
  if (hasRole(user, 'admin') || hasRole(user, 'leader')) allowedTeams = [...VALID_TEAMS];
  else if (hasRole(user, 'team_leader')) allowedTeams = teamLeaderTeams(user);
  else allowedTeams = user.employee?.team ? [user.employee.team] : [];
  if (!VALID_TEAMS.has(requestedTeam) || !allowedTeams.includes(requestedTeam)) {
    return res.status(403).json({ error: '不能查看其他小组的项目名单' });
  }
  const projects = Project.all()
    .filter(project => project.status === 'active')
    .filter(project => projectTeams(project).includes(requestedTeam))
    .map(project => ({ id: project.id, code: project.code, name: project.name, team: requestedTeam }));
  res.json(projects);
});

// Date coverage of project allocation records visible to the current account.
// The project dashboard uses this instead of today's date for its default month.
router.get('/date-range', (req, res) => {
  const rows = db.prepare(`
    SELECT pm.employeeId, pm.effectiveFrom,
           COALESCE(pm.effectiveTo, date('now','localtime')) AS effectiveTo,
           e.team AS empTeam
    FROM project_memberships pm
    LEFT JOIN employees e ON e.id=pm.employeeId
  `).all().filter(row => canViewEmployee(req.auth.user, {
    id: row.employeeId,
    team: row.empTeam,
  }));
  if (!rows.length) {
    return res.json({ earliestDate: null, latestDate: null, totalRecords: 0 });
  }
  const earliestDate = rows.reduce((value, row) => !value || row.effectiveFrom < value ? row.effectiveFrom : value, null);
  const latestDate = rows.reduce((value, row) => !value || row.effectiveTo > value ? row.effectiveTo : value, null);
  res.json({ earliestDate, latestDate, totalRecords: rows.length });
});

// Overview: projects enriched with member names and total hours for a date range.
router.get('/overview', (req, res) => {
  const { startDate, endDate } = req.query;

  const allProjects = Project.all().filter(isVisibleProject);
  const hoursRows = aggregateProjectHours({ startDate, endDate, dashboard: true });
  const hoursMap = new Map(hoursRows.map(r => [r.projectId, r.hours]));
  const memberships = ProjectMembership.allWithNames({ startDate, endDate }).filter(row => showOnDashboard(row.empName));
  const visibleIds = visibleProjectIds(req.auth.user, memberships);
  const projects = allProjects.filter(project => !visibleIds || visibleIds.has(project.id));

  // projectId → Map(empId → empName) to deduplicate across adjacent windows
  const memberMap = new Map();
  for (const m of memberships) {
    if (!memberMap.has(m.projectId)) memberMap.set(m.projectId, new Map());
    const empSet = memberMap.get(m.projectId);
    if (!empSet.has(m.employeeId)) empSet.set(m.employeeId, m.empName);
  }

  const result = projects.map(p => {
    const names = memberMap.get(p.id);
    const memberNames = names ? memberships
      .filter(membership => membership.projectId === p.id)
      .filter(membership => canViewEmployee(req.auth.user, { id: membership.employeeId, team: membership.empTeam }))
      .map(membership => membership.empName)
      .filter((name, index, values) => values.indexOf(name) === index) : [];
    return {
      ...decorateProjectForUser(p, req.auth.user),
      memberCount: names ? names.size : 0,
      memberNames,
      totalHours: round2(hoursMap.get(p.id) || 0),
    };
  });

  res.json(result);
});

router.get('/resource-graph', (req, res) => {
  const graph = summarizeResourceGraph({ ...req.query, dashboard: true });
  const canSeeSensitive = canViewAllPeople(req.auth.user);
  const projectsWithPermissions = graph.projects.map(project => {
    const permissions = decorateProjectForUser(Project.find(project.id) || project, req.auth.user);
    return {
      ...(canSeeSensitive ? project : { ...project, cost: 0, topContributor: null }),
      canRename: permissions.canRename,
      canDelete: permissions.canDelete,
      canMerge: permissions.canMerge,
      canEditProgress: permissions.canEditProgress,
    };
  });
  if (canSeeSensitive) return res.json({ ...graph, projects: projectsWithPermissions });
  // The personnel-project relationship is shared operational information.
  // Non-admin users may view the complete graph, but financial/contribution
  // details remain redacted and all mutation endpoints still require admin.
  const employees = graph.employees.map(employee => ({ ...employee, cost: 0 }));
  const projects = projectsWithPermissions;
  const links = graph.links.map(link => ({ ...link, cost: 0 }));
  res.json({ ...graph, employees, projects, links });
});

// Project timeline: planned duration plus weekly allocated hours. The weekly
// hours drive the varying line thickness in the project dashboard.
router.get('/timeline', (req, res) => {
  const user = req.auth.user;
  const allMemberships = db.prepare(`
    SELECT pm.projectId, pm.employeeId, pm.effectiveFrom, pm.effectiveTo,
           e.team AS empTeam
    FROM project_memberships pm
    LEFT JOIN employees e ON e.id=pm.employeeId
  `).all();
  const visibleEmployees = Employee.all().filter(employee => showOnDashboard(employee.name) && canViewEmployee(user, employee));
  const visibleEmployeeIds = visibleEmployees.map(employee => employee.id);
  const ownTeams = teamLeaderTeams(user);
  const ownProjectIds = new Set(allMemberships
    .filter(row => Number(row.employeeId) === Number(user.employeeId))
    .map(row => Number(row.projectId)));

  const projects = Project.all().filter(isVisibleProject).filter(project => {
    if (canViewAllPeople(user)) return true;
    const teams = projectTeams(project);
    if (hasRole(user, 'team_leader')) return teams.some(team => ownTeams.includes(team));
    return ownProjectIds.has(Number(project.id));
  });
  const projectIds = projects.map(project => project.id);
  const projectIdSet = new Set(projectIds);
  const memberships = allMemberships.filter(row => projectIdSet.has(Number(row.projectId)));

  const validStarts = memberships.map(row => row.effectiveFrom).filter(isIsoDate);
  const validEnds = memberships.map(row => row.effectiveTo).filter(isIsoDate);
  for (const project of projects) {
    if (isIsoDate(project.startDate)) validStarts.push(project.startDate);
    if (isIsoDate(project.endDate)) validEnds.push(project.endDate);
  }
  const today = dayjs().format('YYYY-MM-DD');
  const requestedStart = isIsoDate(req.query.startDate) ? req.query.startDate : null;
  const requestedEnd = isIsoDate(req.query.endDate) ? req.query.endDate : null;
  const startDate = requestedStart || validStarts.sort()[0] || dayjs().startOf('month').format('YYYY-MM-DD');
  const endDate = requestedEnd || [...validEnds, today].sort().at(-1) || today;
  const segments = summarizeProjectTimeline({
    startDate,
    endDate,
    employeeIds: visibleEmployeeIds,
    projectIds,
  });
  const hoursByProject = new Map();
  for (const segment of segments) {
    hoursByProject.set(segment.projectId, round2((hoursByProject.get(segment.projectId) || 0) + segment.hours));
  }
  const projectRows = projects.map(project => {
    const decorated = decorateProjectForUser(project, user);
    const projectMemberships = memberships.filter(row => Number(row.projectId) === Number(project.id));
    const membershipStarts = projectMemberships.map(row => row.effectiveFrom).filter(isIsoDate).sort();
    const membershipEnds = projectMemberships.map(row => row.effectiveTo).filter(isIsoDate).sort();
    return {
      ...decorated,
      timelineStart: isIsoDate(project.startDate) ? project.startDate : membershipStarts[0] || startDate,
      timelineEnd: isIsoDate(project.endDate) ? project.endDate : membershipEnds.at(-1) || endDate,
      pendingEnd: project.endDate === '待定',
      hours: hoursByProject.get(project.id) || 0,
    };
  });
  res.json({ startDate, endDate, granularity: 'week', projects: projectRows, segments });
});

// Import project allocations from an Excel spreadsheet (项目分配表).
router.post('/preview-allocations', requireAnyRole('admin'), upload.single('file'), (req, res) => {
  let uploadedPath = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    uploadedPath = req.file.path;
    res.json(previewAllocationImport(uploadedPath, {
      year: req.body.year,
      sourceName: req.file.originalname,
    }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    if (uploadedPath) { try { fs.unlinkSync(uploadedPath); } catch {} }
  }
});

router.post('/import-allocations', requireAnyRole('admin'), upload.single('file'), (req, res) => {
  let uploadedPath = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    uploadedPath = req.file.path;
    const result = importAllocations(uploadedPath, {
      year: req.body.year,
      sourceName: req.file.originalname,
      resolutions: req.body.resolutions ? JSON.parse(req.body.resolutions) : {},
    });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    if (uploadedPath) {
      try { fs.unlinkSync(uploadedPath); } catch {}
    }
  }
});

// Wraps output rows to look like { ...pm, Employee: {...} } for the frontend.
function decorateMembership(row) {
  const { empName, empDepartment, empPosition, empTeam, ...pm } = row;
  return {
    ...pm,
    Employee: { id: pm.employeeId, name: empName, department: empDepartment, position: empPosition, team: empTeam },
  };
}

router.post('/', requireAnyRole('admin', 'leader', 'team_leader'), (req, res) => {
  try {
    const { members = [], ...rest } = req.body;
    if (!rest.name || !String(rest.name).trim()) return res.status(400).json({ error: 'name is required' });
    rest.name = String(rest.name).trim();
    rest.code = String(rest.code || '').trim() || null;
    if (!isIsoDate(rest.startDate)) return res.status(400).json({ error: '请选择项目开始时间' });
    if (!isExpectedEndDate(rest.endDate)) return res.status(400).json({ error: '请选择预计完成时间，或填写待定' });
    rest.team = creationTeam(req.auth.user, rest.team);
    const duplicate = db.prepare("SELECT id FROM projects WHERE name=? AND status NOT IN ('merged','placeholder','deleted')").get(rest.name);
    if (duplicate) return res.status(400).json({ error: '项目名单中已有同名项目' });
    const duplicateCode = rest.code && db.prepare("SELECT id FROM projects WHERE code=? COLLATE NOCASE AND status NOT IN ('merged','placeholder','deleted')").get(rest.code);
    if (duplicateCode) return res.status(400).json({ error: '项目名单中已有相同单号' });
    const isAdmin = hasRole(req.auth.user, 'admin');
    const safeRest = isAdmin ? rest : {
      code: rest.code, name: rest.name, team: rest.team,
      startDate: rest.startDate, endDate: rest.endDate,
    };
    const createProject = db.transaction(() => {
      const project = Project.create(safeRest);
      const today = dayjs().format('YYYY-MM-DD');
      for (const m of isAdmin ? members : []) {
        ProjectMembership.create({
          projectId: project.id, employeeId: m.employeeId,
          weight: m.weight ?? 1.0, role: m.role ?? 'member',
          effectiveFrom: m.effectiveFrom || today,
        });
      }
      return project;
    });
    const project = createProject();
    req.audit('project_created', 'project', project.id, { code: project.code, name: project.name, team: project.team });
    res.json(project);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', requireAnyRole('admin', 'leader', 'team_leader'), (req, res) => {
  const p = Project.find(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const isAdmin = hasRole(req.auth.user, 'admin');
  if (!isAdmin && !canRenameProject(req.auth.user, p)) {
    return res.status(403).json({ error: '只能修改本组项目名称' });
  }
  if (!isAdmin && Object.keys(req.body || {}).some(key => !['name', 'code', 'startDate', 'endDate', 'completionPercent'].includes(key))) {
    return res.status(403).json({ error: '组长和VIP只能维护项目名称、单号、时间和进度' });
  }
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: '项目名称不能为空' });
    const duplicate = db.prepare("SELECT id FROM projects WHERE name=? AND id<>? AND status NOT IN ('merged','placeholder','deleted')").get(name, p.id);
    if (duplicate) return res.status(400).json({ error: '已有同名项目，请使用其他名称或先处理重复项目' });
    req.body.name = name;
  }
  if (req.body.code !== undefined) {
    const code = String(req.body.code || '').trim() || null;
    const duplicateCode = code && db.prepare("SELECT id FROM projects WHERE code=? COLLATE NOCASE AND id<>? AND status NOT IN ('merged','placeholder','deleted')").get(code, p.id);
    if (duplicateCode) return res.status(400).json({ error: '已有相同项目单号' });
    req.body.code = code;
  }
  if (req.body.startDate !== undefined && !isIsoDate(req.body.startDate)) {
    return res.status(400).json({ error: '请选择项目开始时间' });
  }
  if (req.body.endDate !== undefined && !isExpectedEndDate(req.body.endDate)) {
    return res.status(400).json({ error: '预计完成时间应为日期或待定' });
  }
  if (req.body.completionPercent !== undefined) {
    const completion = Number(req.body.completionPercent);
    if (!Number.isFinite(completion) || completion < 0 || completion > 100) {
      return res.status(400).json({ error: '项目完成百分比必须在 0 到 100 之间' });
    }
    req.body.completionPercent = completion;
  }
  const updateProject = db.transaction(() => {
    const updated = Project.update(req.params.id, req.body);
    if (req.body.name !== undefined && req.body.name !== p.name) {
      db.prepare('UPDATE weekly_report_items SET projectName=? WHERE projectId=?').run(req.body.name, p.id);
    }
    return updated;
  });
  const updated = updateProject();
  if (req.body.name !== undefined && req.body.name !== p.name) {
    req.audit('project_renamed', 'project', p.id, { from: p.name, to: req.body.name });
  }
  if (req.body.code !== undefined && req.body.code !== p.code) {
    req.audit('project_code_changed', 'project', p.id, { from: p.code, to: req.body.code });
  }
  if (req.body.completionPercent !== undefined && Number(req.body.completionPercent) !== Number(p.completionPercent || 0)) {
    req.audit('project_progress_changed', 'project', p.id, { from: Number(p.completionPercent || 0), to: Number(req.body.completionPercent) });
  }
  res.json(updated);
});

router.post('/:id/merge', requireAnyRole('admin', 'leader', 'team_leader'), (req, res) => {
  const source = Project.find(req.params.id);
  const target = Project.find(Number(req.body.targetProjectId));
  if (!source || !isVisibleProject(source)) return res.status(404).json({ error: '待合并项目不存在' });
  if (!target || !isVisibleProject(target)) return res.status(400).json({ error: '请选择有效的目标项目' });
  if (source.id === target.id) return res.status(400).json({ error: '不能合并到项目自身' });
  if (!canRenameProject(req.auth.user, source) || !canRenameProject(req.auth.user, target)) {
    return res.status(403).json({ error: '组长只能合并本组项目' });
  }
  db.transaction(() => {
    db.prepare('UPDATE project_memberships SET projectId=? WHERE projectId=?').run(target.id, source.id);
    const membershipGroups = db.prepare(`SELECT employeeId, effectiveFrom, COALESCE(effectiveTo,'') AS effectiveTo,
      COALESCE(role,'') AS role, GROUP_CONCAT(id) AS ids, SUM(weight) AS totalWeight
      FROM project_memberships WHERE projectId=?
      GROUP BY employeeId, effectiveFrom, COALESCE(effectiveTo,''), COALESCE(role,'') HAVING COUNT(*)>1`).all(target.id);
    for (const group of membershipGroups) {
      const ids = String(group.ids).split(',').map(Number);
      db.prepare('UPDATE project_memberships SET weight=? WHERE id=?').run(group.totalWeight, ids[0]);
      for (const id of ids.slice(1)) db.prepare('DELETE FROM project_memberships WHERE id=?').run(id);
    }
    db.prepare('UPDATE weekly_report_items SET projectId=?, projectName=? WHERE projectId=?')
      .run(target.id, target.name, source.id);
    const reportGroups = db.prepare(`SELECT reportId, period, GROUP_CONCAT(id) AS ids, SUM(weight) AS totalWeight
      FROM weekly_report_items WHERE projectId=? GROUP BY reportId, period HAVING COUNT(*)>1`).all(target.id);
    for (const group of reportGroups) {
      const ids = String(group.ids).split(',').map(Number);
      db.prepare('UPDATE weekly_report_items SET weight=?, projectName=? WHERE id=?').run(group.totalWeight, target.name, ids[0]);
      for (const id of ids.slice(1)) db.prepare('DELETE FROM weekly_report_items WHERE id=?').run(id);
    }
    Project.update(source.id, { status: 'merged' });
  })();
  req.audit('project_merged', 'project', source.id, { from: source.name, targetProjectId: target.id, target: target.name });
  res.json({ ok: true, target: decorateProjectForUser(Project.find(target.id), req.auth.user) });
});

router.delete('/:id', requireAnyRole('admin', 'leader', 'team_leader'), (req, res) => {
  const project = Project.find(req.params.id);
  if (!project || !isVisibleProject(project)) return res.status(404).json({ error: 'not found' });
  if (!canRenameProject(req.auth.user, project)) return res.status(403).json({ error: '组长只能删除本组项目' });
  Project.update(project.id, { status: 'deleted' });
  req.audit('project_deleted', 'project', project.id, { name: project.name, preservedHistory: true });
  res.json({ ok: true });
});

router.get('/:id/members', (req, res) => {
  const today = dayjs().format('YYYY-MM-DD');
  res.json(ProjectMembership.activeForProject(req.params.id, today)
    .map(decorateMembership)
    .filter(row => canViewEmployee(req.auth.user, row.Employee)));
});

router.get('/:id/history', (req, res) => {
  res.json(ProjectMembership.historyForProject(req.params.id)
    .map(decorateMembership)
    .filter(row => canViewEmployee(req.auth.user, row.Employee)));
});

router.post('/:id/members', requireAnyRole('admin'), (req, res) => {
  const { employeeId, weight = 1.0, role = 'member', effectiveFrom } = req.body;
  const today = effectiveFrom || dayjs().format('YYYY-MM-DD');
  const created = ProjectMembership.create({
    projectId: Number(req.params.id), employeeId, weight, role, effectiveFrom: today,
  });
  res.json(created);
});

// Weight change → close the old row (effectiveTo = yesterday), open a new one from today.
router.post('/:id/members/:membershipId/weight', requireAnyRole('admin'), (req, res) => {
  const { weight, effectiveFrom } = req.body;
  const m = ProjectMembership.find(req.params.membershipId);
  if (!m || m.projectId !== Number(req.params.id)) return res.status(404).json({ error: 'not found' });
  if (!Number.isFinite(Number(weight)) || Number(weight) <= 0) {
    return res.status(400).json({ error: 'weight must be greater than 0' });
  }
  const today = effectiveFrom || dayjs().format('YYYY-MM-DD');
  if (!isIsoDate(today)) {
    return res.status(400).json({ error: 'invalid effectiveFrom date' });
  }

  const tx = db.transaction(() => {
    ProjectMembership.update(m.id, {
      effectiveTo: dayjs(today).subtract(1, 'day').format('YYYY-MM-DD'),
    });
    return ProjectMembership.create({
      employeeId: m.employeeId, projectId: m.projectId,
      weight: Number(weight), role: m.role, effectiveFrom: today, note: 'weight adjust',
    });
  });
  res.json(tx());
});

router.delete('/:id/members/:membershipId', requireAnyRole('admin'), (req, res) => {
  const m = ProjectMembership.find(req.params.membershipId);
  if (!m || m.projectId !== Number(req.params.id)) return res.status(404).json({ error: 'not found' });
  ProjectMembership.update(m.id, { effectiveTo: dayjs().format('YYYY-MM-DD') });
  res.json({ ok: true });
});

module.exports = router;

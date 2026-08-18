const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const { db, Project, ProjectMembership } = require('../models');
const { aggregateProjectHours } = require('../services/allocation');
const { round2, summarizeResourceGraph } = require('../services/analytics');
const { importAllocations, previewAllocationImport } = require('../services/allocation-import');
const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  return dayjs(value).format('YYYY-MM-DD') === value;
}

router.get('/', (req, res) => res.json(Project.all()));

// Overview: projects enriched with member names and total hours for a date range.
router.get('/overview', (req, res) => {
  const { startDate, endDate } = req.query;

  const projects = Project.all();
  const hoursRows = aggregateProjectHours({ startDate, endDate });
  const hoursMap = new Map(hoursRows.map(r => [r.projectId, r.hours]));
  const memberships = ProjectMembership.allWithNames({ startDate, endDate });

  // projectId → Map(empId → empName) to deduplicate across adjacent windows
  const memberMap = new Map();
  for (const m of memberships) {
    if (!memberMap.has(m.projectId)) memberMap.set(m.projectId, new Map());
    const empSet = memberMap.get(m.projectId);
    if (!empSet.has(m.employeeId)) empSet.set(m.employeeId, m.empName);
  }

  const result = projects.map(p => {
    const names = memberMap.get(p.id);
    const memberNames = names ? Array.from(names.values()) : [];
    return {
      ...p,
      memberCount: memberNames.length,
      memberNames,
      totalHours: round2(hoursMap.get(p.id) || 0),
    };
  });

  res.json(result);
});

router.get('/resource-graph', (req, res) => {
  res.json(summarizeResourceGraph(req.query));
});

// Import project allocations from an Excel spreadsheet (项目分配表).
router.post('/preview-allocations', upload.single('file'), (req, res) => {
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

router.post('/import-allocations', upload.single('file'), (req, res) => {
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

router.post('/', (req, res) => {
  try {
    const { members = [], ...rest } = req.body;
    if (!rest.name || !String(rest.name).trim()) return res.status(400).json({ error: 'name is required' });
    const createProject = db.transaction(() => {
      const project = Project.create(rest);
      const today = dayjs().format('YYYY-MM-DD');
      for (const m of members) {
        ProjectMembership.create({
          projectId: project.id, employeeId: m.employeeId,
          weight: m.weight ?? 1.0, role: m.role ?? 'member',
          effectiveFrom: m.effectiveFrom || today,
        });
      }
      return project;
    });
    const project = createProject();
    res.json(project);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', (req, res) => {
  const p = Project.find(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (req.body.completionPercent !== undefined) {
    const completion = Number(req.body.completionPercent);
    if (!Number.isFinite(completion) || completion < 0 || completion > 100) {
      return res.status(400).json({ error: '项目完成百分比必须在 0 到 100 之间' });
    }
    req.body.completionPercent = completion;
  }
  res.json(Project.update(req.params.id, req.body));
});

router.delete('/:id', (req, res) => {
  const project = Project.find(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });
  const removeProject = db.transaction(() => {
    db.prepare('DELETE FROM project_memberships WHERE projectId=?').run(project.id);
    Project.destroy(project.id);
  });
  removeProject();
  res.json({ ok: true });
});

router.get('/:id/members', (req, res) => {
  const today = dayjs().format('YYYY-MM-DD');
  res.json(ProjectMembership.activeForProject(req.params.id, today).map(decorateMembership));
});

router.get('/:id/history', (req, res) => {
  res.json(ProjectMembership.historyForProject(req.params.id).map(decorateMembership));
});

router.post('/:id/members', (req, res) => {
  const { employeeId, weight = 1.0, role = 'member', effectiveFrom } = req.body;
  const today = effectiveFrom || dayjs().format('YYYY-MM-DD');
  const created = ProjectMembership.create({
    projectId: Number(req.params.id), employeeId, weight, role, effectiveFrom: today,
  });
  res.json(created);
});

// Weight change → close the old row (effectiveTo = yesterday), open a new one from today.
router.post('/:id/members/:membershipId/weight', (req, res) => {
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

router.delete('/:id/members/:membershipId', (req, res) => {
  const m = ProjectMembership.find(req.params.membershipId);
  if (!m || m.projectId !== Number(req.params.id)) return res.status(404).json({ error: 'not found' });
  ProjectMembership.update(m.id, { effectiveTo: dayjs().format('YYYY-MM-DD') });
  res.json({ ok: true });
});

module.exports = router;

const express = require('express');
const dayjs = require('dayjs');
const { db, Project, ProjectMembership } = require('../models');
const router = express.Router();

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  return dayjs(value).format('YYYY-MM-DD') === value;
}

router.get('/', (req, res) => res.json(Project.all()));

// Wraps output rows to look like { ...pm, Employee: {...} } for the frontend.
function decorateMembership(row) {
  const { empName, empDepartment, empPosition, ...pm } = row;
  return {
    ...pm,
    Employee: { id: pm.employeeId, name: empName, department: empDepartment, position: empPosition },
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

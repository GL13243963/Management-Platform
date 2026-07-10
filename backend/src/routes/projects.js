const express = require('express');
const dayjs = require('dayjs');
const { db, Project, ProjectMembership } = require('../models');
const router = express.Router();

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
    const project = Project.create(rest);
    const today = dayjs().format('YYYY-MM-DD');
    for (const m of members) {
      ProjectMembership.create({
        projectId: project.id, employeeId: m.employeeId,
        weight: m.weight ?? 1.0, role: m.role ?? 'member',
        effectiveFrom: m.effectiveFrom || today,
      });
    }
    res.json(project);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', (req, res) => {
  const p = Project.find(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(Project.update(req.params.id, req.body));
});

router.delete('/:id', (req, res) => {
  Project.destroy(req.params.id);
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
  if (!m) return res.status(404).json({ error: 'not found' });
  const today = effectiveFrom || dayjs().format('YYYY-MM-DD');

  const tx = db.transaction(() => {
    ProjectMembership.update(m.id, {
      effectiveTo: dayjs(today).subtract(1, 'day').format('YYYY-MM-DD'),
    });
    return ProjectMembership.create({
      employeeId: m.employeeId, projectId: m.projectId,
      weight, role: m.role, effectiveFrom: today, note: 'weight adjust',
    });
  });
  res.json(tx());
});

router.delete('/:id/members/:membershipId', (req, res) => {
  const m = ProjectMembership.find(req.params.membershipId);
  if (!m) return res.status(404).json({ error: 'not found' });
  ProjectMembership.update(m.id, { effectiveTo: dayjs().format('YYYY-MM-DD') });
  res.json({ ok: true });
});

module.exports = router;

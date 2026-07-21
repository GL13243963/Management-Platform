const express = require('express');
const { db, Employee } = require('../models');
const router = express.Router();

router.get('/', (req, res) => res.json(Employee.all()));

router.post('/', (req, res) => {
  try { res.json(Employee.create(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', (req, res) => {
  const emp = Employee.find(req.params.id);
  if (!emp) return res.status(404).json({ error: 'not found' });
  res.json(Employee.update(req.params.id, req.body));
});

router.delete('/:id', (req, res) => {
  const emp = Employee.find(req.params.id);
  if (!emp) return res.status(404).json({ error: 'not found' });
  const attendanceCount = db.prepare('SELECT COUNT(*) AS count FROM attendance_logs WHERE employeeId=?').get(emp.id).count;
  const membershipCount = db.prepare('SELECT COUNT(*) AS count FROM project_memberships WHERE employeeId=?').get(emp.id).count;
  if (attendanceCount || membershipCount) {
    return res.status(409).json({
      error: '该员工已有考勤或项目历史，不能删除，可将其设为停用',
    });
  }
  Employee.destroy(emp.id);
  res.json({ ok: true });
});

module.exports = router;

const express = require('express');
const { Employee } = require('../models');
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
  Employee.destroy(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

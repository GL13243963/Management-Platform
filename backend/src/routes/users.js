const express = require('express');
const { db, Employee } = require('../models');
const { User, Session, AuditLog } = require('../models/auth');
const { requireAnyRole } = require('../middleware/auth');
const { validatePassword, hashPassword } = require('../services/password');

const router = express.Router();
const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
router.use(requireAnyRole('admin'));

router.get('/', (req, res) => res.json(User.all()));

router.post('/non-employee', asyncHandler(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const accountType = String(req.body?.accountType || '').trim();
  const temporaryPassword = String(req.body?.temporaryPassword || '');
  if (!username) return res.status(400).json({ error: '请输入登录姓名' });
  if (!['guest', 'vip'].includes(accountType)) return res.status(400).json({ error: '请选择访客或VIP身份' });
  if (User.findByUsername(username)) return res.status(409).json({ error: '该登录姓名已存在' });
  const validationError = validatePassword(temporaryPassword);
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    const user = User.create({
      username,
      passwordHash: await hashPassword(temporaryPassword),
      roles: [accountType === 'vip' ? 'leader' : 'guest'],
      mustChangePassword: true,
    });
    req.audit('non_employee_account_created', 'user', user.id, { username, accountType });
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

router.post('/sync-employees', asyncHandler(async (req, res) => {
  const temporaryPassword = String(req.body?.temporaryPassword || '');
  const validationError = validatePassword(temporaryPassword);
  if (validationError) return res.status(400).json({ error: validationError });
  const existingEmployeeIds = new Set(db.prepare('SELECT employeeId FROM users WHERE employeeId IS NOT NULL').all().map(row => row.employeeId));
  const employees = Employee.all().filter(employee => employee.active && !existingEmployeeIds.has(employee.id));
  const accountRows = await Promise.all(employees.map(async employee => ({
    employee,
    passwordHash: await hashPassword(temporaryPassword),
  })));
  const created = [];
  try {
    db.transaction(() => {
      for (const row of accountRows) {
        const roles = row.employee.personnelVisible ? ['employee'] : ['leader'];
        created.push(User.create({ employeeId: row.employee.id, username: row.employee.name, passwordHash: row.passwordHash, roles }));
      }
    })();
  } catch (error) {
    return res.status(409).json({ error: `创建账号失败：${error.message}` });
  }
  req.audit('accounts_synced', 'user', null, { created: created.length });
  res.json({ created, count: created.length });
}));

router.put('/:id/roles', (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = User.public(id);
    if (!current) return res.status(404).json({ error: '账号不存在' });
    const requestedRoles = Array.isArray(req.body?.roles) ? req.body.roles.map(item => typeof item === 'string' ? item : item?.role) : [];
    if (!current.employeeId && requestedRoles.some(role => !['guest', 'leader'].includes(role))) {
      return res.status(400).json({ error: '非员工账号只能设置为访客或VIP' });
    }
    const keepsAdmin = Array.isArray(req.body?.roles) && req.body.roles.some(item => (typeof item === 'string' ? item : item?.role) === 'admin');
    if (current.roles.some(item => item.role === 'admin') && !keepsAdmin) {
      const adminCount = db.prepare(`SELECT COUNT(DISTINCT u.id) AS count FROM users u
        JOIN user_roles r ON r.userId=u.id WHERE u.active=1 AND r.role='admin'`).get().count;
      if (adminCount <= 1) return res.status(400).json({ error: '必须至少保留一个启用的管理员账号' });
    }
    const user = User.setRoles(id, req.body?.roles);
    if (!user) return res.status(404).json({ error: '账号不存在' });
    req.audit('roles_changed', 'user', user.id, { roles: user.roles });
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/reset-password', asyncHandler(async (req, res) => {
  const user = User.find(Number(req.params.id));
  if (!user) return res.status(404).json({ error: '账号不存在' });
  const temporaryPassword = String(req.body?.temporaryPassword || '');
  const validationError = validatePassword(temporaryPassword);
  if (validationError) return res.status(400).json({ error: validationError });
  User.setPassword(user.id, await hashPassword(temporaryPassword), true);
  Session.deleteForUser(user.id);
  req.audit('password_reset', 'user', user.id);
  res.json({ ok: true, user: User.public(user.id) });
}));

router.post('/:id/unlock', (req, res) => {
  const user = User.unlock(Number(req.params.id));
  if (!user) return res.status(404).json({ error: '账号不存在' });
  req.audit('account_unlocked', 'user', user.id);
  res.json(user);
});

router.put('/:id/active', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.auth.user.id && req.body?.active === false) return res.status(400).json({ error: '不能停用当前登录账号' });
  const current = User.public(id);
  if (!current) return res.status(404).json({ error: '账号不存在' });
  if (req.body?.active === false && current.roles.some(item => item.role === 'admin')) {
    const adminCount = db.prepare(`SELECT COUNT(DISTINCT u.id) AS count FROM users u
      JOIN user_roles r ON r.userId=u.id WHERE u.active=1 AND r.role='admin'`).get().count;
    if (adminCount <= 1) return res.status(400).json({ error: '必须至少保留一个启用的管理员账号' });
  }
  const user = User.setActive(id, req.body?.active !== false);
  req.audit(user.active ? 'account_enabled' : 'account_disabled', 'user', user.id);
  res.json(user);
});

router.get('/audit/recent', (req, res) => res.json(AuditLog.recent(req.query.limit)));

module.exports = router;

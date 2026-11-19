const express = require('express');
const { User, Session, AuditLog } = require('../models/auth');
const {
  validatePassword, hashPassword, verifyPassword, createSessionToken, hashSessionToken,
} = require('../services/password');
const {
  authenticate, setSessionCookie, clearSessionCookie, clientIp,
} = require('../middleware/auth');

const router = express.Router();
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.post('/login', asyncHandler(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const user = User.findByUsername(username);
  const genericError = { error: '姓名或密码不正确', code: 'INVALID_CREDENTIALS' };

  if (!user || !user.active) {
    AuditLog.create({ username, action: 'login_failed', details: { reason: 'invalid_account' }, ipAddress: clientIp(req) });
    return res.status(401).json(genericError);
  }

  if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
    AuditLog.create({ userId: user.id, username: user.username, action: 'login_blocked', ipAddress: clientIp(req) });
    return res.status(423).json({ error: '密码连续输错5次，账号已暂时锁定', code: 'ACCOUNT_LOCKED', lockedUntil: user.lockedUntil });
  }
  if (user.lockedUntil) User.unlock(user.id);

  if (!await verifyPassword(password, user.passwordHash)) {
    const failure = User.recordLoginFailure(user.id);
    AuditLog.create({ userId: user.id, username: user.username, action: 'login_failed', details: { failures: failure.failures }, ipAddress: clientIp(req) });
    if (failure.lockedUntil) {
      return res.status(423).json({ error: '密码连续输错5次，账号已暂时锁定15分钟', code: 'ACCOUNT_LOCKED', lockedUntil: failure.lockedUntil });
    }
    return res.status(401).json(genericError);
  }

  User.recordLoginSuccess(user.id);
  Session.prune();
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
  Session.create({
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt,
    ipAddress: clientIp(req),
    userAgent: req.get('user-agent'),
  });
  setSessionCookie(res, token, SESSION_MAX_AGE_MS);
  AuditLog.create({ userId: user.id, username: user.username, action: 'login_success', ipAddress: clientIp(req) });
  res.json({ user: User.public(user.id), expiresAt });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: req.auth.user }));

router.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const user = User.find(req.auth.user.id);
  if (!await verifyPassword(currentPassword, user.passwordHash)) {
    return res.status(400).json({ error: '当前密码不正确', code: 'CURRENT_PASSWORD_INVALID' });
  }
  const validationError = validatePassword(newPassword);
  if (validationError) return res.status(400).json({ error: validationError, code: 'PASSWORD_TOO_WEAK' });
  if (await verifyPassword(newPassword, user.passwordHash)) {
    return res.status(400).json({ error: '新密码不能与临时密码或当前密码相同', code: 'PASSWORD_UNCHANGED' });
  }
  const passwordHash = await hashPassword(newPassword);
  User.setPassword(user.id, passwordHash, false);
  Session.deleteForUser(user.id, req.auth.sessionId);
  req.audit('password_changed', 'user', user.id);
  res.json({ ok: true, user: User.public(user.id) });
}));

router.post('/logout', authenticate, (req, res) => {
  Session.delete(req.auth.sessionId);
  req.audit('logout', 'session', req.auth.sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

module.exports = router;

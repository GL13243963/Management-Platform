const { User, Session, AuditLog } = require('../models/auth');
const { hashSessionToken } = require('../services/password');

const COOKIE_NAME = 'management_session';

function parseCookies(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}

function authenticate(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: '请先登录', code: 'AUTH_REQUIRED' });
  const session = Session.findByTokenHash(hashSessionToken(token));
  if (!session || !session.active || Date.parse(session.expiresAt) <= Date.now()) {
    if (session) Session.delete(session.id);
    clearSessionCookie(res);
    return res.status(401).json({ error: '登录已失效，请重新登录', code: 'SESSION_EXPIRED' });
  }
  req.auth = { sessionId: session.id, user: User.public(session.userId) };
  req.audit = (action, entityType, entityId, details) => AuditLog.create({
    userId: req.auth.user.id,
    username: req.auth.user.username,
    action, entityType, entityId, details,
    ipAddress: clientIp(req),
  });
  next();
}

function requireChangedPassword(req, res, next) {
  if (req.auth?.user?.mustChangePassword) {
    return res.status(403).json({ error: '首次登录必须先修改密码', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  next();
}

function hasRole(user, role, team) {
  return !!user?.roles?.some(item => item.role === role && (!team || item.team === team));
}

function requireAnyRole(...roles) {
  return (req, res, next) => {
    if (roles.some(role => hasRole(req.auth?.user, role))) return next();
    return res.status(403).json({ error: '没有权限执行此操作', code: 'FORBIDDEN' });
  };
}

function teamLeaderTeams(user) {
  return (user?.roles || []).filter(item => item.role === 'team_leader').map(item => item.team);
}

function canViewAllPeople(user) {
  return hasRole(user, 'admin') || hasRole(user, 'leader');
}

function canViewEmployee(user, employee) {
  if (!employee) return false;
  if (canViewAllPeople(user)) return true;
  if (Number(user?.employeeId) === Number(employee.id)) return true;
  return teamLeaderTeams(user).includes(employee.team);
}

function setSessionCookie(res, token, maxAgeMs) {
  const secureEnabled = process.env.COOKIE_SECURE === 'true'
    || (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false');
  const secure = secureEnabled ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`);
}

function clearSessionCookie(res) {
  const secureEnabled = process.env.COOKIE_SECURE === 'true'
    || (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false');
  const secure = secureEnabled ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

module.exports = {
  COOKIE_NAME, authenticate, requireChangedPassword, requireAnyRole, hasRole,
  teamLeaderTeams, canViewAllPeople, canViewEmployee,
  setSessionCookie, clearSessionCookie, clientIp,
};

const crypto = require('node:crypto');
const db = require('../db');

const VALID_ROLES = new Set(['admin', 'team_leader', 'leader', 'employee', 'guest']);
const VALID_TEAMS = new Set(['', '方案组', '规划组']);

function rolesForUser(userId) {
  return db.prepare('SELECT role, team FROM user_roles WHERE userId=? ORDER BY id').all(userId);
}

function publicUser(row) {
  if (!row) return null;
  const employee = row.employeeId
    ? db.prepare('SELECT id, name, team, active FROM employees WHERE id=?').get(row.employeeId)
    : null;
  return {
    id: row.id,
    employeeId: row.employeeId || null,
    username: row.username,
    mustChangePassword: !!row.mustChangePassword,
    active: !!row.active,
    lockedUntil: row.lockedUntil || null,
    lastLoginAt: row.lastLoginAt || null,
    employee: employee ? { ...employee, active: !!employee.active } : null,
    roles: rolesForUser(row.id),
  };
}

function normalizeRoles(roles) {
  const normalized = [];
  for (const item of Array.isArray(roles) ? roles : []) {
    const role = typeof item === 'string' ? item : item?.role;
    const team = role === 'team_leader' ? String(item?.team || '') : '';
    if (!VALID_ROLES.has(role)) throw new Error(`不支持的角色: ${role || '空'}`);
    if (!VALID_TEAMS.has(team)) throw new Error(`不支持的小组: ${team}`);
    if (role === 'team_leader' && !team) throw new Error('组长角色必须指定方案组或规划组');
    if (!normalized.some(value => value.role === role && value.team === team)) normalized.push({ role, team });
  }
  if (!normalized.length) throw new Error('账号至少需要一个角色');
  if (normalized.some(value => value.role === 'guest') && normalized.length > 1) {
    throw new Error('访客身份不能与其他身份同时设置');
  }
  return normalized;
}

const User = {
  find(id) { return db.prepare('SELECT * FROM users WHERE id=?').get(id); },
  findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(String(username || '').trim());
  },
  public(id) { return publicUser(this.find(id)); },
  all() { return db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all().map(publicUser); },
  create({ employeeId, username, passwordHash, roles = ['employee'], mustChangePassword = true }) {
    const cleanUsername = String(username || '').trim();
    if (!cleanUsername) throw new Error('登录姓名不能为空');
    const normalizedRoles = normalizeRoles(roles);
    return db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO users (employeeId, username, passwordHash, mustChangePassword)
        VALUES (?, ?, ?, ?)
      `).run(employeeId || null, cleanUsername, passwordHash, mustChangePassword ? 1 : 0);
      const userId = Number(info.lastInsertRowid);
      const insertRole = db.prepare('INSERT INTO user_roles (userId, role, team) VALUES (?, ?, ?)');
      for (const role of normalizedRoles) insertRole.run(userId, role.role, role.team);
      return this.public(userId);
    })();
  },
  setRoles(id, roles) {
    const normalizedRoles = normalizeRoles(roles);
    return db.transaction(() => {
      db.prepare('DELETE FROM user_roles WHERE userId=?').run(id);
      const insert = db.prepare('INSERT INTO user_roles (userId, role, team) VALUES (?, ?, ?)');
      for (const role of normalizedRoles) insert.run(id, role.role, role.team);
      return this.public(id);
    })();
  },
  setPassword(id, passwordHash, mustChangePassword) {
    db.prepare(`UPDATE users SET passwordHash=?, mustChangePassword=?, failedLoginCount=0,
      lockedUntil=NULL, updatedAt=datetime('now','localtime') WHERE id=?`
    ).run(passwordHash, mustChangePassword ? 1 : 0, id);
    return this.public(id);
  },
  setActive(id, active) {
    db.prepare(`UPDATE users SET active=?, updatedAt=datetime('now','localtime') WHERE id=?`).run(active ? 1 : 0, id);
    if (!active) Session.deleteForUser(id);
    return this.public(id);
  },
  recordLoginFailure(id, now = new Date()) {
    const user = this.find(id);
    if (!user) return null;
    const failures = Number(user.failedLoginCount || 0) + 1;
    const lockedUntil = failures >= 5 ? new Date(now.getTime() + 15 * 60 * 1000).toISOString() : null;
    db.prepare(`UPDATE users SET failedLoginCount=?, lockedUntil=?, updatedAt=datetime('now','localtime') WHERE id=?`)
      .run(failures, lockedUntil, id);
    return { failures, lockedUntil };
  },
  recordLoginSuccess(id, now = new Date()) {
    db.prepare(`UPDATE users SET failedLoginCount=0, lockedUntil=NULL, lastLoginAt=?,
      updatedAt=datetime('now','localtime') WHERE id=?`).run(now.toISOString(), id);
  },
  unlock(id) {
    db.prepare(`UPDATE users SET failedLoginCount=0, lockedUntil=NULL,
      updatedAt=datetime('now','localtime') WHERE id=?`).run(id);
    return this.public(id);
  },
};

const Session = {
  create({ userId, tokenHash, expiresAt, ipAddress, userAgent }) {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO sessions (id, userId, tokenHash, expiresAt, createdAt, ipAddress, userAgent)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, tokenHash, expiresAt, createdAt, ipAddress || null, userAgent || null);
    return { id, expiresAt, createdAt };
  },
  findByTokenHash(tokenHash) {
    return db.prepare(`SELECT s.*, u.employeeId, u.username, u.passwordHash, u.mustChangePassword,
      u.active, u.failedLoginCount, u.lockedUntil, u.lastLoginAt
      FROM sessions s JOIN users u ON u.id=s.userId WHERE s.tokenHash=?`).get(tokenHash);
  },
  delete(id) { return db.prepare('DELETE FROM sessions WHERE id=?').run(id); },
  deleteForUser(userId, exceptId = null) {
    if (exceptId) return db.prepare('DELETE FROM sessions WHERE userId=? AND id<>?').run(userId, exceptId);
    return db.prepare('DELETE FROM sessions WHERE userId=?').run(userId);
  },
  prune(now = new Date()) { return db.prepare('DELETE FROM sessions WHERE expiresAt<=?').run(now.toISOString()); },
};

const AuditLog = {
  create({ userId, username, action, entityType, entityId, details, ipAddress }) {
    return db.prepare(`INSERT INTO audit_logs
      (userId, username, action, entityType, entityId, details, ipAddress)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(userId || null, username || null, action, entityType || null, entityId == null ? null : String(entityId),
      details == null ? null : JSON.stringify(details), ipAddress || null);
  },
  recent(limit = 200) {
    return db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(Math.min(1000, Math.max(1, Number(limit) || 200)));
  },
};

module.exports = { VALID_ROLES, User, Session, AuditLog, publicUser };

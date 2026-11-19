const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'management-platform-auth-'));
process.env.APP_DB_PATH = path.join(testDir, 'app.db');
process.env.NODE_ENV = 'test';

const { db, Employee, Project } = require('../src/models');
const { User } = require('../src/models/auth');
const { validatePassword, hashPassword, verifyPassword } = require('../src/services/password');
const app = require('../src/index');

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.raw.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

async function request(url, { cookie, ...options } = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  return fetch(`${baseUrl}${url}`, { ...options, headers });
}

function sessionCookie(response) {
  return response.headers.get('set-cookie')?.split(';')[0];
}

test('password hashing validates the agreed minimum without storing plaintext', async () => {
  assert.equal(validatePassword('short1'), '密码至少需要8位');
  assert.equal(validatePassword('abcdefgh'), '密码必须同时包含字母和数字');
  assert.equal(validatePassword('Password8'), null);
  const encoded = await hashPassword('Password8');
  assert.match(encoded, /^scrypt\$/);
  assert.equal(encoded.includes('Password8'), false);
  assert.equal(await verifyPassword('Password8', encoded), true);
  assert.equal(await verifyPassword('WrongPass8', encoded), false);
});

test('first login requires a password change and then unlocks business APIs', async () => {
  const employee = Employee.create({ name: '首次登录员工', team: '方案组' });
  User.create({ employeeId: employee.id, username: employee.name, passwordHash: await hashPassword('Temporary8'), roles: ['employee'] });

  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: employee.name, password: 'Temporary8' }) });
  assert.equal(login.status, 200);
  const cookie = sessionCookie(login);
  assert.ok(cookie);
  const blocked = await request('/api/employees', { cookie });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, 'PASSWORD_CHANGE_REQUIRED');

  const changed = await request('/api/auth/change-password', { cookie, method: 'POST', body: JSON.stringify({ currentPassword: 'Temporary8', newPassword: 'NewPassword9' }) });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).user.mustChangePassword, false);
  const employees = await request('/api/employees', { cookie });
  assert.equal(employees.status, 200);
  assert.deepEqual((await employees.json()).map(item => item.name), ['首次登录员工']);
});

test('five failed passwords lock an account for fifteen minutes', async () => {
  const employee = Employee.create({ name: '锁定测试员工', team: '规划组' });
  User.create({ employeeId: employee.id, username: employee.name, passwordHash: await hashPassword('CorrectPass8'), roles: ['employee'], mustChangePassword: false });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: employee.name, password: 'WrongPass8' }) });
    assert.equal(response.status, 401);
  }
  const locked = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: employee.name, password: 'WrongPass8' }) });
  assert.equal(locked.status, 423);
  assert.equal((await locked.json()).code, 'ACCOUNT_LOCKED');
  const correctButLocked = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: employee.name, password: 'CorrectPass8' }) });
  assert.equal(correctButLocked.status, 423);
});

test('team leaders see their team while ordinary employees only see themselves', async () => {
  const schemeLeaderEmployee = Employee.create({ name: '方案组长测试', team: '方案组' });
  const planningEmployee = Employee.create({ name: '规划员工测试', team: '规划组' });
  const passwordHash = await hashPassword('RoleTest88');
  User.create({ employeeId: schemeLeaderEmployee.id, username: schemeLeaderEmployee.name, passwordHash, roles: [{ role: 'team_leader', team: '方案组' }], mustChangePassword: false });
  User.create({ employeeId: planningEmployee.id, username: planningEmployee.name, passwordHash, roles: ['employee'], mustChangePassword: false });

  const leaderLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: schemeLeaderEmployee.name, password: 'RoleTest88' }) });
  const leaderRows = await request('/api/employees', { cookie: sessionCookie(leaderLogin) });
  assert.deepEqual((await leaderRows.json()).map(item => item.name).sort(), ['方案组长测试', '首次登录员工']);

  const employeeLogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: planningEmployee.name, password: 'RoleTest88' }) });
  const employeeCookie = sessionCookie(employeeLogin);
  const employeeRows = await request('/api/employees', { cookie: employeeCookie });
  assert.deepEqual((await employeeRows.json()).map(item => item.name), ['规划员工测试']);
  const attendanceForbidden = await request('/api/attendance', { cookie: employeeCookie });
  assert.equal(attendanceForbidden.status, 403);
  const forbidden = await request('/api/employees', { cookie: employeeCookie, method: 'POST', body: JSON.stringify({ name: '越权创建' }) });
  assert.equal(forbidden.status, 403);
});

test('admin sync uses separate salts and cannot remove the final administrator', async () => {
  const adminEmployee = Employee.create({ name: '唯一管理员', team: '方案组' });
  const adminPasswordHash = await hashPassword('AdminPass88');
  const admin = User.create({
    employeeId: adminEmployee.id,
    username: adminEmployee.name,
    passwordHash: adminPasswordHash,
    roles: [{ role: 'admin' }, { role: 'team_leader', team: '方案组' }],
    mustChangePassword: false,
  });
  Employee.create({ name: '待建账号甲', team: '方案组' });
  Employee.create({ name: '待建账号乙', team: '规划组' });

  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: admin.username, password: 'AdminPass88' }) });
  const cookie = sessionCookie(login);
  const systemStatus = await request('/api/system/status', { cookie });
  assert.equal(systemStatus.status, 200);
  assert.ok((await systemStatus.json()).currentVersion);

  const project = Project.create({ name: '改名前项目' });
  const report = db.prepare('INSERT INTO weekly_reports (employeeId,weekStart) VALUES (?,?)').run(adminEmployee.id, '2026-08-31');
  db.prepare('INSERT INTO weekly_report_items (reportId,period,projectId,projectName,weight) VALUES (?,?,?,?,?)')
    .run(Number(report.lastInsertRowid), 'current', project.id, project.name, 1);
  const rename = await request(`/api/projects/${project.id}`, { cookie, method: 'PUT', body: JSON.stringify({ name: '改名后项目' }) });
  assert.equal(rename.status, 200);
  assert.equal(Project.find(project.id).name, '改名后项目');
  assert.equal(db.prepare('SELECT projectName FROM weekly_report_items WHERE projectId=?').get(project.id).projectName, '改名后项目');

  const sync = await request('/api/users/sync-employees', { cookie, method: 'POST', body: JSON.stringify({ temporaryPassword: 'SharedPass88' }) });
  assert.equal(sync.status, 200);
  assert.equal((await sync.json()).count, 2);
  const first = User.findByUsername('待建账号甲');
  const second = User.findByUsername('待建账号乙');
  assert.notEqual(first.passwordHash, second.passwordHash);
  assert.equal(await verifyPassword('SharedPass88', first.passwordHash), true);
  assert.equal(await verifyPassword('SharedPass88', second.passwordHash), true);

  const guestResponse = await request('/api/users/non-employee', { cookie, method: 'POST', body: JSON.stringify({ username: '外部访客', accountType: 'guest', temporaryPassword: 'GuestPass88' }) });
  assert.equal(guestResponse.status, 200);
  const guest = await guestResponse.json();
  assert.equal(guest.employeeId, null);
  assert.deepEqual(guest.roles, [{ role: 'guest', team: '' }]);
  const vipResponse = await request('/api/users/non-employee', { cookie, method: 'POST', body: JSON.stringify({ username: '外部VIP', accountType: 'vip', temporaryPassword: 'VipPass888' }) });
  assert.equal(vipResponse.status, 200);
  const vip = await vipResponse.json();
  assert.equal(vip.employeeId, null);
  assert.deepEqual(vip.roles, [{ role: 'leader', team: '' }]);
  const invalidRole = await request(`/api/users/${guest.id}/roles`, { cookie, method: 'PUT', body: JSON.stringify({ roles: [{ role: 'employee' }] }) });
  assert.equal(invalidRole.status, 400);

  const removeAdmin = await request(`/api/users/${admin.id}/roles`, { cookie, method: 'PUT', body: JSON.stringify({ roles: [{ role: 'employee' }] }) });
  assert.equal(removeAdmin.status, 400);
  assert.match((await removeAdmin.json()).error, /至少保留一个/);
});

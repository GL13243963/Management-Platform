const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'management-platform-tools-'));
process.env.APP_DB_PATH = path.join(testDir, 'app.db');
process.env.NODE_ENV = 'test';

const { db, Employee } = require('../src/models');
const { User } = require('../src/models/auth');
const { hashPassword } = require('../src/services/password');

let app;
let server;
let baseUrl;
let contributorCookie;
let developerCookie;
let developerId;

test.before(async () => {
  const contributor = Employee.create({ name: '工具贡献人', team: '方案组' });
  const developer = Employee.create({ name: '工具开发人', team: '规划组' });
  const passwordHash = await hashPassword('ToolMatrix88');
  User.create({ employeeId: contributor.id, username: contributor.name, passwordHash, roles: ['employee'], mustChangePassword: false });
  const developerUser = User.create({ employeeId: developer.id, username: developer.name, passwordHash, roles: ['employee'], mustChangePassword: false });
  developerId = developerUser.id;
  app = require('../src/index');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  contributorCookie = await login('工具贡献人');
  developerCookie = await login('工具开发人');
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.raw.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

async function login(username) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'ToolMatrix88' }) });
  return response.headers.get('set-cookie').split(';')[0];
}
function request(url, cookie, options = {}) {
  return fetch(`${baseUrl}${url}`, { ...options, headers: { cookie, ...(options.headers || {}) } });
}
function selfMadeForm(name = '团队自研测试工具') {
  const form = new FormData();
  form.append('name', name);
  form.append('englishName', 'TEAM TOOL');
  form.append('type', '小程序');
  form.append('source', '团队自研');
  form.append('scene', '效率办公');
  form.append('developerUserId', String(developerId));
  form.append('summary', '用于验证工具矩阵权限和排行榜。');
  form.append('functionDescription', '这是团队开发的测试工具。');
  form.append('usageSteps', '下载工具包\n阅读说明\n开始使用');
  form.append('versionDescription', 'v1.0 测试版');
  form.append('package', new Blob([Buffer.from('PK test')], { type: 'application/zip' }), 'team-tool.zip');
  return form;
}

test('seeded external developers do not appear on the team developer leaderboard', async () => {
  const response = await request('/api/tool-matrix/stats', contributorCookie);
  assert.equal(response.status, 200);
  const stats = await response.json();
  assert.equal(stats.totals.toolCount, 7);
  assert.deepEqual(stats.developers, []);
  assert.ok(!stats.contributors.some(item => item.name === '郭磊'));
  assert.ok(stats.topItems.every(item => item.contributorName !== '郭磊'));
});

test('team self-developed tool ranks its team developer and both parties can manage it', async () => {
  const created = await request('/api/tool-matrix', contributorCookie, { method: 'POST', body: selfMadeForm() });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const stats = await (await request('/api/tool-matrix/stats', contributorCookie)).json();
  assert.deepEqual(stats.developers[0], { name: '工具开发人', count: 1 });

  const contributorDetail = await (await request(`/api/tool-matrix/${id}`, contributorCookie)).json();
  const developerDetail = await (await request(`/api/tool-matrix/${id}`, developerCookie)).json();
  assert.equal(contributorDetail.canManage, true);
  assert.equal(developerDetail.canManage, true);

  const updated = await request(`/api/tool-matrix/${id}`, developerCookie, { method: 'PUT', body: selfMadeForm('开发人已修改') });
  assert.equal(updated.status, 200);
  assert.equal((await (await request(`/api/tool-matrix/${id}`, developerCookie)).json()).name, '开发人已修改');
});

test('favorite toggles and use actions update heat', async () => {
  const list = await (await request('/api/tool-matrix/items', contributorCookie)).json();
  const item = list.find(value => value.officialUrl);
  const favorite = await (await request(`/api/tool-matrix/${item.id}/favorite`, contributorCookie, { method: 'POST' })).json();
  assert.equal(favorite.favorited, true);
  assert.equal(favorite.heat, 3);
  const used = await (await request(`/api/tool-matrix/${item.id}/use`, contributorCookie, { method: 'POST' })).json();
  assert.equal(used.useCount, 1);
  const detail = await (await request(`/api/tool-matrix/${item.id}`, contributorCookie)).json();
  assert.equal(detail.heat, 4);
});

test('small utilities and plugins can be shared as direct downloads without an external link', async () => {
  const form = new FormData();
  form.append('name', '直接下载测试插件');
  form.append('type', '编辑器插件');
  form.append('source', '第三方工具');
  form.append('scene', '效率办公');
  form.append('developerName', '外部作者');
  form.append('summary', '验证只有文件也可以正常发布。');
  form.append('functionDescription', '这是一个用于验证直接下载入口的测试插件。');
  form.append('usageSteps', '下载插件包\n按说明安装');
  form.append('package', new Blob([Buffer.from('PK plugin')], { type: 'application/zip' }), 'plugin.zip');
  const created = await request('/api/tool-matrix', contributorCookie, { method: 'POST', body: form });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const detail = await (await request(`/api/tool-matrix/${id}`, contributorCookie)).json();
  assert.equal(detail.officialUrl, '');
  assert.equal(detail.packageName, 'plugin.zip');
  const download = await request(`/api/tool-matrix/${id}/package`, contributorCookie);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /plugin\.zip/);
});

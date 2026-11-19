const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'management-platform-gallery-'));
process.env.APP_DB_PATH = path.join(testDir, 'app.db');
process.env.NODE_ENV = 'test';

const { db, Employee, Project } = require('../src/models');
const { User } = require('../src/models/auth');
const { hashPassword } = require('../src/services/password');
const app = require('../src/index');

let server;
let baseUrl;
let cookie;
let guestCookie;

test.before(async () => {
  const employee = Employee.create({ name: '图榜测试员工', team: '方案组' });
  User.create({ employeeId: employee.id, username: employee.name, passwordHash: await hashPassword('GalleryPass8'), roles: ['employee'], mustChangePassword: false });
  User.create({ employeeId: null, username: '图榜访客', passwordHash: await hashPassword('GuestPass88'), roles: ['guest'], mustChangePassword: false });
  Project.create({ name: '图榜所属项目', team: '方案组' });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await request('/api/auth/login', { method: 'POST', json: { username: employee.name, password: 'GalleryPass8' } });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const guestLogin = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: '图榜访客', password: 'GuestPass88' }) });
  guestCookie = guestLogin.headers.get('set-cookie').split(';')[0];
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.raw.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

async function request(url, { json, headers = {}, ...options } = {}) {
  if (cookie) headers.cookie = cookie;
  if (json !== undefined) { headers['content-type'] = 'application/json'; options.body = JSON.stringify(json); }
  return fetch(`${baseUrl || ''}${url}`, { ...options, headers });
}

test('gallery seeds reference images and keeps details behind the open endpoint', async () => {
  const metaResponse = await request('/api/render-gallery/meta');
  assert.equal(metaResponse.status, 200);
  const meta = await metaResponse.json();
  assert.deepEqual(meta.categories, ['鸟瞰', '半鸟瞰', '人视', '室内', '分析图', '其他']);
  assert.ok(meta.platforms.includes('D5渲染'));
  assert.ok(meta.platforms.includes('LOVART'));

  const response = await request('/api/render-gallery/items');
  assert.equal(response.status, 200);
  const items = await response.json();
  assert.equal(items.length, 42);
  assert.equal('prompt' in items[0], false);
  assert.equal('platforms' in items[0], false);
  assert.equal('title' in items[0], false);

  const detailResponse = await request(`/api/render-gallery/${items[0].id}`);
  const detail = await detailResponse.json();
  assert.ok(detail.prompt);
  assert.ok(detail.platforms.length);
  assert.equal(detail.starCount, 0);
  const detailAgain = await request(`/api/render-gallery/${items[0].id}`);
  assert.equal((await detailAgain.json()).starCount, 0);
});

test('copy always adds a star while one account can like an image only once', async () => {
  const items = await (await request('/api/render-gallery/items')).json();
  const id = items[0].id;
  const firstLike = await (await request(`/api/render-gallery/${id}/like`, { method: 'POST' })).json();
  assert.equal(firstLike.added, true);
  assert.equal(firstLike.starCount, 1);
  const repeatedLike = await (await request(`/api/render-gallery/${id}/like`, { method: 'POST' })).json();
  assert.equal(repeatedLike.added, false);
  assert.equal(repeatedLike.starCount, 1);
  const firstCopy = await (await request(`/api/render-gallery/${id}/copy`, { method: 'POST' })).json();
  const secondCopy = await (await request(`/api/render-gallery/${id}/copy`, { method: 'POST' })).json();
  assert.equal(firstCopy.starCount, 2);
  assert.equal(secondCopy.starCount, 3);
});

test('employee uploads a multi-platform image with a parameter screenshot and project', async () => {
  const meta = await (await request('/api/render-gallery/meta')).json();
  const project = meta.projects.find(item => item.name === '图榜所属项目');
  const form = new FormData();
  form.append('image', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'work.jpg');
  form.append('parameterImage', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'parameters.png');
  form.append('title', '组合平台测试作品');
  form.append('platforms', JSON.stringify(['D5渲染', 'LOVART', '其他']));
  form.append('otherPlatform', '内部试验平台');
  form.append('category', '鸟瞰');
  form.append('projectId', String(project.id));
  form.append('isPractice', 'false');
  form.append('prompt', '组合平台测试 Prompt');
  const uploadResponse = await request('/api/render-gallery', { method: 'POST', body: form, headers: {} });
  assert.equal(uploadResponse.status, 201);
  const { id } = await uploadResponse.json();
  const detail = await (await request(`/api/render-gallery/${id}`)).json();
  assert.deepEqual(detail.platforms, ['D5渲染', 'LOVART', '内部试验平台']);
  assert.equal(detail.project, '图榜所属项目');
  assert.ok(detail.parameterImageUrl);
  assert.equal((await request(detail.imageUrl)).status, 200);
  assert.equal((await request(detail.parameterImageUrl)).status, 200);

  const stats = await (await request('/api/render-gallery/stats')).json();
  assert.equal(stats.platforms.find(item => item.platform === 'D5渲染').count, 1);
  assert.equal(stats.platforms.find(item => item.platform === 'LOVART').count, 1);
  assert.equal(stats.platforms.find(item => item.platform === '内部试验平台').count, 1);
  assert.equal(stats.latestItem.id, id);
  assert.equal(stats.latestItem.uploaderName, '图榜测试员工');
  assert.equal(typeof stats.topItems[0].uploaderName, 'string');
  assert.equal(typeof stats.topItems[0].authorStarCount, 'number');
  const talent = stats.topUploaders.find(item => item.name === '图榜测试员工');
  assert.equal(talent.score, talent.count + talent.starCount);
});

test('employee can upload more than two works in sequence', async () => {
  for (let index = 1; index <= 3; index += 1) {
    const form = new FormData();
    form.append('image', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), `sequence-${index}.jpg`);
    form.append('title', `连续上传作品${index}`);
    form.append('platforms', JSON.stringify(['D5渲染']));
    form.append('category', '人视');
    form.append('isPractice', 'true');
    form.append('prompt', `连续上传测试 ${index}`);
    const response = await request('/api/render-gallery', { method: 'POST', body: form, headers: {} });
    assert.equal(response.status, 201, `第${index}次上传应成功`);
  }
});

test('guest can browse, copy, like and enter the upload flow', async () => {
  const guestRequest = (url, options = {}) => fetch(`${baseUrl}${url}`, { ...options, headers: { cookie: guestCookie, ...(options.headers || {}) } });
  const listResponse = await guestRequest('/api/render-gallery/items');
  assert.equal(listResponse.status, 200);
  const [item] = await listResponse.json();
  assert.equal((await guestRequest(`/api/render-gallery/${item.id}`)).status, 200);
  assert.equal((await guestRequest(`/api/render-gallery/${item.id}/copy`, { method: 'POST' })).status, 200);
  assert.equal((await guestRequest(`/api/render-gallery/${item.id}/like`, { method: 'POST' })).status, 200);
  assert.equal((await guestRequest('/api/render-gallery', { method: 'POST' })).status, 400);
  const meta = await (await guestRequest('/api/render-gallery/meta')).json();
  assert.equal(meta.canUpload, true);
});

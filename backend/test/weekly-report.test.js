const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dayjs = require('dayjs');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'management-platform-weekly-'));
process.env.APP_DB_PATH = path.join(testDir, 'app.db');
process.env.NODE_ENV = 'test';

const { db, Employee, Project, ProjectMembership, AttendanceLog } = require('../src/models');
const { User } = require('../src/models/auth');
const { hashPassword } = require('../src/services/password');
const {
  mondayOf, validateWeekStart, diceSimilarity, saveReport, loadReport,
  previousPlan, listTeamReports,
} = require('../src/services/weekly-report');
const app = require('../src/index');

let server;
let baseUrl;
let schemeEmployee;
let planningEmployee;
let schemeLeader;
let vipUser;
let schemeProjectA;
let schemeProjectB;
let historyProject;

test.before(async () => {
  schemeEmployee = Employee.create({ name: '周报方案员工', team: '方案组' });
  planningEmployee = Employee.create({ name: '周报规划员工', team: '规划组' });
  const leaderEmployee = Employee.create({ name: '周报方案组长', team: '方案组' });
  schemeProjectA = Project.create({ code: 'TEST-A', name: '测试项目甲', team: '方案组' });
  schemeProjectB = Project.create({ code: 'TEST-B', name: '测试项目乙', team: '方案组' });
  historyProject = Project.create({ code: 'HISTORY-1', name: '历史项目', team: '方案组' });
  const passwordHash = await hashPassword('WeeklyPass8');
  User.create({ employeeId: schemeEmployee.id, username: schemeEmployee.name, passwordHash, roles: ['employee'], mustChangePassword: false });
  User.create({ employeeId: planningEmployee.id, username: planningEmployee.name, passwordHash, roles: ['employee'], mustChangePassword: false });
  schemeLeader = User.create({ employeeId: leaderEmployee.id, username: leaderEmployee.name, passwordHash, roles: [{ role: 'team_leader', team: '方案组' }, 'employee'], mustChangePassword: false });
  vipUser = User.create({ username: '周报VIP', passwordHash, roles: ['leader'], mustChangePassword: false });
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

async function login(username) {
  const response = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password: 'WeeklyPass8' }) });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('week boundaries use Monday and validate week starts', () => {
  assert.equal(mondayOf('2026-09-03'), '2026-08-31');
  assert.equal(validateWeekStart('2026-08-31'), true);
  assert.equal(validateWeekStart('2026-09-01'), false);
  assert.ok(diceSimilarity('滨江中心项目', '滨江中心方案') >= 0.6);
});

test('drafts may be incomplete while submission requires both totals to equal 1.0', () => {
  const weekStart = mondayOf();
  const draft = saveReport({
    employeeId: schemeEmployee.id,
    weekStart,
    items: [{ period: 'current', projectId: schemeProjectA.id, projectName: '测试项目甲', weight: 0.5 }],
    editorUserId: 1,
  });
  assert.equal(draft.status, 'draft');
  const teamRows = listTeamReports('方案组', weekStart);
  assert.equal(teamRows.find(row => row.employee.id === schemeEmployee.id).hasData, true);
  assert.equal(teamRows.find(row => row.employee.id !== schemeEmployee.id).hasData, false);
  assert.throws(() => saveReport({
    employeeId: schemeEmployee.id,
    weekStart,
    items: [{ period: 'current', projectId: schemeProjectA.id, projectName: '测试项目甲', weight: 1 }],
    submit: true,
    editorUserId: 1,
  }), /下周计划比例必须合计为1.0/);
});

test('submitted next-week plan becomes the following week current suggestion', () => {
  const weekStart = mondayOf();
  const report = saveReport({
    employeeId: schemeEmployee.id,
    weekStart,
    items: [
      { period: 'current', projectId: schemeProjectA.id, projectName: '测试项目甲', weight: 1 },
      { period: 'next', projectId: schemeProjectB.id, projectName: '测试项目乙', weight: 1 },
    ],
    submit: true,
    editorUserId: 1,
  });
  assert.equal(report.status, 'submitted');
  assert.equal(loadReport(schemeEmployee.id, weekStart).items.length, 2);
  const suggestion = previousPlan(schemeEmployee.id, dayjs(weekStart).add(7, 'day').format('YYYY-MM-DD'));
  assert.equal(suggestion.length, 1);
  assert.equal(suggestion[0].period, 'current');
  assert.equal(suggestion[0].projectName, '测试项目乙');
  const currentMemberships = ProjectMembership.activeForEmployee(schemeEmployee.id, weekStart);
  const nextMemberships = ProjectMembership.activeForEmployee(
    schemeEmployee.id,
    dayjs(weekStart).add(7, 'day').format('YYYY-MM-DD'),
  );
  assert.equal(currentMemberships.length, 1);
  assert.equal(nextMemberships.length, 1);
  assert.equal(Project.find(currentMemberships[0].projectId).name, '测试项目甲');
  assert.equal(Project.find(nextMemberships[0].projectId).name, '测试项目乙');
});

test('employee can see only their previous-month attendance reminder summary', async () => {
  let previousMonthDay = dayjs().subtract(1, 'month').startOf('month').add(1, 'day');
  while ([0, 6].includes(previousMonthDay.day())) previousMonthDay = previousMonthDay.add(1, 'day');
  const previousMonthDate = previousMonthDay.format('YYYY-MM-DD');
  AttendanceLog.upsert({
    employeeId: schemeEmployee.id, employeeName: schemeEmployee.name, date: previousMonthDate,
    clockIn: '09:00', clockOut: '21:30', workHours: 11.5, status: 'normal',
    isLate: false, isEarlyLeave: false, isMissedPunch: false,
  });
  AttendanceLog.upsert({
    employeeId: planningEmployee.id, employeeName: planningEmployee.name, date: previousMonthDate,
    clockIn: '10:00', clockOut: '18:00', workHours: 7, status: 'late',
    isLate: true, isEarlyLeave: false, isMissedPunch: false,
  });
  const cookie = await login(schemeEmployee.name);
  const response = await request('/api/weekly/my-attendance-summary', { cookie });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.hasData, true);
  assert.equal(body.summary.employeeId, schemeEmployee.id);
  assert.equal(body.summary.lateDays, 0);
  assert.equal(body.summary.overtimeHours, 0.5);
  assert.equal(body.updateDay, 20);
});

test('ordinary edits are blocked after Monday 18:00 while a leader can correct them', () => {
  const pastWeek = dayjs(mondayOf()).subtract(14, 'day').format('YYYY-MM-DD');
  const items = [
    { period: 'current', projectId: historyProject.id, projectName: '历史项目', weight: 1 },
    { period: 'next', projectName: '待安排', weight: 1 },
  ];
  assert.throws(() => saveReport({ employeeId: schemeEmployee.id, weekStart: pastWeek, items, submit: true }), /已锁定/);
  const corrected = saveReport({
    employeeId: schemeEmployee.id, weekStart: pastWeek, items,
    submit: true, allowLocked: true, markReviewed: true, editorUserId: schemeLeader.id,
  });
  assert.equal(corrected.status, 'locked');
  assert.equal(corrected.items.length, 2);
});

test('employees must select an existing project from their own team', () => {
  const nextWeek = dayjs(mondayOf()).add(7, 'day').format('YYYY-MM-DD');
  const planningProject = Project.create({ name: '共享中心规划', team: '规划组' });
  assert.throws(() => saveReport({
    employeeId: schemeEmployee.id,
    weekStart: nextWeek,
    items: [
      { period: 'current', projectName: '员工自行新建', weight: 1 },
      { period: 'next', projectName: '待安排', weight: 1 },
    ],
    submit: true,
  }), /项目名单中的项目/);
  const placeholders = Project.all().filter(project => project.code === 'SYS-UNASSIGNED');
  assert.throws(() => saveReport({
    employeeId: schemeEmployee.id,
    weekStart: dayjs(nextWeek).add(7, 'day').format('YYYY-MM-DD'),
    items: [
      { period: 'current', projectId: planningProject.id, projectName: planningProject.name, weight: 1 },
      { period: 'next', projectName: '待安排', weight: 1 },
    ],
    submit: true,
  }), /不能选择其他小组的项目/);
  assert.equal(placeholders.length, 1);
  assert.equal(placeholders[0].name, '待安排');
  assert.equal(placeholders[0].status, 'placeholder');
});

test('team leader API cannot read the other team', async () => {
  const cookie = await login('周报方案组长');
  const own = await request(`/api/weekly/team?team=${encodeURIComponent('方案组')}&weekStart=${mondayOf()}`, { cookie });
  assert.equal(own.status, 200);
  assert.ok((await own.json()).rows.every(row => row.employee.team === '方案组'));
  const other = await request(`/api/weekly/team?team=${encodeURIComponent('规划组')}&weekStart=${mondayOf()}`, { cookie });
  assert.equal(other.status, 403);
  assert.ok(listTeamReports('方案组', mondayOf()).some(row => row.employee.id === schemeEmployee.id));
});

test('project list creation and renaming follow employee, team leader, and VIP permissions', async () => {
  const employeeCookie = await login(schemeEmployee.name);
  const teamLeaderCookie = await login('周报方案组长');
  const vipCookie = await login('周报VIP');

  const ownOptions = await request(`/api/projects/options?team=${encodeURIComponent('方案组')}`, { cookie: employeeCookie });
  assert.equal(ownOptions.status, 200);
  assert.ok((await ownOptions.json()).some(project => project.id === schemeProjectA.id && project.code === 'TEST-A'));
  const otherOptions = await request(`/api/projects/options?team=${encodeURIComponent('规划组')}`, { cookie: employeeCookie });
  assert.equal(otherOptions.status, 403);

  const employeeCreate = await request('/api/projects', { cookie: employeeCookie, method: 'POST', body: JSON.stringify({ code: 'EMP-001', name: '员工越权项目', team: '方案组' }) });
  assert.equal(employeeCreate.status, 403);
  const teamCreate = await request('/api/projects', { cookie: teamLeaderCookie, method: 'POST', body: JSON.stringify({ code: '', name: '组长新建项目', team: '规划组', startDate: mondayOf(), endDate: '待定' }) });
  assert.equal(teamCreate.status, 200);
  const teamCreated = await teamCreate.json();
  assert.equal(teamCreated.team, '方案组');
  assert.equal(teamCreated.code, null);
  assert.equal(teamCreated.startDate, mondayOf());
  assert.equal(teamCreated.endDate, '待定');
  const refreshedOptions = await request(`/api/projects/options?team=${encodeURIComponent('方案组')}`, { cookie: employeeCookie });
  assert.ok((await refreshedOptions.json()).some(project => project.id === teamCreated.id && project.code === null));

  const planningProject = Project.create({ name: 'VIP可改规划项目', team: '规划组' });
  const deniedRename = await request(`/api/projects/${planningProject.id}`, { cookie: teamLeaderCookie, method: 'PUT', body: JSON.stringify({ name: '方案组长不应改名' }) });
  assert.equal(deniedRename.status, 403);
  const ownProgress = await request(`/api/projects/${teamCreated.id}`, { cookie: teamLeaderCookie, method: 'PUT', body: JSON.stringify({ completionPercent: 35 }) });
  assert.equal(ownProgress.status, 200);
  assert.equal((await ownProgress.json()).completionPercent, 35);
  const deniedProgress = await request(`/api/projects/${planningProject.id}`, { cookie: teamLeaderCookie, method: 'PUT', body: JSON.stringify({ completionPercent: 50 }) });
  assert.equal(deniedProgress.status, 403);
  const vipRename = await request(`/api/projects/${planningProject.id}`, { cookie: vipCookie, method: 'PUT', body: JSON.stringify({ name: 'VIP已修改规划项目', code: 'VIP-EDIT-001' }) });
  assert.equal(vipRename.status, 200);
  const vipRenamed = await vipRename.json();
  assert.equal(vipRenamed.name, 'VIP已修改规划项目');
  assert.equal(vipRenamed.code, 'VIP-EDIT-001');
  const vipProgress = await request(`/api/projects/${planningProject.id}`, { cookie: vipCookie, method: 'PUT', body: JSON.stringify({ completionPercent: 60 }) });
  assert.equal(vipProgress.status, 200);
  assert.equal((await vipProgress.json()).completionPercent, 60);
  const vipCreate = await request('/api/projects', { cookie: vipCookie, method: 'POST', body: JSON.stringify({ code: 'VIP-NEW-001', name: 'VIP新增规划项目', team: '规划组', startDate: mondayOf(), endDate: dayjs(mondayOf()).add(90, 'day').format('YYYY-MM-DD') }) });
  assert.equal(vipCreate.status, 200);
  assert.equal((await vipCreate.json()).team, '规划组');

  const mergeSource = Project.create({ name: '组长待合并项目', team: '方案组' });
  ProjectMembership.create({ employeeId: schemeEmployee.id, projectId: mergeSource.id, weight: 0.2, effectiveFrom: mondayOf() });
  const mergeResponse = await request(`/api/projects/${mergeSource.id}/merge`, { cookie: teamLeaderCookie, method: 'POST', body: JSON.stringify({ targetProjectId: teamCreated.id }) });
  assert.equal(mergeResponse.status, 200);
  assert.equal(Project.find(mergeSource.id).status, 'merged');
  assert.ok(ProjectMembership.activeForEmployee(schemeEmployee.id, mondayOf()).some(item => item.projectId === teamCreated.id));

  const deniedDelete = await request(`/api/projects/${planningProject.id}`, { cookie: teamLeaderCookie, method: 'DELETE' });
  assert.equal(deniedDelete.status, 403);
  const deleteResponse = await request(`/api/projects/${teamCreated.id}`, { cookie: teamLeaderCookie, method: 'DELETE' });
  assert.equal(deleteResponse.status, 200);
  assert.equal(Project.find(teamCreated.id).status, 'deleted');
  assert.ok(vipUser.id);
});

test('ordinary employees can view the complete personnel-project graph without cost data', async () => {
  const cookie = await login(schemeEmployee.name);
  const startDate = mondayOf();
  const endDate = dayjs(startDate).add(14, 'day').format('YYYY-MM-DD');
  const response = await request(`/api/projects/resource-graph?startDate=${startDate}&endDate=${endDate}`, { cookie });
  assert.equal(response.status, 200);
  const graph = await response.json();
  assert.ok(graph.employees.some(employee => employee.id === schemeEmployee.id));
  assert.ok(graph.employees.some(employee => employee.id === planningEmployee.id));
  assert.ok(graph.links.every(link => link.cost === 0));
  assert.ok(graph.projects.every(project => project.cost === 0 && project.topContributor === null));
});

test('project timeline lets VIP view both teams while a team leader remains team-scoped', async () => {
  const planningProject = Project.create({ name: '时序规划项目', team: '规划组', startDate: mondayOf(), endDate: '待定' });
  ProjectMembership.create({ employeeId: planningEmployee.id, projectId: planningProject.id, weight: 1, effectiveFrom: mondayOf() });
  const leaderCookie = await login('周报方案组长');
  const leaderResponse = await request('/api/projects/timeline', { cookie: leaderCookie });
  assert.equal(leaderResponse.status, 200);
  const leaderTimeline = await leaderResponse.json();
  assert.ok(leaderTimeline.projects.length > 0);
  assert.ok(leaderTimeline.projects.every(project => project.associatedTeams.includes('方案组')));
  assert.equal(leaderTimeline.projects.some(project => project.id === planningProject.id), false);

  const vipCookie = await login('周报VIP');
  const vipResponse = await request('/api/projects/timeline', { cookie: vipCookie });
  assert.equal(vipResponse.status, 200);
  const vipTimeline = await vipResponse.json();
  assert.ok(vipTimeline.projects.some(project => project.associatedTeams.includes('方案组')));
  assert.ok(vipTimeline.projects.some(project => project.id === planningProject.id && project.associatedTeams.includes('规划组')));
});

test('non-personnel accounts are excluded from personnel, attendance, and weekly reporting', async () => {
  const exempt = Employee.create({
    name: '仅账号领导', team: null, personnelVisible: false,
    attendanceRequired: false, weeklyReportRequired: false,
  });
  AttendanceLog.upsert({
    employeeId: exempt.id, employeeName: exempt.name, date: mondayOf(),
    clockIn: '09:00', clockOut: '18:00', workHours: 8, status: 'normal',
  });
  assert.equal(AttendanceLog.queryAll({ employeeId: exempt.id }).length, 0);
  assert.throws(() => saveReport({
    employeeId: exempt.id, weekStart: mondayOf(),
    items: [{ period: 'current', projectName: '待安排', weight: 1 }, { period: 'next', projectName: '待安排', weight: 1 }],
    submit: true,
  }), /不需要填写个人周报/);
  const cookie = await login('周报方案组长');
  const response = await request('/api/employees', { cookie });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).some(employee => employee.id === exempt.id), false);
});


test('Excel weekend overtime survives remote-work scheduling and cancellation', async () => {
  const XLSX = require('xlsx');
  const employee = Employee.create({ name: '合成考勤员工', team: '方案组' });
  User.create({ username: '考勤测试管理员', passwordHash: await hashPassword('WeeklyPass8'),
    roles: ['admin'], mustChangePassword: false });
  const cookie = await login('考勤测试管理员');
  const date = '2026-08-22';
  const sheet = XLSX.utils.aoa_to_sheet([
    ['姓名', '日期', '上班', '下班', '加班时长'],
    [employee.name, date, '10:00 迟到', '16:00 早退', 2.5 / 24],
  ]);
  sheet.E2.z = '[h]:mm';
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '考勤');
  const form = new FormData();
  form.append('file', new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })]), 'synthetic.xlsx');
  const imported = await fetch(baseUrl + '/api/attendance/import', { method: 'POST', headers: { cookie }, body: form });
  assert.equal(imported.status, 200);
  async function readAttendance() {
    const result = await request(`/api/attendance?employeeId=${employee.id}&startDate=${date}&endDate=${date}`, { cookie });
    assert.equal(result.status, 200);
    return (await result.json())[0];
  }
  let row = await readAttendance();
  assert.equal(row.status, 'weekend_overtime');
  assert.equal(row.overtimeHours, 2.5);
  assert.equal(row.isLate, false);
  assert.equal(row.isEarlyLeave, false);
  const scheduled = await request('/api/employees/comp-leave/batch', {
    cookie, method: 'POST', body: JSON.stringify({ employeeIds: [employee.id], dates: [date], type: 'remote_work' }),
  });
  assert.equal(scheduled.status, 200);
  row = await readAttendance();
  assert.equal(row.status, 'remote_work');
  assert.equal(row.workHours, 8);
  assert.equal(row.clockIn, null);
  assert.equal(row.clockOut, null);
  assert.equal(row.missedPunchCount, 0);
  assert.equal(row.overtimeHours, 0);
  const removed = await request(`/api/employees/${employee.id}/comp-leave/${date}`, { cookie, method: 'DELETE' });
  assert.equal(removed.status, 200);
  row = await readAttendance();
  assert.equal(row.status, 'weekend_overtime');
  assert.equal(row.clockIn, '10:00');
  assert.equal(row.overtimeHours, 2.5);
});


test('project summary restricts named attendance and uses only allocated work within actual dates', async () => {
  const project = Project.create({ name: '总结验收项目', manager: schemeEmployee.name, team: '方案组', startDate: '2025-10-01' });
  const other = Project.create({ name: '总结验收另一项目', team: '方案组' });
  for (const [person, target, from, to] of [
    [schemeEmployee, project, '2025-10-13', '2025-10-14'],
    [schemeEmployee, other, '2025-10-13', '2025-10-15'],
    [planningEmployee, project, '2025-10-13', '2025-10-15'],
  ]) {
    ProjectMembership.create({ employeeId: person.id, projectId: target.id, effectiveFrom: from, effectiveTo: to, weight: 1 });
  }
  for (const [person, date, hours, clockOut] of [
    [schemeEmployee, '2025-10-13', 8, '22:10'],
    [schemeEmployee, '2025-10-15', 8, '23:55'],
    [planningEmployee, '2025-10-14', 7, '18:30'],
    [planningEmployee, '2025-10-16', 8, '23:59'],
  ]) {
    AttendanceLog.upsert({ employeeId: person.id, employeeName: person.name, date, clockIn: '09:30', clockOut, workHours: hours, status: 'normal' });
  }

  const manager = await login(schemeEmployee.name);
  const nonManager = await login(planningEmployee.name);
  const url = '/api/projects/' + project.id + '/summary';
  const options = await request('/api/projects/summary-options', { cookie: manager });
  assert.equal(options.status, 200);
  assert.deepEqual((await options.json()).map(row => row.id), [project.id]);
  const otherOptions = await request('/api/projects/summary-options', { cookie: nonManager });
  assert.deepEqual(await otherOptions.json(), []);
  const input = {
    confirmed: true, startDate: '2025-10-13', endDate: '2025-10-15',
    progressTable: '里程碑\t日期\t实际完成日期\t说明\r\n交付\t2025-10-14\t2025/10/15\t归档\r\n评审\t2025-10-12\t2025年10月13日\t通过',
  };
  const generate = (cookie, changes = {}) => request(url, { cookie, method: 'POST', body: JSON.stringify({ ...input, ...changes }) });
  assert.equal((await generate(nonManager)).status, 403);
  assert.equal((await generate(manager, { confirmed: false })).status, 400);
  assert.equal((await generate(manager, { progressTable: '里程碑\t日期\n评审\t2025-02-30' })).status, 400);
  const response = await generate(manager);
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.durationDays, 3);
  assert.equal(report.attendanceDays, 2);
  assert.equal(report.totalHours, 11);
  assert.deepEqual(report.topContributors.map(({ name, hours }) => [name, hours]), [[planningEmployee.name, 7]]);
  assert.deepEqual(report.latestPunch, { date: '2025-10-13', time: '22:10', name: schemeEmployee.name });
  assert.deepEqual(report.milestones.map(({ title, date }) => [title, date]), [['评审', '2025-10-13'], ['交付', '2025-10-15']]);
  assert.equal(Project.find(project.id).status, 'active');

  Employee.create({ name: schemeEmployee.name + ' ', team: '方案组' });
  assert.equal((await generate(manager)).status, 403);
});

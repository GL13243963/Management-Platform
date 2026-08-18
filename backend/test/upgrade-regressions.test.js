const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'management-platform-test-'));
process.env.APP_DB_PATH = path.join(testDir, 'app.db');

const { db, Employee, Project, ProjectMembership, AttendanceLog } = require('../src/models');
const {
  importAllocations, parseAllocationWorkbook, parsePeriodHeader, syncMembershipPeriod,
} = require('../src/services/allocation-import');
const { summarizeResourceGraph } = require('../src/services/analytics');

test.after(() => {
  db.raw.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('transaction keeps the original failure when SQLite already ended it', () => {
  const original = new Error('original transaction failure');
  const run = db.transaction(() => {
    db.exec('ROLLBACK');
    throw original;
  });

  assert.throws(run, error => error === original);
  assert.equal(db.raw.isTransaction, false);
});

test('nested transactions use savepoints without cancelling the outer transaction', () => {
  db.exec('CREATE TABLE transaction_probe (value INTEGER)');
  db.transaction(() => {
    db.prepare('INSERT INTO transaction_probe (value) VALUES (?)').run(1);
    assert.throws(db.transaction(() => {
      db.prepare('INSERT INTO transaction_probe (value) VALUES (?)').run(2);
      throw new Error('inner failure');
    }), /inner failure/);
    db.prepare('INSERT INTO transaction_probe (value) VALUES (?)').run(3);
  })();

  assert.deepEqual(
    db.prepare('SELECT value FROM transaction_probe ORDER BY value').all().map(row => row.value),
    [1, 3],
  );
});

test('attendance re-import preserves approved comp-leave hours', () => {
  const employee = Employee.create({ name: '调休测试员工' });
  AttendanceLog.upsert({
    employeeId: employee.id, employeeName: employee.name, date: '2026-08-05',
    clockIn: '09:00', clockOut: '18:00', workHours: 9, status: 'normal',
    isLate: false, isEarlyLeave: false, isMissedPunch: false,
    rawClockIn: '09:00', rawClockOut: '18:00',
  });
  const original = AttendanceLog.findByEmpDate(employee.id, '2026-08-05');
  AttendanceLog.update(original.id, { overrideType: 'comp_leave', workHours: 0, status: 'comp_leave' });

  AttendanceLog.upsert({
    employeeId: employee.id, employeeName: employee.name, date: '2026-08-05',
    clockIn: '08:55', clockOut: '18:10', workHours: 9.25, status: 'normal',
    isLate: false, isEarlyLeave: false, isMissedPunch: false,
    rawClockIn: '08:55', rawClockOut: '18:10',
  });

  const saved = AttendanceLog.findByEmpDate(employee.id, '2026-08-05');
  assert.equal(saved.overrideType, 'comp_leave');
  assert.equal(saved.status, 'comp_leave');
  assert.equal(saved.workHours, 0);
  assert.equal(saved.rawClockIn, '08:55');
});

test('independent comp leave is excluded from attendance and survives attendance import', () => {
  const employee = Employee.create({ name: '独立调休员工' });
  AttendanceLog.upsert({ employeeId: employee.id, employeeName: employee.name, date: '2026-08-06', clockIn: '09:00', clockOut: '18:00', workHours: 9, status: 'normal', isLate: false, isEarlyLeave: false, isMissedPunch: false });
  db.prepare('INSERT INTO comp_leave_records (employeeId,date,note) VALUES (?,?,?)').run(employee.id, '2026-08-06', '批量调休');
  assert.equal(AttendanceLog.queryAll({ startDate: '2026-08-06', endDate: '2026-08-06' }).some(row => row.employeeId === employee.id), false);
  AttendanceLog.upsert({ employeeId: employee.id, employeeName: employee.name, date: '2026-08-06', clockIn: '08:50', clockOut: '18:20', workHours: 9.5, status: 'normal', isLate: false, isEarlyLeave: false, isMissedPunch: false });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM comp_leave_records WHERE employeeId=? AND date=?').get(employee.id, '2026-08-06').count, 1);
  assert.equal(summarizeResourceGraph({ startDate: '2026-08-06', endDate: '2026-08-06' }).employees.find(row => row.id === employee.id)?.totalHours || 0, 0);
});

test('attendance coverage uses imported attendance dates only', () => {
  const employee = Employee.create({ name: '覆盖范围口径员工' });
  AttendanceLog.upsert({ employeeId: employee.id, employeeName: employee.name, date: '2026-07-01', clockIn: '09:00', clockOut: '18:00', workHours: 9, status: 'normal', isLate: false, isEarlyLeave: false, isMissedPunch: false });
  db.prepare(`INSERT INTO attendance_logs
    (employeeId,employeeName,date,workHours,status,source) VALUES (?,?,?,?,?,?)`)
    .run(employee.id, employee.name, '2027-12-31', 0, 'leave', 'manual');
  db.prepare('INSERT INTO comp_leave_records (employeeId,date,note) VALUES (?,?,?)')
    .run(employee.id, '2028-01-01', '不影响覆盖范围');
  const coverage = db.prepare(`SELECT MIN(date) earliestDate, MAX(date) latestDate
    FROM attendance_logs WHERE source='import'`).get();
  assert.equal(coverage.latestDate < '2027-12-31', true);
  assert.equal(coverage.latestDate < '2028-01-01', true);
});

test('allocation re-import replaces stale projects and is idempotent', () => {
  const employee = Employee.create({ name: '分配测试员工' });
  const projectA = Project.create({ name: '旧项目' });
  const projectB = Project.create({ name: '新项目' });
  const period = { from: '2026-08-03', to: '2026-08-09', label: '8月3-9' };
  ProjectMembership.create({
    employeeId: employee.id, projectId: projectA.id, weight: 1,
    effectiveFrom: period.from, effectiveTo: period.to,
  });

  const first = syncMembershipPeriod(employee.id, period, [{ projectId: projectB.id, weight: 1 }]);
  let active = ProjectMembership.activeForEmployee(employee.id, '2026-08-05');
  assert.equal(first.removed, 1);
  assert.deepEqual(active.map(row => row.projectId), [projectB.id]);

  const second = syncMembershipPeriod(employee.id, period, [{ projectId: projectB.id, weight: 1 }]);
  active = ProjectMembership.activeForEmployee(employee.id, '2026-08-05');
  assert.deepEqual(second, { created: 0, updated: 0, removed: 0, adjusted: 0 });
  assert.equal(active.length, 1);
});

test('allocation import treats blank cells as explicit clears with no overlap residue', () => {
  const employee = Employee.create({ name: '空白覆盖员工' });
  const oldProject = Project.create({ name: '待清空旧项目' });
  ProjectMembership.create({
    employeeId: employee.id, projectId: oldProject.id, weight: 1,
    effectiveFrom: '2026-08-01', effectiveTo: '2026-08-15', note: '导入 旧周期',
  });

  const workbookPath = path.join(testDir, '2026-allocation-clear.xlsx');
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['', '2026年8月份'],
    ['', '8月3-9'],
    [employee.name, ''],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, '项目分配');
  XLSX.writeFile(workbook, workbookPath);

  const parsed = parseAllocationWorkbook(workbookPath);
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(parsed.records[0].projects, []);

  importAllocations(workbookPath);
  assert.equal(ProjectMembership.activeForEmployee(employee.id, '2026-08-05').length, 0);

  const remaining = db.prepare(`
    SELECT effectiveFrom, effectiveTo FROM project_memberships
    WHERE employeeId=? AND projectId=? ORDER BY effectiveFrom
  `).all(employee.id, oldProject.id);
  assert.deepEqual(remaining.map(row => ({ ...row })), [
    { effectiveFrom: '2026-08-01', effectiveTo: '2026-08-02' },
    { effectiveFrom: '2026-08-10', effectiveTo: '2026-08-15' },
  ]);
});

test('allocation import clears overlapping data for employees omitted from the later workbook', () => {
  const included = Employee.create({ name: '后表包含员工' });
  const omitted = Employee.create({ name: '后表缺席员工' });
  const oldProject = Project.create({ name: '缺席员工旧项目' });
  ProjectMembership.create({
    employeeId: omitted.id, projectId: oldProject.id, weight: 1,
    effectiveFrom: '2026-08-03', effectiveTo: '2026-08-09', note: '导入 旧周期',
  });

  const workbookPath = path.join(testDir, '2026-allocation-authoritative.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['', '2026年8月份'],
    ['', '8月3-9'],
    [included.name, '本次项目'],
  ]), '项目分配');
  XLSX.writeFile(workbook, workbookPath);

  importAllocations(workbookPath, { resolutions: { 本次项目: { action: 'create' } } });
  assert.equal(ProjectMembership.activeForEmployee(omitted.id, '2026-08-05').length, 0);
  const includedMemberships = ProjectMembership.activeForEmployee(included.id, '2026-08-05');
  assert.equal(includedMemberships.length, 1);
  assert.equal(
    db.prepare('SELECT name FROM projects WHERE id=?').get(includedMemberships[0].projectId).name,
    '本次项目',
  );
});

test('allocation import requires a decision for new names and supports merging', () => {
  const employee = Employee.create({ name: '项目归并员工' });
  const canonical = Project.create({ name: '已有标准项目' });
  const workbookPath = path.join(testDir, '2026-allocation-merge.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['', '2026年8月份'],
    ['', '8月10-16'],
    [employee.name, '表中新项目名'],
  ]), '项目分配');
  XLSX.writeFile(workbook, workbookPath);

  assert.throws(() => importAllocations(workbookPath), /尚未确认新建或归并/);
  assert.equal(ProjectMembership.activeForEmployee(employee.id, '2026-08-12').length, 0);

  importAllocations(workbookPath, {
    resolutions: { 表中新项目名: { action: 'merge', projectId: canonical.id } },
  });
  const memberships = ProjectMembership.activeForEmployee(employee.id, '2026-08-12');
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].projectId, canonical.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM projects WHERE name=?').get('表中新项目名').count, 0);
});

test('overview memberships respect the requested date range', () => {
  const employee = Employee.create({ name: '范围测试员工' });
  const oldProject = Project.create({ name: '历史项目' });
  const currentProject = Project.create({ name: '本期项目' });
  ProjectMembership.create({
    employeeId: employee.id, projectId: oldProject.id, weight: 1,
    effectiveFrom: '2026-07-01', effectiveTo: '2026-07-07',
  });
  ProjectMembership.create({
    employeeId: employee.id, projectId: currentProject.id, weight: 1,
    effectiveFrom: '2026-08-03', effectiveTo: '2026-08-09',
  });

  const rows = ProjectMembership.allWithNames({ startDate: '2026-08-03', endDate: '2026-08-09' })
    .filter(row => row.employeeId === employee.id);
  assert.deepEqual(rows.map(row => row.projectName), ['本期项目']);
});

test('allocation periods support month and year boundaries', () => {
  assert.deepEqual(parsePeriodHeader('8月31-6', 2026), {
    from: '2026-08-31', to: '2026-09-06', label: '8月31-6',
  });
  assert.deepEqual(parsePeriodHeader('12月28-3', 2026), {
    from: '2026-12-28', to: '2027-01-03', label: '12月28-3',
  });
});

test('resource graph exposes cross-project hours for one employee', () => {
  const employee = Employee.create({ name: '图谱测试员工', team: '建筑组', hourlyRate: 100 });
  const projectA = Project.create({ name: '图谱项目甲', completionPercent: 45 });
  const projectB = Project.create({ name: '图谱项目乙' });
  for (const project of [projectA, projectB]) {
    ProjectMembership.create({
      employeeId: employee.id, projectId: project.id, weight: 0.5,
      effectiveFrom: '2026-08-03', effectiveTo: '2026-08-09',
    });
  }
  AttendanceLog.upsert({
    employeeId: employee.id, employeeName: employee.name, date: '2026-08-04',
    clockIn: '09:00', clockOut: '17:00', workHours: 8, status: 'normal',
    isLate: false, isEarlyLeave: false, isMissedPunch: false,
  });

  const result = summarizeResourceGraph({ startDate: '2026-08-03', endDate: '2026-08-09' });
  const person = result.employees.find(item => item.id === employee.id);
  const links = result.links.filter(item => item.employeeId === employee.id);
  assert.equal(person.projectCount, 2);
  assert.equal(person.team, '建筑组');
  assert.equal(person.multiProject, true);
  assert.equal(person.allocatedHours, 8);
  assert.deepEqual(links.map(item => item.hours).sort(), [4, 4]);
  assert.equal(links.reduce((sum, item) => sum + item.cost, 0), 800);
  assert.equal(result.projects.find(item => item.id === projectA.id).completionPercent, 45);
});

test('attendance analytics count both anomalies and weekend plus after-nine overtime', () => {
  const employee = Employee.create({ name: '考勤新指标员工' });
  AttendanceLog.upsert({ employeeId: employee.id, employeeName: employee.name, date: '2026-08-20', clockIn: '10:00', clockOut: '22:30', workHours: 12.5, status: 'late_and_early', isLate: true, isEarlyLeave: true, isMissedPunch: false, sourceOvertime: true, sourceOvertimeHours: 5 });
  AttendanceLog.upsert({ employeeId: employee.id, employeeName: employee.name, date: '2026-08-22', clockIn: '09:00', clockOut: '21:30', workHours: 12.5, status: 'normal', isLate: false, isEarlyLeave: false, isMissedPunch: false, sourceOvertime: true, sourceOvertimeHours: 4, sourceBusinessTrip: true, sourceBusinessTripHours: 8, sourceOutside: true, sourceOutsideHours: 2 });
  const row = require('../src/services/analytics').summarizeEmployees({ startDate: '2026-08-20', endDate: '2026-08-22' }).find(item => item.employeeId === employee.id);
  assert.equal(row.overtimeHours, 6);
  assert.equal(row.businessTripHours, 8);
  assert.equal(row.outsideHours, 2);
  assert.equal(row.lateOrEarlyDays, 2);
});

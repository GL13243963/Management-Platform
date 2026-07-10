const dayjs = require('dayjs');
const { db, Employee, Project, ProjectMembership, AttendanceLog } = require('../models');
const { computeDaily } = require('../services/attendance');

// Wipe existing data (destructive)
db.exec(`
  DELETE FROM adjustments;
  DELETE FROM attendance_logs;
  DELETE FROM project_memberships;
  DELETE FROM projects;
  DELETE FROM employees;
`);

const emps = [
  { name: '张伟', employeeNo: 'E001', department: '创新中心', position: '架构师', hourlyRate: 120 },
  { name: '李娜', employeeNo: 'E002', department: '创新中心', position: '工程师', hourlyRate: 90 },
  { name: '王强', employeeNo: 'E003', department: '创新中心', position: '工程师', hourlyRate: 85 },
  { name: '赵敏', employeeNo: 'E004', department: '创新中心', position: '产品', hourlyRate: 95 },
].map(e => Employee.create(e));

const projects = [
  { code: 'P-2026-01', name: '智慧工地平台', manager: '张伟', startDate: '2026-01-01' },
  { code: 'P-2026-02', name: '装配式BIM系统', manager: '李娜', startDate: '2026-03-01' },
].map(p => Project.create(p));

const memberships = [
  { employeeId: emps[0].id, projectId: projects[0].id, weight: 0.6, role: 'master',    effectiveFrom: '2026-01-01' },
  { employeeId: emps[0].id, projectId: projects[1].id, weight: 0.4, role: 'secondary', effectiveFrom: '2026-03-01' },
  { employeeId: emps[1].id, projectId: projects[0].id, weight: 1.0, role: 'master',    effectiveFrom: '2026-01-01' },
  { employeeId: emps[2].id, projectId: projects[1].id, weight: 1.0, role: 'master',    effectiveFrom: '2026-03-01' },
  { employeeId: emps[3].id, projectId: projects[0].id, weight: 0.5, role: 'secondary', effectiveFrom: '2026-01-01' },
  { employeeId: emps[3].id, projectId: projects[1].id, weight: 0.5, role: 'secondary', effectiveFrom: '2026-03-01' },
];
memberships.forEach(m => ProjectMembership.create(m));

const today = dayjs();
for (let i = 0; i < 10; i++) {
  const d = today.subtract(i, 'day').format('YYYY-MM-DD');
  for (const e of emps) {
    const jitter = Math.floor(Math.random() * 20) - 5;
    const inM = Math.max(0, Math.min(59, 30 + jitter));
    const outM = Math.min(59, 30 + Math.floor(Math.random() * 30));
    const clockIn = `09:${String(inM).padStart(2, '0')}`;
    const clockOut = `17:${String(outM).padStart(2, '0')}`;
    const daily = computeDaily({ clockIn, clockOut });
    AttendanceLog.upsert({
      employeeId: e.id, employeeName: e.name, date: d, ...daily,
    });
  }
}

console.log('Seed complete. 4 employees, 2 projects, 10 days of attendance.');
process.exit(0);

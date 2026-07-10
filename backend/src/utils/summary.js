/**
 * Read-only summary of what's currently in the DB.
 * Usage: node --experimental-sqlite src/utils/summary.js
 */
const { Employee, AttendanceLog, Project } = require('../models');

const emps = Employee.all();
const logs = AttendanceLog.query({});
const projects = Project.all();

console.log(`\n== Employees (${emps.length}) ==`);
emps.forEach(e => console.log(`  #${e.id}  ${e.name.padEnd(6)}  ${e.department || '-'}  hourlyRate=${e.hourlyRate}`));

console.log(`\n== Projects (${projects.length}) ==`);
projects.forEach(p => console.log(`  #${p.id}  ${p.code || '-'}  ${p.name}  status=${p.status}`));

console.log(`\n== Attendance logs (${logs.length}) ==`);
const byEmp = new Map();
for (const l of logs) {
  const cur = byEmp.get(l.employeeName) || { days: 0, hours: 0, late: 0, early: 0 };
  cur.days += 1;
  cur.hours = Math.round((cur.hours + (l.workHours || 0)) * 100) / 100;
  if (l.isLate && !l.overrideType) cur.late += 1;
  if (l.isEarlyLeave && !l.overrideType) cur.early += 1;
  byEmp.set(l.employeeName, cur);
}
console.log('  Name       Days  Hours   Late  Early');
[...byEmp.entries()].forEach(([name, s]) => {
  console.log(`  ${name.padEnd(8)}  ${String(s.days).padStart(4)}  ${String(s.hours).padStart(6)}  ${String(s.late).padStart(4)}  ${String(s.early).padStart(4)}`);
});

const dates = logs.map(l => l.date).sort();
console.log(`\n== Date coverage: ${dates[0]} → ${dates[dates.length-1]} (${new Set(dates).size} distinct days) ==\n`);
process.exit(0);

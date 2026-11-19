/**
 * One-shot script: parse a monthly-report Excel and insert into the DB.
 * Usage:
 *   node --experimental-sqlite src/utils/import-monthly.js "<path/to/xlsx>"
 */

const path = require('path');
const { Employee, AttendanceLog } = require('../models');
const { computeDaily } = require('../services/attendance');
const { parseMonthlyReport } = require('../services/monthly-report');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node --experimental-sqlite src/utils/import-monthly.js <xlsx-path>');
  process.exit(1);
}

const absPath = path.resolve(file);
console.log(`Reading: ${absPath}`);
const { startDate, endDate, employees, records } = parseMonthlyReport(absPath);
console.log(`Date range: ${startDate} → ${endDate}`);
console.log(`Employees found: ${employees.length}  (${employees.join(', ')})`);
console.log(`Punch records: ${records.length}`);

let created = 0, updated = 0;
const empByName = new Map();

for (const r of records) {
  let emp = empByName.get(r.name);
  if (!emp) {
    emp = Employee.findByName(r.name);
    if (!emp) {
      emp = Employee.create({
        name: r.name,
        department: r.department,
        employeeNo: r.employeeNo,
      });
    }
    empByName.set(r.name, emp);
  }
  const daily = computeDaily({ date: r.date, clockIn: r.clockIn, clockOut: r.clockOut, preferSourceStatus: true });
  const { created: isNew } = AttendanceLog.upsert({
    employeeId: emp.id, employeeName: emp.name, date: r.date,
    clockIn: daily.clockIn, clockOut: daily.clockOut,
    workHours: daily.workHours, status: daily.status,
    isLate: daily.isLate, isEarlyLeave: daily.isEarlyLeave, isMissedPunch: daily.isMissedPunch, missedPunchCount: daily.missedPunchCount,
  });
  if (isNew) created++; else updated++;
}

console.log(`\n✓ Done. Created ${created} new logs, updated ${updated} existing logs.`);
process.exit(0);

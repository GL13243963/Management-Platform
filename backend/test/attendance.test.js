const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { computeDaily } = require('../src/services/attendance');
const { parseMonthlyReport } = require('../src/services/monthly-report');

test('single punch and explicit source marker are preserved as anomalies', () => {
  const single = computeDaily({ clockIn: '09:12', clockOut: '' });
  assert.equal(single.status, 'missed_punch');
  assert.equal(single.clockIn, '09:12');
  assert.equal(single.isMissedPunch, true);
  assert.equal(single.workHours, 4);
  assert.equal(computeDaily({ clockIn: '漏刷', clockOut: '17:45' }).workHours, 4);
  assert.equal(computeDaily({ clockIn: '漏刷', clockOut: '' }).workHours, 0);
  const early = computeDaily({ clockIn: '09:10', clockOut: '17:43 早退' });
  assert.equal(early.isEarlyLeave, true);
  assert.equal(early.status, 'early');
  const imported = computeDaily({ clockIn: '09:00', clockOut: '19:00', sourceText: '加班 2小时' });
  assert.equal(imported.sourceOvertimeHours, 2);
  const outside = computeDaily({ clockIn: '09:00', clockOut: '19:00', sourceText: '外出 1小时' });
  assert.equal(outside.status, 'excluded');
  assert.equal(outside.workHours, 10);
  assert.equal(outside.isLate, false);
  assert.equal(outside.isMissedPunch, false);
  assert.equal(outside.sourceOutsideHours, 1);
  const outsideOnly = computeDaily({ clockIn: '外出:3小时', clockOut: '' });
  assert.equal(outsideOnly.status, 'excluded');
  assert.equal(outsideOnly.workHours, 3);
  assert.equal(outsideOnly.sourceOutsideHours, 3);
  const outsideColumn = computeDaily({ clockIn: '', clockOut: '', outsideHours: 2.5 });
  assert.equal(outsideColumn.status, 'excluded');
  assert.equal(outsideColumn.workHours, 2.5);
  for (const marker of ['年假', '事假', '病假']) {
    const excluded = computeDaily({ clockIn: marker, clockOut: marker });
    assert.equal(excluded.status, 'excluded', marker);
    assert.equal(excluded.workHours, 0, marker);
  }

  const weekend = computeDaily({ date: '2026-08-22', clockIn: '10:30 迟到', clockOut: '16:00 早退' });
  assert.equal(weekend.status, 'weekend_overtime');
  assert.equal(weekend.workHours, 5.5);
  assert.equal(weekend.isLate, false);
  assert.equal(weekend.isEarlyLeave, false);
  assert.equal(weekend.isMissedPunch, false);
  assert.equal(computeDaily({ date: '2026-08-22', clockIn: '09:00', clockOut: '21:30',
    overtimeHours: '02:30' }).sourceOvertimeHours, 2.5);
  const marker = computeDaily({ date: '2026-08-22', clockOut: '加班时长：02:30' });
  assert.equal(marker.clockOut, null);
  assert.equal(marker.sourceOvertimeHours, 2.5);
  assert.equal(computeDaily({ sourceText: '加班 2小时30分钟' }).sourceOvertimeHours, 2.5);
});

test('both monthly report layouts map the complete date range', () => {
  const reportDir = path.resolve(__dirname, '..', '..', '月报');
  const files = fs.readdirSync(reportDir).filter(name => name.endsWith('.xlsx') && !name.startsWith('~$'));
  assert.equal(files.length >= 2, true);

  for (const name of files) {
    const parsed = parseMonthlyReport(path.join(reportDir, name));
    const dates = parsed.records.map(record => record.date).sort();
    assert.equal(dates[0] >= parsed.startDate, true, name);
    assert.equal(dates.at(-1) <= parsed.endDate, true, name);
    const minimumEmployees = /2人/.test(name) ? 2 : 8;
    assert.equal(parsed.employees.length >= minimumEmployees, true, name);
    assert.equal(parsed.records.every(record => record.sourceRow > 0 && record.sourceColumn > 0), true, name);
  }
});

test('known source reports produce the verified per-employee anomaly counts', () => {
  const reportDir = path.resolve(__dirname, '..', '..', '月报');
  const name = fs.readdirSync(reportDir).find(file => file.startsWith('创新中心考勤月报') && file.endsWith('.xlsx'));
  const parsed = parseMonthlyReport(path.join(reportDir, name));
  const totals = {};
  for (const record of parsed.records) {
    const daily = computeDaily(record);
    const item = totals[record.name] ||= { late: 0, early: 0, missed: 0 };
    item.late += Number(daily.isLate);
    item.early += Number(daily.isEarlyLeave);
    item.missed += Number(daily.isMissedPunch);
  }
  assert.deepEqual(totals, {
    '杜啟泽': { late: 0, early: 0, missed: 0 },
    '俞晨超': { late: 0, early: 0, missed: 0 },
    '宋骜': { late: 1, early: 0, missed: 3 },
    '李辉': { late: 0, early: 0, missed: 5 },
    '李亮': { late: 7, early: 0, missed: 3 },
    '李勇': { late: 2, early: 1, missed: 6 },
    '傅宏钊': { late: 5, early: 0, missed: 5 },
    '吴昊': { late: 1, early: 0, missed: 1 },
  });
});

test('latest workbook labels are authoritative for Song Ao and Wu Tao', () => {
  const reportDir = path.resolve(__dirname, '..', '..', '月报');
  const name = fs.readdirSync(reportDir).find(file => file.includes('2026年08月21日至2026年09月20日') && file.endsWith('.xlsx'));
  const parsed = parseMonthlyReport(path.join(reportDir, name));
  const result = {};
  for (const employeeName of ['宋骜', '吴涛']) {
    const rows = parsed.records.filter(record => record.name === employeeName)
      .map(record => computeDaily({ ...record, preferSourceStatus: true }));
    result[employeeName] = {
      late: rows.filter(row => row.isLate).length,
      missed: rows.reduce((sum, row) => sum + (row.missedPunchCount || 0), 0),
    };
  }
  assert.deepEqual(result, {
    '宋骜': { late: 0, missed: 4 },
    '吴涛': { late: 5, missed: 6 },
  });
});

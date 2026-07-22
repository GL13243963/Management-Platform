const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { computeDaily } = require('../src/services/attendance');
const { parseMonthlyReport } = require('../src/services/monthly-report');

test('single punch and explicit source marker are preserved as anomalies', () => {
  assert.deepEqual(
    computeDaily({ clockIn: '09:12', clockOut: '' }),
    {
      clockIn: '09:12', clockOut: null, workHours: 0,
      isLate: false, isEarlyLeave: false, isMissedPunch: true, status: 'missed_punch',
    },
  );
  const early = computeDaily({ clockIn: '09:10', clockOut: '17:43 早退' });
  assert.equal(early.isEarlyLeave, true);
  assert.equal(early.status, 'early');
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
    assert.equal(parsed.employees.length, 8, name);
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

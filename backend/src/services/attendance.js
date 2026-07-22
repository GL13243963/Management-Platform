const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);

const SHIFT_START = '09:35';
const SHIFT_END = '17:30';

function parseTime(str) {
  if (!str) return null;
  // Accept "9:30", "09:30", "09:30:15", "2024-06-01 09:30", Excel serial fragments
  const s = String(str).trim();
  const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h > 23 || mm > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function computeDaily({ clockIn, clockOut }) {
  // Attendance exports may append an authoritative status marker to the time,
  // for example "17:43 早退" when a person's scheduled end is later than 17:30.
  const sourceLate = /迟到/.test(String(clockIn || ''));
  const sourceEarlyLeave = /早退/.test(String(clockOut || ''));
  const sourceMissedPunch = /漏刷|漏卡|缺卡|未打卡/.test(`${clockIn || ''} ${clockOut || ''}`);
  const inT = parseTime(clockIn);
  const outT = parseTime(clockOut);

  // Both punches marked as missing count as one missed-punch day.
  if (sourceMissedPunch || !inT || !outT) {
    return {
      clockIn: inT, clockOut: outT,
      workHours: 0,
      isLate: sourceLate,
      isEarlyLeave: sourceEarlyLeave,
      isMissedPunch: true,
      status: 'missed_punch',
    };
  }

  const startMin = toMinutes(SHIFT_START);
  const endMin = toMinutes(SHIFT_END);
  const inMin = toMinutes(inT);
  const outMin = toMinutes(outT);

  const workHours = Math.max(0, (outMin - inMin) / 60);

  const isLate = sourceLate || inMin > startMin;
  const isEarlyLeave = sourceEarlyLeave || outMin < endMin;

  let status = 'normal';
  if (isLate && isEarlyLeave) status = 'late_and_early';
  else if (isLate) status = 'late';
  else if (isEarlyLeave) status = 'early';

  return {
    clockIn: inT,
    clockOut: outT,
    workHours: Math.round(workHours * 100) / 100,
    isLate, isEarlyLeave, isMissedPunch: false, status,
  };
}

module.exports = { computeDaily, parseTime, SHIFT_START, SHIFT_END };

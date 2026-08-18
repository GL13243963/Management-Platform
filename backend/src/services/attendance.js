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

function markedHours(text, label) {
  const match = String(text || '').match(new RegExp(`${label}[^\\d]{0,10}(\\d+(?:\\.\\d+)?)\\s*(?:小时|h|H)`));
  return match ? Number(match[1]) : null;
}

function computeDaily({ clockIn, clockOut, sourceText = '', overtimeHours, businessTripHours, outsideHours }) {
  // Attendance exports may append an authoritative status marker to the time,
  // for example "17:43 早退" when a person's scheduled end is later than 17:30.
  const sourceLate = /迟到/.test(String(clockIn || ''));
  const sourceEarlyLeave = /早退/.test(String(clockOut || ''));
  const combinedSource = `${clockIn || ''} ${clockOut || ''} ${sourceText || ''}`;
  const sourceMissedPunch = /漏刷|漏卡|缺卡|未打卡/.test(combinedSource);
  const sourceOvertime = /加班/.test(combinedSource) || Number(overtimeHours) > 0;
  const sourceBusinessTrip = /出差/.test(combinedSource) || Number(businessTripHours) > 0;
  const sourceOutside = /外出/.test(combinedSource) || Number(outsideHours) > 0;
  const inT = parseTime(clockIn);
  const outT = parseTime(clockOut);

  // A single missing punch invalidates only its half-day: retain the other
  // half-day as 4 hours. With no valid punch, no work hours are retained.
  if (sourceMissedPunch || !inT || !outT) {
    const validPunchCount = Number(!!inT) + Number(!!outT);
    return {
      clockIn: inT, clockOut: outT,
      workHours: validPunchCount === 1 ? 4 : 0,
      isLate: sourceLate,
      isEarlyLeave: sourceEarlyLeave,
      isMissedPunch: true,
      status: 'missed_punch',
      sourceOvertime, sourceBusinessTrip, sourceOutside,
      sourceOvertimeHours: Number(overtimeHours) || markedHours(combinedSource, '加班') || 0,
      sourceBusinessTripHours: Number(businessTripHours) || markedHours(combinedSource, '出差') || 0,
      sourceOutsideHours: Number(outsideHours) || markedHours(combinedSource, '外出') || 0,
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

  const roundedWorkHours = Math.round(workHours * 100) / 100;
  return {
    clockIn: inT,
    clockOut: outT,
    workHours: roundedWorkHours,
    isLate, isEarlyLeave, isMissedPunch: false, status,
    sourceOvertime, sourceBusinessTrip, sourceOutside,
    sourceOvertimeHours: Number(overtimeHours) || markedHours(combinedSource, '加班') || (sourceOvertime ? Math.max(0, roundedWorkHours - 8) : 0),
    sourceBusinessTripHours: Number(businessTripHours) || markedHours(combinedSource, '出差') || (sourceBusinessTrip ? roundedWorkHours : 0),
    sourceOutsideHours: Number(outsideHours) || markedHours(combinedSource, '外出') || (sourceOutside ? roundedWorkHours : 0),
  };
}

module.exports = { computeDaily, parseTime, SHIFT_START, SHIFT_END };

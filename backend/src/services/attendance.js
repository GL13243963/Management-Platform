const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);

const SHIFT_START = '09:35';
const SHIFT_END = '17:30';
const STANDARD_WORKDAY_HOURS = 8;
const ATTENDANCE_EXCLUSION_RE = /年假|事假|病假|婚假|产假|陪产假|丧假|请假|外出|调休/;
const MISSED_PUNCH_RE = /漏刷|漏卡|缺卡|未打卡/;

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

function parseOvertimeDuration(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const clock = text.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60 + Number(clock[3] || 0) / 3600;
  const units = text.match(/^(?:(\d+(?:\.\d+)?)\s*(?:小时|h))?\s*(?:(\d+(?:\.\d+)?)\s*(?:分钟|分|min))?$/i);
  return units && (units[1] || units[2]) ? Number(units[1] || 0) + Number(units[2] || 0) / 60 : null;
}

function overtimeHoursFromText(text) {
  const durations = String(text || '').matchAll(/加班(?:时长|小时数)?\s*[:：=]?\s*(\d+:\d{2}(?::\d{2})?|\d+(?:\.\d+)?\s*(?:小时|h)(?:\s*\d+(?:\.\d+)?\s*(?:分钟|分|min))?|\d+(?:\.\d+)?\s*(?:分钟|分|min)|\d+(?:\.\d+)?(?=\s*(?:$|[，,；;）)])))/gi);
  for (const match of durations) {
    const hours = parseOvertimeDuration(match[1]);
    if (hours !== null) return hours;
  }
  return null;
}

function attendanceExclusionReason(value) {
  const text = typeof value === 'object' && value
    ? `${value.rawClockIn || value.clockIn || ''} ${value.rawClockOut || value.clockOut || ''} ${value.sourceText || ''}`
    : String(value || '');
  return text.match(ATTENDANCE_EXCLUSION_RE)?.[0] || null;
}

function isAttendanceExcluded(log) {
  if (log?.overrideType === 'remote_work' || log?.status === 'remote_work') return false;
  const excludedOverride = log?.overrideType;
  return !!(excludedOverride || log?.status === 'excluded' || attendanceExclusionReason(log));
}

function isOutsideWork(log) {
  if (log?.overrideType) return false;
  return !!((log?.sourceOutside || attendanceExclusionReason(log) === '外出') && Number(log?.workHours) > 0);
}

function isWorkHoursExcluded(log) {
  return isAttendanceExcluded(log) && !isOutsideWork(log);
}

function isWeekendDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return false;
  const day = dayjs(date).day();
  return day === 0 || day === 6;
}

function explicitMissedPunchCount(clockIn, clockOut, sourceText) {
  const count = [clockIn, clockOut].reduce((sum, value) => sum + Number(MISSED_PUNCH_RE.test(String(value || ''))), 0);
  return count || (MISSED_PUNCH_RE.test(String(sourceText || '')) ? 1 : 0);
}

function computeDaily({ date, clockIn, clockOut, sourceText = '', overtimeHours, businessTripHours, outsideHours, preferSourceStatus = false }) {
  // Attendance exports may append an authoritative status marker to the time,
  // for example "17:43 早退" when a person's scheduled end is later than 17:30.
  const sourceLate = /迟到/.test(String(clockIn || ''));
  const sourceEarlyLeave = /早退/.test(String(clockOut || ''));
  const combinedSource = `${clockIn || ''} ${clockOut || ''} ${sourceText || ''}`;
  const missedPunchCount = explicitMissedPunchCount(clockIn, clockOut, sourceText);
  const sourceMissedPunch = missedPunchCount > 0;
  const explicitOvertime = parseOvertimeDuration(overtimeHours) ?? overtimeHoursFromText(combinedSource);
  const sourceOvertime = /加班/.test(combinedSource) || explicitOvertime > 0;
  const sourceBusinessTrip = /出差/.test(combinedSource) || Number(businessTripHours) > 0;
  const sourceOutside = /外出/.test(combinedSource) || Number(outsideHours) > 0;
  const punchTime = value => parseTime(String(value ?? '').replace(/加班(?:时长|小时数)?\s*[:：=]?\s*\d+:\d{2}(?::\d{2})?/g, ''));
  const inT = punchTime(clockIn);
  const outT = punchTime(clockOut);
  const excludedReason = attendanceExclusionReason(combinedSource) || (sourceOutside ? '外出' : null);
  const isWeekend = isWeekendDate(date);

  if (excludedReason) {
    const punchedHours = inT && outT ? Math.max(0, (toMinutes(outT) - toMinutes(inT)) / 60) : 0;
    const markedOutsideHours = Number(outsideHours) || markedHours(combinedSource, '外出') || 0;
    const outsideWorkHours = excludedReason === '外出'
      ? Math.round(Math.max(punchedHours, markedOutsideHours) * 100) / 100
      : 0;
    return {
      clockIn: inT, clockOut: outT, workHours: outsideWorkHours,
      isLate: false, isEarlyLeave: false, isMissedPunch: false,
      missedPunchCount: 0,
      status: 'excluded',
      sourceOvertime: false, sourceBusinessTrip, sourceOutside,
      sourceOvertimeHours: 0,
      sourceBusinessTripHours: Number(businessTripHours) || markedHours(combinedSource, '出差') || 0,
      sourceOutsideHours: sourceOutside ? (markedOutsideHours || outsideWorkHours) : 0,
    };
  }

  // Textual attendance results exported by the source system are
  // authoritative. A marker-only overtime/business-trip cell is not a punch.
  if (!inT && !outT && (sourceOvertime || sourceBusinessTrip)) {
    const sourceOvertimeHours = explicitOvertime ?? 0;
    const sourceBusinessTripHours = Number(businessTripHours) || markedHours(combinedSource, '出差') || 0;
    return {
      clockIn: null, clockOut: null, workHours: sourceBusinessTrip ? sourceBusinessTripHours : 0,
      isLate: !isWeekend && sourceLate, isEarlyLeave: !isWeekend && sourceEarlyLeave, isMissedPunch: false, missedPunchCount: 0,
      status: sourceBusinessTrip ? 'business_trip' : 'overtime',
      sourceOvertime, sourceBusinessTrip, sourceOutside,
      sourceOvertimeHours,
      sourceBusinessTripHours,
      sourceOutsideHours: Number(outsideHours) || markedHours(combinedSource, '外出') || 0,
    };
  }

  // Weekend punches represent overtime only. They never create attendance
  // anomalies, even when the source contains late/early/missing markers.
  if (isWeekend) {
    const validPunchCount = Number(!!inT) + Number(!!outT);
    const workHours = inT && outT
      ? Math.max(0, (toMinutes(outT) - toMinutes(inT)) / 60)
      : validPunchCount === 1 ? 4 : 0;
    const roundedWorkHours = Math.round(workHours * 100) / 100;
    return {
      clockIn: inT, clockOut: outT, workHours: roundedWorkHours,
      isLate: false, isEarlyLeave: false, isMissedPunch: false, missedPunchCount: 0,
      status: 'weekend_overtime',
      sourceOvertime: sourceOvertime || roundedWorkHours > 0, sourceBusinessTrip, sourceOutside,
      sourceOvertimeHours: explicitOvertime ?? 0,
      sourceBusinessTripHours: Number(businessTripHours) || markedHours(combinedSource, '出差') || 0,
      sourceOutsideHours: Number(outsideHours) || markedHours(combinedSource, '外出') || 0,
    };
  }

  // A single missing punch invalidates only its half-day: retain the other
  // half-day as 4 hours. With no valid punch, no work hours are retained.
  if (sourceMissedPunch || (!preferSourceStatus && (!inT || !outT))) {
    const validPunchCount = Number(!!inT) + Number(!!outT);
    return {
      clockIn: inT, clockOut: outT,
      workHours: validPunchCount === 1 ? 4 : 0,
      isLate: sourceLate,
      isEarlyLeave: sourceEarlyLeave,
      isMissedPunch: true,
      missedPunchCount: missedPunchCount || 1,
      status: 'missed_punch',
      sourceOvertime, sourceBusinessTrip, sourceOutside,
      sourceOvertimeHours: explicitOvertime ?? 0,
      sourceBusinessTripHours: Number(businessTripHours) || markedHours(combinedSource, '出差') || 0,
      sourceOutsideHours: Number(outsideHours) || markedHours(combinedSource, '外出') || 0,
    };
  }


  if (!inT || !outT) {
    return {
      clockIn: inT, clockOut: outT, workHours: 0,
      isLate: sourceLate, isEarlyLeave: sourceEarlyLeave, isMissedPunch: false, missedPunchCount: 0,
      status: sourceLate ? 'late' : sourceEarlyLeave ? 'early' : 'normal',
      sourceOvertime, sourceBusinessTrip, sourceOutside,
      sourceOvertimeHours: explicitOvertime ?? 0,
      sourceBusinessTripHours: Number(businessTripHours) || markedHours(combinedSource, '出差') || 0,
      sourceOutsideHours: Number(outsideHours) || markedHours(combinedSource, '外出') || 0,
    };
  }

  const startMin = toMinutes(SHIFT_START);
  const endMin = toMinutes(SHIFT_END);
  const inMin = toMinutes(inT);
  const outMin = toMinutes(outT);

  const workHours = Math.max(0, (outMin - inMin) / 60);

  const isLate = preferSourceStatus ? sourceLate : sourceLate || inMin > startMin;
  const isEarlyLeave = preferSourceStatus ? sourceEarlyLeave : sourceEarlyLeave || outMin < endMin;

  let status = 'normal';
  if (isLate && isEarlyLeave) status = 'late_and_early';
  else if (isLate) status = 'late';
  else if (isEarlyLeave) status = 'early';

  const roundedWorkHours = Math.round(workHours * 100) / 100;
  return {
    clockIn: inT,
    clockOut: outT,
    workHours: roundedWorkHours,
    isLate, isEarlyLeave, isMissedPunch: false, missedPunchCount: 0, status,
    sourceOvertime, sourceBusinessTrip, sourceOutside,
    sourceOvertimeHours: explicitOvertime ?? (sourceOvertime ? Math.max(0, roundedWorkHours - 8) : 0),
    sourceBusinessTripHours: Number(businessTripHours) || markedHours(combinedSource, '出差') || (sourceBusinessTrip ? roundedWorkHours : 0),
    sourceOutsideHours: Number(outsideHours) || markedHours(combinedSource, '外出') || (sourceOutside ? roundedWorkHours : 0),
  };
}

function remoteWorkPatch(log, workHours = STANDARD_WORKDAY_HOURS) {
  return {
    rawClockIn: log.rawClockIn ?? log.clockIn,
    rawClockOut: log.rawClockOut ?? log.clockOut,
    clockIn: null, clockOut: null, workHours, status: 'remote_work',
    isLate: false, isEarlyLeave: false, isMissedPunch: false, missedPunchCount: 0,
  };
}

module.exports = { remoteWorkPatch, STANDARD_WORKDAY_HOURS, computeDaily, parseTime, attendanceExclusionReason, isAttendanceExcluded, isOutsideWork, isWorkHoursExcluded, isWeekendDate, overtimeHoursFromText, SHIFT_START, SHIFT_END };

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const dayjs = require('dayjs');
const { db, Employee, AttendanceLog, Adjustment } = require('../models');
const { computeDaily } = require('../services/attendance');
const { parseMonthlyReport } = require('../services/monthly-report');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

/** Row-based (one row per punch) format */
const KEY_MAP = {
  name: ['name', '姓名', '员工', '员工姓名'],
  date: ['date', '日期', '打卡日期'],
  clockIn: ['clockIn', 'in', '上班', '上班打卡', '签到', '上班时间'],
  clockOut: ['clockOut', 'out', '下班', '下班打卡', '签退', '下班时间'],
  sourceText: ['status', '状态', '考勤状态', '备注', '异常'],
  overtimeHours: ['overtimeHours', '加班时长', '加班小时'],
  businessTripHours: ['businessTripHours', '出差时长', '出差小时'],
  outsideHours: ['outsideHours', '外出时长', '外出小时'],
};
function pickKey(row, group) {
  for (const k of KEY_MAP[group]) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
  }
  return null;
}
function normalizeDate(v) {
  if (v == null) return null;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return dayjs(new Date(d.y, d.m - 1, d.d)).format('YYYY-MM-DD');
  }
  const parsed = dayjs(String(v).trim());
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
}
function normalizeTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const total = Math.round(v * 24 * 60);
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return String(v).trim();
}

/** Detect whether the workbook is the matrix-style monthly report. */
function isMonthlyReportFormat(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  // Signature: a row whose first cell is "姓名" or "帐号" and has date-like headers.
  let idx = rows.findIndex(r => r && (String(r[0]) === '姓名' || String(r[0]) === '帐号'));
  if (idx >= 0) {
    const header = rows[idx];
    const dateLike = header.slice(9).filter(v => /^\d{1,2}\/[一二三四五六日]/.test(String(v))).length;
    return dateLike >= 5;
  }
  // Alternative check: look for any row with date-like headers from column 9
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i];
    if (row && row.length > 11) {
      const dateLike = row.slice(9).filter(v => /^\d{1,2}\/[一二三四五六日]/.test(String(v))).length;
      if (dateLike >= 5) return true;
    }
  }
  return false;
}

async function importMonthlyReport(filePath) {
  const { startDate, endDate, records } = parseMonthlyReport(filePath);
  let created = 0, updated = 0;
  let removedStale = 0;
  const verification = new Map();
  const empByName = new Map();

  for (const r of records) {
    if (empByName.has(r.name)) continue;
    let emp = Employee.findByName(r.name);
    if (!emp) emp = Employee.create({ name: r.name, department: r.department, employeeNo: r.employeeNo });
    empByName.set(r.name, emp);
  }

  const importRecords = () => {
    const sourceKeys = new Set(records.map(r => `${empByName.get(r.name).id}:${r.date}`));
    removedStale = AttendanceLog.deleteMissingInRange(
      Array.from(empByName.values(), emp => emp.id), startDate, endDate, sourceKeys,
    );

    for (const r of records) {
      const emp = empByName.get(r.name);
      const daily = computeDaily({ clockIn: r.clockIn, clockOut: r.clockOut, sourceText: `${r.rawClockIn || ''} ${r.rawClockOut || ''}` });
      const { row, created: isNew } = AttendanceLog.upsert({
        employeeId: emp.id, employeeName: emp.name, date: r.date,
        clockIn: daily.clockIn, clockOut: daily.clockOut,
        workHours: daily.workHours, status: daily.status,
        isLate: daily.isLate, isEarlyLeave: daily.isEarlyLeave, isMissedPunch: daily.isMissedPunch,
        rawClockIn: r.rawClockIn, rawClockOut: r.rawClockOut,
        sourceRow: r.sourceRow, sourceColumn: r.sourceColumn,
        sourceOvertime: daily.sourceOvertime, sourceBusinessTrip: daily.sourceBusinessTrip, sourceOutside: daily.sourceOutside,
        sourceOvertimeHours: daily.sourceOvertimeHours, sourceBusinessTripHours: daily.sourceBusinessTripHours, sourceOutsideHours: daily.sourceOutsideHours,
      });
      const check = verification.get(r.name) || {
        employeeName: r.name,
        source: { late: 0, early: 0, missedPunch: 0 },
        imported: { late: 0, early: 0, missedPunch: 0 },
      };
      check.source.late += daily.isLate ? 1 : 0;
      check.source.early += daily.isEarlyLeave ? 1 : 0;
      check.source.missedPunch += daily.isMissedPunch ? 1 : 0;
      check.imported.late += row.isLate ? 1 : 0;
      check.imported.early += row.isEarlyLeave ? 1 : 0;
      check.imported.missedPunch += row.isMissedPunch ? 1 : 0;
      verification.set(r.name, check);
      if (isNew) created++; else updated++;
    }
  };
  db.transaction(importRecords)();
  const reconciliation = Array.from(verification.values()).map(item => ({
    ...item,
    matched: item.source.late === item.imported.late
      && item.source.early === item.imported.early
      && item.source.missedPunch === item.imported.missedPunch,
  }));
  return {
    format: 'monthly-report', startDate, endDate, created, updated, removedStale, skipped: 0,
    verified: reconciliation.every(item => item.matched),
    reconciliation,
  };
}

function importRowFormat(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  let created = 0, updated = 0, skipped = 0;
  for (const raw of rows) {
    const name = pickKey(raw, 'name');
    const date = normalizeDate(pickKey(raw, 'date'));
    const clockIn = normalizeTime(pickKey(raw, 'clockIn'));
    const clockOut = normalizeTime(pickKey(raw, 'clockOut'));
    if (!name || !date) { skipped++; continue; }
    let emp = Employee.findByName(name);
    if (!emp) emp = Employee.create({ name });
    const daily = computeDaily({ clockIn, clockOut, sourceText: pickKey(raw, 'sourceText'), overtimeHours: pickKey(raw, 'overtimeHours'), businessTripHours: pickKey(raw, 'businessTripHours'), outsideHours: pickKey(raw, 'outsideHours') });
    const { created: isNew } = AttendanceLog.upsert({
      employeeId: emp.id, employeeName: emp.name, date,
      clockIn: daily.clockIn, clockOut: daily.clockOut,
      workHours: daily.workHours, status: daily.status,
      isLate: daily.isLate, isEarlyLeave: daily.isEarlyLeave, isMissedPunch: daily.isMissedPunch,
      rawClockIn: clockIn, rawClockOut: clockOut,
      sourceOvertime: daily.sourceOvertime, sourceBusinessTrip: daily.sourceBusinessTrip, sourceOutside: daily.sourceOutside,
      sourceOvertimeHours: daily.sourceOvertimeHours, sourceBusinessTripHours: daily.sourceBusinessTripHours, sourceOutsideHours: daily.sourceOutsideHours,
    });
    if (isNew) created++; else updated++;
  }
  return { format: 'row', created, updated, skipped };
}

router.post('/import', upload.single('file'), async (req, res) => {
  let uploadedPath = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    uploadedPath = req.file.path;

    let result;
    const isMonthly = isMonthlyReportFormat(req.file.path);

    if (isMonthly) {
      result = await importMonthlyReport(req.file.path);
    } else {
      result = importRowFormat(req.file.path);
    }
    res.json({ ok: true, format: isMonthly ? 'monthly' : 'row', ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally {
    if (uploadedPath) {
      try { fs.unlinkSync(uploadedPath); } catch {}
    }
  }
});

router.get('/', (req, res) => res.json(AttendanceLog.query(req.query)));

// Return the earliest/latest attendance dates and record count — used by the
// frontend to display a data-cutoff warning banner.
router.get('/date-range', (req, res) => {
  const att = db.prepare(`
    SELECT MIN(date) AS earliestDate, MAX(date) AS latestDate,
           COUNT(*) AS totalRecords, MAX(createdAt) AS lastImport
    FROM attendance_logs
    WHERE source='import'
  `).get() || {};
  const mem = db.prepare(`
    SELECT MIN(effectiveFrom) AS earliestMembershipDate,
           MAX(COALESCE(effectiveTo, date('now','localtime'))) AS latestMembershipDate,
           COUNT(*) AS membershipRecords, MAX(createdAt) AS lastMembershipImport
    FROM project_memberships
  `).get() || {};
  // Warn if attendance and allocation date ranges don't overlap —
  // either allocations start before attendance data, or after it ends.
  const noOverlap = !!(
    att.latestDate && mem.earliestMembershipDate && mem.earliestMembershipDate > att.latestDate
  );
  const allocBeforeAtt = !!(
    att.earliestDate && mem.earliestMembershipDate && mem.earliestMembershipDate < att.earliestDate
  );
  const hasWarning = noOverlap || allocBeforeAtt;
  res.json({
    earliestDate: att.earliestDate || null,
    latestDate: att.latestDate || null,
    totalRecords: att.totalRecords || 0,
    lastImport: att.lastImport || null,
    earliestMembershipDate: mem.earliestMembershipDate || null,
    latestMembershipDate: mem.latestMembershipDate || null,
    membershipRecords: mem.membershipRecords || 0,
    lastMembershipImport: mem.lastMembershipImport || null,
    hasWarning,
  });
});

router.patch('/:id', (req, res) => {
  const log = AttendanceLog.find(req.params.id);
  if (!log) return res.status(404).json({ error: 'not found' });

  const { overrideType, overrideNote, clockIn, clockOut } = req.body;
  const patch = {};

  if (clockIn !== undefined || clockOut !== undefined) {
    const daily = computeDaily({
      clockIn: clockIn ?? log.clockIn,
      clockOut: clockOut ?? log.clockOut,
    });
    Object.assign(patch, daily);
  }
  if (overrideType !== undefined) {
    if (overrideType) {
      patch.overrideType = overrideType;
      patch.overrideNote = overrideNote || null;
      patch.status = overrideType;
      if (!patch.workHours) patch.workHours = 8;
    } else {
      patch.overrideType = null; patch.overrideNote = null;
      const daily = computeDaily({
        clockIn: clockIn ?? log.rawClockIn ?? log.clockIn,
        clockOut: clockOut ?? log.rawClockOut ?? log.clockOut,
      });
      Object.assign(patch, daily);
    }
  }
  const saved = AttendanceLog.update(log.id, patch);
  if (overrideType) {
    Adjustment.create({
      attendanceLogId: log.id, employeeId: log.employeeId, date: log.date,
      type: overrideType, reason: overrideNote,
    });
  }
  res.json(saved);
});

module.exports = router;

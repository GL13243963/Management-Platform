const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const dayjs = require('dayjs');
const { Employee, AttendanceLog, Adjustment } = require('../models');
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
  // Signature: a row whose first cell is "帐号" and has 10+ date-like headers.
  const idx = rows.findIndex(r => r && r[0] === '帐号');
  if (idx < 0) return false;
  const header = rows[idx];
  const dateLike = header.slice(10).filter(v => /^\d{1,2}\/[一二三四五六日]/.test(String(v))).length;
  return dateLike >= 5;
}

async function importMonthlyReport(filePath) {
  const { startDate, endDate, records } = parseMonthlyReport(filePath);
  let created = 0, updated = 0;
  const empByName = new Map();
  for (const r of records) {
    let emp = empByName.get(r.name);
    if (!emp) {
      emp = Employee.findByName(r.name);
      if (!emp) emp = Employee.create({ name: r.name, department: r.department, employeeNo: r.employeeNo });
      empByName.set(r.name, emp);
    }
    const daily = computeDaily({ clockIn: r.clockIn, clockOut: r.clockOut });
    const { created: isNew } = AttendanceLog.upsert({
      employeeId: emp.id, employeeName: emp.name, date: r.date,
      clockIn: daily.clockIn, clockOut: daily.clockOut,
      workHours: daily.workHours, status: daily.status,
      isLate: daily.isLate, isEarlyLeave: daily.isEarlyLeave,
    });
    if (isNew) created++; else updated++;
  }
  return { format: 'monthly-report', startDate, endDate, created, updated, skipped: 0 };
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
    const daily = computeDaily({ clockIn, clockOut });
    const { created: isNew } = AttendanceLog.upsert({
      employeeId: emp.id, employeeName: emp.name, date,
      clockIn: daily.clockIn, clockOut: daily.clockOut,
      workHours: daily.workHours, status: daily.status,
      isLate: daily.isLate, isEarlyLeave: daily.isEarlyLeave,
    });
    if (isNew) created++; else updated++;
  }
  return { format: 'row', created, updated, skipped };
}

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    let result;
    if (isMonthlyReportFormat(req.file.path)) {
      result = await importMonthlyReport(req.file.path);
    } else {
      result = importRowFormat(req.file.path);
    }
    try { fs.unlinkSync(req.file.path); } catch {}
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/', (req, res) => res.json(AttendanceLog.query(req.query)));

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
      patch.isLate = false; patch.isEarlyLeave = false; patch.status = overrideType;
      if (!patch.workHours) patch.workHours = 8;
    } else {
      patch.overrideType = null; patch.overrideNote = null;
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

/**
 * Monthly-report Excel parser.
 *
 * Handles the "matrix" attendance report where:
 *  - Rows 0–4  = title / meta / column headers (`08/一`, `09/二`, ...)
 *  - Row 5, 7, 9, ...  = employee 签到 row (with name in col 2, dept in col 3)
 *  - Row 6, 8, 10, ... = the same employee's 签退 row
 *
 * The `startDate` (YYYY-MM-DD) is required so we know the year+month that the day
 * numbers in the column headers belong to; when day numbers reset (e.g. 30 → 01)
 * the month rolls over automatically.
 */

const XLSX = require('xlsx');
const dayjs = require('dayjs');

const FILENAME_DATE_RE = /(\d{4})年(\d{2})月(\d{2})日至(\d{4})年(\d{2})月(\d{2})日/;

function inferDateRangeFromName(name = '') {
  const m = name.match(FILENAME_DATE_RE);
  if (!m) return null;
  return {
    startDate: `${m[1]}-${m[2]}-${m[3]}`,
    endDate:   `${m[4]}-${m[5]}-${m[6]}`,
  };
}

function buildColumnDates(headerRow, startDate) {
  // Column 10 is the first date column (aligned with startDate). Walk forward:
  // whenever the header's day number is LESS than the previous one, roll to next month.
  const map = {};
  let cursor = dayjs(startDate);
  const startDay = parseInt(String(headerRow[10]).split('/')[0], 10);
  if (Number.isNaN(startDay) || startDay !== cursor.date()) {
    // If header's first day doesn't match startDate.date(), still trust startDate.
  }
  map[10] = cursor.format('YYYY-MM-DD');
  let prevDay = cursor.date();
  for (let c = 11; c < headerRow.length; c++) {
    const cell = String(headerRow[c] || '').trim();
    if (!cell) break;
    const dayNum = parseInt(cell.split('/')[0], 10);
    if (Number.isNaN(dayNum)) break;
    if (dayNum < prevDay) cursor = cursor.add(1, 'month').date(dayNum);
    else cursor = cursor.date(dayNum);
    map[c] = cursor.format('YYYY-MM-DD');
    prevDay = dayNum;
  }
  return map;
}

/**
 * Parse a monthly report workbook and return:
 *   { startDate, endDate, records: [{ name, department, date, clockIn, clockOut }] }
 * If a day has no punch data for someone, no record is emitted for that (name, date).
 */
function parseMonthlyReport(filePath, opts = {}) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  // Infer date range from either explicit opts or the sheet name / file name.
  let range = opts.startDate && opts.endDate ? { startDate: opts.startDate, endDate: opts.endDate } : null;
  range = range || inferDateRangeFromName(wb.SheetNames[0]) || inferDateRangeFromName(filePath);
  if (!range) throw new Error('Cannot infer date range — pass { startDate, endDate } explicitly.');

  // Header row is at index 3 in this template (has "帐号 工号 姓名 ..." and 08/一 ...)
  const headerIdx = rows.findIndex(r => r && r[0] === '帐号');
  if (headerIdx < 0) throw new Error('Header row (帐号 姓名 部门 ...) not found.');
  const colDate = buildColumnDates(rows[headerIdx], range.startDate);
  const dateCols = Object.keys(colDate).map(Number);

  const records = [];
  const employees = new Set();

  // Iterate employee blocks: each employee occupies 2 rows starting at headerIdx + 2 (skip sub-header row).
  // In this template, first data row is headerIdx + 2 (the 签到 row of the first employee).
  for (let i = headerIdx + 2; i < rows.length; i += 2) {
    const rIn = rows[i];
    const rOut = rows[i + 1] || [];
    const name = String(rIn[2] || '').trim();
    if (!name) continue;
    const department = String(rIn[3] || '').trim();
    const employeeNo = String(rIn[1] || '').trim() || null;
    employees.add(name);

    for (const c of dateCols) {
      const clockIn = String(rIn[c] || '').trim() || null;
      const clockOut = String(rOut[c] || '').trim() || null;
      if (!clockIn && !clockOut) continue; // no punch → skip
      records.push({
        name, department, employeeNo,
        date: colDate[c], clockIn, clockOut,
      });
    }
  }

  return { ...range, employees: Array.from(employees), records };
}

module.exports = { parseMonthlyReport, buildColumnDates, inferDateRangeFromName };

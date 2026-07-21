/**
 * Monthly-report Excel parser.
 */

const XLSX = require('xlsx');
const dayjs = require('dayjs');

const FILENAME_DATE_RE = /(\d{4})年(\d{2})月(\d{2})日至(\d{4})年(\d{2})月(\d{2})日/;

function inferDateRangeFromName(name = '') {
  const m = name.match(FILENAME_DATE_RE);
  if (!m) return null;
  return {
    startDate: `${m[1]}-${m[2]}-${m[3]}`,
    endDate: `${m[4]}-${m[5]}-${m[6]}`,
  };
}

function buildColumnDates(headerRow, startDate) {
  // Column 9 (column J) is the first date column
  const map = {};
  let cursor = dayjs(startDate);
  map[9] = cursor.format('YYYY-MM-DD');
  let prevDay = cursor.date();

  for (let c = 10; c < headerRow.length; c++) {
    const cell = String(headerRow[c] || '').trim();
    if (!cell) break;
    const dayMatch = cell.match(/^(\d+)/);
    if (!dayMatch) break;
    const dayNum = parseInt(dayMatch[1], 10);
    if (Number.isNaN(dayNum)) break;

    if (dayNum < prevDay) cursor = cursor.add(1, 'month').date(dayNum);
    else cursor = cursor.date(dayNum);

    map[c] = cursor.format('YYYY-MM-DD');
    prevDay = dayNum;
  }
  return map;
}

/**
 * Parse a monthly report workbook and return records.
 */
function parseMonthlyReport(filePath, opts = {}) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  // Infer date range from either explicit opts or the sheet name / file name.
  let range = opts.startDate && opts.endDate ? { startDate: opts.startDate, endDate: opts.endDate } : null;
  range = range || inferDateRangeFromName(wb.SheetNames[0]) || inferDateRangeFromName(filePath);

  let headerIdx = rows.findIndex(r => r && String(r[0]) === '姓名');
  if (headerIdx < 0) {
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      if (rows[i] && String(rows[i][0]) === '帐号') {
        headerIdx = i;
        break;
      }
    }
  }
  if (headerIdx < 0) throw new Error('Header row (姓名 部门 ...) not found.');

  // Try to infer start date from header: if first date col is '21/日' and last date col is '20/一'
  // Then it's probably 6/21 to 7/20
  if (!range) {
    const headerRow = rows[headerIdx];
    let firstDay = null, lastDay = null;
    for (let c = 9; c < headerRow.length; c++) {
      const cell = String(headerRow[c] || '').trim();
      if (!cell) continue;
      const dayMatch = cell.match(/^(\d+)/);
      if (!dayMatch) continue;
      const dayNum = parseInt(dayMatch[1], 10);
      if (!firstDay) firstDay = dayNum;
      lastDay = dayNum;
    }

    if (firstDay !== null && lastDay !== null) {
      const now = dayjs();
      let startYear = now.year();
      let startMonth = now.month();

      if (firstDay > lastDay) {
        startMonth = now.month() - 1;
        if (startMonth < 0) {
          startMonth = 11;
          startYear--;
        }
      }
      const startDate = dayjs().year(startYear).month(startMonth).date(firstDay);
      const endDate = firstDay > lastDay ? startDate.add(1, 'month').date(lastDay) : startDate.date(lastDay);
      range = {
        startDate: startDate.format('YYYY-MM-DD'),
        endDate: endDate.format('YYYY-MM-DD'),
      };
    }
  }
  if (!range) throw new Error('Cannot infer date range.');

  const colDate = buildColumnDates(rows[headerIdx], range.startDate);
  const dateCols = Object.keys(colDate).map(Number);

  const records = [];
  const employees = new Set();

  let firstDataRow = headerIdx + 1;
  for (let i = headerIdx + 1; i < Math.min(headerIdx + 20, rows.length); i++) {
    const firstCell = rows[i] && String(rows[i][0]).trim();
    if (firstCell && firstCell !== '姓名' && firstCell !== '帐号') {
      firstDataRow = i;
      break;
    }
  }

  for (let i = firstDataRow; i < rows.length; i += 2) {
    const rIn = rows[i];
    const rOut = rows[i + 1] || [];

    const name = String(rIn[0] || '').trim();
    if (!name) continue;
    if (name.includes('合计') || name.includes('总计') || name.includes('小计')) continue;

    const department = String(rIn[1] || '').trim();
    employees.add(name);

    for (const c of dateCols) {
      const clockIn = String(rIn[c] || '').trim() || null;
      const clockOut = String(rOut[c] || '').trim() || null;

      if (!clockIn && !clockOut) continue;

      records.push({
        name, department,
        date: colDate[c], clockIn, clockOut,
        overrideType: null,
      });
    }
  }

  return { ...range, employees: Array.from(employees), records };
}

module.exports = { parseMonthlyReport, buildColumnDates, inferDateRangeFromName };

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

function findDateColumns(headerRow) {
  return headerRow
    .map((value, index) => (/^\d{1,2}\/[一二三四五六日]$/.test(String(value || '').trim()) ? index : -1))
    .filter(index => index >= 0);
}

function buildColumnDates(headerRow, startDate) {
  const map = {};
  const dateColumns = findDateColumns(headerRow);
  if (!dateColumns.length) return map;

  let cursor = dayjs(startDate);
  map[dateColumns[0]] = cursor.format('YYYY-MM-DD');
  let prevDay = cursor.date();

  for (const c of dateColumns.slice(1)) {
    const cell = String(headerRow[c] || '').trim();
    const dayMatch = cell.match(/^(\d+)/);
    if (!dayMatch) continue;
    const dayNum = parseInt(dayMatch[1], 10);
    if (Number.isNaN(dayNum)) continue;

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

  let headerIdx = rows.findIndex(r => r && r.some(cell => ['姓名', '帐号'].includes(String(cell).trim())) && findDateColumns(r).length >= 5);
  if (headerIdx < 0) throw new Error('Header row (姓名 部门 ...) not found.');

  // Try to infer start date from header: if first date col is '21/日' and last date col is '20/一'
  // Then it's probably 6/21 to 7/20
  if (!range) {
    const headerRow = rows[headerIdx];
    let firstDay = null, lastDay = null;
    for (const c of findDateColumns(headerRow)) {
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
  const headerRow = rows[headerIdx];
  const nameCol = headerRow.findIndex(cell => String(cell).trim() === '姓名');
  const departmentCol = headerRow.findIndex(cell => String(cell).trim() === '部门');
  const employeeNoCol = headerRow.findIndex(cell => ['工号', '帐号'].includes(String(cell).trim()));
  if (nameCol < 0) throw new Error('Name column not found.');

  const records = [];
  const employees = new Set();

  let firstDataRow = headerIdx + 1;
  for (let i = headerIdx + 1; i < Math.min(headerIdx + 20, rows.length); i++) {
    const employeeName = rows[i] && String(rows[i][nameCol] || '').trim();
    if (employeeName && employeeName !== '姓名') {
      firstDataRow = i;
      break;
    }
  }

  for (let i = firstDataRow; i < rows.length; i += 2) {
    const rIn = rows[i];
    const rOut = rows[i + 1] || [];

    const name = String(rIn[nameCol] || '').trim();
    if (!name) continue;
    if (name.includes('合计') || name.includes('总计') || name.includes('小计')) continue;

    const department = departmentCol >= 0 ? String(rIn[departmentCol] || '').trim() : '';
    const employeeNo = employeeNoCol >= 0 ? String(rIn[employeeNoCol] || '').trim() : '';
    employees.add(name);

    for (const c of dateCols) {
      const rawClockIn = String(rIn[c] || '').trim() || null;
      const rawClockOut = String(rOut[c] || '').trim() || null;

      if (!rawClockIn && !rawClockOut) continue;

      records.push({
        name, department, employeeNo,
        date: colDate[c], clockIn: rawClockIn, clockOut: rawClockOut,
        rawClockIn, rawClockOut,
        sourceRow: i + 1, sourceColumn: c + 1,
        overrideType: null,
      });
    }
  }

  return { ...range, employees: Array.from(employees), records };
}

module.exports = { parseMonthlyReport, buildColumnDates, findDateColumns, inferDateRangeFromName };

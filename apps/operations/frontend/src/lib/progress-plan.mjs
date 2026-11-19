import { read, utils, SSF } from 'xlsx';

const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const nonTasks = /^(?:(?:春节|国庆|五一|清明|端午|中秋|元旦)(?:假期?|放假)?|休息|放假|假期|调休|法定节假日)$/;
const dateFormat = 'yyyy-mm-dd';

function readCalendar(sheet, date1904) {
  if (!sheet['!ref']) return [];
  const range = utils.decode_range(sheet['!ref']);
  const cell = (r, c) => sheet[utils.encode_cell({ r, c })]?.v;
  const items = [];
  let firstDay = null;
  let dates = null;
  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let column = range.s.c; column + 6 <= range.e.c; column++) {
      if (weekdays.every((day, index) => cell(row, column + index) === day)) {
        firstDay = column;
        dates = null;
        break;
      }
    }
    if (firstDay === null) continue;
    const values = weekdays.map((_, index) => cell(row, firstDay + index));
    if (Number.isInteger(values[0]) && values[0] > 60 && values[0] <= 2958459 - 6
      && values.every((value, index) => value === values[0] + index)) {
      dates = values.map(value => SSF.format(dateFormat, value, { date1904 }));
      continue;
    }
    if (!dates) continue;
    values.forEach((value, index) => {
      if (typeof value !== 'string' || weekdays.includes(value)) return;
      const title = value.replace(/\s+/g, ' ').trim();
      if (title && !nonTasks.test(title)) items.push({ date: dates[index], title });
    });
  }
  return items;
}

export async function readProgressPlan(file) {
  if (!/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
    throw new Error('请选择不超过 5 MB 的 .xlsx 进度计划表');
  }
  let book;
  try {
    book = read(await file.arrayBuffer(), { cellNF: true, sheetRows: 2001 });
  } catch {
    throw new Error('无法打开 Excel，请检查文件是否完整');
  }
  const names = book.SheetNames.filter(name => /^进度计划/.test(name.trim()));
  const date1904 = !!book.Workbook?.WBProps?.date1904;
  const unique = new Map();
  for (const name of names) {
    const sheet = book.Sheets[name];
    if (sheet['!fullref'] && utils.decode_range(sheet['!fullref']).e.r >= 2001) {
      throw new Error('进度计划工作表超过 2,001 行，请拆分后导入');
    }
    for (const item of readCalendar(sheet, date1904)) unique.set(item.date + '\t' + item.title, item);
  }
  const items = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!items.length) throw new Error('未识别到周历任务。请检查「进度计划」工作表中的周一至周日、Excel 日期和任务。');
  const table = ['里程碑\t日期', ...items.map(item => item.title + '\t' + item.date)].join('\n');
  if (items.length > 200 || table.length > 24000 || items.some(item => item.title.length > 160)) {
    throw new Error('进度表最多支持 200 条节点、24,000 字，每条节点名称最多 160 字');
  }
  return { items, table };
}

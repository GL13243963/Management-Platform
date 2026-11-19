const dayjs = require('dayjs');
const { AttendanceLog } = require('../models');
const { distributeHours } = require('./allocation');

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && dayjs(value).format('YYYY-MM-DD') === value;
}

function normalizeDate(text) {
  const match = /^(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?$/.exec(text || '');
  if (!match) return null;
  const value = [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-');
  return isIsoDate(value) ? value : null;
}

function parseMilestones(text) {
  if (typeof text !== 'string' || text.length > 24000) throw new Error('请粘贴不超过 24,000 字的进度表');
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line, index) => ({
    number: index + 1, cells: line.split('\t').map(cell => cell.trim()),
  })).filter(row => row.cells.some(Boolean));
  if (rows.length < 2 || rows.length > 201) throw new Error('请粘贴表头和 1 至 200 行里程碑');
  const headers = rows.shift().cells;
  const columns = [
    ['里程碑', '阶段', '任务名称', '节点', '里程碑名称'],
    ['日期', '完成日期', '实际完成日期', '节点日期', '里程碑日期'],
    ['说明', '备注', '状态'],
  ].map((names, index) => {
    // Prefer the actual date when the sheet has both actual and planned columns.
    if (index === 1 && headers.includes('实际完成日期')) return headers.indexOf('实际完成日期');
    return headers.findIndex(header => names.includes(header));
  });
  if (columns[0] < 0 || columns[1] < 0) throw new Error('进度表须包含“里程碑”和“日期”两列，请从 Excel 复制含表头的区域');
  return rows.map(({ cells, number }) => {
    const title = cells[columns[0]];
    const date = normalizeDate(cells[columns[1]]);
    const note = cells[columns[2]] || '';
    if (!title || title.length > 160 || !date || note.length > 500) {
      throw new Error('进度表第 ' + number + ' 行无效：请检查里程碑名称、日期和说明');
    }
    return { title, date, note };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function summarizeProject({ project, memberships, startDate, endDate, milestones }) {
  const people = new Map();
  const attendanceDates = new Set();
  let latestPunch = null;
  for (const membership of memberships) {
    const id = Number(membership.employeeId);
    if (membership.effectiveFrom > endDate || (membership.effectiveTo && membership.effectiveTo < startDate)
      || !membership.empName || people.has(id)) continue;
    people.set(id, { id, name: membership.empName, hoursUnits: 0, days: new Set() });
  }
  for (const person of people.values()) {
    for (const log of AttendanceLog.queryAll({ startDate, endDate, employeeId: person.id })) {
      const units = distributeHours(log).reduce((sum, row) => Number(row.projectId) === Number(project.id)
        ? sum + Math.round(row.hours * 100) : sum, 0);
      if (units <= 0) continue;
      person.hoursUnits += units;
      person.days.add(log.date);
      attendanceDates.add(log.date);
      const clockOut = /^(?:[01]\d|2[0-3]):[0-5]\d(?:\:[0-5]\d)?$/.test(log.clockOut || '') ? log.clockOut.slice(0, 5) : null;
      if (clockOut && (!latestPunch || clockOut > latestPunch.time || (clockOut === latestPunch.time && log.date > latestPunch.date))) {
        latestPunch = { name: person.name, date: log.date, time: clockOut };
      }
    }
  }
  const ranked = [...people.values()].sort((a, b) => b.hoursUnits - a.hoursUnits || a.id - b.id);
  const top = ranked[0]?.hoursUnits || 0;
  const members = ranked.map(person => ({ id: person.id, name: person.name, hours: person.hoursUnits / 100, days: person.days.size }));
  const durationDays = (Date.parse(endDate) - Date.parse(startDate)) / 86400000 + 1;
  return {
    project: { id: project.id, name: project.name, code: project.code, manager: project.manager },
    startDate, endDate, durationDays, milestones, members,
    totalHours: ranked.reduce((sum, person) => sum + person.hoursUnits, 0) / 100,
    attendanceDays: attendanceDates.size,
    topContributors: top ? members.filter(person => person.hours === top / 100) : [],
    latestPunch,
  };
}

module.exports = { isIsoDate, parseMilestones, summarizeProject };

import dayjs from 'dayjs';
import api from '../api';

export function latestAttendanceMonthRange(coverage) {
  if (!coverage?.latestDate) return null;
  const latest = dayjs(coverage.latestPeriodEnd || coverage.latestDate);
  const earliest = coverage.earliestDate ? dayjs(coverage.earliestDate) : null;
  let start = coverage.latestPeriodStart
    ? dayjs(coverage.latestPeriodStart)
    : latest.subtract(1, 'month').add(1, 'day');
  if (earliest && start.isBefore(earliest, 'day')) start = earliest;
  return [start.startOf('day'), latest.endOf('day')];
}

export async function loadLatestAttendanceMonth(fallbackRange) {
  try {
    const coverage = await api.get('/attendance/date-range');
    return latestAttendanceMonthRange(coverage) || fallbackRange;
  } catch {
    return fallbackRange;
  }
}

export function latestProjectAllocationMonthRange(coverage) {
  if (!coverage?.latestDate) return null;
  const end = dayjs(coverage.latestDate);
  const earliest = coverage.earliestDate ? dayjs(coverage.earliestDate) : null;
  let start = end.subtract(1, 'month').add(1, 'day');
  if (earliest && start.isBefore(earliest, 'day')) start = earliest;
  return [start.startOf('day'), end.endOf('day')];
}

export async function loadLatestProjectAllocationMonth(fallbackRange) {
  try {
    const coverage = await api.get('/projects/date-range');
    return latestProjectAllocationMonthRange(coverage) || fallbackRange;
  } catch {
    return fallbackRange;
  }
}

export function weekRange(date = dayjs()) {
  const value = dayjs(date);
  const monday = value.subtract((value.day() + 6) % 7, 'day').startOf('day');
  return [monday, monday.add(6, 'day').endOf('day')];
}

export function latestAttendanceWeekRange(coverage) {
  return coverage?.latestDate ? weekRange(coverage.latestDate) : null;
}

export async function loadLatestAttendanceWeek(fallbackRange) {
  try {
    const coverage = await api.get('/attendance/date-range');
    return latestAttendanceWeekRange(coverage) || fallbackRange;
  } catch {
    return fallbackRange;
  }
}

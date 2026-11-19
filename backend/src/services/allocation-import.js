const XLSX = require('xlsx');
const dayjs = require('dayjs');
const { db, Employee, Project, ProjectMembership } = require('../models');

// Project name alias map — keys are substrings that appear in the spreadsheet,
// values are the canonical project names in the system.
const ALIASES = [
  { test: /宝山前期策划/, canonical: '根据地预研究-宝山区' },
  { test: /宏观区位分析/, canonical: '根据地预研究-宝山区' },
  { test: /^嘉定科创核(?!项目)/, canonical: '嘉定科创核项目' },
  { test: /科创核(?!项目)/, canonical: '嘉定科创核项目' },
  { test: /集团好城区面试/, canonical: '好城区' },
  { test: /^宝山$/, canonical: '根据地预研究-宝山区' },
];

function normalizeProjectName(raw) {
  let name = String(raw).trim();
  for (const { test, canonical } of ALIASES) {
    if (test.test(name)) {
      // Special case: "根据地预研究-宝山区-宏观区位分析" → "根据地预研究-宝山区"
      name = canonical;
      break;
    }
  }
  return name;
}

/**
 * Parse a project token like "嘉定科创核项目0.7" or "港汇花园1.0".
 * Returns { name, weight } where weight is between 0 and 1, defaulting to 1.
 * Weight detection: trailing number that is a decimal (contains ".") in range (0,1),
 * or exactly "1" / "1.0".
 */
function parseToken(token) {
  const raw = token.trim();
  if (!raw) return null;
  // Match trailing number
  const m = raw.match(/^(.+?)(\d+(?:\.\d+)?)$/);
  if (!m) return { name: normalizeProjectName(raw), weight: 1, explicit: false };
  const namePart = m[1].trim();
  const numStr = m[2];
  const num = parseFloat(numStr);
  // Treat as weight if: has decimal point and 0 < n <= 1, or exactly "1"
  const looksLikeWeight = (numStr.includes('.') && num > 0 && num <= 1) || numStr === '1';
  if (namePart && looksLikeWeight) {
    return { name: normalizeProjectName(namePart), weight: Math.round(num * 100) / 100, explicit: true };
  }
  return { name: normalizeProjectName(raw), weight: 1, explicit: false };
}

/** Split a cell into individual project tokens. Handles newline, 、, comma, slash, semicolon, and whitespace separators. */
function splitCell(cell) {
  if (!cell) return [];
  return String(cell)
    // This is one established project name in the source workbook, not two
    // projects separated by the Chinese enumeration mark.
    .replace(/州桥、南翔卡点研究/g, '州桥§南翔卡点研究')
    .split(/[\r\n、，,\/；;\s]+/)
    .map(s => s.replace(/州桥§南翔卡点研究/g, '州桥、南翔卡点研究').trim())
    .filter(Boolean);
}

/** Parse period header like "8月3-9" → { from: '2026-08-03', to: '2026-08-09' }. */
function parsePeriodHeader(header, year) {
  const m = String(header).match(/(\d{1,2})月(\d{1,2})\s*[-–至到]\s*(?:(\d{1,2})月)?(\d{1,2})/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const fromDay = parseInt(m[2], 10);
  const endMonth = m[3] ? parseInt(m[3], 10) : month;
  const toDay = parseInt(m[4], 10);
  const from = dayjs(`${year}-${String(month).padStart(2, '0')}-${String(fromDay).padStart(2, '0')}`);
  let endYear = year;
  if (endMonth < month) endYear += 1;
  let to = dayjs(`${endYear}-${String(endMonth).padStart(2, '0')}-${String(toDay).padStart(2, '0')}`);
  if (!m[3] && toDay < fromDay) to = from.add(1, 'month').date(toDay);
  return {
    from: from.format('YYYY-MM-DD'),
    to: to.format('YYYY-MM-DD'),
    label: `${month}月${fromDay}-${endMonth === month ? '' : `${endMonth}月`}${toDay}`,
  };
}

/** Build a cached project lookup. */
function createProjectCache(resolutions = {}) {
  const cache = new Map(Project.all().map(p => [p.name, p]));
  const projectsById = new Map(Project.all().map(p => [p.id, p]));
  const created = [];
  return {
    findOrCreate(name) {
      if (cache.has(name)) return { project: cache.get(name), created: false };
      const resolution = resolutions[name];
      if (!resolution) throw new Error(`新项目“${name}”尚未确认新建或归并`);
      if (resolution.action === 'merge') {
        const project = projectsById.get(Number(resolution.projectId));
        if (!project) throw new Error(`项目“${name}”选择的归并目标不存在`);
        cache.set(name, project);
        return { project, created: false };
      }
      if (resolution.action !== 'create') throw new Error(`项目“${name}”的处理方式无效`);
      const project = Project.create({ code: null, name, status: 'active' });
      cache.set(name, project);
      projectsById.set(project.id, project);
      created.push(name);
      return { project, created: true };
    },
    getCreated: () => created,
  };
}

function previewAllocationImport(filePath, opts = {}) {
  const parsed = parseAllocationWorkbook(filePath, opts);
  const existingProjects = Project.all();
  const existingNames = new Set(existingProjects.map(project => project.name));
  const importedNames = new Set(parsed.records.flatMap(record => record.projects.map(project => project.name)));
  return {
    year: parsed.year,
    periods: parsed.periods.map(period => period.label),
    unknownProjects: Array.from(importedNames).filter(name => !existingNames.has(name)).sort(),
    existingProjects: existingProjects.map(({ id, name, status }) => ({ id, name, status })),
  };
}

/** Find every membership overlapping a date range for an employee. */
function findOverlapping(employeeId, from, to) {
  return db.prepare(`
    SELECT * FROM project_memberships
    WHERE employeeId = ?
      AND effectiveFrom <= ? AND (effectiveTo IS NULL OR effectiveTo >= ?)
    ORDER BY id
  `).all(employeeId, to, from);
}

/**
 * Make one employee/week exactly match the spreadsheet while preserving any
 * portions of older memberships that lie before or after that week.
 */
function syncMembershipPeriod(employeeId, period, projects) {
  const desired = new Map(projects.map(project => [project.projectId, project]));
  const overlapping = findOverlapping(employeeId, period.from, period.to);
  const dayBefore = dayjs(period.from).subtract(1, 'day').format('YYYY-MM-DD');
  const dayAfter = dayjs(period.to).add(1, 'day').format('YYYY-MM-DD');
  let created = 0, updated = 0, removed = 0, adjusted = 0;

  for (const membership of overlapping) {
    const wanted = desired.get(membership.projectId);
    const isExactPeriod = membership.effectiveFrom === period.from
      && membership.effectiveTo === period.to;

    if (wanted && isExactPeriod) {
      if (Math.abs(membership.weight - wanted.weight) > 0.001) {
        ProjectMembership.update(membership.id, { weight: wanted.weight });
        updated++;
      }
      desired.delete(membership.projectId);
      continue;
    }

    const hasBefore = membership.effectiveFrom < period.from;
    const hasAfter = membership.effectiveTo === null || membership.effectiveTo > period.to;

    if (hasBefore && hasAfter) {
      ProjectMembership.update(membership.id, { effectiveTo: dayBefore });
      ProjectMembership.create({
        employeeId: membership.employeeId,
        projectId: membership.projectId,
        weight: membership.weight,
        role: membership.role,
        effectiveFrom: dayAfter,
        effectiveTo: membership.effectiveTo,
        note: membership.note,
      });
      adjusted++;
    } else if (hasBefore) {
      ProjectMembership.update(membership.id, { effectiveTo: dayBefore });
      adjusted++;
    } else if (hasAfter) {
      ProjectMembership.update(membership.id, { effectiveFrom: dayAfter });
      adjusted++;
    } else {
      db.prepare('DELETE FROM project_memberships WHERE id=?').run(membership.id);
      removed++;
    }
  }

  for (const project of desired.values()) {
    ProjectMembership.create({
      employeeId,
      projectId: project.projectId,
      weight: project.weight,
      role: 'member',
      effectiveFrom: period.from,
      effectiveTo: period.to,
      note: period.note || `导入 ${period.label}`,
    });
    created++;
  }

  return { created, updated, removed, adjusted };
}

function parseAllocationWorkbook(filePath, opts = {}) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  if (rows.length < 3) throw new Error('表格行数不足，至少需要表头和数据行');

  // Row 0: month labels ("8月份"), Row 1: date ranges ("8月3-9")
  const periodRow = rows[1];
  const workbookText = rows.slice(0, 2).flat().join(' ');
  const embeddedYear = workbookText.match(/(20\d{2})年/)?.[1]
    || String(opts.sourceName || '').match(/(20\d{2})/)?.[1];
  const requestedYear = Number(opts.year);
  const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100
    ? requestedYear
    : Number(embeddedYear) || new Date().getFullYear();

  // Each column from index 1 onward is a period
  const periods = [];
  for (let col = 1; col < periodRow.length; col++) {
    const period = parsePeriodHeader(periodRow[col], year);
    if (period) periods.push({ ...period, col });
  }
  if (!periods.length) throw new Error('未能识别任何工作周时间段（如"8月3-9"）');

  const records = [];
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const empName = String(row[0] || '').trim();
    if (!empName) continue;
    for (const period of periods) {
      const cell = row[period.col];
      const tokens = splitCell(cell);
      const parsed = tokens.map(parseToken).filter(Boolean);
      // If no tokens had explicit weights, distribute equally
      const hasExplicitWeights = parsed.some(p => p.explicit);
      if (!hasExplicitWeights && parsed.length > 1) {
        const w = Math.round((1 / parsed.length) * 100) / 100;
        parsed.forEach((p, idx) => {
          p.weight = idx === parsed.length - 1
            ? Math.round((1 - w * (parsed.length - 1)) * 100) / 100
            : w;
        });
      }
      // Keep empty cells as explicit records. An empty allocation in a newly
      // imported period means "no projects", so stale memberships from an
      // earlier overlapping import must be removed as well.
      records.push({ employeeName: empName, period, projects: parsed });
    }
  }
  return { year, periods, records };
}

function importAllocations(filePath, opts = {}) {
  const { year, periods, records } = parseAllocationWorkbook(filePath, opts);

  let created = 0;
  let updated = 0;
  let removed = 0;
  let adjusted = 0;
  const projectCache = createProjectCache(opts.resolutions || {});
  const employeesNotFound = new Set();

  const runImport = db.transaction(() => {
    // A later workbook is authoritative for every covered period. Clear the
    // overlapping slice for all existing memberships first, including people
    // omitted from the new workbook, so no stale allocation can survive.
    const employeeIds = db.prepare('SELECT DISTINCT employeeId FROM project_memberships').all();
    for (const period of periods) {
      for (const { employeeId } of employeeIds) {
        const result = syncMembershipPeriod(employeeId, period, []);
        removed += result.removed;
        adjusted += result.adjusted;
      }
    }

    for (const rec of records) {
      const emp = Employee.findByName(rec.employeeName);
      if (!emp) {
        employeesNotFound.add(rec.employeeName);
        continue;
      }
      const desiredProjects = rec.projects.map(proj => {
        const { project } = projectCache.findOrCreate(proj.name);
        return { projectId: project.id, weight: proj.weight };
      });
      const result = syncMembershipPeriod(emp.id, rec.period, desiredProjects);
      created += result.created;
      updated += result.updated;
      removed += result.removed;
      adjusted += result.adjusted;
    }
  });

  runImport();

  return {
    ok: true,
    year,
    periods: periods.map(p => p.label),
    created,
    updated,
    removed,
    adjusted,
    projectsCreated: projectCache.getCreated(),
    employeesNotFound: Array.from(employeesNotFound),
    totalRecords: records.length,
  };
}

module.exports = {
  importAllocations, parseAllocationWorkbook, normalizeProjectName,
  parseToken, splitCell, parsePeriodHeader, syncMembershipPeriod, previewAllocationImport,
};

<template>
  <div class="week-grid" role="region" aria-label="项目周工时占比" tabindex="0">
    <table>
      <thead>
        <tr>
          <th scope="col" class="project-col">项目（{{ projects.length }}）</th>
          <th v-for="week in grid.weeks" :key="week.key" scope="col">
            {{ week.label }}
            <small>{{ formatHours(week.total) }} 小时</small>
          </th>
          <th scope="col">期间合计<small>小时</small></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in grid.rows" :key="row.project.id">
          <th scope="row" class="project-col" :title="projectTitle(row.project)">
            <button v-if="row.project.canEditProgress" type="button" class="project-button"
              :aria-label="'编辑项目进度：' + row.project.name" @click="$emit('edit', row.project)">
              {{ row.project.name }}
            </button>
            <span v-else>{{ row.project.name }}</span>
          </th>
          <td v-for="cell in row.cells" :key="cell.week.key">
            <span class="week-cell" :data-level="cell.level"
              :title="formatHours(cell.hours) + ' 小时 · ' + cell.label"
              :aria-label="formatHours(cell.hours) + ' 小时，占比 ' + cell.label">
              {{ cell.hours ? cell.label : '—' }}
            </span>
          </td>
          <td class="project-total">{{ formatHours(row.total) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import dayjs from 'dayjs';

const props = defineProps({
  projects: { type: Array, required: true },
  timeline: { type: Object, required: true },
});
defineEmits(['edit']);

const hoursFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const formatHours = value => hoursFormat.format(value / 100);

function projectTitle(project) {
  const end = project.pendingEnd ? '待定' : project.timelineEnd;
  return [project.name, project.timelineStart && end ? '计划：' + project.timelineStart + ' 至 ' + end : '',
    '进度：' + (Number(project.completionPercent) || 0) + '%'].filter(Boolean).join('\n');
}

const grid = computed(() => {
  const { startDate, endDate, segments = [] } = props.timeline;
  const start = dayjs(startDate || null);
  const end = dayjs(endDate || null);
  const weeks = [];
  const byWeek = new Map();
  const projectIds = new Set(props.projects.map(project => String(project.id)));
  if (start.isValid() && end.isValid() && !start.isAfter(end, 'day')) {
    const monday = start.subtract((start.day() + 6) % 7, 'day');
    for (let day = monday; !day.isAfter(end, 'day'); day = day.add(7, 'day')) {
      const last = day.add(6, 'day');
      const firstShown = day.isBefore(start, 'day') ? start : day;
      const lastShown = last.isAfter(end, 'day') ? end : last;
      const key = day.format('YYYY-MM-DD');
      const label = firstShown.format(firstShown.year() === end.year() ? 'M/D' : 'YY/M/D')
        + '–' + lastShown.format(firstShown.year() === lastShown.year() ? 'M/D' : 'YY/M/D');
      const week = { key, label, total: 0, hoursByProject: new Map() };
      weeks.push(week);
      byWeek.set(key, week);
    }
  }

  // Add the displayed projects only, so filtering also updates each week's denominator.
  for (const segment of segments) {
    const week = byWeek.get(segment.weekStart);
    const id = String(segment.projectId);
    const hours = Math.round(Number(segment.hours) * 100);
    if (!week || !projectIds.has(id) || !Number.isFinite(hours) || hours <= 0) continue;
    week.hoursByProject.set(id, (week.hoursByProject.get(id) || 0) + hours);
    week.total += hours;
  }

  const rows = props.projects.map(project => {
    let total = 0;
    const cells = weeks.map(week => {
      const hours = week.hoursByProject.get(String(project.id)) || 0;
      total += hours;
      const share = week.total ? hours / week.total * 100 : 0;
      return {
        week, hours,
        label: !hours ? '0%' : share < 0.1 ? '<0.1%' : Number(share.toFixed(1)) + '%',
        level: !hours ? 0 : share < 10 ? 1 : share < 25 ? 2 : share < 50 ? 3 : share < 75 ? 4 : 5,
      };
    });
    return { project, total, cells };
  });
  return { weeks, rows };
});
</script>

<style scoped>
.week-grid { max-width: 100%; overflow-x: auto; padding-bottom: 4px; }
table { width: 100%; border-collapse: separate; border-spacing: 2px; font-size: 12px; font-variant-numeric: tabular-nums; }
th, td { padding: 0; text-align: center; }
thead th { min-width: 74px; padding: 5px 6px; background: #edf1f7; color: #273750; white-space: nowrap; }
thead small { display: block; color: #52637a; font-size: 11px; font-weight: 500; }
.project-col { position: sticky; left: 0; z-index: 1; width: 1%; min-width: 125px; max-width: 240px; padding: 2px 8px; text-align: left; background: #f4f6fa; overflow-wrap: anywhere; }
.project-button { padding: 0; border: 0; background: none; color: #214e97; font: inherit; text-align: left; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.week-cell { display: grid; place-items: center; min-height: 24px; padding: 0 4px; border-radius: 3px; color: #18375e; font-weight: 650; white-space: nowrap; }
.week-cell[data-level="0"] { background: #f5f7fa; color: #68798e; font-weight: 400; }
.week-cell[data-level="1"] { background: #e1eeff; }
.week-cell[data-level="2"] { background: #bfd9fc; }
.week-cell[data-level="3"] { background: #92b9f2; }
.week-cell[data-level="4"] { background: #376cb9; color: white; }
.week-cell[data-level="5"] { background: #224984; color: white; }
.project-total { padding: 2px 8px; background: #edf1f7; font-weight: 650; }
@media (max-width: 600px) { .project-col { max-width: 150px; } }
</style>

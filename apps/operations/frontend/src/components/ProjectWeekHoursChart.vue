<template>
  <div>
    <div v-show="hasHours" ref="chartElement" class="timeline-chart" />
    <a-empty v-if="!hasHours" description="所选期间暂无项目工时" />
    <ul class="project-legend" aria-label="项目图例与期间工时">
      <li v-for="row in grid.rows" :key="row.project.id">
        <span class="legend-swatch" :style="{ backgroundColor: row.color }" aria-hidden="true" />
        <button v-if="row.total > 0" type="button" class="project-button"
          :aria-pressed="focusedProjectId === String(row.project.id)"
          @click="toggleProjectFocus(String(row.project.id))">{{ row.project.name }}</button>
        <span v-else :title="projectTitle(row.project)">{{ row.project.name }}</span>
        <button v-if="row.project.canEditProgress" type="button" class="project-button"
          :title="projectTitle(row.project)" :aria-label="'编辑项目进度：' + row.project.name"
          @click="$emit('edit', row.project)">编辑</button>
        <span class="legend-hours">{{ formatHours(row.total) }} 小时</span>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
import dayjs from 'dayjs';

const props = defineProps({
  projects: { type: Array, required: true },
  timeline: { type: Object, required: true },
});
defineEmits(['edit']);

const hoursFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const formatHours = value => hoursFormat.format(value);

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

  // Add the displayed projects only, so each weekly total reflects the current filter.
  for (const segment of segments) {
    const week = byWeek.get(segment.weekStart);
    const id = String(segment.projectId);
    const hours = Math.round(Number(segment.hours) * 100);
    if (!week || !projectIds.has(id) || !Number.isFinite(hours) || hours <= 0) continue;
    week.hoursByProject.set(id, (week.hoursByProject.get(id) || 0) + hours);
    week.total += hours;
  }

  const projectOrder = new Map((props.timeline.projects || props.projects)
    .map((project, index) => [String(project.id), index]));
  const rows = props.projects.map(project => {
    const id = String(project.id);
    const values = weeks.map(week => week.hoursByProject.get(id) || 0);
    const index = projectOrder.get(id) ?? 0;
    const hue = Math.round(index * 137.508) % 360;
    return {
      project,
      color: projectColors[index] || `hsl(${hue}, 58%, 43%)`,
      spectrumOrder: projectHues[index] ?? ((hue + 40) % 360) - 40,
      values: values.map(hours => hours / 100),
      total: values.reduce((sum, hours) => sum + hours, 0) / 100,
    };
  }).sort((a, b) => a.spectrumOrder - b.spectrumOrder);
  return { weeks, rows };
});

const projectColors = ['#F82D76', '#D51E69', '#F47D12', '#FFB900', '#35CCB4',
  '#159D8B', '#2FB4DE', '#1685A4', '#9852E8', '#6336AE'];
const projectHues = [-24, -23, 28, 44, 170, 172, 194, 196, 264, 268];
const hasHours = computed(() => grid.value.weeks.some(week => week.total > 0));
const chartElement = ref(null);
const focusedProjectId = ref(null);
let chart;
let observer;

function toggleProjectFocus(id) {
  focusedProjectId.value = focusedProjectId.value === id ? null : id;
  renderChart();
}

function renderChart() {
  if (!chart || !hasHours.value) return;
  const { weeks, rows } = grid.value;
  chart.setOption({
    aria: { enabled: true, label: { description: '项目周工时堆叠图。每层表示项目工时，总高度表示当周合计。' } },
    grid: { left: 14, right: 22, top: 40, bottom: 16, containLabel: true },
    xAxis: { type: 'category', boundaryGap: weeks.length === 1, data: weeks.map(week => week.label) },
    yAxis: { type: 'value', name: '工时（小时）' },
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter(items) {
        const week = weeks[items[0]?.dataIndex];
        if (!week) return '';
        const heading = echarts.format.encodeHTML(week.label) + ' · 合计 ' + formatHours(week.total / 100) + ' 小时';
        const details = items.filter(item => item.value > 0).reverse().map(item =>
          item.marker + echarts.format.encodeHTML(item.seriesName) + ' · ' + formatHours(item.value) + ' 小时');
        return [heading, ...details].join('<br>');
      },
    },
    // ECharts stacks from the bottom, while the legend reads from the top.
    series: rows.filter(row => row.total > 0).reverse().map(row => {
      const id = String(row.project.id);
      const muted = focusedProjectId.value !== null && focusedProjectId.value !== id;
      return {
        id,
        name: row.project.name,
        type: weeks.length === 1 ? 'bar' : 'line',
        stack: 'hours',
        data: row.values,
        itemStyle: { color: row.color, opacity: muted ? 0.2 : 1 },
        ...(weeks.length === 1
          ? { barMaxWidth: 64 }
          : {
            smooth: 0.25,
            smoothMonotone: 'x',
            showSymbol: false,
            lineStyle: { width: 1, opacity: muted ? 0.2 : 1 },
            areaStyle: { opacity: muted ? 0.15 : 0.78 },
          }),
      };
    }),
  }, { notMerge: true });
  chart.resize();
}

onMounted(() => {
  chart = echarts.init(chartElement.value);
  observer = new ResizeObserver(() => {
    if (chartElement.value.clientWidth) chart.resize();
  });
  observer.observe(chartElement.value);
  renderChart();
});
watch(grid, () => {
  if (!grid.value.rows.some(row => row.total > 0 && String(row.project.id) === focusedProjectId.value)) {
    focusedProjectId.value = null;
  }
  renderChart();
}, { flush: 'post' });
onBeforeUnmount(() => {
  observer?.disconnect();
  chart?.dispose();
});
</script>

<style scoped>
.timeline-chart { width: 100%; height: clamp(260px, 36vw, 400px); }
.project-legend { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 0; margin: 8px 0 0; list-style: none; }
.project-legend li { display: flex; align-items: baseline; gap: 6px; font-size: 12px; overflow-wrap: anywhere; }
.legend-swatch { flex: 0 0 10px; height: 10px; border-radius: 2px; }
.legend-hours { color: var(--muted); white-space: nowrap; }
.project-button { padding: 0; border: 0; background: none; color: #5948c8; font: inherit; text-align: left; text-decoration: underline; cursor: pointer; }
.project-button[aria-pressed="true"] { font-weight: 700; }
</style>

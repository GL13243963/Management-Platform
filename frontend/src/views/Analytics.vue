<template>
  <div class="page">
    <h1 class="page-title">统计分析</h1>
    <p class="page-subtitle">项目人工成本 · 工时趋势</p>

    <DataDateBanner :range="range" />

    <div class="card filter-card">
      <a-space :size="14" wrap>
        <a-range-picker v-model:value="range" @change="load" style="width: 300px" />
        <a-button type="primary" @click="load">
          <template #icon><search-outlined /></template>
          查询
        </a-button>
      </a-space>
    </div>

    <div class="card">
      <div class="section-title">项目人工成本</div>
      <a-table :data-source="labor" :columns="laborCols" row-key="projectId" :pagination="false" size="middle">
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'hours'">
            {{ fmtHours(record.hours) }}
          </template>
        </template>
      </a-table>
    </div>

    <div class="card">
      <div class="section-title">工时趋势</div>
      <div ref="trendChart" style="height: 360px"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import dayjs from 'dayjs';
import echarts from '../lib/echarts';
import { SearchOutlined } from '@ant-design/icons-vue';
import api from '../api';
import { fmtHours, fmtMoney } from '../lib/format';
import DataDateBanner from '../components/DataDateBanner.vue';

const range = ref([dayjs().subtract(30, 'day'), dayjs()]);
const labor = ref([]);
const trendChart = ref(null);
let inst = null;

const laborCols = [
  { title: '项目', dataIndex: 'projectName', width: 200 },
  { title: '总工时', dataIndex: 'hours', sorter: (a, b) => a.hours - b.hours, width: 120 },
  {
    title: '人工成本（元）',
    dataIndex: 'cost',
    sorter: (a, b) => a.cost - b.cost,
    customRender: ({ text }) => fmtMoney(text),
  },
];

function params() {
  return {
    startDate: range.value?.[0]?.format('YYYY-MM-DD'),
    endDate: range.value?.[1]?.format('YYYY-MM-DD'),
  };
}

async function load() {
  const p = params();
  labor.value = await api.get('/analytics/labor-cost', { params: p });
  await nextTick();
  renderTrend();
}

function handleResize() {
  inst?.resize();
}

async function renderTrend() {
  if (!trendChart.value) return;
  if (!inst) {
    inst = echarts.init(trendChart.value);
    window.addEventListener('resize', handleResize);
  }
  const p = params();
  const [rows, employees] = await Promise.all([
    api.get('/attendance', { params: p }),
    api.get('/employees'),
  ]);

  const teamOf = new Map(employees.map(e => [e.id, e.team || '']));
  const belongsTo = (empId, keyword) => (teamOf.get(empId) || '').includes(keyword);

  // date → { overall, planning, architecture }
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, { overall: 0, planning: 0, architecture: 0 });
    const day = map.get(r.date);
    const h = Number(r.workHours) || 0;
    day.overall += h;
    if (belongsTo(r.employeeId, '规划')) day.planning += h;
    if (belongsTo(r.employeeId, '方案')) day.architecture += h;
  }
  const dates = Array.from(map.keys()).sort();
  const r2 = n => Math.round(n * 100) / 100;
  const overallData = dates.map(d => r2(map.get(d).overall));
  const planningData = dates.map(d => r2(map.get(d).planning));
  const archData = dates.map(d => r2(map.get(d).architecture));

  inst.setOption({
    color: ['#7C6CF2', '#55CDB1', '#F2C75C'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#E5E7EB',
      borderWidth: 1,
      textStyle: { color: '#374151' },
    },
    legend: {
      data: ['整体', '规划组', '方案组'],
      top: 0,
      textStyle: { color: '#6B7280', fontSize: 12 },
    },
    grid: { left: 50, right: 30, top: 40, bottom: 50 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLine: { lineStyle: { color: '#E5E7EB' } },
      axisLabel: { color: '#6B7280', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      name: '小时',
      splitLine: { lineStyle: { color: '#F3F4F6' } },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#6B7280', fontSize: 11 },
    },
    series: [
      {
        name: '整体',
        type: 'line',
        smooth: true,
        data: overallData,
        symbol: 'circle',
        symbolSize: 6,
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(124, 108, 242, 0.20)' },
            { offset: 1, color: 'rgba(124, 108, 242, 0.01)' },
          ]),
        },
        lineStyle: { width: 3 },
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
      },
      {
        name: '规划组',
        type: 'line',
        smooth: true,
        data: planningData,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2 },
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
      },
      {
        name: '方案组',
        type: 'line',
        smooth: true,
        data: archData,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2 },
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
      },
    ],
  }, true);
}

onMounted(load);

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  inst?.dispose();
  inst = null;
});
</script>

<style scoped>
.filter-card {
  padding: 16px 22px;
}
</style>

<template>
  <div class="page">
    <h1 class="page-title">统计分析</h1>
    <p class="page-subtitle">多维度工时聚合 · 项目人工成本</p>

    <div class="card" style="padding:16px 22px;">
      <a-space :size="14" wrap>
        <a-range-picker v-model:value="range" @change="load" />
        <a-button type="primary" @click="load">查询</a-button>
      </a-space>
    </div>

    <div class="card">
      <div class="section-title">项目工时（叠加人工成本）</div>
      <a-table :dataSource="labor" :columns="laborCols" row-key="projectId" :pagination="false" size="middle" />
    </div>

    <div class="card">
      <div class="section-title">人员工时明细</div>
      <a-table :dataSource="byEmp" :columns="empCols" row-key="employeeId" :pagination="{pageSize:10}" size="middle" />
    </div>

    <div class="card">
      <div class="section-title">工时趋势</div>
      <div ref="trendChart" style="height:360px;"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import dayjs from 'dayjs';
import * as echarts from 'echarts';
import api from '../api';

const range = ref([dayjs().subtract(30, 'day'), dayjs()]);
const labor = ref([]);
const byEmp = ref([]);
const trendChart = ref(null);
let inst = null;

const laborCols = [
  { title: '项目', dataIndex: 'projectName' },
  { title: '总工时', dataIndex: 'hours', sorter: (a,b)=>a.hours-b.hours },
  { title: '人工成本（元）', dataIndex: 'cost', sorter: (a,b)=>a.cost-b.cost,
    customRender: ({text}) => text?.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) },
];
const empCols = [
  { title: '员工', dataIndex: 'name' },
  { title: '总工时', dataIndex: 'totalHours' },
  { title: '出勤天数', dataIndex: 'days' },
  { title: '迟到', dataIndex: 'lateDays' },
  { title: '早退', dataIndex: 'earlyDays' },
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
  byEmp.value = await api.get('/analytics/by-employee', { params: p });
  await nextTick();
  renderTrend();
}

async function renderTrend() {
  if (!trendChart.value) return;
  if (!inst) inst = echarts.init(trendChart.value);
  // Build daily total-hours series from all attendance in range
  const p = params();
  const rows = await api.get('/attendance', { params: p });
  const map = new Map();
  for (const r of rows) map.set(r.date, (map.get(r.date) || 0) + (r.workHours || 0));
  const dates = Array.from(map.keys()).sort();
  const values = dates.map(d => Math.round(map.get(d) * 100) / 100);
  inst.setOption({
    color: ['#0074C4'],
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#D1D5DB' } } },
    yAxis: { type: 'value', name: '小时', splitLine: { lineStyle: { color: '#F0F2F5' } } },
    grid: { left: 40, right: 20, top: 30, bottom: 40 },
    series: [{
      type: 'line', smooth: true, data: values, symbol: 'circle',
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0,0,0,1,[
          {offset:0, color:'rgba(0,116,196,0.4)'},
          {offset:1, color:'rgba(0,116,196,0.02)'},
        ]),
      },
      lineStyle: { width: 2 },
    }],
  });
}

onMounted(load);
</script>

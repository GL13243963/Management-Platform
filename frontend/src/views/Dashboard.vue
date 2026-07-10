<template>
  <div class="page">
    <h1 class="page-title">数据概览</h1>
    <p class="page-subtitle">Innovation Center · 实时运营指标</p>

    <div class="card" style="padding:16px 22px;">
      <a-space :size="12" wrap>
        <a-range-picker v-model:value="range" @change="load" />
        <a-button type="primary" @click="load">刷新</a-button>
      </a-space>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">总工时（小时）</div>
        <div class="stat-value">{{ summary.totalHours || 0 }}</div>
        <div class="stat-hint">覆盖 {{ summary.employeeCount || 0 }} 名员工</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">出勤率</div>
        <div class="stat-value">{{ summary.attendanceRate || 0 }}%</div>
        <div class="stat-hint">共 {{ summary.totalDays || 0 }} 条打卡记录</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">迟到 / 早退</div>
        <div class="stat-value">{{ summary.lateDays || 0 }} / {{ summary.earlyDays || 0 }}</div>
        <div class="stat-hint">异常打卡（未审批）</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">审批异常</div>
        <div class="stat-value">{{ summary.overrideDays || 0 }}</div>
        <div class="stat-hint">请假 / 出差 / 调休</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">项目工时分布</div>
      <div ref="projectChart" style="height:340px;"></div>
    </div>

    <div class="card">
      <div class="section-title">人员工时排行</div>
      <a-table
        :dataSource="byEmployee"
        :columns="empCols"
        :pagination="{ pageSize: 8 }"
        row-key="employeeId"
        size="middle"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import dayjs from 'dayjs';
import * as echarts from 'echarts';
import api from '../api';

const range = ref([dayjs().subtract(30, 'day'), dayjs()]);
const summary = ref({});
const byProject = ref([]);
const byEmployee = ref([]);
const projectChart = ref(null);
let chartInstance = null;

const empCols = [
  { title: '员工', dataIndex: 'name' },
  { title: '总工时', dataIndex: 'totalHours', sorter: (a,b)=>a.totalHours-b.totalHours },
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
  summary.value = await api.get('/analytics/summary', { params: p });
  byProject.value = await api.get('/analytics/by-project', { params: p });
  byEmployee.value = await api.get('/analytics/by-employee', { params: p });
  await nextTick();
  renderChart();
}

function renderChart() {
  if (!projectChart.value) return;
  if (!chartInstance) chartInstance = echarts.init(projectChart.value);
  chartInstance.setOption({
    color: ['#0074C4', '#3A9CE0', '#65B8EA', '#93D0F2', '#B7E0F7', '#DFF0FB'],
    tooltip: { trigger: 'item', formatter: '{b}<br/>工时: {c} 小时 ({d}%)' },
    legend: { bottom: 10 },
    series: [{
      type: 'pie',
      radius: ['45%', '70%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}\n{c} h' },
      data: byProject.value.map(p => ({ name: p.projectName, value: p.hours })),
    }],
  });
}

onMounted(load);
</script>

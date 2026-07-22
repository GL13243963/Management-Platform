<template>
  <div class="page">
    <h1 class="page-title">数据概览</h1>
    <p class="page-subtitle">Innovation Center · 实时运营指标</p>

    <div class="card filter-card">
      <a-space :size="14" wrap>
        <a-range-picker
          v-model:value="range"
          @change="load"
          :allowClear="false"
          style="width: 300px"
        />
        <a-button type="primary" @click="load">
          <template #icon><reload-outlined :spin="loading" /></template>
          刷新数据
        </a-button>
      </a-space>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">总工时（小时）</div>
        <div class="stat-value">{{ summary.totalHours || 0 }}</div>
        <div class="stat-hint">覆盖 {{ summary.employeeCount || 0 }} 名员工</div>
      </div>
      <div class="stat-card" style="--stat-color: var(--success)">
        <div class="stat-label">出勤率</div>
        <div class="stat-value">{{ summary.attendanceRate || 0 }}<span style="font-size: 18px; margin-left: 2px">%</span></div>
        <div class="stat-hint">共 {{ summary.totalDays || 0 }} 条打卡记录</div>
      </div>
      <div class="stat-card" style="--stat-color: var(--warning)">
        <div class="stat-label">迟到 / 早退</div>
        <div class="stat-value">{{ summary.lateDays || 0 }} / {{ summary.earlyDays || 0 }}</div>
        <div class="stat-hint">异常考勤（未审批）</div>
      </div>
      <div class="stat-card" style="--stat-color: var(--info)">
        <div class="stat-label">审批异常</div>
        <div class="stat-value">{{ summary.overrideDays || 0 }}</div>
        <div class="stat-hint">请假 / 出差 / 调休</div>
      </div>
    </div>

    <div class="group-stats-container">
      <a-alert
        v-if="unassignedEmployees.length"
        class="group-warning"
        type="warning"
        show-icon
        :message="`${unassignedEmployees.length} 名员工尚未设置规划组/建筑组`"
        :description="`请到“人员管理”设置组别：${unassignedEmployees.map(e => e.name).join('、')}`"
      />
      <div class="group-card">
        <div class="group-title">规划组 - 出勤统计</div>
        <div ref="planningChart" class="group-chart-wrapper"></div>
        <div class="absent-list">
          <div class="absent-list-title">漏刷人员</div>
          <div class="absent-list-items">
            <template v-if="planningAbsent.length">
              <span v-for="name in planningAbsent" :key="name" class="absent-tag">{{ name }}</span>
            </template>
            <span v-else class="no-absent">暂无缺勤</span>
          </div>
        </div>
      </div>
      <div class="group-card">
        <div class="group-title">建筑组 - 出勤统计</div>
        <div ref="architectureChart" class="group-chart-wrapper"></div>
        <div class="absent-list">
          <div class="absent-list-title">漏刷人员</div>
          <div class="absent-list-items">
            <template v-if="architectureAbsent.length">
              <span v-for="name in architectureAbsent" :key="name" class="absent-tag">{{ name }}</span>
            </template>
            <span v-else class="no-absent">暂无缺勤</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 24px">
      <div class="section-title">
        人员工时排行
        <span class="full-attendance-hint">全勤比例：{{ fullAttendanceRate }}%</span>
      </div>
      <a-table
        :data-source="byEmployeeSorted"
        :columns="empCols"
        :pagination="{ pageSize: 8 }"
        row-key="employeeId"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'lateDays'">
            <span v-if="record.lateDays > 0" class="highlight-count">
              {{ record.lateDays }} 次
            </span>
            <span v-else>0</span>
          </template>
          <template v-if="column.key === 'earlyDays'">
            <span v-if="record.earlyDays > 0" class="highlight-count">
              {{ record.earlyDays }} 次
            </span>
            <span v-else>0</span>
          </template>
          <template v-if="column.key === 'missedPunchDays'">
            <span v-if="record.missedPunchDays > 0" class="highlight-count">
              {{ record.missedPunchDays }} 次
            </span>
            <span v-else>0</span>
          </template>
          <template v-if="column.key === 'personalFullAttendanceRate'">
            <span :class="{ 'full-attendance': record.personalFullAttendanceRate === 100 }">
              {{ record.personalFullAttendanceRate || 0 }}%
            </span>
          </template>
        </template>
      </a-table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, computed } from 'vue';
import dayjs from 'dayjs';
import * as echarts from 'echarts';
import { ReloadOutlined } from '@ant-design/icons-vue';
import api from '../api';

const range = ref([dayjs().subtract(30, 'day'), dayjs()]);
const summary = ref({});
const byEmployee = ref([]);
const employees = ref([]);
const attendanceLogs = ref([]);
const loading = ref(false);
const planningChart = ref(null);
const architectureChart = ref(null);
let planningChartInst = null;
let architectureChartInst = null;

const empCols = [
  { title: '员工', dataIndex: 'name', width: 140 },
  { title: '总工时', dataIndex: 'totalHours', width: 140 },
  { title: '出勤天数', dataIndex: 'days', width: 110 },
  { title: '迟到次数', key: 'lateDays', dataIndex: 'lateDays', width: 120 },
  { title: '早退次数', key: 'earlyDays', dataIndex: 'earlyDays', width: 120 },
  { title: '漏刷次数', key: 'missedPunchDays', dataIndex: 'missedPunchDays', width: 120 },
  { title: '个人全勤率', key: 'personalFullAttendanceRate', width: 140 },
];

const byEmployeeSorted = computed(() => {
  return [...byEmployee.value].sort((a, b) => b.totalHours - a.totalHours);
});

const fullAttendanceRate = computed(() => {
  if (!byEmployee.value.length) return 0;
  const fullAttendanceCount = byEmployee.value.filter(e => e.lateDays === 0 && e.earlyDays === 0).length;
  return Math.round((fullAttendanceCount / byEmployee.value.length) * 100);
});

function employeeBelongsToTeam(employee, teamKeyword) {
  return (employee.team || employee.department || '').includes(teamKeyword);
}

const unassignedEmployees = computed(() => employees.value.filter(employee =>
  !employeeBelongsToTeam(employee, '规划') && !employeeBelongsToTeam(employee, '建筑')
));

const planningAbsent = computed(() => {
  const planningEmployees = employees.value.filter(e => employeeBelongsToTeam(e, '规划')).map(e => e.name);
  const absentSet = new Set();

  for (const log of attendanceLogs.value) {
    if (planningEmployees.includes(log.employeeName)) {
      if (['missed_punch', 'absent'].includes(log.status)) {
        absentSet.add(log.employeeName);
      }
    }
  }

  return Array.from(absentSet);
});

const architectureAbsent = computed(() => {
  const architectureEmployees = employees.value.filter(e => employeeBelongsToTeam(e, '建筑')).map(e => e.name);
  const absentSet = new Set();

  for (const log of attendanceLogs.value) {
    if (architectureEmployees.includes(log.employeeName)) {
      if (['missed_punch', 'absent'].includes(log.status)) {
        absentSet.add(log.employeeName);
      }
    }
  }

  return Array.from(absentSet);
});

function params() {
  return {
    startDate: range.value?.[0]?.format('YYYY-MM-DD'),
    endDate: range.value?.[1]?.format('YYYY-MM-DD'),
  };
}

function getGroupAttendanceStats(departmentKeyword) {
  const groupEmployees = employees.value.filter(e => employeeBelongsToTeam(e, departmentKeyword));
  const groupEmployeeIds = new Set(groupEmployees.map(e => e.id));
  const groupLogs = attendanceLogs.value.filter(l => groupEmployeeIds.has(l.employeeId));

  const stats = {
    normal: 0, late: 0, early: 0, lateAndEarly: 0,
    leave: 0, businessTrip: 0, compLeave: 0, missedPunch: 0,
  };

  for (const log of groupLogs) {
    if (log.overrideType === 'leave') stats.leave++;
    else if (log.overrideType === 'business_trip') stats.businessTrip++;
    else if (log.overrideType === 'comp_leave') stats.compLeave++;
    else if (log.status === 'normal') stats.normal++;
    else if (log.status === 'late') stats.late++;
    else if (log.status === 'early') stats.early++;
    else if (log.status === 'late_and_early') stats.lateAndEarly++;
    else if (['missed_punch', 'absent'].includes(log.status)) stats.missedPunch++;
    else stats.normal++;
  }

  return stats;
}

async function load() {
  loading.value = true;
  try {
    const p = params();
    summary.value = await api.get('/analytics/summary', { params: p });
    byEmployee.value = await api.get('/analytics/by-employee', { params: p });
    employees.value = await api.get('/employees');
    attendanceLogs.value = await api.get('/attendance', { params: p });
    await nextTick();
    renderCharts();
  } finally {
    loading.value = false;
  }
}

function renderCharts() {
  renderGroupCharts();
}

function renderGroupCharts() {
  renderPlanningChart();
  renderArchitectureChart();
}

function renderPlanningChart() {
  if (!planningChart.value) return;
  if (!planningChartInst) {
    planningChartInst = echarts.init(planningChart.value);
  }
  const stats = getGroupAttendanceStats('规划');
  planningChartInst.setOption(getGroupChartOption(stats));
}

function renderArchitectureChart() {
  if (!architectureChart.value) return;
  if (!architectureChartInst) {
    architectureChartInst = echarts.init(architectureChart.value);
  }
  const stats = getGroupAttendanceStats('建筑');
  architectureChartInst.setOption(getGroupChartOption(stats));
}

function getGroupChartOption(stats) {
  const data = [
    { name: '正常', value: stats.normal, itemStyle: { color: '#10B981' } },
    { name: '迟到', value: stats.late, itemStyle: { color: '#F59E0B' } },
    { name: '早退', value: stats.early, itemStyle: { color: '#F97316' } },
    { name: '迟+早', value: stats.lateAndEarly, itemStyle: { color: '#EF4444' } },
    { name: '请假', value: stats.leave, itemStyle: { color: '#3B82F6' } },
    { name: '出差', value: stats.businessTrip, itemStyle: { color: '#6366F1' } },
    { name: '调休', value: stats.compLeave, itemStyle: { color: '#8B5CF6' } },
    { name: '漏刷', value: stats.missedPunch, itemStyle: { color: '#991B1B' } },
  ].filter(d => d.value > 0);

  const hasData = data.length > 0;

  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#E5E7EB', borderWidth: 1, textStyle: { color: '#374151' } },
    legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: '#6B7280', fontSize: 11 } },
    graphic: hasData ? [] : [{
      type: 'text', left: 'center', top: '40%',
      style: { text: '暂无分组数据', fill: '#9CA3AF', fontSize: 14 },
    }],
    series: [{
      type: 'pie', radius: ['40%', '68%'], center: ['50%', '42%'], avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}\n{c}', color: '#374151', fontSize: 11 },
      emphasis: { label: { show: true, fontSize: 12, fontWeight: '600' }, itemStyle: { shadowBlur: 8, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.15)' } },
      data
    }]
  };
}

onMounted(load);
</script>

<style scoped>
.filter-card {
  padding: 16px 22px;
  display: flex;
  align-items: center;
}

.stat-card::before {
  background: linear-gradient(180deg, var(--stat-color, var(--brand)) 0%, var(--stat-color, var(--brand-light)) 100%);
}

.stat-value span {
  font-weight: 500;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.full-attendance-hint {
  font-size: 13px;
  color: #10B981;
  font-weight: 500;
}

.highlight-count {
  color: #F59E0B;
  font-weight: 600;
}

.full-attendance {
  color: #10B981;
  font-weight: 600;
}

.group-warning {
  grid-column: 1 / -1;
  margin-bottom: 4px;
}
</style>

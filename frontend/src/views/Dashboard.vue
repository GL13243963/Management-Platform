<template>
  <div class="page">
    <h1 class="page-title">考勤看板</h1>
    <p class="page-subtitle">方案组与规划组考勤健康 · 个人考勤 · 人员负荷异常</p>

    <DataDateBanner :range="range" />

    <a-alert class="rules-note" type="info" show-icon>
      <template #message>考勤统计口径说明</template>
      <template #description>
        <div class="rules-grid">
          <span><b>迟到/早退：</b>分别计为一次异常，同一天同时发生计 2 次。</span>
          <span><b>漏刷：</b>单侧漏刷仅扣除所在半天，另一半天计 4 小时；两侧均无有效打卡计 0 小时。</span>
          <span><b>加班：</b>导入表记录的周末加班时长，加上每天 21:00 之后的工作时长。</span>
          <span><b>出差/外出：</b>以导入考勤表的记录及其时长为准。</span>
          <span><b>调休：</b>独立于导入数据，不计工作时长，也不参与考勤统计。</span>
          <span><b>统计周期：</b>所有指标均按页面当前选择的日期范围计算。</span>
        </div>
      </template>
    </a-alert>

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
        <div class="stat-value">{{ fmtHours(summary.totalHours) }}</div>
        <div class="stat-hint">覆盖 {{ summary.employeeCount || 0 }} 名员工</div>
      </div>
      <div class="stat-card" style="--stat-color: var(--success)">
        <div class="stat-label">出勤率</div>
        <div class="stat-value">{{ summary.attendanceRate || 0 }}<span style="font-size: 18px; margin-left: 2px">%</span></div>
        <div class="stat-hint">共 {{ summary.totalDays || 0 }} 条打卡记录</div>
      </div>
      <div class="stat-card" style="--stat-color: var(--warning)">
        <div class="stat-label">迟到/早退次数</div>
        <div class="stat-value">{{ summary.lateOrEarlyDays || 0 }}</div>
        <div class="stat-hint">迟到、早退分别计次</div>
      </div>
      <div class="stat-card" style="--stat-color: var(--info)">
        <div class="stat-label">加班 / 出差 / 外出时长</div>
        <div class="stat-value">{{ fmtHours(summary.overtimeHours) }} / {{ fmtHours(summary.businessTripHours) }} / {{ fmtHours(summary.outsideHours) }}</div>
        <div class="stat-hint">小时 · 周末导入加班 + 每日 21:00 后工时</div>
      </div>
    </div>

    <div class="group-stats-container">
      <a-alert
        v-if="unassignedEmployees.length"
        class="group-warning"
        type="warning"
        show-icon
        :message="`${unassignedEmployees.length} 名员工尚未设置规划组/方案组`"
        :description="`请到“人员管理”设置组别：${unassignedEmployees.map(e => e.name).join('、')}`"
      />
      <div class="group-card">
        <div class="group-title">
          规划组 - 出勤统计
          <span class="group-rate" :class="rateClass(planningRate)">合格率 {{ planningRate }}%</span>
        </div>
        <div ref="planningChart" class="group-chart-wrapper"></div>
        <div class="group-insights">
          <div class="insight-row">
            <div class="insight-title">全勤人员</div>
            <div class="insight-items">
            <template v-if="planningFullAttendance.length">
              <span v-for="name in planningFullAttendance" :key="name" class="full-tag">{{ name }}</span>
            </template>
            <span v-else class="empty-insight">暂无全勤人员</span>
            </div>
          </div>
          <div class="insight-row">
            <div class="insight-title">加班时长最长</div>
            <div class="insight-items"><span v-if="planningOvertimeTop" class="overtime-tag">{{ planningOvertimeTop.name }} · {{ fmtHours(planningOvertimeTop.overtimeHours) }} 小时</span><span v-else class="empty-insight">暂无加班记录</span></div>
          </div>
        </div>
      </div>
      <div class="group-card">
        <div class="group-title">
          方案组 - 出勤统计
          <span class="group-rate" :class="rateClass(architectureRate)">合格率 {{ architectureRate }}%</span>
        </div>
        <div ref="architectureChart" class="group-chart-wrapper"></div>
        <div class="group-insights">
          <div class="insight-row">
            <div class="insight-title">全勤人员</div>
            <div class="insight-items">
            <template v-if="architectureFullAttendance.length">
              <span v-for="name in architectureFullAttendance" :key="name" class="full-tag">{{ name }}</span>
            </template>
            <span v-else class="empty-insight">暂无全勤人员</span>
            </div>
          </div>
          <div class="insight-row">
            <div class="insight-title">加班时长最长</div>
            <div class="insight-items"><span v-if="architectureOvertimeTop" class="overtime-tag">{{ architectureOvertimeTop.name }} · {{ fmtHours(architectureOvertimeTop.overtimeHours) }} 小时</span><span v-else class="empty-insight">暂无加班记录</span></div>
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
          <template v-if="column.key === 'lateOrEarlyDays'">
            <span v-if="record.lateOrEarlyDays > 0" class="highlight-count">
              {{ record.lateOrEarlyDays }} 次
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

    <div class="analytics-section">
      <div class="analytics-heading"><h2>考勤与负荷趋势</h2><span>沿用上方日期范围 · 整体、规划组与方案组每日人均工时变化</span></div>
      <div class="card">
        <div class="section-title">人均工时趋势</div>
        <div ref="trendChart" class="trend-chart"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, computed } from 'vue';
import dayjs from 'dayjs';
import echarts from '../lib/echarts';
import { ReloadOutlined } from '@ant-design/icons-vue';
import api from '../api';
import { fmtHours } from '../lib/format';
import DataDateBanner from '../components/DataDateBanner.vue';

const range = ref([dayjs().subtract(30, 'day'), dayjs()]);
const summary = ref({});
const byEmployee = ref([]);
const employees = ref([]);
const attendanceLogs = ref([]);
const loading = ref(false);
const planningChart = ref(null);
const architectureChart = ref(null);
const trendChart = ref(null);
let planningChartInst = null;
let architectureChartInst = null;
let trendChartInst = null;

const empCols = [
  { title: '员工', dataIndex: 'name', width: 140 },
  { title: '总工时', dataIndex: 'totalHours', width: 140, customRender: ({ text }) => fmtHours(text) },
  { title: '出勤天数', dataIndex: 'days', width: 110 },
  { title: '加班时长', dataIndex: 'overtimeHours', width: 110, customRender: ({ text }) => fmtHours(text) },
  { title: '出差时长', dataIndex: 'businessTripHours', width: 110, customRender: ({ text }) => fmtHours(text) },
  { title: '外出时长', dataIndex: 'outsideHours', width: 110, customRender: ({ text }) => fmtHours(text) },
  { title: '迟到/早退', key: 'lateOrEarlyDays', dataIndex: 'lateOrEarlyDays', width: 120 },
  { title: '漏刷次数', key: 'missedPunchDays', dataIndex: 'missedPunchDays', width: 120 },
  { title: '个人全勤率', key: 'personalFullAttendanceRate', width: 140 },
];

const byEmployeeSorted = computed(() => {
  return [...byEmployee.value].sort((a, b) => b.totalHours - a.totalHours);
});

const fullAttendanceRate = computed(() => {
  if (!byEmployee.value.length) return 0;
  const fullAttendanceCount = byEmployee.value.filter(e => e.lateDays === 0 && e.earlyDays === 0 && e.missedPunchDays === 0).length;
  return Math.round((fullAttendanceCount / byEmployee.value.length) * 100);
});

function employeeBelongsToTeam(employee, teamKeyword) {
  return (employee.team || employee.department || '').includes(teamKeyword);
}

const unassignedEmployees = computed(() => employees.value.filter(employee =>
  !employeeBelongsToTeam(employee, '规划') && !employeeBelongsToTeam(employee, '方案')
));

function summariesForTeam(teamKeyword) {
  const names = new Set(employees.value.filter(e => employeeBelongsToTeam(e, teamKeyword)).map(e => e.name));
  return byEmployee.value.filter(item => names.has(item.name));
}

function fullAttendanceForTeam(teamKeyword) {
  return summariesForTeam(teamKeyword)
    .filter(item => item.lateDays === 0 && item.earlyDays === 0 && item.missedPunchDays === 0)
    .map(item => item.name);
}

function overtimeTopForTeam(teamKeyword) {
  return summariesForTeam(teamKeyword)
    .filter(item => Number(item.overtimeHours) > 0)
    .sort((a, b) => Number(b.overtimeHours) - Number(a.overtimeHours))[0] || null;
}

const planningFullAttendance = computed(() => fullAttendanceForTeam('规划'));
const architectureFullAttendance = computed(() => fullAttendanceForTeam('方案'));
const planningOvertimeTop = computed(() => overtimeTopForTeam('规划'));
const architectureOvertimeTop = computed(() => overtimeTopForTeam('方案'));

/** 分组考勤合格率 = 正常打卡天数 / 应打卡天数（不含请假/出差/调休） */
function qualificationRate(stats) {
  const attended = stats.normal + stats.late + stats.early + stats.lateAndEarly + stats.missedPunch;
  if (!attended) return 0;
  return Math.round((stats.normal / attended) * 100);
}

const planningStats = computed(() => getGroupAttendanceStats('规划'));
const architectureStats = computed(() => getGroupAttendanceStats('方案'));
const planningRate = computed(() => qualificationRate(planningStats.value));
const architectureRate = computed(() => qualificationRate(architectureStats.value));

/** 合格率阈值：>=90 良好，>=70 警告，<70 差 */
const RATE_GOOD = 90;
const RATE_WARN = 70;

function rateClass(rate) {
  if (rate >= RATE_GOOD) return 'rate-good';
  if (rate >= RATE_WARN) return 'rate-warn';
  return 'rate-bad';
}

function rateColor(rate) {
  if (rate >= RATE_GOOD) return '#55CDB1';
  if (rate >= RATE_WARN) return '#F2C75C';
  return '#F3789B';
}

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
    // Wait two animation frames so the CSS grid has final dimensions
    // before ECharts measures the container (otherwise it renders at 0×0).
    requestAnimationFrame(() => requestAnimationFrame(() => { renderCharts(); renderTrend(); }));
  } finally {
    loading.value = false;
  }
}

function renderGroupChart(chartRef, inst, stats, rate) {
  if (!chartRef) return inst;
  if (!inst) {
    inst = echarts.init(chartRef);
  }
  inst.setOption(getGroupChartOption(stats, rate));
  return inst;
}

function renderCharts() {
  planningChartInst = renderGroupChart(
    planningChart.value, planningChartInst, planningStats.value, planningRate.value
  );
  architectureChartInst = renderGroupChart(
    architectureChart.value, architectureChartInst, architectureStats.value, architectureRate.value
  );
}

function renderTrend() {
  if (!trendChart.value) return;
  if (!trendChartInst) trendChartInst = echarts.init(trendChart.value);
  const teamOf = new Map(employees.value.map(employee => [employee.id, employee.team || '']));
  const map = new Map();
  for (const row of attendanceLogs.value) {
    if (!map.has(row.date)) map.set(row.date, {
      overall: 0, planning: 0, architecture: 0,
      overallPeople: new Set(), planningPeople: new Set(), architecturePeople: new Set(),
    });
    const day = map.get(row.date), hours = Number(row.workHours) || 0, team = teamOf.get(row.employeeId) || '';
    day.overall += hours;
    day.overallPeople.add(row.employeeId);
    if (team.includes('规划')) { day.planning += hours; day.planningPeople.add(row.employeeId); }
    if (team.includes('方案')) { day.architecture += hours; day.architecturePeople.add(row.employeeId); }
  }
  const dates = Array.from(map.keys()).sort();
  const values = key => dates.map(date => {
    const day = map.get(date), count = day[`${key}People`].size;
    return count ? Math.round(day[key] / count * 100) / 100 : null;
  });
  trendChartInst.setOption({
    color: ['#7C6CF2', '#55CDB1', '#F2C75C'],
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,.96)', borderColor: '#EBE9F2', textStyle: { color: '#49455F' } },
    legend: { data: ['整体', '规划组', '方案组'], top: 0, textStyle: { color: '#77738B' } },
    grid: { left: 50, right: 30, top: 42, bottom: 48 },
    xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#EBE9F2' } }, axisLabel: { color: '#77738B', fontSize: 11 } },
    yAxis: { type: 'value', name: '人均小时', splitLine: { lineStyle: { color: '#F3F1F8' } }, axisLabel: { color: '#77738B' } },
    series: [
      { name: '整体', type: 'line', smooth: true, data: values('overall'), symbolSize: 6, lineStyle: { width: 3 }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(124,108,242,.20)' }, { offset: 1, color: 'rgba(124,108,242,.01)' }]) } },
      { name: '规划组', type: 'line', smooth: true, data: values('planning'), symbolSize: 5, lineStyle: { width: 2 } },
      { name: '方案组', type: 'line', smooth: true, data: values('architecture'), symbolSize: 5, lineStyle: { width: 2 } },
    ],
  }, true);
}

function getGroupChartOption(stats, rate) {
  const data = [
    { name: '正常', value: stats.normal, itemStyle: { color: '#55CDB1' } },
    { name: '迟到', value: stats.late, itemStyle: { color: '#F2C75C' } },
    { name: '早退', value: stats.early, itemStyle: { color: '#F5A66F' } },
    { name: '迟+早', value: stats.lateAndEarly, itemStyle: { color: '#F3789B' } },
    { name: '请假', value: stats.leave, itemStyle: { color: '#76B7F3' } },
    { name: '出差', value: stats.businessTrip, itemStyle: { color: '#7C6CF2' } },
    { name: '调休', value: stats.compLeave, itemStyle: { color: '#B094F5' } },
    { name: '漏刷', value: stats.missedPunch, itemStyle: { color: '#D94F78' } },
  ].filter(d => d.value > 0);

  const hasData = data.length > 0;

  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#E5E7EB', borderWidth: 1, textStyle: { color: '#374151' } },
    legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: '#6B7280', fontSize: 11 } },
    graphic: hasData ? [
      { type: 'text', left: 'center', top: '34%', style: { text: `${rate}%`, fill: rateColor(rate), fontSize: 22, fontWeight: 700, textAlign: 'center' } },
      { type: 'text', left: 'center', top: '50%', style: { text: '合格率', fill: '#9CA3AF', fontSize: 11, textAlign: 'center' } },
    ] : [{
      type: 'text', left: 'center', top: '40%',
      style: { text: '暂无分组数据', fill: '#9CA3AF', fontSize: 14 },
    }],
    series: [{
      type: 'pie', radius: ['46%', '70%'], center: ['50%', '44%'], avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}\n{c}', color: '#374151', fontSize: 11 },
      emphasis: { label: { show: true, fontSize: 12, fontWeight: '600' }, itemStyle: { shadowBlur: 8, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.15)' } },
      data
    }]
  };
}

function handleResize() {
  planningChartInst?.resize();
  architectureChartInst?.resize();
  trendChartInst?.resize();
}

onMounted(async () => {
  window.addEventListener('resize', handleResize);
  try {
    const coverage = await api.get('/attendance/date-range');
    if (coverage?.earliestDate && coverage?.latestDate) {
      range.value = [dayjs(coverage.earliestDate), dayjs(coverage.latestDate)];
    }
  } finally {
    load();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  planningChartInst?.dispose();
  architectureChartInst?.dispose();
  trendChartInst?.dispose();
  planningChartInst = null;
  architectureChartInst = null;
  trendChartInst = null;
});
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

.group-insights{border-top:1px solid var(--border);padding-top:14px;display:grid;gap:12px}.insight-row{display:grid;grid-template-columns:112px 1fr;align-items:start;gap:10px}.insight-title{color:var(--muted);font-size:13px;font-weight:600;padding-top:4px}.insight-items{display:flex;flex-wrap:wrap;gap:8px;min-height:28px}.full-tag,.overtime-tag{display:inline-flex;align-items:center;padding:4px 10px;border-radius:8px;font-size:13px}.full-tag{color:#248f78;background:#eafaf5;border:1px solid #c9f0e4}.overtime-tag{color:#8a5b09;background:#fff8df;border:1px solid #f7e4a3}.empty-insight{color:var(--muted);font-size:13px;padding-top:4px}

.group-rate {
  margin-left: auto;
  font-size: 13px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 999px;
  background: #F3F4F6;
  color: #6B7280;
}

.group-rate.rate-good {
  background: #ECFDF5;
  color: #059669;
}

.group-rate.rate-warn {
  background: #FFFBEB;
  color: #D97706;
}

.group-rate.rate-bad {
  background: #FEF2F2;
  color: #DC2626;
}
.analytics-section{margin-top:30px;padding-top:8px}.analytics-heading{margin:0 0 16px 2px}.analytics-heading h2{margin:0;color:var(--ink);font-size:20px}.analytics-heading span{display:block;margin-top:5px;color:var(--muted);font-size:13px}.trend-chart{height:360px;width:100%}
.rules-note{margin-bottom:16px}.rules-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 22px;line-height:1.65}.rules-grid b{color:var(--ink)}@media(max-width:800px){.rules-grid{grid-template-columns:1fr}}
</style>

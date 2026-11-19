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
          <span><b>出差/外出：</b>以导入表为准；外出不计考勤异常，但外出时长计入总工时和项目工时。</span>
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

    <div class="analytics-section">
      <div class="analytics-heading"><h2>团队工作时间趋势</h2><span>当前4周 · 主曲线显示团队投入，下方柱状图解释加班变化</span></div>
      <div class="card">
        <div class="section-title trend-title">
          <div class="trend-window-nav">
            <a-button size="small" aria-label="向前移动一周" :disabled="trendWeekOffset >= trendMaxOffset" @click="moveTrendWindow(1)">←</a-button>
            <span>{{ trendWindowLabel }}</span>
            <a-button size="small" aria-label="向后移动一周" :disabled="trendWeekOffset === 0" @click="moveTrendWindow(-1)">→</a-button>
          </div>
          <a-space :size="10" wrap>
            <a-radio-group v-model:value="trendMetric" button-style="solid" size="small" @change="renderTrend">
              <a-radio-button value="total">团队总工时</a-radio-button>
              <a-radio-button value="average">人均工时</a-radio-button>
            </a-radio-group>
          </a-space>
        </div>
        <div class="trend-explain">
          <span><i class="trend-key planning"></i>规划组</span>
          <span><i class="trend-key architecture"></i>方案组</span>
          <span><i class="trend-key weekend"></i>周末加班</span>
          <span><i class="trend-key late"></i>工作日21:00后加班</span>
        </div>
        <div ref="trendChart" class="trend-chart"></div>
      </div>
    </div>

    <div class="card" style="margin-top: 24px">
      <div class="section-title">
        <span>人员工时排行 <small class="sort-hint">点击表头可按该项排序</small></span>
        <a-space :size="12" wrap>
          <a-radio-group v-model:value="employeeTeamFilter" button-style="solid" size="small">
            <a-radio-button value="all">全部</a-radio-button>
            <a-radio-button value="方案组">方案组</a-radio-button>
            <a-radio-button value="规划组">规划组</a-radio-button>
          </a-radio-group>
          <span class="full-attendance-hint">全勤比例：{{ fullAttendanceRate }}%</span>
        </a-space>
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

    <div class="card" style="margin-top: 24px">
      <div class="section-title attendance-detail-title">
        <span>打卡明细 <small v-if="detailEmployee" class="sort-hint">共 {{ filteredAttendanceDetails.length }} 条</small></span>
        <a-space wrap>
          <a-select
            v-model:value="detailEmployee"
            show-search
            allow-clear
            placeholder="搜索并选择姓名"
            :options="employeeNameOptions"
            :filter-option="filterEmployeeOption"
            style="width:190px"
          />
          <a-select v-if="detailEmployee" v-model:value="detailStatus" allow-clear placeholder="全部状态" style="width:140px">
            <a-select-option value="normal">正常</a-select-option>
            <a-select-option value="late">迟到</a-select-option>
            <a-select-option value="early">早退</a-select-option>
            <a-select-option value="late_and_early">迟到+早退</a-select-option>
            <a-select-option value="missed_punch">漏刷</a-select-option>
            <a-select-option value="absent">漏刷</a-select-option>
            <a-select-option value="leave">请假</a-select-option>
            <a-select-option value="business_trip">出差</a-select-option>
            <a-select-option value="comp_leave">调休</a-select-option>
            <a-select-option value="remote_work">居家办公</a-select-option>
            <a-select-option value="weekend_overtime">周末加班</a-select-option>
          </a-select>
        </a-space>
      </div>
      <a-empty v-if="!detailEmployee" description="请先搜索并选择一名同事，再查看打卡明细" />
      <template v-else-if="selectedEmployeeSummary">
        <div class="employee-conclusion" :class="{ attention: selectedHasAnomaly }">
          <div>
            <strong>{{ detailEmployee }} · 总体结论</strong>
            <span>{{ selectedConclusion }}</span>
          </div>
          <div class="anomaly-tags">
            <a-tag :color="selectedEmployeeSummary.missedPunchDays ? 'error' : 'success'">漏刷 {{ selectedEmployeeSummary.missedPunchDays || 0 }}</a-tag>
            <a-tag :color="selectedEmployeeSummary.lateDays ? 'orange' : 'success'">迟到 {{ selectedEmployeeSummary.lateDays || 0 }}</a-tag>
            <a-tag :color="selectedEmployeeSummary.earlyDays ? 'orange' : 'success'">早退 {{ selectedEmployeeSummary.earlyDays || 0 }}</a-tag>
          </div>
        </div>
        <div class="employee-metric-grid">
          <div class="employee-metric" :class="metricLevel('personalFullAttendanceRate')">
            <span>出勤率</span><b>{{ selectedEmployeeSummary.personalFullAttendanceRate || 0 }}%</b>
            <small>{{ metricComparison('personalFullAttendanceRate', '个百分点') }}</small>
          </div>
          <div class="employee-metric" :class="metricLevel('totalHours')">
            <span>总工时</span><b>{{ fmtHours(selectedEmployeeSummary.totalHours) }}h</b>
            <small>{{ metricComparison('totalHours', '小时') }}</small>
          </div>
          <div class="employee-metric" :class="metricLevel('overtimeHours')">
            <span>加班时长</span><b>{{ fmtHours(selectedEmployeeSummary.overtimeHours) }}h</b>
            <small>{{ metricComparison('overtimeHours', '小时') }}</small>
          </div>
          <div class="employee-metric neutral">
            <span>出差 / 外出</span><b>{{ fmtHours(selectedEmployeeSummary.businessTripHours) }} / {{ fmtHours(selectedEmployeeSummary.outsideHours) }}h</b>
            <small>统计周期内累计时长</small>
          </div>
        </div>
      </template>
      <a-alert v-else-if="detailEmployee" type="info" show-icon message="该同事在当前时间段内没有考勤记录" style="margin-bottom:14px" />
      <a-table
        v-if="detailEmployee"
        :data-source="filteredAttendanceDetails"
        :columns="detailCols"
        :pagination="{ pageSize: 50, showSizeChanger: true, pageSizeOptions: ['50', '100', '200'], showTotal: total => `共 ${total} 条` }"
        row-key="id"
        :scroll="{ x: 860 }"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'rawClockIn'">{{ record.rawClockIn || record.clockIn || '--' }}</template>
          <template v-else-if="column.dataIndex === 'rawClockOut'">{{ record.rawClockOut || record.clockOut || '--' }}</template>
          <template v-else-if="column.dataIndex === 'status'"><a-tag :color="detailStatusColor(record)">{{ detailStatusText(record) }}</a-tag></template>
          <template v-else-if="column.dataIndex === 'workHours'">{{ fmtHours(record.workHours) }}</template>
        </template>
      </a-table>
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
import { loadLatestAttendanceMonth } from '../lib/coverage';

const range = ref([dayjs().subtract(30, 'day'), dayjs()]);
const summary = ref({});
const byEmployee = ref([]);
const employees = ref([]);
const attendanceLogs = ref([]);
const trendAttendanceLogs = ref([]);
const detailEmployee = ref();
const detailStatus = ref();
const loading = ref(false);
const trendMetric = ref('total');
const employeeTeamFilter = ref('all');
const trendWeekOffset = ref(0);
const planningChart = ref(null);
const architectureChart = ref(null);
const trendChart = ref(null);
let planningChartInst = null;
let architectureChartInst = null;
let trendChartInst = null;

const latestTrendWeek = computed(() => {
  const dates = trendAttendanceLogs.value.map(item => item.date).filter(Boolean).sort();
  return startOfWeek(dates.at(-1) || range.value?.[1]?.format('YYYY-MM-DD') || dayjs().format('YYYY-MM-DD'));
});

const trendWindowWeeks = computed(() => {
  const end = dayjs(latestTrendWeek.value).subtract(trendWeekOffset.value, 'week');
  return Array.from({ length: 4 }, (_, index) => end.subtract(3 - index, 'week').format('YYYY-MM-DD'));
});

const trendMaxOffset = computed(() => {
  const dates = trendAttendanceLogs.value.map(item => item.date).filter(Boolean).sort();
  if (!dates.length) return 0;
  return Math.max(0, dayjs(latestTrendWeek.value).diff(dayjs(startOfWeek(dates[0])), 'week'));
});

const trendWindowLabel = computed(() => {
  const weeks = trendWindowWeeks.value;
  if (!weeks.length) return '当前4周';
  const start = dayjs(weeks[0]);
  const end = dayjs(weeks[3]).add(6, 'day');
  return `${start.format('MM/DD')} — ${end.format('MM/DD')}`;
});

const empCols = [
  { title: '员工', dataIndex: 'name', width: 140, sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'), sortDirections: ['descend', 'ascend'] },
  { title: '总工时', dataIndex: 'totalHours', width: 140, sorter: numericSorter('totalHours'), defaultSortOrder: 'descend', sortDirections: ['descend', 'ascend'], customRender: ({ text }) => fmtHours(text) },
  { title: '出勤天数', dataIndex: 'days', width: 110, sorter: numericSorter('days'), sortDirections: ['descend', 'ascend'] },
  { title: '加班时长', dataIndex: 'overtimeHours', width: 110, sorter: numericSorter('overtimeHours'), sortDirections: ['descend', 'ascend'], customRender: ({ text }) => fmtHours(text) },
  { title: '出差时长', dataIndex: 'businessTripHours', width: 110, sorter: numericSorter('businessTripHours'), sortDirections: ['descend', 'ascend'], customRender: ({ text }) => fmtHours(text) },
  { title: '外出时长', dataIndex: 'outsideHours', width: 110, sorter: numericSorter('outsideHours'), sortDirections: ['descend', 'ascend'], customRender: ({ text }) => fmtHours(text) },
  { title: '迟到/早退', key: 'lateOrEarlyDays', dataIndex: 'lateOrEarlyDays', width: 120, sorter: numericSorter('lateOrEarlyDays'), sortDirections: ['descend', 'ascend'] },
  { title: '漏刷次数', key: 'missedPunchDays', dataIndex: 'missedPunchDays', width: 120, sorter: numericSorter('missedPunchDays'), sortDirections: ['descend', 'ascend'] },
  { title: '个人全勤率', key: 'personalFullAttendanceRate', dataIndex: 'personalFullAttendanceRate', width: 140, sorter: numericSorter('personalFullAttendanceRate'), sortDirections: ['descend', 'ascend'] },
];

const detailCols = [
  { title: '日期', dataIndex: 'date', width: 120, sorter: (a, b) => String(a.date).localeCompare(String(b.date)), defaultSortOrder: 'descend' },
  { title: '员工', dataIndex: 'employeeName', width: 130 },
  { title: '原始上班打卡', dataIndex: 'rawClockIn', width: 140 },
  { title: '原始下班打卡', dataIndex: 'rawClockOut', width: 140 },
  { title: '工时（小时）', dataIndex: 'workHours', width: 130 },
  { title: '状态', dataIndex: 'status', width: 120 },
  { title: '备注', dataIndex: 'overrideNote', ellipsis: true },
];

const DETAIL_STATUS_MAP = {
  normal: ['正常', 'success'], late: ['迟到', 'warning'], early: ['早退', 'warning'],
  late_and_early: ['迟到+早退', 'error'], missed_punch: ['漏刷', 'error'], absent: ['漏刷', 'error'],
  leave: ['请假', 'blue'], business_trip: ['出差', 'cyan'], comp_leave: ['调休', 'purple'], remote_work: ['居家办公', 'cyan'], weekend_overtime: ['周末加班', 'gold'],
  excluded: ['不计考勤', 'default'],
};

function excludedReason(row) { return `${row.rawClockIn || ''} ${row.rawClockOut || ''}`.match(/年假|事假|病假|婚假|产假|陪产假|丧假|请假|外出/)?.[0]; }
function detailStatusText(row) { const reason = excludedReason(row); return reason ? `${reason}（不计考勤${reason === '外出' ? '，计入工时' : ''}）` : DETAIL_STATUS_MAP[row.overrideType || row.status]?.[0] || row.overrideType || row.status || '--'; }
function detailStatusColor(row) { return DETAIL_STATUS_MAP[row.overrideType || row.status]?.[1] || 'default'; }

const employeeNameOptions = computed(() => employees.value
  .filter(employee => employee.attendanceRequired !== false)
  .map(employee => employee.name)
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b, 'zh-CN'))
  .map(name => ({ label: name, value: name })));

function filterEmployeeOption(input, option) {
  return String(option?.label || '').toLowerCase().includes(String(input || '').toLowerCase());
}

const filteredAttendanceDetails = computed(() => {
  if (!detailEmployee.value) return [];
  return attendanceLogs.value
    .filter(row => row.employeeName === detailEmployee.value)
    .filter(row => !detailStatus.value || (row.overrideType || row.status) === detailStatus.value)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.employeeName || '').localeCompare(String(b.employeeName || ''), 'zh-CN'));
});

const selectedEmployeeSummary = computed(() => byEmployee.value.find(item => item.name === detailEmployee.value) || null);
const summaryAverages = computed(() => {
  const rows = byEmployee.value;
  const average = field => rows.length ? rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0) / rows.length : 0;
  return {
    personalFullAttendanceRate: average('personalFullAttendanceRate'),
    totalHours: average('totalHours'),
    overtimeHours: average('overtimeHours'),
  };
});
const selectedHasAnomaly = computed(() => {
  const row = selectedEmployeeSummary.value;
  return !!row && (Number(row.missedPunchDays) > 0 || Number(row.lateDays) > 0 || Number(row.earlyDays) > 0);
});
const selectedConclusion = computed(() => {
  const row = selectedEmployeeSummary.value;
  if (!row) return '暂无数据';
  const issues = [];
  if (row.missedPunchDays) issues.push(`漏刷${row.missedPunchDays}次`);
  if (row.lateDays) issues.push(`迟到${row.lateDays}次`);
  if (row.earlyDays) issues.push(`早退${row.earlyDays}次`);
  return issues.length ? `需要关注：${issues.join('、')}` : '本周期考勤正常，未发现漏刷、迟到或早退';
});

function metricDifference(field) {
  return (Number(selectedEmployeeSummary.value?.[field]) || 0) - (Number(summaryAverages.value[field]) || 0);
}
function metricComparison(field, unit) {
  const average = Number(summaryAverages.value[field]) || 0;
  const difference = metricDifference(field);
  const averageText = field === 'personalFullAttendanceRate' ? `${Math.round(average)}%` : `${fmtHours(average)}h`;
  if (Math.abs(difference) < 0.05) return `与全员平均值 ${averageText} 持平`;
  const differenceText = field === 'personalFullAttendanceRate' ? Math.abs(difference).toFixed(1) : fmtHours(Math.abs(difference));
  return `${difference > 0 ? '高于' : '低于'}全员平均值 ${differenceText}${unit}（平均 ${averageText}）`;
}
function metricLevel(field) {
  const difference = metricDifference(field);
  if (Math.abs(difference) < 0.05) return 'average';
  return difference > 0 ? 'above' : 'below';
}

function numericSorter(field) {
  return (a, b) => (Number(a[field]) || 0) - (Number(b[field]) || 0);
}

const byEmployeeSorted = computed(() => {
  const teamById = new Map(employees.value.map(employee => [Number(employee.id), employee.team || employee.department || '']));
  return [...byEmployee.value]
    .filter(item => employeeTeamFilter.value === 'all' || teamById.get(Number(item.employeeId)) === employeeTeamFilter.value)
    .sort((a, b) => b.totalHours - a.totalHours);
});

const fullAttendanceRate = computed(() => {
  if (!byEmployeeSorted.value.length) return 0;
  const fullAttendanceCount = byEmployeeSorted.value.filter(e => e.lateDays === 0 && e.earlyDays === 0 && e.missedPunchDays === 0).length;
  return Math.round((fullAttendanceCount / byEmployeeSorted.value.length) * 100);
});

function employeeBelongsToTeam(employee, teamKeyword) {
  return (employee.team || employee.department || '').includes(teamKeyword);
}

const unassignedEmployees = computed(() => employees.value.filter(employee =>
  employee.attendanceRequired !== false
  && !employeeBelongsToTeam(employee, '规划') && !employeeBelongsToTeam(employee, '方案')
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
    if (log.status === 'excluded' || excludedReason(log)) continue;
    if (log.overrideType === 'leave') stats.leave++;
    else if (log.overrideType === 'business_trip') stats.businessTrip++;
    else if (log.overrideType === 'comp_leave') stats.compLeave++;
    else if (log.status === 'normal') stats.normal++;
    else if (log.status === 'late') stats.late++;
    else if (log.status === 'early') stats.early++;
    else if (log.status === 'late_and_early') stats.lateAndEarly++;
    else if (['missed_punch', 'absent'].includes(log.status)) stats.missedPunch += Number(log.missedPunchCount) || 1;
    else stats.normal++;
  }

  return stats;
}

async function load() {
  loading.value = true;
  try {
    const p = params();
    const trendParams = {
      startDate: dayjs(p.startDate).subtract(21, 'day').format('YYYY-MM-DD'),
      endDate: p.endDate,
    };
    [summary.value, byEmployee.value, employees.value, attendanceLogs.value, trendAttendanceLogs.value] = await Promise.all([
      api.get('/analytics/summary', { params: p }),
      api.get('/analytics/by-employee', { params: p }),
      api.get('/employees', { params: { dashboard: true } }),
      api.get('/attendance', { params: { ...p, dashboard: true } }),
      api.get('/attendance', { params: { ...trendParams, dashboard: true } }),
    ]);
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
  const periods = trendWindowWeeks.value;
  const visibleWeeks = new Set(periods);
  const map = new Map(periods.map(week => [week, {
    planning: 0, architecture: 0,
    planningPeople: new Set(), architecturePeople: new Set(),
    planningHasHours: false, architectureHasHours: false,
    weekendOvertime: 0, weekdayOvertime: 0,
  }]));
  for (const row of trendAttendanceLogs.value) {
    const exclusion = excludedReason(row);
    const outsideWork = exclusion === '外出' || row.sourceOutside;
    if ((row.status === 'excluded' || exclusion) && !outsideWork) continue;
    const key = startOfWeek(row.date);
    if (!visibleWeeks.has(key)) continue;
    const period = map.get(key);
    const hours = Number(row.workHours) || 0;
    const team = teamOf.get(row.employeeId) || '';
    if (team.includes('规划') && hours > 0) { period.planning += hours; period.planningPeople.add(row.employeeId); period.planningHasHours = true; }
    if (team.includes('方案') && hours > 0) { period.architecture += hours; period.architecturePeople.add(row.employeeId); period.architectureHasHours = true; }
    const overtime = overtimeForLog(row);
    if ([0, 6].includes(dayjs(row.date).day())) period.weekendOvertime += overtime;
    else period.weekdayOvertime += overtime;
  }
  const labels = periods.map(date => `${dayjs(date).format('MM/DD')}周`);
  const values = key => periods.map(date => {
    const period = map.get(date);
    if (!period[`${key}HasHours`]) return { value: null, people: null, total: null, average: null };
    const people = period[`${key}People`].size;
    const total = roundTrend(period[key]);
    return {
      value: trendMetric.value === 'average' ? roundTrend(total / people) : total,
      people,
      total,
      average: people ? roundTrend(total / people) : 0,
    };
  });
  const weekendBars = periods.map(date => roundTrend(map.get(date).weekendOvertime));
  const weekdayBars = periods.map(date => roundTrend(map.get(date).weekdayOvertime));
  const tooltipFormatter = items => {
    const rows = [`<b>${items[0]?.axisValue || ''}</b>`];
    for (const item of items) {
      if (item.value == null || item.value === '-') continue;
      const rawValue = typeof item.value === 'object' ? item.value.value : item.value;
      if (rawValue == null) continue;
      if (item.data?.people != null) {
        rows.push(`${item.marker}${item.seriesName}：<b>${fmtHours(rawValue)}</b> 小时 · ${item.data.people}人`);
        rows.push(`<span style="padding-left:20px;color:#77738B">总计 ${fmtHours(item.data.total)}h · 人均 ${fmtHours(item.data.average)}h</span>`);
      } else {
        rows.push(`${item.marker}${item.seriesName}：<b>${fmtHours(rawValue)}</b> 小时`);
      }
    }
    return rows.join('<br/>');
  };
  const lineSeries = [
    { name: '规划组', data: values('planning'), color: '#55CDB1' },
    { name: '方案组', data: values('architecture'), color: '#F2C75C' },
  ].map(item => ({
    name: item.name, type: 'line', data: item.data, smooth: true, connectNulls: false,
    symbolSize: 8, lineStyle: { width: 3, color: item.color }, itemStyle: { color: item.color },
    label: { show: true, position: 'top', color: item.color, formatter: params => `${fmtHours(params.value)}h` },
  }));
  trendChartInst.setOption({
    animationDuration: 350,
    tooltip: { trigger: 'axis', formatter: tooltipFormatter, backgroundColor: 'rgba(255,255,255,.96)', borderColor: '#EBE9F2', textStyle: { color: '#49455F' } },
    legend: { data: lineSeries.map(item => item.name), top: 0, textStyle: { color: '#77738B' } },
    grid: [
      { left: 56, right: 30, top: 48, height: '54%' },
      { left: 56, right: 30, top: '73%', height: '16%' },
    ],
    xAxis: [
      { type: 'category', data: labels, boundaryGap: false, axisLine: { lineStyle: { color: '#EBE9F2' } }, axisLabel: { color: '#77738B', fontSize: 11, hideOverlap: true } },
      { type: 'category', gridIndex: 1, data: labels, axisLine: { lineStyle: { color: '#EBE9F2' } }, axisLabel: { color: '#77738B', fontSize: 11, hideOverlap: true } },
    ],
    yAxis: [
      { type: 'value', name: trendMetric.value === 'average' ? '人均小时' : '团队总小时', splitLine: { lineStyle: { color: '#F3F1F8' } }, axisLabel: { color: '#77738B' } },
      { type: 'value', gridIndex: 1, name: '加班小时', splitLine: { show: false }, axisLabel: { color: '#77738B' } },
    ],
    series: [
      ...lineSeries,
      { name: '周末加班', type: 'bar', stack: 'overtime', xAxisIndex: 1, yAxisIndex: 1, data: weekendBars, itemStyle: { color: '#F59E0B', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 18 },
      { name: '工作日21:00后', type: 'bar', stack: 'overtime', xAxisIndex: 1, yAxisIndex: 1, data: weekdayBars, itemStyle: { color: '#8B5CF6', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 18 },
    ],
  }, true);
}

function roundTrend(value) { return Math.round((Number(value) || 0) * 100) / 100; }

function startOfWeek(date) {
  const value = dayjs(date);
  return value.subtract((value.day() + 6) % 7, 'day').format('YYYY-MM-DD');
}

function moveTrendWindow(direction) {
  trendWeekOffset.value = Math.min(trendMaxOffset.value, Math.max(0, trendWeekOffset.value + direction));
  renderTrend();
}

function overtimeForLog(log) {
  if (Number.isFinite(log.overtimeHours)) return log.overtimeHours;
  if (log.overrideType || log.status === 'remote_work') return 0;
  const stored = Number(log.sourceOvertimeHours) || 0;
  if (stored > 0) return roundTrend(stored);
  if ([0, 6].includes(dayjs(log.date).day())) return roundTrend(log.workHours);
  const time = String(log.clockOut || log.rawClockOut || '').match(/(\d{1,2}):(\d{2})/);
  const minutes = time ? Number(time[1]) * 60 + Number(time[2]) : 0;
  return roundTrend(Math.max(0, minutes - 21 * 60) / 60);
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
  range.value = await loadLatestAttendanceMonth(range.value);
  await load();
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

.sort-hint {
  margin-left: 8px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
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

.trend-title{gap:16px}.trend-window-nav{display:flex;align-items:center;gap:10px}.trend-window-nav>span{min-width:118px;text-align:center;font-size:14px}.trend-explain{display:flex;gap:18px;flex-wrap:wrap;margin:4px 0 8px;color:var(--muted);font-size:12px}.trend-explain span{display:inline-flex;align-items:center;gap:6px}.trend-key{display:inline-block;width:20px;height:4px;border-radius:4px}.trend-key.planning{background:#55CDB1}.trend-key.architecture{background:#F2C75C}.trend-key.weekend{height:10px;background:#F59E0B}.trend-key.late{height:10px;background:#8B5CF6}.trend-chart{height:520px}

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
.attendance-detail-title{gap:16px;flex-wrap:wrap;margin-bottom:14px}
.employee-conclusion{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:12px;padding:14px 16px;border:1px solid #b7ebd7;border-radius:10px;background:#f0fff8}.employee-conclusion.attention{border-color:#ffb3c1;background:#fff1f3}.employee-conclusion strong{display:block;margin-bottom:4px;font-size:15px}.employee-conclusion span{font-size:13px;color:var(--muted)}.anomaly-tags{display:flex;flex-wrap:wrap;gap:5px}.employee-metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}.employee-metric{padding:13px 14px;border-radius:10px;border-left:4px solid #8c8c8c;background:#fafafa}.employee-metric>span{display:block;color:var(--muted);font-size:12px}.employee-metric>b{display:block;margin:3px 0;font-size:21px;color:var(--ink)}.employee-metric>small{display:block;min-height:34px;line-height:1.45;color:var(--muted)}.employee-metric.above{border-left-color:#1677ff;background:#f0f7ff}.employee-metric.below{border-left-color:#fa8c16;background:#fff7e8}.employee-metric.average{border-left-color:#52c41a;background:#f6ffed}.employee-metric.neutral{border-left-color:#722ed1;background:#f9f0ff}@media(max-width:900px){.employee-metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.employee-conclusion{align-items:flex-start;flex-direction:column}.employee-metric-grid{grid-template-columns:1fr}}
</style>

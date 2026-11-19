<template>
  <div class="card coverage-card">
    <div class="coverage-head">
      <div><div class="section-title">数据覆盖进度</div><p>考勤与项目分配数据的有效时间范围</p></div>
      <div class="coverage-head-actions">
        <div class="week-nav">
          <a-button size="small" shape="circle" :disabled="!canMovePrevious" title="查看上一时段" @click="moveWindow(-1)">←</a-button>
          <span>{{ windowLabel }}</span>
          <a-button size="small" shape="circle" :disabled="!canMoveNext" title="查看下一时段" @click="moveWindow(1)">→</a-button>
        </div>
        <a-tag :color="status.color">{{ status.text }}</a-tag>
      </div>
    </div>
    <a-skeleton v-if="loading" active :paragraph="{ rows: 3 }" />
    <template v-else>
      <div class="attendance-latest">
        <span>当前首先展示考勤最新覆盖时段</span>
        <b>{{ attendancePeriodLabel }}</b>
        <small>可使用右侧箭头继续查看项目分配延伸日期</small>
      </div>
      <div class="coverage-axis">
        <span v-for="period in visiblePeriods" :key="period.start">{{ period.label }}</span>
      </div>
      <div v-for="item in tracks" :key="item.key" class="coverage-row">
        <div class="coverage-label"><i :style="{ background: item.color }"></i><b>{{ item.title }}</b><small>{{ item.count }} 条总计</small></div>
        <div class="track">
          <div v-if="trackVisible(item)" class="track-fill" :style="trackStyle(item)"><span></span></div>
          <div v-else class="track-empty">{{ item.start ? '本窗口无数据' : '尚未导入' }}</div>
        </div>
        <div class="coverage-dates"><b>{{ visibleRange(item).start || '—' }}</b><span>至</span><b>{{ visibleRange(item).end || '—' }}</b><small>当前时段覆盖 · 最近导入：{{ formatImport(item.lastImport) }}</small></div>
      </div>
      <a-alert v-if="warning" type="warning" show-icon :message="warning" style="margin-top:14px" />
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import dayjs from 'dayjs';
import api from '../api';
import { latestAttendanceMonthRange } from '../lib/coverage';

const info = ref({});
const loading = ref(true);
const windowStart = ref(null);
const windowEndValue = ref(null);
const tracks = computed(() => [
  { key: 'attendance', title: '考勤数据', color: '#7C6CF2', start: info.value.earliestDate, end: info.value.latestDate, count: info.value.totalRecords || 0, lastImport: info.value.lastImport },
  { key: 'allocation', title: '项目分配', color: '#E11D48', start: info.value.earliestMembershipDate, end: info.value.latestMembershipDate, count: info.value.membershipRecords || 0, lastImport: info.value.lastMembershipImport },
]);
const validDates = computed(() => tracks.value.flatMap(item => [item.start, item.end]).filter(Boolean));
const axisStart = computed(() => validDates.value.length ? [...validDates.value].sort()[0] : null);
const axisEnd = computed(() => validDates.value.length ? [...validDates.value].sort().at(-1) : null);
const attendancePeriodLabel = computed(() => info.value.latestPeriodStart && info.value.latestPeriodEnd
  ? `${info.value.latestPeriodStart} 至 ${info.value.latestPeriodEnd}`
  : info.value.latestDate ? `${info.value.earliestDate} 至 ${info.value.latestDate}` : '尚未导入考勤数据');
const effectiveWindowStart = computed(() => windowStart.value || (axisStart.value ? dayjs(axisStart.value) : dayjs().startOf('day')));
const windowEnd = computed(() => windowEndValue.value || effectiveWindowStart.value.add(1, 'month').subtract(1, 'day'));
const windowDays = computed(() => Math.max(1, windowEnd.value.diff(effectiveWindowStart.value, 'day') + 1));
const visiblePeriods = computed(() => Array.from({ length: 4 }, (_, index) => {
  const startOffset = Math.floor(index * windowDays.value / 4);
  const endOffset = Math.max(startOffset, Math.floor((index + 1) * windowDays.value / 4) - 1);
  const start = effectiveWindowStart.value.add(startOffset, 'day');
  const end = effectiveWindowStart.value.add(endOffset, 'day');
  return { start: start.format('YYYY-MM-DD'), label: `${start.format('MM/DD')}–${end.format('MM/DD')}` };
}));
const windowLabel = computed(() => validDates.value.length
  ? `${effectiveWindowStart.value.format('YYYY-MM-DD')} 至 ${windowEnd.value.format('YYYY-MM-DD')}`
  : '暂无数据');
const canMovePrevious = computed(() => !!axisStart.value && effectiveWindowStart.value.isAfter(dayjs(axisStart.value), 'day'));
const canMoveNext = computed(() => !!axisEnd.value && windowEnd.value.isBefore(dayjs(axisEnd.value), 'day'));
const overlap = computed(() => {
  const [a, p] = tracks.value;
  return a.start && p.start && a.start <= p.end && p.start <= a.end;
});
const status = computed(() => {
  if (!validDates.value.length) return { color: 'default', text: '等待导入' };
  if (!tracks.value.every(item => item.start)) return { color: 'warning', text: '数据不完整' };
  return overlap.value ? { color: 'success', text: '时间范围有交集' } : { color: 'error', text: '时间范围未对齐' };
});
const warning = computed(() => {
  const [a, p] = tracks.value;
  if (!a.start || !p.start) return '考勤和项目分配数据尚未全部导入，看板分析可能不完整。';
  if (!overlap.value) return '两类数据的覆盖时间没有交集，无法可靠计算项目工时。';
  if (a.start !== p.start || a.end !== p.end) return `两类数据范围不完全一致；共同可分析时段为 ${a.start > p.start ? a.start : p.start} 至 ${a.end < p.end ? a.end : p.end}。`;
  return '';
});
function trackStyle(item) {
  const visibleStart = dayjs(item.start).isAfter(effectiveWindowStart.value, 'day') ? dayjs(item.start) : effectiveWindowStart.value;
  const visibleEnd = dayjs(item.end).isBefore(windowEnd.value, 'day') ? dayjs(item.end) : windowEnd.value;
  const left = visibleStart.diff(effectiveWindowStart.value, 'day') / windowDays.value * 100;
  const coveredDays = visibleEnd.diff(visibleStart, 'day') + 1;
  const width = Math.max(2, coveredDays / windowDays.value * 100);
  return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, background: item.color };
}
function trackVisible(item) {
  return !!item.start && dayjs(item.end).diff(effectiveWindowStart.value, 'day') >= 0
    && dayjs(item.start).diff(windowEnd.value, 'day') <= 0;
}
function moveWindow(direction) {
  if (!axisStart.value || !axisEnd.value) return;
  const days = windowDays.value;
  if (direction < 0) {
    let end = effectiveWindowStart.value.subtract(1, 'day');
    let start = end.subtract(days - 1, 'day');
    if (start.isBefore(dayjs(axisStart.value), 'day')) start = dayjs(axisStart.value);
    windowStart.value = start;
    windowEndValue.value = end;
  } else {
    const start = windowEnd.value.add(1, 'day');
    let end = start.add(days - 1, 'day');
    if (end.isAfter(dayjs(axisEnd.value), 'day')) end = dayjs(axisEnd.value);
    windowStart.value = start;
    windowEndValue.value = end;
  }
}
function visibleRange(item) {
  if (!trackVisible(item)) return { start: null, end: null };
  const start = dayjs(item.start).isAfter(effectiveWindowStart.value, 'day') ? dayjs(item.start) : effectiveWindowStart.value;
  const end = dayjs(item.end).isBefore(windowEnd.value, 'day') ? dayjs(item.end) : windowEnd.value;
  return { start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD') };
}
function formatImport(value) { return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—'; }
onMounted(async () => {
  try {
    info.value = await api.get('/attendance/date-range');
    const range = latestAttendanceMonthRange(info.value);
    if (range) {
      windowStart.value = range[0];
      windowEndValue.value = range[1];
    }
  } finally { loading.value = false; }
});
</script>

<style scoped>
.coverage-card{padding:20px 24px}.coverage-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.coverage-head p{margin:-8px 0 16px;color:var(--muted);font-size:12px}.coverage-head-actions{display:flex;align-items:center;gap:14px}.attendance-latest{display:flex;align-items:center;gap:12px;margin:0 0 14px;padding:10px 14px;border-radius:10px;background:#f3f0ff;color:#6656df;font-size:12px}.attendance-latest b{font-size:14px}.attendance-latest small{margin-left:auto;color:var(--muted)}.week-nav{display:flex;align-items:center;gap:8px}.week-nav span{min-width:190px;text-align:center;color:var(--muted);font-size:12px}.coverage-axis{display:grid;grid-template-columns:repeat(4,1fr);margin:0 287px 5px 152px;color:var(--muted-light);font-size:11px;text-align:center}.coverage-axis span{border-left:1px solid #E7E4EF}.coverage-axis span:last-child{border-right:1px solid #E7E4EF}.coverage-row{display:grid;grid-template-columns:140px minmax(260px,1fr) 275px;gap:12px;align-items:center;padding:11px 0}.coverage-label{display:flex;align-items:center;gap:7px}.coverage-label i{width:10px;height:10px;border-radius:50%}.coverage-label small{color:var(--muted);margin-left:auto}.track{height:14px;border-radius:999px;background:repeating-linear-gradient(90deg,#F0EEF6 0,calc(25% - 1px),#E3DFEB calc(25% - 1px),#E3DFEB 25%);position:relative;overflow:hidden}.track-fill{position:absolute;height:100%;border-radius:999px;box-shadow:0 2px 7px rgba(70,58,126,.15)}.track-fill span{position:absolute;right:3px;top:3px;width:8px;height:8px;border-radius:50%;background:#fff}.track-empty{text-align:center;font-size:10px;color:var(--muted-light);line-height:14px}.coverage-dates{display:grid;grid-template-columns:1fr 20px 1fr;align-items:center;font-size:12px;text-align:center}.coverage-dates span{color:var(--muted)}.coverage-dates small{grid-column:1/-1;color:var(--muted);margin-top:3px}@media(max-width:900px){.coverage-head{flex-direction:column}.coverage-head-actions{width:100%;justify-content:space-between}.attendance-latest{align-items:flex-start;flex-direction:column}.attendance-latest small{margin-left:0}.coverage-row{grid-template-columns:1fr}.coverage-axis{display:none}.coverage-dates{text-align:left;max-width:300px}}
@media(max-width:760px){.coverage-card{padding:16px 12px}.coverage-head>div{min-width:0;max-width:100%}.coverage-head-actions{flex-wrap:wrap;gap:10px}.week-nav{flex:1;min-width:0}.week-nav span{min-width:0;flex:1}.coverage-row{grid-template-columns:minmax(0,1fr)}.coverage-dates{min-width:0;max-width:100%}}
</style>

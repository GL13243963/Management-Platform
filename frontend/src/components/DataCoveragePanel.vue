<template>
  <div class="card coverage-card">
    <div class="coverage-head">
      <div><div class="section-title">数据覆盖进度</div><p>考勤与项目分配数据的有效时间范围</p></div>
      <a-tag :color="status.color">{{ status.text }}</a-tag>
    </div>
    <a-skeleton v-if="loading" active :paragraph="{ rows: 3 }" />
    <template v-else>
      <div class="coverage-axis"><span>{{ axisStart || '暂无数据' }}</span><span>{{ axisEnd || '暂无数据' }}</span></div>
      <div v-for="item in tracks" :key="item.key" class="coverage-row">
        <div class="coverage-label"><i :style="{ background: item.color }"></i><b>{{ item.title }}</b><small>{{ item.count }} 条</small></div>
        <div class="track"><div v-if="item.start" class="track-fill" :style="trackStyle(item)"><span></span></div><div v-else class="track-empty">尚未导入</div></div>
        <div class="coverage-dates"><b>{{ item.start || '—' }}</b><span>至</span><b>{{ item.end || '—' }}</b><small>最近导入：{{ formatImport(item.lastImport) }}</small></div>
      </div>
      <a-alert v-if="warning" type="warning" show-icon :message="warning" style="margin-top:14px" />
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import dayjs from 'dayjs';
import api from '../api';

const info = ref({});
const loading = ref(true);
const tracks = computed(() => [
  { key: 'attendance', title: '考勤数据', color: '#7C6CF2', start: info.value.earliestDate, end: info.value.latestDate, count: info.value.totalRecords || 0, lastImport: info.value.lastImport },
  { key: 'allocation', title: '项目分配', color: '#E11D48', start: info.value.earliestMembershipDate, end: info.value.latestMembershipDate, count: info.value.membershipRecords || 0, lastImport: info.value.lastMembershipImport },
]);
const validDates = computed(() => tracks.value.flatMap(item => [item.start, item.end]).filter(Boolean));
const axisStart = computed(() => validDates.value.length ? [...validDates.value].sort()[0] : null);
const axisEnd = computed(() => validDates.value.length ? [...validDates.value].sort().at(-1) : null);
const totalDays = computed(() => axisStart.value && axisEnd.value ? Math.max(1, dayjs(axisEnd.value).diff(dayjs(axisStart.value), 'day')) : 1);
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
  const left = dayjs(item.start).diff(dayjs(axisStart.value), 'day') / totalDays.value * 100;
  const width = Math.max(2, dayjs(item.end).diff(dayjs(item.start), 'day') / totalDays.value * 100);
  return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, background: item.color };
}
function formatImport(value) { return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—'; }
onMounted(async () => { try { info.value = await api.get('/attendance/date-range'); } finally { loading.value = false; } });
</script>

<style scoped>
.coverage-card{padding:20px 24px}.coverage-head{display:flex;justify-content:space-between;align-items:flex-start}.coverage-head p{margin:-8px 0 16px;color:var(--muted);font-size:12px}.coverage-axis{display:flex;justify-content:space-between;margin:0 285px 5px 150px;color:var(--muted-light);font-size:11px}.coverage-row{display:grid;grid-template-columns:140px minmax(260px,1fr) 275px;gap:12px;align-items:center;padding:11px 0}.coverage-label{display:flex;align-items:center;gap:7px}.coverage-label i{width:10px;height:10px;border-radius:50%}.coverage-label small{color:var(--muted);margin-left:auto}.track{height:14px;border-radius:999px;background:#F0EEF6;position:relative;overflow:hidden}.track-fill{position:absolute;height:100%;border-radius:999px;box-shadow:0 2px 7px rgba(70,58,126,.15)}.track-fill span{position:absolute;right:3px;top:3px;width:8px;height:8px;border-radius:50%;background:#fff}.track-empty{text-align:center;font-size:10px;color:var(--muted-light);line-height:14px}.coverage-dates{display:grid;grid-template-columns:1fr 20px 1fr;align-items:center;font-size:12px;text-align:center}.coverage-dates span{color:var(--muted)}.coverage-dates small{grid-column:1/-1;color:var(--muted);margin-top:3px}@media(max-width:900px){.coverage-row{grid-template-columns:1fr}.coverage-axis{display:none}.coverage-dates{text-align:left;max-width:300px}}
</style>

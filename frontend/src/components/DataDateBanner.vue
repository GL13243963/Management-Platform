<template>
  <a-alert
    v-if="info"
    :type="alertType"
    show-icon
    :message="message"
    :description="description"
    style="margin-bottom: 16px"
  />
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../api';

const props = defineProps({
  // The currently selected date range as [dayjs, dayjs] or ISO strings
  range: { type: Array, default: null },
});

const info = ref(null);

const alertType = computed(() => {
  if (!info.value) return 'info';
  return info.value.hasWarning ? 'warning' : 'info';
});

const message = computed(() => {
  if (!info.value) return '';
  if (!info.value.latestDate) return '暂无考勤数据';
  return `考勤数据截止至 ${info.value.latestDate}（共 ${info.value.totalRecords} 条记录）`;
});

const description = computed(() => {
  if (!info.value || !info.value.latestDate) return '';
  const notes = [];
  if (props.range && props.range[1]) {
    const end = typeof props.range[1] === 'string'
      ? props.range[1]
      : props.range[1].format?.('YYYY-MM-DD');
    if (end && end > info.value.latestDate) {
      notes.push(`所选时间段包含 ${info.value.latestDate} 之后尚无考勤数据的日期，工时统计可能偏低。`);
    }
  }
  if (info.value.earliestMembershipDate && info.value.earliestDate
      && info.value.earliestMembershipDate < info.value.earliestDate) {
    notes.push(`项目分配起始于 ${info.value.earliestMembershipDate}，早于考勤数据起始日期 ${info.value.earliestDate}。`);
  }
  return notes.join(' ');
});

onMounted(async () => {
  try {
    info.value = await api.get('/attendance/date-range');
  } catch {
    info.value = null;
  }
});
</script>

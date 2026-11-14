<template>
  <div class="page weekly-page">
    <div class="page-head"><div><h1 class="page-title">每周项目填报</h1><p class="page-subtitle">{{ weekLabel }} · {{ auth.user?.username }}</p></div><a-tag :color="statusColor">{{ statusLabel }}</a-tag></div>
    <section v-if="attendanceReminder" class="attendance-reminder" :class="{ empty: !attendanceReminder.hasData }">
      <div class="reminder-copy">
        <span>{{ attendanceReminder.month }} · 上月考勤提醒</span>
        <strong>{{ attendanceReminder.encouragement }}</strong>
        <small>考勤数据由管理员每月20日更新</small>
      </div>
      <div v-if="attendanceReminder.hasData" class="reminder-stats">
        <div><strong>{{ attendanceReminder.summary.personalFullAttendanceRate }}%</strong><span>正常出勤率</span></div>
        <div><strong>{{ attendanceReminder.summary.totalHours }}h</strong><span>总工时</span></div>
        <div><strong>{{ attendanceReminder.summary.overtimeHours }}h</strong><span>加班时长</span></div>
        <div :class="{ attention: attentionCount > 0 }"><strong>{{ attentionCount }}</strong><span>迟到/早退/漏刷</span></div>
      </div>
    </section>
    <a-alert v-if="reminder" :type="reminder.type" show-icon :message="reminder.message" style="margin-bottom:18px" />
    <a-alert v-if="report?.status === 'locked'" type="info" show-icon message="本周数据已锁定，如需更正请联系组长或管理员。" style="margin-bottom:18px" />
    <WeeklyAllocationEditor ref="editor" :items="items" :team="auth.user?.employee?.team" :readonly="report?.status === 'locked'" />
    <div class="actions">
      <a-button :disabled="report?.status === 'locked'" :loading="saving" @click="save(false)">保存草稿</a-button>
      <a-button type="primary" :disabled="report?.status === 'locked'" :loading="saving" @click="save(true)">提交本周填报</a-button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import dayjs from 'dayjs';
import { message } from 'ant-design-vue';
import api from '../api';
import WeeklyAllocationEditor from '../components/WeeklyAllocationEditor.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const editor = ref(null);
const report = ref(null);
const items = ref([]);
const saving = ref(false);
const attendanceReminder = ref(null);
const attentionCount = computed(() => {
  const value = attendanceReminder.value?.summary;
  return value ? value.lateDays + value.earlyDays + value.missedPunchDays : 0;
});
function monday() { const now = dayjs(); return now.subtract((now.day() + 6) % 7, 'day').format('YYYY-MM-DD'); }
const weekStart = monday();
const weekLabel = computed(() => `${weekStart} 至 ${dayjs(weekStart).add(6, 'day').format('YYYY-MM-DD')}`);
const statusLabel = computed(() => ({ draft: '草稿', submitted: '已提交', reviewed: '组长已核对', locked: '已锁定' })[report.value?.status] || '未填写');
const statusColor = computed(() => ({ draft: 'default', submitted: 'blue', reviewed: 'green', locked: 'purple' })[report.value?.status] || 'orange');
const reminder = computed(() => {
  if (['submitted', 'reviewed', 'locked'].includes(report.value?.status)) return null;
  const day = dayjs().day();
  if (day === 4) return { type: 'warning', message: '今天是周四，请在下班前完成本周和下周项目填报。' };
  if ([5, 6, 0].includes(day)) return { type: 'error', message: '本周填报尚未提交，请尽快完成。' };
  return { type: 'info', message: '请在本周四前完成填报；没有具体项目时请选择“待安排”。' };
});
async function load() {
  const [result, attendance] = await Promise.all([
    api.get('/weekly/my', { params: { weekStart } }),
    api.get('/weekly/my-attendance-summary'),
  ]);
  report.value = result.report;
  attendanceReminder.value = attendance;
  items.value = result.report?.items?.length ? result.report.items : [
    ...(result.suggestedCurrent || []),
    { period: 'next', projectName: '', weight: 1 },
  ];
}
async function save(submit) {
  if (submit && !editor.value.valid()) return message.warning('本周实际和下周计划的比例都必须合计为1.0');
  saving.value = true;
  try {
    report.value = await api.put('/weekly/my', { weekStart, items: editor.value.values(), submit });
    items.value = report.value.items;
    message.success(submit ? '本周填报已提交' : '草稿已保存');
  } catch (error) { message.error(error?.error || '保存失败'); }
  finally { saving.value = false; }
}
onMounted(load);
</script>

<style scoped>
.weekly-page{max-width:1180px;margin:0 auto}.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.attendance-reminder{display:flex;align-items:center;justify-content:space-between;gap:24px;margin:0 0 18px;padding:20px 22px;border:1px solid #ded9ff;border-radius:14px;background:linear-gradient(120deg,#f0edff,#fbfaff);box-shadow:0 5px 18px rgba(87,72,177,.07)}.attendance-reminder.empty{background:#faf9fe}.reminder-copy{display:flex;flex:1;flex-direction:column;gap:6px}.reminder-copy>span{color:#6a5bd8;font-size:12px;font-weight:700}.reminder-copy>strong{color:#45405c;font-size:14px;line-height:1.65}.reminder-copy>small{color:#9893a6;font-size:11px}.reminder-stats{display:grid;grid-template-columns:repeat(4,minmax(82px,1fr));gap:8px}.reminder-stats>div{min-width:82px;padding:9px 12px;border-left:1px solid #e3dff5;text-align:center}.reminder-stats strong,.reminder-stats span{display:block}.reminder-stats strong{color:#4f4969;font-size:17px}.reminder-stats span{margin-top:3px;color:#918ca0;font-size:10px}.reminder-stats .attention strong{color:#e5577f}.actions{display:flex;justify-content:flex-end;gap:12px;margin-top:20px;padding:18px 0}@media(max-width:800px){.attendance-reminder{align-items:stretch;flex-direction:column}.reminder-stats{grid-template-columns:repeat(2,1fr)}.reminder-stats>div{border-left:0;background:rgba(255,255,255,.65);border-radius:9px}}@media(max-width:600px){.actions{position:sticky;bottom:0;padding:12px;background:rgba(248,248,252,.95)}}
</style>

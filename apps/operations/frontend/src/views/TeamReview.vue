<template>
  <div class="page review-page">
    <div class="review-head"><div><h1 class="page-title">小组填报核对</h1><p class="page-subtitle">周五核对本组项目名称、数量和投入比例</p></div><a-select v-if="auth.isAdmin" v-model:value="team" :options="teamOptions" style="width:130px" @change="load" /></div>
    <div class="week-toolbar"><a-button @click="moveWeek(-1)">上一周</a-button><b>{{ weekLabel }}</b><a-button @click="moveWeek(1)">下一周</a-button><a-button @click="goCurrent">本周</a-button></div>
    <a-alert :type="missingCount ? 'warning' : 'success'" show-icon :message="missingCount ? `${missingCount} 人尚未填写` : '本组人员均已填写'" style="margin-bottom:18px" />
    <a-table :data-source="rows" :columns="columns" :row-key="record => record.employee.id" :loading="loading">
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'status'"><a-tag :color="statusColor(record)">{{ statusLabel(record) }}</a-tag></template>
        <template v-else-if="column.dataIndex === 'currentTotal'"><span :class="{ invalid: Math.abs(record.currentTotal - 1) > .0001 }">{{ record.currentTotal.toFixed(2) }}</span></template>
        <template v-else-if="column.dataIndex === 'nextTotal'"><span :class="{ invalid: Math.abs(record.nextTotal - 1) > .0001 }">{{ record.nextTotal.toFixed(2) }}</span></template>
        <template v-else-if="column.dataIndex === 'actions'"><a-button type="link" @click="openReview(record)">{{ record.report ? '核对/修改' : '代为填写' }}</a-button></template>
      </template>
    </a-table>

    <section v-if="nameReviews.length" class="card name-reviews">
      <h2>相似项目名称待确认</h2>
      <div v-for="item in nameReviews" :key="item.id" class="name-review-row">
        <div><b>{{ item.projectName }}</b><span>可能与“{{ item.suggestedProjectName }}”是同一项目 · {{ item.employeeName }}提交</span></div>
        <a-space><a-button @click="resolveName(item,'separate')">保留为新项目</a-button><a-button type="primary" @click="resolveName(item,'merge')">合并到已有项目</a-button></a-space>
      </div>
    </section>

    <a-modal v-model:open="modal.open" :title="`核对：${modal.row?.employee?.name || ''}`" width="920px" ok-text="核对完成" :confirm-loading="modal.loading" @ok="saveReview">
      <WeeklyAllocationEditor ref="editor" :items="modal.items" :team="modal.row?.employee?.team" />
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { message } from 'ant-design-vue';
import api from '../api';
import WeeklyAllocationEditor from '../components/WeeklyAllocationEditor.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const teamOptions = [{ label: '方案组', value: '方案组' }, { label: '规划组', value: '规划组' }];
const team = ref(auth.user?.roles?.find(item => item.role === 'team_leader')?.team || '方案组');
const currentMonday = () => { const now = dayjs(); return now.subtract((now.day() + 6) % 7, 'day'); };
const weekStart = ref(currentMonday().format('YYYY-MM-DD'));
const rows = ref([]);
const nameReviews = ref([]);
const loading = ref(false);
const editor = ref(null);
const modal = reactive({ open: false, loading: false, row: null, items: [] });
const columns = [
  { title: '员工', dataIndex: ['employee', 'name'] }, { title: '状态', dataIndex: 'status', width: 120 },
  { title: '本周合计', dataIndex: 'currentTotal', width: 110 }, { title: '下周合计', dataIndex: 'nextTotal', width: 110 },
  { title: '操作', dataIndex: 'actions', width: 130 },
];
const weekLabel = computed(() => `${weekStart.value} 至 ${dayjs(weekStart.value).add(6, 'day').format('YYYY-MM-DD')}`);
const missingCount = computed(() => rows.value.filter(row => !row.hasData).length);
function statusLabel(row) {
  const status = row.report?.status;
  if (status === 'reviewed') return '已核对';
  if (status === 'locked') return '已锁定';
  if (status === 'submitted') return '已提交';
  return row.hasData ? '已填写' : '未填写';
}
function statusColor(row) {
  const status = row.report?.status;
  if (status === 'reviewed') return 'green';
  if (status === 'locked') return 'purple';
  if (status === 'submitted') return 'blue';
  return row.hasData ? 'cyan' : 'orange';
}
async function load() {
  loading.value = true;
  try {
    const params = { team: team.value, weekStart: weekStart.value };
    const [result, reviews] = await Promise.all([api.get('/weekly/team', { params }), api.get('/weekly/project-reviews', { params: { team: team.value } })]);
    rows.value = result.rows; nameReviews.value = reviews;
  } finally { loading.value = false; }
}
function moveWeek(value) { weekStart.value = dayjs(weekStart.value).add(value * 7, 'day').format('YYYY-MM-DD'); load(); }
function goCurrent() { weekStart.value = currentMonday().format('YYYY-MM-DD'); load(); }
function openReview(row) {
  modal.row = row;
  modal.items = row.report?.items?.length ? row.report.items : [{ period: 'current', projectName: '', weight: 1 }, { period: 'next', projectName: '', weight: 1 }];
  modal.open = true;
}
async function saveReview() {
  if (!editor.value.valid()) return message.warning('两部分比例都必须合计为1.0');
  modal.loading = true;
  try {
    await api.put(`/weekly/team/${modal.row.employee.id}`, { weekStart: weekStart.value, items: editor.value.values(), reviewed: true });
    message.success('已完成核对'); modal.open = false; await load();
  } catch (error) { message.error(error?.error || '保存失败'); }
  finally { modal.loading = false; }
}
async function resolveName(item, action) { await api.post(`/weekly/project-reviews/${item.id}/resolve`, { action, team: team.value }); message.success('项目名称已处理'); await load(); }
onMounted(load);
</script>

<style scoped>
.review-head,.week-toolbar,.name-review-row{display:flex;justify-content:space-between;align-items:center;gap:16px}.week-toolbar{justify-content:flex-start;margin:16px 0}.invalid{color:#cf1322;font-weight:700}.name-reviews{margin-top:20px;padding:20px}.name-reviews h2{margin-top:0}.name-review-row{padding:14px 0;border-top:1px solid var(--border)}.name-review-row span{display:block;margin-top:5px;color:var(--muted);font-size:12px}@media(max-width:700px){.review-head,.name-review-row{align-items:flex-start;flex-direction:column}.week-toolbar{flex-wrap:wrap}}
</style>

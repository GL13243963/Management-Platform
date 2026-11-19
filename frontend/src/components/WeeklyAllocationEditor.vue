<template>
  <div class="weekly-editor">
    <section v-for="section in sections" :key="section.period" class="period-card">
      <header>
        <div><h3>{{ section.title }}</h3><p>{{ section.description }}</p></div>
        <div class="total" :class="{ valid: isValid(section.period) }">合计 {{ total(section.period).toFixed(2) }}</div>
      </header>
      <div v-for="(item, index) in rows[section.period]" :key="item.key" class="allocation-row">
        <a-select
          v-model:value="item.projectId"
          :options="projectOptions"
          :disabled="readonly"
          placeholder="请选择项目"
          show-search
          option-filter-prop="label"
          allow-clear
          style="flex:1"
          @change="emitChange"
          @dropdownVisibleChange="visible => visible && loadProjects()"
        />
        <a-input-number v-model:value="item.weight" :disabled="readonly" :min="0.05" :max="1" :step="0.05" @change="emitChange" />
        <span class="percent">{{ Math.round((Number(item.weight) || 0) * 100) }}%</span>
        <a-button v-if="!readonly" danger type="text" @click="remove(section.period, index)">删除</a-button>
      </div>
      <a-button v-if="!readonly" type="dashed" block @click="add(section.period)">＋ 添加项目</a-button>
      <a-alert v-if="!isValid(section.period)" type="warning" show-icon :message="`${section.title}比例必须合计为 1.0`" />
    </section>
  </div>
</template>

<script setup>
import { computed, reactive, watch } from 'vue';
import api from '../api';

const props = defineProps({ items: { type: Array, default: () => [] }, readonly: Boolean, team: { type: String, default: '' } });
const emit = defineEmits(['update:items']);
const rows = reactive({ current: [], next: [] });
const projects = reactive([]);
const UNASSIGNED = 'unassigned';
const sections = [
  { period: 'current', title: '本周实际', description: '填写本周实际参与的项目和投入比例' },
  { period: 'next', title: '下周计划', description: '填写下周预计参与的项目和投入比例' },
];
let keySeed = 0;

function makeItem(item = {}) {
  const unassigned = !item.projectId && String(item.projectName || '').trim() === '待安排';
  return { key: ++keySeed, period: item.period, projectId: unassigned ? UNASSIGNED : (item.projectId || null), projectName: item.projectName || '', projectCode: item.projectCode || '', weight: Number(item.weight) || 1 };
}
function reset(items) {
  rows.current.splice(0, rows.current.length, ...items.filter(item => item.period === 'current').map(makeItem));
  rows.next.splice(0, rows.next.length, ...items.filter(item => item.period === 'next').map(makeItem));
  if (!rows.current.length) rows.current.push(makeItem({ period: 'current', weight: 1 }));
  if (!rows.next.length) rows.next.push(makeItem({ period: 'next', weight: 1 }));
}
watch(() => props.items, value => reset(value || []), { immediate: true, deep: false });
const projectOptions = computed(() => {
  const values = [{ value: UNASSIGNED, label: '待安排' }, ...projects.map(project => ({ value: project.id, label: project.code ? `${project.name}（${project.code}）` : project.name }))];
  return values.filter((option, index) => values.findIndex(value => value.value === option.value) === index);
});
function total(period) { return rows[period].reduce((sum, item) => sum + (Number(item.weight) || 0), 0); }
function isValid(period) { return Math.abs(total(period) - 1) < 0.0001 && rows[period].every(item => item.projectId); }
function values() {
  return [...rows.current, ...rows.next].map(({ key, ...item }) => {
    if (item.projectId === UNASSIGNED) return { period: item.period, projectId: null, projectName: '待安排', weight: Number(item.weight) };
    const project = projects.find(value => Number(value.id) === Number(item.projectId));
    return { period: item.period, projectId: Number(item.projectId), projectName: project?.name || item.projectName, weight: Number(item.weight) };
  });
}
function emitChange() { emit('update:items', values()); }
function add(period) { rows[period].push(makeItem({ period, weight: 0.5 })); emitChange(); }
function remove(period, index) { rows[period].splice(index, 1); if (!rows[period].length) rows[period].push(makeItem({ period, weight: 1 })); emitChange(); }
function valid() { return isValid('current') && isValid('next'); }
defineExpose({ values, valid, reset });
async function loadProjects() {
  if (!props.team) return;
  try {
    const loaded = await api.get('/projects/options', { params: { team: props.team } });
    const selected = [...rows.current, ...rows.next]
      .filter(item => item.projectId && item.projectId !== UNASSIGNED && item.projectName)
      .map(item => ({ id: Number(item.projectId), name: item.projectName, code: item.projectCode }));
    projects.splice(0, projects.length, ...loaded, ...selected.filter(item => !loaded.some(project => project.id === item.id)));
  } catch { projects.splice(0); }
}
watch(() => props.team, loadProjects, { immediate: true });
</script>

<style scoped>
.weekly-editor{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.period-card{padding:20px;border:1px solid var(--border);border-radius:14px;background:#fff}.period-card header{display:flex;justify-content:space-between;gap:16px;margin-bottom:16px}.period-card h3{margin:0 0 4px;font-size:17px}.period-card p{margin:0;color:var(--muted);font-size:12px}.total{height:30px;padding:5px 10px;border-radius:16px;color:#d4380d;background:#fff2e8;font-weight:700;white-space:nowrap}.total.valid{color:#237804;background:#f6ffed}.allocation-row{display:flex;align-items:center;gap:10px;margin-bottom:10px}.allocation-row :deep(.ant-input-number){width:92px}.percent{width:42px;color:var(--muted);font-size:12px}.period-card .ant-alert{margin-top:12px}@media(max-width:900px){.weekly-editor{grid-template-columns:1fr}}@media(max-width:520px){.period-card{padding:15px}.allocation-row{flex-wrap:wrap}.allocation-row .ant-select{flex-basis:100%!important}.allocation-row :deep(.ant-input-number){width:110px}}
</style>

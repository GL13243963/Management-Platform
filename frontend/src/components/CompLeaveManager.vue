<template>
  <div class="leave-page">
    <div class="card">
      <div class="leave-head"><div class="section-title">批量设置调休</div><a-switch v-model:checked="selectAll" checked-children="已全选" un-checked-children="全选员工" @change="toggleAll" /></div>
      <a-alert type="info" show-icon message="调休记录独立保存，不受考勤表重新导入影响；不计工作时长，也不计入出勤和考勤异常。" style="margin-bottom:16px" />
      <div class="employee-switches">
        <label v-for="employee in employees" :key="employee.id" class="employee-switch"><a-switch :checked="selectedIds.includes(employee.id)" @change="checked => toggleEmployee(employee.id, checked)" /><span>{{ employee.name }}</span><small>{{ employee.team || '未分组' }}</small></label>
      </div>
      <a-divider />
      <a-radio-group v-model:value="dateMode" button-style="solid" style="margin-bottom:14px"><a-radio-button value="single">具体日期</a-radio-button><a-radio-button value="range">连续时间段</a-radio-button></a-radio-group>
      <div class="date-controls">
        <a-date-picker v-if="dateMode === 'single'" v-model:value="singleDate" value-format="YYYY-MM-DD" placeholder="选择调休日期" />
        <a-range-picker v-else v-model:value="dateRange" value-format="YYYY-MM-DD" :allow-clear="false" />
        <a-input v-model:value="note" placeholder="备注（可选）" style="max-width:300px" />
        <a-button type="primary" :loading="saving" @click="save">确认设置调休</a-button>
      </div>
      <p class="selection-summary">已选择 {{ selectedIds.length }} 名员工 · {{ dates.length }} 个日期，共 {{ selectedIds.length * dates.length }} 条调休记录</p>
    </div>
    <div class="card"><div class="section-title">已设置调休</div><a-table :data-source="records" :columns="columns" row-key="id" :pagination="{ pageSize: 12 }" size="middle"><template #bodyCell="{ column, record }"><template v-if="column.dataIndex === 'actions'"><a-popconfirm title="确认撤销这条调休？" @confirm="remove(record)"><a-button type="link" danger size="small">撤销</a-button></a-popconfirm></template></template></a-table></div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import dayjs from 'dayjs';
import { message } from 'ant-design-vue';
import api from '../api';
const employees = ref([]), records = ref([]), selectedIds = ref([]), selectAll = ref(false), dateMode = ref('single'), singleDate = ref(null), dateRange = ref([dayjs().format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD')]), note = ref(''), saving = ref(false);
const columns = [{ title: '员工', dataIndex: 'employeeName' }, { title: '调休日期', dataIndex: 'date' }, { title: '备注', dataIndex: 'note' }, { title: '设置时间', dataIndex: 'createdAt' }, { title: '操作', dataIndex: 'actions', width: 90 }];
const dates = computed(() => { if (dateMode.value === 'single') return singleDate.value ? [singleDate.value] : []; const [start, end] = dateRange.value || []; if (!start || !end) return []; const result=[]; for (let cursor=dayjs(start); !cursor.isAfter(dayjs(end)); cursor=cursor.add(1,'day')) result.push(cursor.format('YYYY-MM-DD')); return result; });
function toggleAll(checked) { selectedIds.value = checked ? employees.value.map(employee => employee.id) : []; }
function toggleEmployee(id, checked) { selectedIds.value = checked ? [...new Set([...selectedIds.value, id])] : selectedIds.value.filter(value => value !== id); selectAll.value = selectedIds.value.length === employees.value.length; }
async function load() { [employees.value, records.value] = await Promise.all([api.get('/employees'), api.get('/employees/comp-leave/all')]); }
async function save() { if (!selectedIds.value.length) return message.warning('请至少选择一名员工'); if (!dates.value.length) return message.warning('请选择调休日期或时间段'); saving.value=true; try { const result=await api.post('/employees/comp-leave/batch',{employeeIds:selectedIds.value,dates:dates.value,note:note.value}); message.success(`已新增 ${result.created} 条调休记录`); await load(); } finally { saving.value=false; } }
async function remove(record) { await api.delete(`/employees/${record.employeeId}/comp-leave/${record.date}`); message.success('已撤销调休'); await load(); }
onMounted(load);
</script>

<style scoped>
.leave-page{padding:8px 0}.leave-head{display:flex;justify-content:space-between;align-items:center}.employee-switches{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.employee-switch{display:grid;grid-template-columns:34px 1fr;align-items:center;padding:11px 12px;border:1px solid var(--border);border-radius:10px;background:#fff}.employee-switch small{grid-column:2;color:var(--muted);margin-top:2px}.date-controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.selection-summary{margin:12px 0 0;color:var(--muted);font-size:12px}
</style>

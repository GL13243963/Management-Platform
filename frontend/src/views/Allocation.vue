<template>
  <div class="page">
    <h1 class="page-title">项目分配</h1>
    <p class="page-subtitle">主副权重可视化调整 · 每次调整自动写入时间序列历史</p>

    <div class="card" style="padding:16px 22px;">
      <a-space :size="14" wrap>
        <span style="color:var(--muted);">选择项目：</span>
        <a-select v-model:value="currentProjectId" style="width:280px;" @change="load" placeholder="请选择">
          <a-select-option v-for="p in projects" :key="p.id" :value="p.id">{{ p.code }} · {{ p.name }}</a-select-option>
        </a-select>
        <a-button type="primary" @click="openAdd" :disabled="!currentProjectId">
          <plus-outlined /> 加入成员
        </a-button>
      </a-space>
    </div>

    <div class="card">
      <div class="section-title">当前成员 · 权重调整</div>
      <a-table
        :dataSource="members"
        :columns="cols"
        row-key="id"
        :pagination="false"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'role'">
            <a-tag :color="record.role === 'master' ? 'blue' : 'default'">
              {{ record.role === 'master' ? '主力' : record.role === 'secondary' ? '协作' : '成员' }}
            </a-tag>
          </template>
          <template v-if="column.dataIndex === 'weight'">
            <div style="display:flex;align-items:center;gap:12px;">
              <a-slider
                :value="record.weight"
                :min="0" :max="1" :step="0.05"
                @change="v => updateWeight(record, v)"
                style="width: 220px;"
              />
              <span style="min-width:60px; font-weight:600; color: var(--brand);">
                {{ Math.round(record.weight * 100) }}%
              </span>
            </div>
          </template>
          <template v-if="column.dataIndex === 'actions'">
            <a-popconfirm title="确定移除该成员？" @confirm="remove(record)">
              <a-button size="small" type="link" danger>移出项目</a-button>
            </a-popconfirm>
          </template>
        </template>
      </a-table>
    </div>

    <div class="card" v-if="history.length">
      <div class="section-title">历史调整记录</div>
      <a-timeline>
        <a-timeline-item v-for="h in history" :key="h.id" :color="h.effectiveTo ? 'gray' : 'blue'">
          <div>
            <b>{{ h.Employee?.name }}</b>
            · 权重 {{ Math.round(h.weight * 100) }}%
            · {{ h.effectiveFrom }} → {{ h.effectiveTo || '至今' }}
            <span v-if="h.note" style="color:var(--muted);">（{{ h.note }}）</span>
          </div>
        </a-timeline-item>
      </a-timeline>
    </div>

    <a-modal v-model:open="addOpen" title="加入成员" @ok="submitAdd">
      <a-form layout="vertical">
        <a-form-item label="员工">
          <a-select v-model:value="newMember.employeeId" show-search :filter-option="filterEmp">
            <a-select-option v-for="e in employees" :key="e.id" :value="e.id">{{ e.name }} · {{ e.department }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="初始权重">
          <a-input-number v-model:value="newMember.weight" :min="0" :max="1" :step="0.1" style="width:100%;" />
        </a-form-item>
        <a-form-item label="角色">
          <a-select v-model:value="newMember.role">
            <a-select-option value="master">主力</a-select-option>
            <a-select-option value="secondary">协作</a-select-option>
            <a-select-option value="member">成员</a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { PlusOutlined } from '@ant-design/icons-vue';
import api from '../api';

const projects = ref([]);
const employees = ref([]);
const currentProjectId = ref(null);
const members = ref([]);
const history = ref([]);
const addOpen = ref(false);
const newMember = reactive({ employeeId: null, weight: 1, role: 'member' });

const cols = [
  { title: '姓名', dataIndex: ['Employee', 'name'], width: 140 },
  { title: '部门', dataIndex: ['Employee', 'department'], width: 140 },
  { title: '角色', dataIndex: 'role', width: 100 },
  { title: '生效于', dataIndex: 'effectiveFrom', width: 130 },
  { title: '权重', dataIndex: 'weight' },
  { title: '操作', dataIndex: 'actions', width: 120 },
];

function filterEmp(input, opt) {
  return String(opt?.children?.[0]?.children ?? '').includes(input);
}

async function load() {
  if (!currentProjectId.value) { members.value = []; history.value = []; return; }
  members.value = await api.get(`/projects/${currentProjectId.value}/members`);
  history.value = await api.get(`/projects/${currentProjectId.value}/history`);
}

let debounceTimer = null;
async function updateWeight(record, value) {
  record.weight = value;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    await api.post(`/projects/${currentProjectId.value}/members/${record.id}/weight`, { weight: value });
    message.success('权重已更新');
    load();
  }, 400);
}

async function remove(record) {
  await api.delete(`/projects/${currentProjectId.value}/members/${record.id}`);
  message.success('已移出');
  load();
}

function openAdd() {
  newMember.employeeId = null; newMember.weight = 1; newMember.role = 'member';
  addOpen.value = true;
}
async function submitAdd() {
  if (!newMember.employeeId) { message.warning('请选择员工'); return; }
  await api.post(`/projects/${currentProjectId.value}/members`, newMember);
  addOpen.value = false;
  message.success('已加入');
  load();
}

onMounted(async () => {
  projects.value = await api.get('/projects');
  employees.value = await api.get('/employees');
  if (projects.value.length) {
    currentProjectId.value = projects.value[0].id;
    load();
  }
});
</script>

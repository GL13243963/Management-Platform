<template>
  <div class="page">
    <h1 class="page-title">项目管理</h1>
    <p class="page-subtitle">创建 · 归档 · 分配成员</p>

    <div class="card">
      <a-space style="margin-bottom:12px;">
        <a-button type="primary" @click="openNew"><plus-outlined /> 新建项目</a-button>
      </a-space>
      <a-table :dataSource="rows" :columns="cols" row-key="id" size="middle">
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'status'">
            <a-tag :color="record.status==='active' ? 'green' : 'default'">
              {{ record.status === 'active' ? '进行中' : '已归档' }}
            </a-tag>
          </template>
          <template v-if="column.dataIndex === 'actions'">
            <a-button size="small" type="link" @click="edit(record)">编辑</a-button>
            <a-button size="small" type="link" danger @click="archive(record)">
              {{ record.status === 'active' ? '归档' : '恢复' }}
            </a-button>
          </template>
        </template>
      </a-table>
    </div>

    <a-modal v-model:open="modal.open" :title="modal.record?.id ? '编辑项目' : '新建项目'" @ok="submit" width="720px">
      <a-form layout="vertical">
        <a-row :gutter="14">
          <a-col :span="12"><a-form-item label="项目代码"><a-input v-model:value="modal.record.code" /></a-form-item></a-col>
          <a-col :span="12"><a-form-item label="项目名称"><a-input v-model:value="modal.record.name" /></a-form-item></a-col>
          <a-col :span="12"><a-form-item label="负责人"><a-input v-model:value="modal.record.manager" /></a-form-item></a-col>
          <a-col :span="12"><a-form-item label="开始日期"><a-date-picker v-model:value="modal.record.startDate" style="width:100%;" value-format="YYYY-MM-DD" /></a-form-item></a-col>
          <a-col :span="24"><a-form-item label="描述"><a-textarea v-model:value="modal.record.description" :rows="2" /></a-form-item></a-col>
          <a-col :span="24" v-if="!modal.record.id">
            <a-form-item label="初始成员（勾选后可设置权重）">
              <a-table
                :dataSource="employees"
                :columns="memberCols"
                :pagination="false"
                size="small"
                row-key="id"
                :row-selection="{
                  selectedRowKeys: memberSelection,
                  onChange: keys => memberSelection = keys,
                }"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.dataIndex === 'weight'">
                    <a-input-number
                      :min="0" :max="1" :step="0.1"
                      :value="memberWeights[record.id] ?? 1"
                      @change="v => memberWeights[record.id] = v"
                      style="width: 90px;"
                    />
                  </template>
                </template>
              </a-table>
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { PlusOutlined } from '@ant-design/icons-vue';
import api from '../api';

const rows = ref([]);
const employees = ref([]);
const memberSelection = ref([]);
const memberWeights = reactive({});

const cols = [
  { title: '代码', dataIndex: 'code', width: 120 },
  { title: '名称', dataIndex: 'name' },
  { title: '负责人', dataIndex: 'manager', width: 120 },
  { title: '开始日期', dataIndex: 'startDate', width: 120 },
  { title: '状态', dataIndex: 'status', width: 100 },
  { title: '操作', dataIndex: 'actions', width: 160 },
];
const memberCols = [
  { title: '姓名', dataIndex: 'name' },
  { title: '部门', dataIndex: 'department' },
  { title: '权重', dataIndex: 'weight', width: 120 },
];

const modal = reactive({ open: false, record: {} });

async function load() {
  rows.value = await api.get('/projects');
  employees.value = await api.get('/employees');
}

function openNew() {
  modal.record = { code: '', name: '', manager: '', startDate: null, description: '' };
  memberSelection.value = [];
  Object.keys(memberWeights).forEach(k => delete memberWeights[k]);
  modal.open = true;
}
function edit(r) {
  modal.record = { ...r };
  modal.open = true;
}
async function submit() {
  if (modal.record.id) {
    await api.put(`/projects/${modal.record.id}`, modal.record);
  } else {
    const members = memberSelection.value.map(id => ({
      employeeId: id, weight: memberWeights[id] ?? 1, role: 'member',
    }));
    await api.post('/projects', { ...modal.record, members });
  }
  message.success('已保存');
  modal.open = false;
  load();
}
async function archive(r) {
  await api.put(`/projects/${r.id}`, { status: r.status === 'active' ? 'archived' : 'active' });
  load();
}

onMounted(load);
</script>

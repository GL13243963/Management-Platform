<template>
  <div class="page">
    <h1 class="page-title">项目管理</h1>
    <p class="page-subtitle">创建 · 归档 · 分配成员</p>

    <div class="card">
      <a-space style="margin-bottom: 16px">
        <a-button type="primary" @click="openNew">
          <template #icon><plus-outlined /></template>
          新建项目
        </a-button>
      </a-space>
      <a-table :data-source="rows" :columns="cols" row-key="id" size="middle">
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'status'">
            <a-tag :color="record.status === 'active' ? 'success' : 'default'">
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

    <a-modal v-model:open="modal.open" :title="modal.record?.id ? '编辑项目' : '新建项目'" @ok="submit" :width="720">
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="项目代码">
              <a-input v-model:value="modal.record.code" placeholder="请输入项目代码" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="项目名称">
              <a-input v-model:value="modal.record.name" placeholder="请输入项目名称" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="负责人">
              <a-input v-model:value="modal.record.manager" placeholder="请输入负责人" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="开始日期">
              <a-date-picker v-model:value="modal.record.startDate" style="width: 100%" value-format="YYYY-MM-DD" placeholder="请选择" />
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item label="描述">
              <a-textarea v-model:value="modal.record.description" :rows="2" placeholder="请输入项目描述" />
            </a-form-item>
          </a-col>
          <a-col :span="24" v-if="!modal.record.id">
            <a-form-item label="初始成员（勾选后可设置权重）">
              <a-table
                :data-source="employees"
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
                      :min="0"
                      :max="1"
                      :step="0.1"
                      :value="memberWeights[record.id] ?? 1"
                      @change="v => memberWeights[record.id] = v"
                      style="width: 90px"
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
  { title: '代码', dataIndex: 'code', width: 140 },
  { title: '名称', dataIndex: 'name' },
  { title: '负责人', dataIndex: 'manager', width: 140 },
  { title: '开始日期', dataIndex: 'startDate', width: 130 },
  { title: '状态', dataIndex: 'status', width: 100 },
  { title: '操作', dataIndex: 'actions', width: 160, fixed: 'right' },
];

const memberCols = [
  { title: '姓名', dataIndex: 'name', width: 140 },
  { title: '部门', dataIndex: 'department' },
  { title: '权重', dataIndex: 'weight', width: 140 },
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
  if (!modal.record.name) {
    message.warning('请输入项目名称');
    return;
  }
  if (modal.record.id) {
    await api.put(`/projects/${modal.record.id}`, modal.record);
  } else {
    const members = memberSelection.value.map(id => ({
      employeeId: id,
      weight: memberWeights[id] ?? 1,
      role: 'member',
    }));
    await api.post('/projects', { ...modal.record, members });
  }
  message.success('已保存');
  modal.open = false;
  load();
}

async function archive(r) {
  await api.put(`/projects/${r.id}`, { status: r.status === 'active' ? 'archived' : 'active' });
  message.success(r.status === 'active' ? '已归档' : '已恢复');
  load();
}

onMounted(load);
</script>

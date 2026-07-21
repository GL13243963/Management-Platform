<template>
  <div class="page">
    <h1 class="page-title">人员管理</h1>
    <p class="page-subtitle">员工信息与小时成本</p>

    <div class="card">
      <a-space style="margin-bottom: 16px">
        <a-button type="primary" @click="openNew">
          <template #icon><plus-outlined /></template>
          新增员工
        </a-button>
      </a-space>
      <a-table :data-source="rows" :columns="cols" row-key="id" size="middle">
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'active'">
            <a-tag :color="record.active ? 'success' : 'default'">
              {{ record.active ? '在职' : '停用' }}
            </a-tag>
          </template>
          <template v-if="column.dataIndex === 'actions'">
            <a-button size="small" type="link" @click="edit(record)">编辑</a-button>
            <a-popconfirm title="确认删除？" @confirm="remove(record)">
              <a-button size="small" type="link" danger>删除</a-button>
            </a-popconfirm>
          </template>
        </template>
      </a-table>
    </div>

    <a-modal v-model:open="modal.open" :title="modal.record?.id ? '编辑员工' : '新增员工'" @ok="submit" :width="600">
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="姓名">
              <a-input v-model:value="modal.record.name" placeholder="请输入姓名" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="工号">
              <a-input v-model:value="modal.record.employeeNo" placeholder="请输入工号" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="部门">
              <a-input v-model:value="modal.record.department" placeholder="例：中建上海院/方案/创新中心" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="组别">
              <a-select v-model:value="modal.record.team" placeholder="请选择组别" allowClear>
                <a-select-option value="规划组">规划组</a-select-option>
                <a-select-option value="建筑组">建筑组</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="职位">
              <a-input v-model:value="modal.record.position" placeholder="请输入职位" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="小时成本（元）">
              <a-input-number v-model:value="modal.record.hourlyRate" :min="0" style="width: 100%" placeholder="请输入" />
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
const modal = reactive({ open: false, record: {} });

const cols = [
  { title: '姓名', dataIndex: 'name', width: 140 },
  { title: '工号', dataIndex: 'employeeNo', width: 140 },
  { title: '部门', dataIndex: 'department', width: 140 },
  { title: '组别', dataIndex: 'team', width: 110 },
  { title: '职位', dataIndex: 'position' },
  { title: '小时成本', dataIndex: 'hourlyRate', width: 130 },
  { title: '状态', dataIndex: 'active', width: 100 },
  { title: '操作', dataIndex: 'actions', width: 160, fixed: 'right' },
];

async function load() {
  rows.value = await api.get('/employees');
}

function openNew() {
  modal.record = { name: '', employeeNo: '', department: '', team: null, position: '', hourlyRate: 0, active: true };
  modal.open = true;
}

function edit(r) {
  modal.record = { ...r };
  modal.open = true;
}

async function submit() {
  if (!modal.record.name) {
    message.warning('请输入姓名');
    return;
  }
  if (modal.record.id) {
    await api.put(`/employees/${modal.record.id}`, modal.record);
  } else {
    await api.post('/employees', modal.record);
  }
  message.success('已保存');
  modal.open = false;
  load();
}

async function remove(r) {
  await api.delete(`/employees/${r.id}`);
  message.success('已删除');
  load();
}

onMounted(load);
</script>

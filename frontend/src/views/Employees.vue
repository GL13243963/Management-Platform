<template>
  <div class="page">
    <h1 class="page-title">人员管理</h1>
    <p class="page-subtitle">员工信息与小时成本</p>

    <div class="card">
      <a-space style="margin-bottom:12px;">
        <a-button type="primary" @click="openNew"><plus-outlined /> 新增员工</a-button>
      </a-space>
      <a-table :dataSource="rows" :columns="cols" row-key="id" size="middle">
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'active'">
            <a-tag :color="record.active ? 'green' : 'default'">{{ record.active ? '在职' : '停用' }}</a-tag>
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

    <a-modal v-model:open="modal.open" :title="modal.record?.id ? '编辑员工' : '新增员工'" @ok="submit">
      <a-form layout="vertical">
        <a-row :gutter="14">
          <a-col :span="12"><a-form-item label="姓名"><a-input v-model:value="modal.record.name" /></a-form-item></a-col>
          <a-col :span="12"><a-form-item label="工号"><a-input v-model:value="modal.record.employeeNo" /></a-form-item></a-col>
          <a-col :span="12"><a-form-item label="部门"><a-input v-model:value="modal.record.department" /></a-form-item></a-col>
          <a-col :span="12"><a-form-item label="职位"><a-input v-model:value="modal.record.position" /></a-form-item></a-col>
          <a-col :span="12"><a-form-item label="小时成本(元)"><a-input-number v-model:value="modal.record.hourlyRate" :min="0" style="width:100%;" /></a-form-item></a-col>
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
  { title: '姓名', dataIndex: 'name', width: 120 },
  { title: '工号', dataIndex: 'employeeNo', width: 120 },
  { title: '部门', dataIndex: 'department' },
  { title: '职位', dataIndex: 'position' },
  { title: '小时成本', dataIndex: 'hourlyRate', width: 120 },
  { title: '状态', dataIndex: 'active', width: 100 },
  { title: '操作', dataIndex: 'actions', width: 160 },
];

async function load() { rows.value = await api.get('/employees'); }

function openNew() { modal.record = { name: '', employeeNo: '', department: '', position: '', hourlyRate: 0, active: true }; modal.open = true; }
function edit(r) { modal.record = { ...r }; modal.open = true; }
async function submit() {
  if (modal.record.id) await api.put(`/employees/${modal.record.id}`, modal.record);
  else await api.post('/employees', modal.record);
  message.success('已保存');
  modal.open = false;
  load();
}
async function remove(r) { await api.delete(`/employees/${r.id}`); load(); }

onMounted(load);
</script>

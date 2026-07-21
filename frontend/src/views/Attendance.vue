<template>
  <div class="page">
    <h1 class="page-title">考勤管理</h1>
    <p class="page-subtitle">导入打卡数据 · 自动核算工时 · 异常手动标记</p>

    <div class="card">
      <div class="section-title">数据导入</div>
      <a-space :size="14" wrap>
        <a-upload
          name="file"
          :customRequest="handleUpload"
          :showUploadList="false"
          accept=".xlsx,.xls,.csv"
        >
          <a-button type="primary">
            <template #icon><upload-outlined /></template>
            导入 Excel / CSV
          </a-button>
        </a-upload>
        <span style="color: var(--muted); font-size: 13px">
          支持列：姓名 / 日期 / 上班打卡 / 下班打卡（自动识别中英列名）
        </span>
      </a-space>
      <a-alert
        v-if="lastImport"
        style="margin-top: 16px"
        type="success"
        show-icon
        :message="`导入完成：新增 ${lastImport.created} 条 · 更新 ${lastImport.updated} 条 · 跳过 ${lastImport.skipped} 条`"
      />
    </div>

    <div class="card">
      <div class="section-title">筛选条件</div>
      <a-space :size="12" wrap>
        <a-range-picker v-model:value="range" @change="load" style="width: 300px" />
        <a-select v-model:value="filterStatus" style="width: 160px" @change="load" allowClear placeholder="全部状态">
          <a-select-option value="normal">正常</a-select-option>
          <a-select-option value="late">迟到</a-select-option>
          <a-select-option value="early">早退</a-select-option>
          <a-select-option value="late_and_early">迟到+早退</a-select-option>
          <a-select-option value="absent">缺勤</a-select-option>
          <a-select-option value="leave">请假</a-select-option>
          <a-select-option value="business_trip">出差</a-select-option>
          <a-select-option value="comp_leave">调休</a-select-option>
        </a-select>
        <a-button @click="load">
          <template #icon><search-outlined /></template>
          查询
        </a-button>
      </a-space>
    </div>

    <div class="card">
      <div class="section-title">考勤明细</div>
      <a-table
        :data-source="rows"
        :columns="cols"
        :pagination="{ pageSize: 15 }"
        row-key="id"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'status'">
            <a-tag :color="statusColor(record)">{{ statusText(record) }}</a-tag>
          </template>
          <template v-if="column.dataIndex === 'actions'">
            <a-button size="small" type="link" @click="openOverride(record)">标记异常</a-button>
          </template>
        </template>
      </a-table>
    </div>

    <a-modal
      v-model:open="modal.open"
      title="异常标记 / 手动调整"
      @ok="submitOverride"
      ok-text="保存"
      :width="520"
    >
      <a-form layout="vertical">
        <a-form-item label="员工">
          <a-input :value="modal.record?.employeeName" disabled />
        </a-form-item>
        <a-form-item label="日期">
          <a-input :value="modal.record?.date" disabled />
        </a-form-item>
        <a-form-item label="异常类型">
          <a-select v-model:value="modal.overrideType" allowClear placeholder="请选择">
            <a-select-option value="">清除（恢复原始）</a-select-option>
            <a-select-option value="leave">请假</a-select-option>
            <a-select-option value="business_trip">出差</a-select-option>
            <a-select-option value="comp_leave">调休</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea v-model:value="modal.overrideNote" :rows="3" placeholder="请输入备注" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import dayjs from 'dayjs';
import { message } from 'ant-design-vue';
import { UploadOutlined, SearchOutlined } from '@ant-design/icons-vue';
import api from '../api';

const range = ref([dayjs().subtract(30, 'day'), dayjs()]);
const filterStatus = ref();
const rows = ref([]);
const lastImport = ref(null);

const cols = [
  { title: '日期', dataIndex: 'date', width: 120 },
  { title: '员工', dataIndex: 'employeeName', width: 140 },
  { title: '上班', dataIndex: 'clockIn', width: 100 },
  { title: '下班', dataIndex: 'clockOut', width: 100 },
  { title: '工时（小时）', dataIndex: 'workHours', width: 130 },
  { title: '状态', dataIndex: 'status', width: 120 },
  { title: '备注', dataIndex: 'overrideNote' },
  { title: '操作', dataIndex: 'actions', width: 120, fixed: 'right' },
];

const STATUS_MAP = {
  normal: ['正常', 'success'],
  late: ['迟到', 'warning'],
  early: ['早退', 'warning'],
  late_and_early: ['迟到+早退', 'error'],
  absent: ['缺勤', 'error'],
  leave: ['请假', 'blue'],
  business_trip: ['出差', 'cyan'],
  comp_leave: ['调休', 'purple'],
};

function statusText(r) { return STATUS_MAP[r.status]?.[0] || r.status; }
function statusColor(r) { return STATUS_MAP[r.status]?.[1] || 'default'; }

const modal = reactive({ open: false, record: null, overrideType: '', overrideNote: '' });

async function load() {
  const params = {
    startDate: range.value?.[0]?.format('YYYY-MM-DD'),
    endDate: range.value?.[1]?.format('YYYY-MM-DD'),
    status: filterStatus.value,
  };
  rows.value = await api.get('/attendance', { params });
}

async function handleUpload({ file, onSuccess, onError }) {
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await api.post('/attendance/import', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    lastImport.value = res;
    message.success('导入成功');
    onSuccess?.(res);
    load();
  } catch (e) {
    message.error(e.error || '导入失败');
    onError?.(e);
  }
}

function openOverride(record) {
  modal.record = record;
  modal.overrideType = record.overrideType || '';
  modal.overrideNote = record.overrideNote || '';
  modal.open = true;
}

async function submitOverride() {
  await api.patch(`/attendance/${modal.record.id}`, {
    overrideType: modal.overrideType || null,
    overrideNote: modal.overrideNote,
  });
  message.success('已保存');
  modal.open = false;
  load();
}

onMounted(load);
</script>

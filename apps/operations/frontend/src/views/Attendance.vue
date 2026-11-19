<template>
  <div class="page">
    <h1 class="page-title">考勤管理</h1>
    <p class="page-subtitle">导入打卡数据 · 自动核算工时 · 导入结果核查</p>

    <DataDateBanner :range="range" />

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
        :type="lastImport.verified === false ? 'error' : 'success'"
        show-icon
        :message="lastImport.verified === false
          ? '导入完成，但逐人异常数量核查未通过'
          : `导入并核查完成：新增 ${lastImport.created} 条 · 更新 ${lastImport.updated} 条 · 清理旧错位 ${lastImport.removedStale || 0} 条 · 跳过 ${lastImport.skipped} 条`"
      />
      <a-table
        v-if="lastImport?.reconciliation?.length"
        style="margin-top: 16px"
        :data-source="lastImport.reconciliation"
        :columns="verificationCols"
        row-key="employeeName"
        :pagination="false"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'matched'">
            <a-tag :color="record.matched ? 'success' : 'error'">
              {{ record.matched ? '一致' : '有差异' }}
            </a-tag>
          </template>
        </template>
      </a-table>
    </div>

  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import dayjs from 'dayjs';
import { message } from 'ant-design-vue';
import { UploadOutlined } from '@ant-design/icons-vue';
import api from '../api';
import DataDateBanner from '../components/DataDateBanner.vue';
import { loadLatestAttendanceMonth } from '../lib/coverage';

const range = ref([dayjs().subtract(30, 'day'), dayjs()]);
const lastImport = ref(null);

const verificationCols = [
  { title: '员工', dataIndex: 'employeeName' },
  { title: '漏刷（原始/入库）', customRender: ({ record }) => `${record.source.missedPunch} / ${record.imported.missedPunch}` },
  { title: '迟到（原始/入库）', customRender: ({ record }) => `${record.source.late} / ${record.imported.late}` },
  { title: '早退（原始/入库）', customRender: ({ record }) => `${record.source.early} / ${record.imported.early}` },
  { title: '核查结果', dataIndex: 'matched', width: 100 },
];

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
  } catch (e) {
    message.error(e.error || '导入失败');
    onError?.(e);
  }
}

onMounted(async () => {
  range.value = await loadLatestAttendanceMonth(range.value);
});
</script>

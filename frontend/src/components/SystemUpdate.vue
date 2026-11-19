<template>
  <div class="page system-update">
    <div class="card update-card">
      <div class="update-head">
        <div><h2>旧版一键更新</h2><p>适用于带安装脚本的系统安装 ZIP。维护 ZIP 请按随包说明在服务器发布。</p></div>
        <a-tag color="blue">当前运行版本 {{ status.currentVersion || '读取中' }}</a-tag>
      </div>
      <a-alert type="warning" show-icon message="更新时系统会短暂无法访问，请避开员工集中填报时间。不要上传来源不明的压缩包。" />
      <div class="update-actions">
        <a-upload :before-upload="selectFile" :show-upload-list="false" accept=".zip">
          <a-button>选择系统安装 ZIP</a-button>
        </a-upload>
        <span class="file-name">{{ selectedFile?.name || '尚未选择文件' }}</span>
        <a-popconfirm title="确认立即备份并更新系统吗？" ok-text="确认更新" cancel-text="取消" :disabled="!selectedFile || updating" @confirm="startUpdate">
          <a-button type="primary" danger :disabled="!selectedFile" :loading="updating">安装并重启</a-button>
        </a-popconfirm>
      </div>
      <a-alert v-if="differentVersion" type="info" show-icon
        message="当前运行版本与最近一次一键更新的目标版本不同。下方是该次任务的记录。"
        style="margin-bottom:14px" />
      <a-descriptions :column="1" bordered size="small">
        <a-descriptions-item label="一键更新任务状态"><a-tag :color="stateColor">{{ stateLabel }}</a-tag></a-descriptions-item>
        <a-descriptions-item label="任务说明">{{ status.update?.message || '—' }}</a-descriptions-item>
        <a-descriptions-item v-if="status.update?.targetVersion" :label="taskRunning ? '本次任务目标版本' : '最近一次任务目标版本'">{{ status.update.targetVersion }}</a-descriptions-item>
        <a-descriptions-item v-if="status.update?.updatedAt" label="任务记录时间">{{ formatTime(status.update.updatedAt) }}</a-descriptions-item>
      </a-descriptions>
      <a-button style="margin-top:14px" @click="loadStatus">刷新状态</a-button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import dayjs from 'dayjs';
import { message } from 'ant-design-vue';
import api from '../api';

const selectedFile = ref(null);
const updating = ref(false);
const status = ref({ currentVersion: '', update: { state: 'idle' } });
const labels = { idle: '等待更新', queued: '等待校验', validating: '正在校验', installing: '正在安装', success: '更新成功', failed: '更新失败' };
const colors = { queued: 'processing', validating: 'processing', installing: 'processing', success: 'success', failed: 'error' };
const stateLabel = computed(() => labels[status.value.update?.state] || status.value.update?.state || '等待更新');
const taskRunning = computed(() => ['queued', 'validating', 'installing'].includes(status.value.update?.state));
const differentVersion = computed(() => {
  const { currentVersion, update } = status.value;
  return !taskRunning.value && !!currentVersion && currentVersion !== 'unknown'
    && !!update?.targetVersion && update.targetVersion !== currentVersion;
});
const stateColor = computed(() => colors[status.value.update?.state] || 'default');
function selectFile(file) { selectedFile.value = file; return false; }
function formatTime(value) { return value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—'; }
async function loadStatus() {
  try { status.value = await api.get('/system/status'); } catch {}
}
async function startUpdate() {
  if (!selectedFile.value) return;
  updating.value = true;
  const fd = new FormData();
  fd.append('file', selectedFile.value);
  try {
    const result = await api.post('/system/update', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
    message.success(result.message);
    selectedFile.value = null;
    await loadStatus();
  } catch (error) {
    message.error(error?.error || '更新启动失败');
  } finally { updating.value = false; }
}
onMounted(loadStatus);
</script>

<style scoped>
.update-card{padding:24px}.update-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px}.update-head h2{margin:0 0 8px}.update-head p{margin:0;color:var(--muted)}.update-actions{display:flex;align-items:center;gap:14px;padding:22px 0}.file-name{min-width:220px;color:var(--muted);font-size:13px}@media(max-width:700px){.update-head,.update-actions{align-items:stretch;flex-direction:column}.file-name{min-width:0}}
</style>

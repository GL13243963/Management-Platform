<template>
  <section class="expense-runs" aria-label="填单助手运行记录">
    <h3>运行记录</h3>
    <button type="button" :disabled="loading" @click="load">刷新</button>
    <a href="/api/os/v1/expense-assistant/runs?download=1">导出诊断摘要</a>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="data">近 7 天运行 <strong>{{ data.runs }}</strong> 次 · 中断 <strong>{{ data.interruptionCount }}</strong> 次</p>
    <p v-else-if="loading" role="status">正在读取运行记录…</p>
    <ul v-if="data?.interrupted.length">
      <li v-for="(item, index) in data.interrupted" :key="index">
        {{ formatTime(item.time) }} · {{ labels[item.stage] || '其他步骤' }}
      </li>
    </ul>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import api from '../api';

const data = ref(null);
const error = ref('');
const loading = ref(false);
const labels = {
  'desktop-start': '启动云端浏览器',
  'portal-login': '企业登录及打开报销单',
  'material-transfer': '传送材料',
  'base-fields': '填写基本信息',
  'ticket-pool': '匹配票据',
  'invoice-imaging': '上传发票影像',
  'itinerary-attachments': '上传行程单',
  'traffic-fields': '填写交通费用',
  review: '核对单据',
  save: '保存草稿',
};
const formatTime = time => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium',
}).format(new Date(time));

async function load() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try { data.value = await api.get('/os/v1/expense-assistant/runs'); }
  catch { error.value = '暂时无法读取运行记录'; }
  finally { loading.value = false; }
}
onMounted(load);
</script>

<style scoped>
.expense-runs { margin-top: 20px; border-top: 1px solid #ebe9f2; padding-top: 16px; }
.expense-runs a { margin-left: 12px; }
.expense-runs li { margin-bottom: 6px; }
</style>

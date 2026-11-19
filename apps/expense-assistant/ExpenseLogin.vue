<script setup>
import { onUnmounted, ref } from 'vue';

const emit = defineEmits(['saved']);
const props = defineProps({ task: { type: Object, required: true }, files: { type: Array, required: true } });
const endpoint = '/api/os/v1/expense-assistant/login-sessions';
const session = ref(null);
const busy = ref(false);
const error = ref('');
const review = ref(null);
const failedStage = ref('');
const portalDetail = ref('');
const receipt = ref('');
const saving = ref(false);
const automaticSaving = ref(false);
const ending = ref(false);
const saveUncertain = ref(false);
const controller = new AbortController();
let timer;
let pendingWindow;

async function request(url, method, payload) {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(payload && { 'Content-Type': 'application/json' }) },
    body: payload ? JSON.stringify(payload) : undefined,
    signal: controller.signal,
    cache: 'no-store',
  });
  if (response.status === 401) throw new Error('请重新登录创新中心 OS。');
  if (method === 'POST' && response.status === 400) throw new Error('材料信息有误，请返回核对发票号码、金额和行程日期。');
  if (url.endsWith('/save') && [404, 409].includes(response.status)) return { status: 'expired' };
  if (method === 'POST' && response.status === 409) {
    throw new Error('云端浏览器正在使用或清理，请稍后重试。');
  }
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('暂时无法连接云端登录服务。');
  }
  return response.json();
}

async function poll() {
  const current = session.value;
  if (!current) return;
  try {
    const result = await request(`${endpoint}/${encodeURIComponent(current.id)}`, 'GET');
    if (session.value !== current) return;
    automaticSaving.value = result.status === 'saving';
    if (automaticSaving.value) {
      timer = setTimeout(poll, 2000);
      return;
    }
    if (result.status === 'ready') {
      review.value = { maskedAccount: result.maskedAccount };
      return;
    }
    if (['saved', 'account-required', 'save-blocked', 'save-uncertain', 'review-expired'].includes(result.status)) {
      review.value = { maskedAccount: result.maskedAccount };
      showSaveResult(result);
      return;
    }
    if (result.status !== 'waiting') {
      if (result.stage) {
        failedStage.value = result.stage;
        portalDetail.value = result.portalDetail || '';
        error.value = {
          'portal-login': '企业登录或打开报销单时中断。请在企业窗口查看当前页面。',
          'base-fields': '填写基础信息时中断。请在企业窗口查看报销表单。',
          'ticket-pool': '核对票据池时中断。请在企业窗口查看票据状态。',
          'invoice-imaging': '处理发票影像时中断。请在企业窗口查看提示。',
          'itinerary-attachments': '上传行程单时中断。请在企业窗口查看提示。',
          'traffic-fields': '填写交通费用时中断。请在企业窗口查看提示。',
        }[result.stage] || '自动填报中断。请在企业窗口查看当前页面。';
        return;
      }
      session.value = null;
      error.value = {
        expired: '登录会话已超时，请重新打开。',
        'tickets-unavailable': '票据池中缺少可用发票。请核对发票是否已入池，且金额和状态正确。',
      }[result.status] || '填报会话已结束，请重新打开。';
      return;
    }
    timer = setTimeout(poll, 2000);
  } catch (cause) {
    if (!controller.signal.aborted && session.value === current) error.value = cause.message;
  }
}

function showSaveResult(result) {
  if (result.status === 'saved' && result.documentNumber) {
    receipt.value = result.documentNumber;
    emit('saved');
  } else if (result.status === 'account-required') {
    review.value.maskedAccount = null;
    error.value = '请在企业窗口选择报销人的收款账户，再点「重新核对并保存草稿」。';
  } else if (result.status === 'save-blocked') {
    error.value = '保存前核对未通过。请在企业窗口核对发票影像、交通费用和付款金额。';
  } else if (['expired', 'review-expired'].includes(result.status)) {
    review.value = null;
    error.value = '会话已到期或剩余时间不足，请重新开始。';
    session.value = null;
  } else {
    saveUncertain.value = true;
    error.value = '草稿结果待核实。请在企业系统查看是否已生成单号，避免重复保存。';
  }
}

async function saveDraft() {
  if (ending.value || saving.value || receipt.value || saveUncertain.value) return;
  error.value = '';
  saving.value = true;
  try {
    const result = await request(`${endpoint}/${encodeURIComponent(session.value.id)}/save`, 'POST');
    showSaveResult(result);
  } catch {
    saveUncertain.value = true;
    error.value = '草稿结果待核实。请在企业系统查看是否已生成单号，避免重复保存。';
  } finally {
    saving.value = false;
  }
}

async function uploadMaterials(id) {
  const names = [...new Set(props.task.matches.flatMap(item => [item.invoice.fileName, item.itinerary.fileName]))];
  for (const [index, name] of names.entries()) {
    const candidates = props.files.filter(file => file.name === name);
    if (candidates.length !== 1) throw new Error('材料文件名缺失或重复，请返回重新选择。');
    const response = await fetch(`${endpoint}/${encodeURIComponent(id)}/materials/${index}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: candidates[0],
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error('材料传输失败，可重新点击登录按钮继续。');
  }
}

async function endSession() {
  if (ending.value || saving.value || !session.value) return;
  ending.value = true;
  try {
    const response = await fetch(`${endpoint}/${encodeURIComponent(session.value.id)}`, {
      method: 'DELETE', signal: controller.signal, credentials: 'same-origin',
    });
    if (!response.ok && response.status !== 404) throw new Error('会话还未结束，请稍后重试。');
    clearTimeout(timer);
    session.value = null;
    review.value = null;
    failedStage.value = '';
    portalDetail.value = '';
    error.value = '';
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause.message;
  } finally {
    ending.value = false;
  }
}

async function start() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  // Open during the click so popup blocking does not depend on the API timing.
  pendingWindow = window.open('about:blank', '_blank');
  if (pendingWindow) {
    pendingWindow.opener = null;
    pendingWindow.document.title = '企业登录 · 创新中心 OS';
    pendingWindow.document.body.textContent = '正在准备云端浏览器，请稍候…';
  }
  try {
    const result = await request(endpoint, 'POST', { ...props.task, autoSave: true });
    const viewer = new URL(result.viewerPath, window.location.origin);
    if (typeof result.id !== 'string' || !result.id || viewer.origin !== window.location.origin ||
        !viewer.pathname.startsWith('/apps/expense-assistant/login/')) {
      throw new Error('云端登录服务返回了无效的会话。');
    }
    if (pendingWindow && !pendingWindow.closed) pendingWindow.document.body.textContent = '正在传输已选材料，请稍候…';
    await uploadMaterials(result.id);
    session.value = { id: result.id, viewer: viewer.href };
    if (pendingWindow && !pendingWindow.closed) pendingWindow.location.replace(viewer.href);
    pendingWindow = null;
    timer = setTimeout(poll, 2000);
  } catch (cause) {
    pendingWindow?.close();
    pendingWindow = null;
    if (!controller.signal.aborted) error.value = cause.message;
  } finally {
    busy.value = false;
  }
}

onUnmounted(() => {
  clearTimeout(timer);
  controller.abort();
  pendingWindow?.close();
  pendingWindow = null;
});
</script>

<template>
  <a-alert v-if="error" type="warning" show-icon :message="error" :description="portalDetail || undefined" />
  <p v-if="!session">扫码后，助手将填表、核对收款和影像，并自动保存草稿。审批由本人提交。</p>
  <a-button v-if="!session" type="primary" :loading="busy" @click="start">打开企业登录窗口</a-button>
  <template v-else>
    <a-button :href="session.viewer" target="_blank" rel="noopener noreferrer">重新打开企业登录窗口</a-button>
    <a-button v-if="!receipt && !saveUncertain" :loading="ending" :disabled="saving || automaticSaving" @click="endSession">结束本次会话</a-button>
    <a-alert v-if="receipt" type="success" show-icon :message="`草稿已保存，单号 ${receipt}`" />
    <p v-else-if="automaticSaving" role="status">正在核对收款、金额和影像，并保存草稿。</p>
    <template v-else-if="review">
      <p role="status">基础信息和交通费用已填好，请在企业窗口核对。</p>
      <p v-if="review.maskedAccount">收款账户 {{ review.maskedAccount }}</p>
      <p v-else>请在企业窗口确认收款账户。</p>
      <a-button type="primary" :loading="saving" :disabled="saveUncertain" @click="saveDraft">重新核对并保存草稿</a-button>
    </template>
    <template v-else-if="!failedStage">
      <p role="status">请在新窗口扫码登录。助手会打开「通用报销单」，匹配票据并填写交通费用。</p>
      <a-button v-if="error" @click="error = ''; poll()">重新查询</a-button>
    </template>
  </template>
</template>

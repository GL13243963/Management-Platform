<script setup>
import { nextTick, onUnmounted, ref } from 'vue';

const message = ref('');
const status = ref('');
const failed = ref(false);
const sending = ref(false);
const feedback = ref(null);
const feedbackOpen = ref(false);
const controller = new AbortController();

async function openFeedback() {
  feedbackOpen.value = true;
  await nextTick();
  feedback.value.scrollIntoView({ block: 'nearest' });
  feedback.value.querySelector('textarea')?.focus();
}

async function sendFeedback() {
  if (!message.value.trim() || sending.value) return;
  sending.value = true;
  status.value = '';
  try {
    const response = await fetch('/api/os/v1/expense-assistant/feedback', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.value.trim() }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('feedback unavailable');
    message.value = '';
    failed.value = false;
    status.value = '留言已收到，谢谢反馈。';
  } catch {
    if (!controller.signal.aborted) {
      failed.value = true;
      status.value = '留言未发送，请稍后重试。';
    }
  } finally {
    sending.value = false;
  }
}

onUnmounted(() => controller.abort());
</script>

<template>
  <section class="card" aria-labelledby="pilot-guide-title">
    <a-alert class="pilot-notice" type="info" show-icon message="测试版 · 填单助手">
      <template #description>
        <p class="pilot-scope"><strong>当前仅支持通用报销单。</strong>差旅报销单功能正在开发中。</p>
        遇到卡住时，请保留企业窗口，按助手提示手动协助，例如选择收款账户。后台会记录失败步骤，供后续版本完善。也可以<a href="#pilot-feedback" @click.prevent="openFeedback">给我们留言</a>。
      </template>
    </a-alert>
    <h2 id="pilot-guide-title">第一次使用，你需要做这四步</h2>
    <ol>
      <li><strong>填写报销信息、选择材料。</strong> <span>填报销人、项目编号和项目名称，再一次选好发票及对应的行程单 PDF。</span></li>
      <li><strong>识别并确认材料。</strong> <span>点「识别材料」，核对发票金额、行程日期和城市。确认无误后点「确认材料」。</span></li>
      <li><strong>打开登录窗口，扫码一次。</strong> <span>点「打开企业登录窗口」，用手机扫码。扫码后等助手自动填表、核对并保存草稿。只有页面提示需要协助时，再操作企业窗口。</span></li>
      <li><strong>查看草稿单号。</strong> <span>确认后将保存的草稿提交即可。</span></li>
    </ol>
    <div v-if="feedbackOpen" id="pilot-feedback" ref="feedback">
      <form @submit.prevent="sendFeedback">
        <label for="expense-feedback">请描述卡在哪一步、看到了什么提示。请勿填写密码、完整账号或发票号码。</label>
        <a-textarea id="expense-feedback" v-model:value="message" :maxlength="1000" :rows="3" :disabled="sending" />
        <a-button type="primary" html-type="submit" :loading="sending" :disabled="!message.trim()">发送留言</a-button>
        <p v-if="status" :role="failed ? 'alert' : 'status'">{{ status }}</p>
      </form>
    </div>
  </section>
</template>

<style scoped>
h2 { margin: 16px 0 8px; font-size: 16px; color: var(--ink); }
.pilot-notice :deep(.ant-alert-description), li span, form label { color: var(--muted); font-size: 13px; }
.pilot-scope { margin: 0 0 4px; }
ol { padding-left: 24px; margin: 0 0 14px; }
li strong { color: var(--ink); }
li + li { margin-top: 5px; }
form { display: grid; gap: 8px; margin-top: 12px; justify-items: start; }
form textarea { width: 100%; }
</style>

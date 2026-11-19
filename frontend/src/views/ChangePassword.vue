<template>
  <main class="change-page">
    <section class="change-card">
      <h1>{{ auth.user?.mustChangePassword ? '首次登录，请修改密码' : '修改密码' }}</h1>
      <p>新密码至少8位，并同时包含字母和数字。</p>
      <a-alert v-if="error" type="error" show-icon :message="error" class="alert" />
      <a-form :model="form" layout="vertical" @finish="submit">
        <a-form-item label="当前密码" name="current" :rules="[{ required: true, message: '请输入当前密码' }]">
          <a-input-password v-model:value="form.current" size="large" autocomplete="current-password" />
        </a-form-item>
        <a-form-item label="新密码" name="next" :rules="[{ required: true, message: '请输入新密码' }]">
          <a-input-password v-model:value="form.next" size="large" autocomplete="new-password" />
        </a-form-item>
        <a-form-item label="再次输入新密码" name="confirm" :rules="[{ required: true, message: '请再次输入新密码' }]">
          <a-input-password v-model:value="form.confirm" size="large" autocomplete="new-password" />
        </a-form-item>
        <a-button type="primary" html-type="submit" size="large" block :loading="loading">保存新密码</a-button>
      </a-form>
    </section>
  </main>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const form = reactive({ current: '', next: '', confirm: '' });
const loading = ref(false);
const error = ref('');

async function submit() {
  error.value = '';
  if (form.next !== form.confirm) { error.value = '两次输入的新密码不一致'; return; }
  loading.value = true;
  try {
    await auth.changePassword(form.current, form.next);
    await router.replace('/');
  } catch (reason) {
    error.value = reason?.error || '密码修改失败';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.change-page{min-height:100vh;display:grid;place-items:center;padding:24px;background:#f8f8fc}.change-card{width:min(440px,100%);padding:38px;border-radius:18px;background:#fff;box-shadow:0 20px 60px rgba(74,64,126,.13)}h1{margin:0 0 8px;color:#302d47}p{color:#77738b;margin:0 0 24px}.alert{margin-bottom:18px}@media(max-width:520px){.change-card{padding:28px 22px}}
</style>

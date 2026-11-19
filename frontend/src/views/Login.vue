<template>

  <main class="auth-page">

    <section class="auth-shell">

      <div class="brand-panel">

        <div class="company-lockup">

          <span class="cscec-symbol"><img src="/brand/china-state-construction.jpg" alt="中国建筑标识" /></span>

          <span class="company-divider"></span>

          <div><strong>中建上海院</strong><small>中国建筑 · 创新中心</small></div>

        </div>

        <div class="os-intro">

          <span class="os-kicker">INNOVATION CENTER</span>

          <h1>创新中心 <em>OS</em></h1>

          <p>连接运营、知识、工具与专业能力的创新工作平台</p>

        </div>

        <div class="platform-dots" aria-label="五个模块">

          <span class="active">运营平台</span><span>项目填单助手</span><span>工具矩阵</span><span>渲染图榜</span><span>项目库检索助手</span>

        </div>

      </div>

      <div class="login-panel">

        <div class="mobile-company">

          <span class="cscec-symbol"><img src="/brand/china-state-construction.jpg" alt="中国建筑标识" /></span>

          <strong>中建上海院 · 创新中心</strong>

        </div>

        <div class="login-heading">

          <span>欢迎使用</span>

          <h2>登录创新中心 OS</h2>

          <p>请使用员工姓名和密码登录</p>

        </div>

        <a-alert v-if="auth.sessionError && !error" type="warning" show-icon
          :message="auth.sessionError" class="auth-alert">
          <template #action><a-button size="small" @click="checkSession(true)">重试检查</a-button></template>
        </a-alert>

        <a-alert v-if="error" type="error" show-icon :message="error" class="auth-alert" />

        <a-form :model="form" layout="vertical" @finish="submit">

          <a-form-item label="姓名" name="username" :rules="[{ required: true, message: '请输入姓名' }]">

            <a-input v-model:value="form.username" size="large" autocomplete="username" placeholder="请输入员工姓名" />

          </a-form-item>

          <a-form-item label="密码" name="password" :rules="[{ required: true, message: '请输入密码' }]">

            <a-input-password v-model:value="form.password" size="large" autocomplete="current-password" placeholder="请输入密码" />

          </a-form-item>

          <a-button type="primary" html-type="submit" size="large" block :loading="loading">登录</a-button>

        </a-form>

        <p class="auth-help">首次登录请使用管理员提供的临时密码；忘记密码请联系管理员重置。</p>

      </div>

    </section>

  </main>

</template>



<script setup>

import { onMounted, reactive, ref } from 'vue';

import { useRouter } from 'vue-router';

import { useAuthStore } from '../stores/auth';



const auth = useAuthStore();

const router = useRouter();

const form = reactive({ username: '', password: '' });

const loading = ref(false);

const error = ref('');



async function checkSession(retry = false) {
  if (retry) auth.ready = false;
  const user = auth.ready ? auth.user : await auth.loadMe();
  if (user && !loading.value && router.currentRoute.value.name === 'Login') {
    await router.replace(user.mustChangePassword ? '/change-password' : '/os');
  }
}

onMounted(() => { void checkSession(); });

async function submit() {

  loading.value = true;

  error.value = '';

  try {

    const user = await auth.login(form.username, form.password);

    await router.replace(user.mustChangePassword ? '/change-password' : '/');

  } catch (reason) {

    error.value = reason?.error || '登录失败，请稍后重试';

  } finally {

    loading.value = false;

  }

}

</script>



<style scoped>

.auth-page{min-height:100vh;display:grid;place-items:center;padding:32px;background:radial-gradient(circle at 10% 15%,rgba(124,108,242,.18),transparent 32%),radial-gradient(circle at 90% 85%,rgba(37,177,218,.12),transparent 28%),#f5f6fb}

.auth-shell{width:min(1040px,100%);min-height:630px;display:grid;grid-template-columns:1.08fr .92fr;overflow:hidden;border:1px solid rgba(255,255,255,.72);border-radius:28px;background:#fff;box-shadow:0 32px 90px rgba(47,43,85,.16)}

.brand-panel{position:relative;display:flex;flex-direction:column;justify-content:space-between;padding:48px;color:#fff;background:linear-gradient(145deg,#2d2961 0%,#6254d6 55%,#8373ee 100%);overflow:hidden}.brand-panel::before,.brand-panel::after{content:'';position:absolute;border:1px solid rgba(255,255,255,.15);border-radius:50%}.brand-panel::before{width:420px;height:420px;right:-180px;top:-160px}.brand-panel::after{width:300px;height:300px;left:-150px;bottom:-150px}

.company-lockup{position:relative;z-index:1;display:flex;align-items:center;gap:16px}.cscec-symbol{width:52px;height:52px;flex:0 0 52px;overflow:hidden;border-radius:3px;background:#fff}.cscec-symbol img{display:block;width:100%;height:100%;object-fit:cover}.company-divider{width:1px;height:36px;background:rgba(255,255,255,.35)}.company-lockup strong{display:block;font-size:17px;letter-spacing:2px}.company-lockup small{display:block;margin-top:4px;color:rgba(255,255,255,.68);font-size:10px;letter-spacing:2px}

.os-intro{position:relative;z-index:1}.os-kicker{font-size:12px;letter-spacing:4px;color:rgba(255,255,255,.62)}.os-intro h1{margin:12px 0 16px;font-size:52px;line-height:1.1;letter-spacing:1px}.os-intro h1 em{font-style:normal;color:#9ee9dc}.os-intro p{max-width:390px;margin:0;color:rgba(255,255,255,.74);font-size:17px;line-height:1.8}

.platform-dots{position:relative;z-index:1;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.platform-dots span{padding-top:13px;border-top:2px solid rgba(255,255,255,.2);color:rgba(255,255,255,.55);font-size:11px;white-space:nowrap}.platform-dots span.active{border-color:#9ee9dc;color:#fff}

.login-panel{display:flex;flex-direction:column;justify-content:center;padding:54px}.mobile-company{display:none}.login-heading span{color:#7467df;font-size:13px;font-weight:700;letter-spacing:2px}.login-heading h2{margin:8px 0 9px;color:#302d47;font-size:29px}.login-heading p{margin:0 0 30px;color:#77738b}.auth-alert{margin-bottom:20px}.auth-help{text-align:center;color:#8a8699;font-size:12px;line-height:1.7;margin:22px 0 0}

@media(max-width:820px){.auth-page{padding:16px}.auth-shell{min-height:0;grid-template-columns:1fr;border-radius:20px}.brand-panel{display:none}.login-panel{padding:32px 24px}.mobile-company{display:flex;align-items:center;gap:12px;margin-bottom:34px;color:#4a465d}.mobile-company strong{font-size:14px}.login-heading h2{font-size:25px}}

</style>


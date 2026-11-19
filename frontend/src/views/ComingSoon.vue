<template>
  <main class="coming-page">
    <header>
      <button type="button" @click="$router.push('/os')"><arrow-left-outlined /> 返回 OS 主页</button>
      <span>创新中心 OS</span>
    </header>
    <section v-if="current">
      <span class="index">{{ current.number }}</span>
      <div class="symbol"><component :is="current.icon" /></div>
      <span class="english">{{ current.english }}</span>
      <h1>{{ current.name }}</h1>
      <div class="badge">开发中</div>
      <p>{{ current.description }}</p>
      <button class="back" type="button" @click="$router.push('/os')">查看其他平台</button>
    </section>
  </main>
</template>

<script setup>
import { computed, markRaw, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeftOutlined, ReadOutlined } from '@ant-design/icons-vue';
import api from '../api';
import { useAuthStore } from '../stores/auth';
const auth = useAuthStore();
const route=useRoute(),apps=ref([]),error=ref('');
const current=computed(()=>{
  const app=apps.value.find(item=>item.visible&&item.status==='placeholder'&&item.launch?.path===`/coming-soon/${route.params.platform}`);
  if (!app) return null;
  const number = String(app.order).padStart(2, '0');
  return {
    number,
    icon: markRaw(ReadOutlined),
    name: auth.isAdmin ? app.name : `开发中模块 ${number}`,
    english: auth.isAdmin ? app.english : 'COMING SOON',
    description: auth.isAdmin ? app.description : '功能暂未开放。',
  };
});
async function loadApps(){error.value='';try{apps.value=await api.get('/os/v1/apps');if(!current.value)error.value='未找到可用的预留模块。';}catch{error.value='模块信息暂不可用，请稍后重试。';}}
onMounted(loadApps);
</script>

<style scoped>
.coming-page{min-height:100vh;padding:0 5vw;color:#302d47;background:radial-gradient(circle at 50% 40%,rgba(124,108,242,.13),transparent 32%),#f7f7fc}.coming-page header{height:82px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e3ec;color:#8a8598;font-size:12px;letter-spacing:2px}.coming-page header button{display:flex;align-items:center;gap:7px;padding:9px 12px;border:0;background:transparent;color:#625d73;cursor:pointer}.coming-page section{min-height:calc(100vh - 82px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;text-align:center}.index{color:#b0acbc;font-size:12px;letter-spacing:4px}.symbol{width:84px;height:84px;display:grid;place-items:center;margin:22px 0;border-radius:24px;background:linear-gradient(145deg,#7768e5,#584bbd);color:#fff;font-size:36px;box-shadow:0 18px 35px rgba(98,82,201,.25)}.english{color:#7668db;font-size:11px;font-weight:700;letter-spacing:4px}.coming-page h1{margin:10px 0 16px;font-size:42px}.badge{padding:6px 16px;border:1px solid #d9d3ff;border-radius:99px;background:#efedff;color:#695bdd;font-size:13px;font-weight:700}.coming-page p{max-width:460px;margin:22px 0;color:#827d90;line-height:1.8}.back{padding:11px 22px;border:1px solid #d8d4e5;border-radius:10px;background:#fff;color:#5c576c;cursor:pointer}.back:hover{border-color:#7c6cf2;color:#6656df}
</style>

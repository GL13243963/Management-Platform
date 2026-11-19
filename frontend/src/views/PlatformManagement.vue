<template>
<main class="management">
 <header><div><span class="eyebrow">INNOVATION CENTER OS</span><h1>平台管理</h1></div><button @click="router.push('/os')">返回 OS 主页</button></header>
 <PlatformActivityOverview />
 <p v-if="loading" role="status">正在读取平台信息…</p>
 <div v-if="error" class="error" role="alert">{{ error }} <button @click="load">重试</button></div>
 <div v-if="modules.length" class="layout">
  <section v-for="selected in modules" :key="selected.appId" :id="'manage-'+selected.appId" class="panel" :class="{focused:route.query.app===selected.appId,wide:['frontend-update','whole-system'].includes(selected.capability)}" :aria-label="selected.name+'版本与更新'">
   <h2>{{ selected.name }} · 版本与更新</h2>
   <span class="update-mode">{{ updateMode(selected) }}</span>
   <template v-if="selected.capability==='whole-system'">
    <p>当前版本 <strong>{{ selected.version }}</strong></p>
    <a-button type="primary" :aria-expanded="showMaintenance" @click="showMaintenance = !showMaintenance">{{ showMaintenance ? '收起维护说明' : '查看维护更新步骤' }}</a-button>
    <div v-if="showMaintenance" class="maintenance-steps">
     <ol>
      <li>在服务器暂存目录校验维护 ZIP 的 SHA-256。</li>
      <li>按随包说明将更新暂存到独立发布目录，用隔离数据验收。</li>
      <li>在维护窗口切换版本。失败时恢复原发布链接。</li>
     </ol>
     <details><summary>旧版一键更新（安装包）</summary><SystemUpdate /></details>
    </div>
   </template>
   <template v-else-if="selected.capability==='integrated'"><p>当前随主平台版本：{{ selected.version }}</p><p>尚未接入独立更新，当前随主平台一起更新。</p><button @click="select('os-core')">查看主平台更新</button></template>
   <template v-else-if="selected.pilot">
    <ModuleVersionManager v-if="selected.capability==='frontend-update'" :app-id="selected.appId" :name="selected.name" />
    <p v-else>当前页面构建：<code>{{ selected.pilot.build }}</code></p>
    <p>所有平台用户可用 · 企业登录和执行服务单独发布。</p>
    <button type="button" @click="openPilot(selected.pilot.entry)">打开填单助手</button>
    <ExpenseRunOverview />
   </template>
   <template v-else-if="selected.capability==='placeholder'"><p>仅预留业务入口，尚未建设；暂不提供更新操作。</p></template>
   <template v-else-if="selected.capability==='frontend-update'">
    <ModuleVersionManager :app-id="selected.appId" :name="selected.name" />
   </template>
   <p v-else>当前更新方式暂不可用。</p>
  </section>
 </div>
</main>
</template>
<script setup>
import ExpenseRunOverview from '../components/ExpenseRunOverview.vue';
import SystemUpdate from '../components/SystemUpdate.vue';
import PlatformActivityOverview from '../components/PlatformActivityOverview.vue';
import {nextTick,onMounted,ref,watch} from 'vue';import {useRouter,useRoute} from 'vue-router';import {useAuthStore} from '../stores/auth';import api from '../api';import ModuleVersionManager from '../components/ModuleVersionManager.vue';
const showMaintenance = ref(false);
const router=useRouter(),route=useRoute(),auth=useAuthStore(),modules=ref([]),loading=ref(false),error=ref('');
async function focusCard(){await nextTick();const id=String(route.query.app||'');if(modules.value.some(m=>m.appId===id))document.getElementById('manage-'+id)?.scrollIntoView({behavior:'smooth',block:'start'});}
function updateMode(module) {
  if (module.pilot) return '已开放';
  return ({
    'whole-system': '服务器维护更新',
    'frontend-update': '独立前端更新',
    integrated: '随主平台更新',
    placeholder: '待接入',
  })[module.capability] || '待核实';
}
function openPilot(entry){if(entry==='/apps/expense-assistant/')window.location.assign(entry);}
function select(id){router.replace({path:'/platform-management',query:{app:id}});}
async function load(){loading.value=true;error.value='';try{modules.value=(await api.get('/os/v1/app-management')).modules;await focusCard();}catch(e){error.value=e.error||'读取失败';if(e.httpStatus===401){auth.user=null;router.replace('/login');}else if(e.httpStatus===403)router.replace('/os');}finally{loading.value=false;}}
watch(()=>route.query.app,focusCard);onMounted(load);
</script>
<style scoped>
.maintenance-steps { margin-top: 16px; }
.maintenance-steps li { margin-bottom: 6px; }
.maintenance-steps summary { cursor: pointer; color: #6656df; }
.update-mode{display:inline-block;margin:0 0 14px;padding:4px 9px;border-radius:8px;background:#f1edff;color:#5344b0;font-size:12px}
.management{min-height:100vh;background:#f8f8fc;color:#302d47;padding:32px 5vw}.management header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:28px}.eyebrow{font-size:11px;letter-spacing:2px;color:#7c6cf2}h1{margin:10px 0;font-size:32px}p{line-height:1.7;color:#77738b}button{padding:10px 16px;border:1px solid #dfdde8;border-radius:10px;background:white;color:#6656df;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid #7c6cf2;outline-offset:3px}.layout{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}nav{display:flex;flex-direction:column;gap:10px}nav button{text-align:left;padding:16px}nav strong,nav small{display:block}nav small{margin-top:6px;color:#77738b}nav .selected{border-color:#7c6cf2;background:#eeeafe}.panel.wide{grid-column:1/-1}.panel.focused{border-color:#7c6cf2}.panel{scroll-margin-top:24px;min-width:0;padding:28px;border:1px solid #ebe9f2;border-radius:18px;background:white}h2{margin-top:0}h3{font-size:16px}.current{display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap}.current span{color:#77738b}.upload{margin:24px 0;padding:20px;border:1px dashed #c8c1f1;border-radius:14px}.upload label{display:block;font-size:14px;margin-bottom:10px}.upload input{display:block;margin-top:10px;max-width:100%}.upload>span{display:block;word-break:break-all;color:#77738b;margin-bottom:12px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0}.version{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 0;border-bottom:1px solid #ebe9f2}.version small{display:block;margin-top:7px;color:#77738b}.error{padding:14px;background:#fff1f0;color:#a33d45;border-radius:10px}.success{padding:12px;background:#eefaf5;color:#39775c}.hint{font-size:13px}@media(max-width:700px){.management{padding:22px 16px}.management header{align-items:flex-start;flex-direction:column}.layout{grid-template-columns:1fr}nav{display:grid;grid-template-columns:1fr 1fr}.panel{padding:18px}.version{align-items:flex-start;flex-wrap:wrap}}
</style>


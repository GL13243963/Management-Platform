<template>

  <main class="os-page">

    <header class="os-header">

      <div class="company">

        <span class="cscec-symbol"><img src="/brand/china-state-construction.jpg" alt="中国建筑标识" /></span>

        <span class="company-divider"></span>

        <div><strong>中建上海院</strong><small>中国建筑 · 创新中心</small></div>

      </div>

      <div class="account">

        <span>{{ auth.user?.username }}</span>
        <button v-if="auth.isAdmin" type="button" @click="router.push('/platform-management')">平台管理</button>

        <button type="button" @click="logout"><logout-outlined /> 退出</button>

      </div>

    </header>



    <section class="hero">

      <div>

        <span class="eyebrow">INNOVATION CENTER OPERATING SYSTEM</span>

        <h1>创新中心 <em>OS</em></h1>

        <p>选择平台，进入您的创新工作空间</p>

      </div>

      <div class="hero-mark">OS<span v-if="apps.length">01—{{ String(apps.length).padStart(2,'0') }}</span></div>

    </section>



    <p v-if="loading" role="status">正在加载模块入口…</p>
    <div v-else-if="error" class="registry-error" role="alert"><p>{{ error }}</p><button type="button" @click="loadApps">重试加载</button></div>
    <section v-else class="platform-grid" aria-label="创新中心五大模块">
      <article v-for="item in apps" :key="item.appId" class="platform-entry"><button class="platform-card" type="button" :disabled="!item.launch && !item.pilot" @click="openApp(item)">
        <span class="number">{{ String(item.order).padStart(2,'0') }}</span>
        <span class="card-copy">
          <strong>{{ displayName(item) }}</strong>
          <small>{{ hideDevelopmentName(item) ? 'COMING SOON' : item.english }}</small>
          <em>{{ item.pilot ? '扫码登录 · 自动填报并保存草稿' : hideDevelopmentName(item) ? '功能暂未开放' : item.description }}</em>
        </span>
        <span class="status" :class="{muted:item.status!=='enabled' && !item.pilot}">{{ item.pilot ? '立即进入' : statusLabel(item.status) }} <arrow-right-outlined /></span>
      </button><button v-if="auth.isAdmin" class="module-update" type="button" @click="router.push({path:'/platform-management',query:{app:item.appId}})" :aria-label="displayName(item)+'版本与更新'">版本与更新</button></article>
    </section>

    <footer>中国建筑 · 中建上海院创新中心</footer>

  </main>

</template>



<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRightOutlined, LogoutOutlined } from '@ant-design/icons-vue';
import { useAuthStore } from '../stores/auth';
import { operationsDefaultPath } from '../router';
import api from '../api';

const auth=useAuthStore(),router=useRouter();
const apps=ref([]),loading=ref(true),error=ref('');
async function loadApps(){
  loading.value=true;error.value='';
  try{apps.value=(await api.get('/os/v1/apps')).filter(item=>item.visible);}
  catch{apps.value=[];error.value='模块入口暂不可用，请稍后重试。';}
  finally{loading.value=false;}
}
function hideDevelopmentName(item) {
  return !item.pilot && !auth.isAdmin && (item.status === 'placeholder' || item.status === 'planned');
}
function displayName(item) {
  return hideDevelopmentName(item) ? `开发中模块 ${String(item.order).padStart(2, '0')}` : item.name;
}
function statusLabel(status){return ({enabled:'立即进入',placeholder:'待建设',planned:'待建设',disabled:'已停用'})[status]||'暂不可用';}
function openApp(item){
  if(item.pilot?.entry === '/apps/expense-assistant/'){
    window.location.assign(item.pilot.entry);
    return;
  }
  if(!item.launch||!['enabled','placeholder'].includes(item.status))return;
  if(item.launch.type==='operations-default')router.push(operationsDefaultPath(auth));
  else if(item.launch.type==='route')router.push(item.launch.path);
}
async function logout(){await auth.logout();await router.replace('/login');}
onMounted(loadApps);
</script>



<style scoped>

.os-page{min-height:100vh;padding:0 5vw 28px;color:#302d47;background:radial-gradient(circle at 90% 5%,rgba(124,108,242,.13),transparent 26%),linear-gradient(180deg,#fafaff,#f3f3fa)}

.os-header{height:88px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(72,66,105,.1)}.company{display:flex;align-items:center;gap:14px}.cscec-symbol{width:48px;height:48px;flex:0 0 48px;overflow:hidden;border-radius:3px;background:#fff}.cscec-symbol img{display:block;width:100%;height:100%;object-fit:cover}.company-divider{width:1px;height:34px;background:#d9d7e2}.company strong,.company small{display:block}.company strong{font-size:16px;letter-spacing:2px}.company small{margin-top:3px;color:#858194;font-size:9px;letter-spacing:2px}.account{display:flex;align-items:center;gap:18px;color:#6f6a81;font-size:14px}.account button{display:flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid #dfdde8;border-radius:8px;background:#fff;color:#625d73;cursor:pointer}.account button:hover{border-color:#7c6cf2;color:#6656df}

.hero{min-height:260px;display:flex;align-items:center;justify-content:space-between;padding:42px 2vw 28px}.eyebrow{color:#7c6cf2;font-size:11px;font-weight:700;letter-spacing:3px}.hero h1{margin:12px 0 8px;font-size:48px;line-height:1.1}.hero h1 em{font-style:normal;color:#6d5ee1}.hero p{margin:0;color:#7b768e;font-size:16px}.hero-mark{color:rgba(100,89,211,.1);font-size:108px;font-weight:900;line-height:.8;letter-spacing:-8px}.hero-mark span{display:block;margin-top:18px;text-align:right;color:#9c97ad;font-size:11px;font-weight:600;letter-spacing:5px}

.platform-entry{min-width:0;display:flex;flex-direction:column;gap:10px}.platform-entry>.platform-card{width:100%;flex:1}.module-update{padding:10px;border:1px solid #dfdde8;border-radius:10px;color:#6656df;background:white;cursor:pointer}.module-update:focus-visible{outline:2px solid #7c6cf2;outline-offset:2px}.platform-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:18px}.platform-card{position:relative;min-height:330px;display:flex;flex-direction:column;align-items:flex-start;padding:25px;border:1px solid #e5e3ec;border-radius:20px;background:rgba(255,255,255,.88);color:inherit;text-align:left;box-shadow:0 8px 28px rgba(58,51,97,.06);cursor:pointer;overflow:hidden;transition:transform .25s ease,box-shadow .25s ease,border-color .25s ease,background .25s ease,color .25s ease}.platform-card:hover,.platform-card:focus-visible{transform:translateY(-7px);color:#fff;border-color:transparent;background:linear-gradient(145deg,#3a346f,#7061df 70%,#8879ee);box-shadow:0 18px 42px rgba(92,76,194,.26);outline:none}.number{align-self:flex-end;color:#a19daa;font-size:12px;letter-spacing:2px}.platform-card:hover .number,.platform-card:focus-visible .number{color:rgba(255,255,255,.55)}.card-copy{display:flex;flex-direction:column;margin-top:76px}.card-copy strong{font-size:24px}.platform-card:hover .card-copy strong,.platform-card:focus-visible .card-copy strong{color:#fff}.card-copy small{margin-top:5px;color:#9b97aa;font-size:10px;letter-spacing:2px}.platform-card:hover .card-copy small,.platform-card:focus-visible .card-copy small{color:rgba(255,255,255,.55)}.card-copy em{margin-top:18px;color:#777286;font-size:13px;font-style:normal}.platform-card:hover .card-copy em,.platform-card:focus-visible .card-copy em{color:rgba(255,255,255,.72)}.status{display:flex;align-items:center;gap:8px;margin-top:auto;color:#6656df;font-size:13px;font-weight:700}.status.muted{color:#9995a7;font-weight:500}.platform-card:hover .status,.platform-card:focus-visible .status{color:#b7f3e8}

footer{padding-top:34px;text-align:center;color:#aaa6b6;font-size:11px;letter-spacing:2px}

@media(max-width:980px){.platform-entry{min-width:0;display:flex;flex-direction:column;gap:10px}.platform-entry>.platform-card{width:100%;flex:1}.module-update{padding:10px;border:1px solid #dfdde8;border-radius:10px;color:#6656df;background:white;cursor:pointer}.module-update:focus-visible{outline:2px solid #7c6cf2;outline-offset:2px}.platform-grid{grid-template-columns:repeat(2,1fr)}.platform-card{min-height:260px}.hero-mark{font-size:80px}}

@media(max-width:620px){.os-page{padding:0 16px 24px}.os-header{height:74px}.company-divider{display:none}.company strong{font-size:13px}.company small{letter-spacing:1px}.account>span{display:none}.hero{min-height:200px;padding:30px 4px 22px}.hero h1{font-size:36px}.hero-mark{display:none}.platform-entry{min-width:0;display:flex;flex-direction:column;gap:10px}.platform-entry>.platform-card{width:100%;flex:1}.module-update{padding:10px;border:1px solid #dfdde8;border-radius:10px;color:#6656df;background:white;cursor:pointer}.module-update:focus-visible{outline:2px solid #7c6cf2;outline-offset:2px}.platform-grid{grid-template-columns:1fr;gap:12px}.platform-card{min-height:190px;padding:20px}.card-copy{margin-top:42px}.card-copy em{margin-top:9px}.status{position:absolute;right:20px;bottom:20px}}

.registry-error{padding:20px;border:1px solid #dfdde8;border-radius:14px;background:#fff}.registry-error button{padding:9px 16px;border:1px solid #7c6cf2;border-radius:8px;background:#fff;color:#6656df;cursor:pointer}.platform-card:disabled{cursor:default;opacity:.65}
@media(min-width:981px) and (max-width:1200px){.platform-entry{min-width:0;display:flex;flex-direction:column;gap:10px}.platform-entry>.platform-card{width:100%;flex:1}.module-update{padding:10px;border:1px solid #dfdde8;border-radius:10px;color:#6656df;background:white;cursor:pointer}.module-update:focus-visible{outline:2px solid #7c6cf2;outline-offset:2px}.platform-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
</style>


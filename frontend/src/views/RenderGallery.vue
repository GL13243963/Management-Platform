<template>
  <main class="gallery-page">
    <div class="shell" :inert="detailOpen">
      <header class="page-header">
        <div class="brand"><span class="mark">榜</span><div><b>创新中心 OS · 渲染图榜</b><small>RENDER GALLERY</small></div></div>
        <div class="header-actions"><span>{{ auth.user?.username }}</span><button type="button" @click="$router.push('/os')">返回 OS 主页</button></div>
      </header>

      <section class="hero">
        <div>
          <span class="eyebrow">GOOD WORK DESERVES TO BE SEEN</span>
          <h1>渲染<span>图榜</span></h1>
          <p>分享工作中生成的好图，也分享让好图诞生的 Prompt。每一次复制与认可，都让好作品被更多人看见。</p>
          <div class="hero-actions"><button v-if="meta.canUpload" class="primary" type="button" @click="uploadOpen=true">＋ 上传我的作品</button><button type="button" @click="scrollToWorks">浏览全部作品</button></div>
        </div>
        <div class="hero-stats"><div><strong>{{ stats.totals.itemCount || 0 }}</strong><span>收录作品</span></div><div><strong>{{ number(stats.totals.starCount) }}</strong><span>累计五角星</span></div><div><strong>{{ stats.totals.uploaderCount || 0 }}</strong><span>分享同事</span></div></div>
      </section>

      <section v-if="stats.latestItem" class="latest-notice">
        <button type="button" @click="openDetail(stats.latestItem.id)">
          <span class="new-badge">NEW</span>
          <img :src="stats.latestItem.imageUrl" alt="最新上传作品">
          <span class="latest-copy"><b>最新上传</b><strong>{{ stats.latestItem.uploaderName }} 上传了新作品</strong><small>{{ formatDate(stats.latestItem.createdAt) }}</small></span>
          <em>点击查看 →</em>
        </button>
      </section>

      <section class="boards">
        <div class="board works-board"><div class="board-head"><h2>★ 好图热榜</h2><span>复制与喜欢共同计星</span></div><div class="top-works"><article v-for="(item,index) in stats.topItems" :key="item.id" class="top-work-card"><button type="button" @click="openDetail(item.id)"><img :src="item.imageUrl" alt="热榜作品"><i>{{ index+1 }}</i><b>★ {{ item.starCount }}</b></button><div class="work-author"><span>{{ item.uploaderName }}</span><strong>全部作品 ★ {{ item.authorStarCount }}</strong></div></article></div></div>
        <div class="board"><div class="board-head"><h2>好图达人</h2><span>1幅1分 · 1星1分</span></div><div class="rank-list"><div v-for="(item,index) in stats.topUploaders" :key="item.name"><i class="avatar">{{ item.name.slice(0,1) }}</i><span><b>{{ item.name }}</b><small>达人榜 NO.{{ index+1 }} · {{ item.count }} 幅 / ★ {{ item.starCount }}</small></span><strong>{{ item.score }} 分</strong></div></div></div>
        <div class="board"><div class="board-head"><h2>平台热榜</h2><span>大家都在用什么</span></div><div class="rank-list"><div v-for="(item,index) in stats.platforms.slice(0,5)" :key="item.platform"><i class="platform-index">{{ index+1 }}</i><span><b>{{ item.platform }}</b><small>平台榜 NO.{{ index+1 }}</small></span><strong>{{ item.count }} 幅</strong></div></div></div>
      </section>

      <section id="allWorks" class="works-section">
        <div class="toolbar">
          <input v-model="filters.q" placeholder="搜索作品、Prompt、上传人或项目…" @input="scheduleLoad">
          <div class="filter-row"><span>平台</span><button :class="{active:!filters.platform}" type="button" @click="setFilter('platform','')">全部</button><button v-for="platform in meta.platforms" :key="platform" :class="{active:filters.platform===platform}" type="button" @click="setFilter('platform',platform)">{{ platform }}</button></div>
          <div class="filter-row"><span>图片类型</span><button :class="{active:!filters.category}" type="button" @click="setFilter('category','')">全部</button><button v-for="category in meta.categories" :key="category" :class="{active:filters.category===category}" type="button" @click="setFilter('category',category)">{{ category }}</button></div>
        </div>
        <div class="section-title"><div><h2>全部作品</h2><p>图片墙只展示作品；点击后查看完整 Prompt 与平台详情</p></div><span>共 {{ items.length }} 幅</span></div>
        <div v-if="loading" class="empty">正在加载作品…</div>
        <div v-else-if="!items.length" class="empty">没有找到符合条件的作品</div>
        <div v-else class="image-wall">
          <article v-for="item in items" :key="item.id" class="image-card">
            <button class="image-button" type="button" title="点击查看详情" @click="openDetail(item.id)"><img :src="item.imageUrl" alt="渲染作品" loading="lazy"></button>
            <button class="like-button" :class="{liked:item.likedByMe}" :disabled="item.likedByMe" type="button" @click="like(item)"><span>{{ item.likedByMe ? '♥' : '♡' }}</span>{{ item.likedByMe ? '已喜欢' : '喜欢这张图' }}</button>
          </article>
        </div>
      </section>

      <section class="usage"><div class="usage-head"><div><h2>生图平台使用频率</h2><p>组合使用时，每个平台分别计入一次</p></div><span class="eyebrow">PLATFORM PULSE</span></div><div class="bar-chart"><div v-for="item in stats.platforms" :key="item.platform" class="bar-item"><div class="bar" :style="{height:barHeight(item.count)}"><strong>{{ item.count }}</strong></div><b>{{ item.platform }}</b></div></div></section>
    </div>

    <div v-if="detailOpen" class="overlay" @click.self="closeDetail" @keydown="handleDetailKeydown">
      <section ref="detailDialog" class="detail-modal" role="dialog" aria-modal="true" aria-labelledby="gallery-detail-title" tabindex="-1">
        <button class="close" type="button" aria-label="关闭作品详情" @click="closeDetail">×</button>
        <div class="detail-image"><img :src="detail.imageUrl" alt="渲染作品"></div>
        <div class="detail-info">
          <div class="star-count">★ {{ detail.starCount }} 五角星</div>
          <h2 id="gallery-detail-title">{{ detail.title }}</h2>
          <div class="badges"><span v-for="platform in detail.platforms" :key="platform">{{ platform }}</span><span>{{ detail.category }}</span></div>
          <dl><dt>上传人</dt><dd>{{ detail.uploaderName }}</dd><dt>所属项目</dt><dd>{{ detail.project || '—' }}</dd><dt>上传时间</dt><dd>{{ formatDate(detail.createdAt) }}</dd></dl>
          <h3>PROMPT</h3><pre>{{ detail.prompt }}</pre>
          <button class="copy-button" type="button" @click="copyPrompt">复制 Prompt · 自动加一颗星</button>
          <div v-if="detail.parameterImageUrl" class="parameter"><h3>参数截图</h3><a :href="detail.parameterImageUrl" target="_blank"><img :src="detail.parameterImageUrl" alt="生成参数截图"></a></div>
          <button v-if="detail.canDelete" class="delete-button" type="button" @click="removeItem">删除这幅作品</button>
        </div>
      </section>
    </div>

    <div v-if="uploadOpen" class="drawer" @click.self="uploadOpen=false">
      <form class="upload-panel" @submit.prevent="submitUpload">
        <button class="close" type="button" @click="uploadOpen=false">×</button><h2>上传好图</h2><p>主图、平台、图片类型、项目归属和 Prompt 均为必填项。</p>
        <label>作品图片 *<input ref="imageInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required></label>
        <label>参数截图（选填）<input ref="parameterInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>
        <label>作品标题 *<input v-model.trim="form.title" maxlength="120" required placeholder="例如：产业园入口日景效果图"></label>
        <fieldset><legend>使用平台（可组合）*</legend><label v-for="platform in meta.platforms" :key="platform" class="check"><input v-model="form.platforms" type="checkbox" :value="platform">{{ platform }}</label><label class="check"><input v-model="form.platforms" type="checkbox" value="其他">其他</label><input v-if="form.platforms.includes('其他')" v-model.trim="form.otherPlatform" maxlength="40" required placeholder="请输入其他平台名称"></fieldset>
        <label>图片类型 *<select v-model="form.category" required><option value="">请选择</option><option v-for="category in meta.categories" :key="category">{{ category }}</option></select></label>
        <label>所属项目 / 自行练习 *<select v-model="form.projectChoice" required><option value="">请选择</option><option value="practice">自行练习</option><option v-for="project in meta.projects" :key="project.id" :value="String(project.id)">{{ project.name }}</option></select></label>
        <label>生图 Prompt *<textarea v-model.trim="form.prompt" maxlength="12000" required placeholder="粘贴生成这张图片时使用的完整 Prompt"></textarea></label>
        <button class="submit-button" type="submit" :disabled="submitting">{{ submitting ? '正在上传…' : '发布到图榜' }}</button>
      </form>
    </div>
  </main>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { message, Modal } from 'ant-design-vue';
import api from '../api';
import { useAuthStore } from '../stores/auth';

const auth=useAuthStore();
const items=ref([]),loading=ref(false),detailOpen=ref(false),detail=ref({}),uploadOpen=ref(false),submitting=ref(false);
const imageInput=ref(null),parameterInput=ref(null),detailDialog=ref(null);
let detailTrigger=null,previousBodyOverflow="";
const meta=reactive({platforms:[],categories:[],projects:[],canUpload:false});
const stats=reactive({totals:{itemCount:0,starCount:0,uploaderCount:0},topItems:[],topUploaders:[],latestItem:null,platforms:[]});
const filters=reactive({platform:'',category:'',q:''});
const form=reactive({title:'',platforms:[],otherPlatform:'',category:'',projectChoice:'',prompt:''});
let searchTimer;
const number=value=>Number(value||0).toLocaleString('zh-CN');
const formatDate=value=>String(value||'').replace('T',' ').slice(0,16);
async function loadMeta(){Object.assign(meta,await api.get('/render-gallery/meta'))}
async function loadStats(){Object.assign(stats,await api.get('/render-gallery/stats'))}
async function loadItems(){loading.value=true;try{items.value=await api.get('/render-gallery/items',{params:{...filters}})}finally{loading.value=false}}
async function loadAll(){await Promise.all([loadMeta(),loadStats(),loadItems()])}
function scheduleLoad(){clearTimeout(searchTimer);searchTimer=setTimeout(loadItems,250)}
function setFilter(key,value){filters[key]=value;loadItems()}
function scrollToWorks(){document.getElementById('allWorks')?.scrollIntoView({behavior:'smooth'})}
async function openDetail(id){
  const trigger=document.activeElement;
  detail.value=await api.get(`/render-gallery/${id}`);
  if(!detailOpen.value){detailTrigger=trigger;previousBodyOverflow=document.body.style.overflow;}
  detailOpen.value=true;
  document.body.style.overflow='hidden';
  await nextTick();
  if(detailOpen.value)(detailDialog.value?.querySelector('button') || detailDialog.value)?.focus();
}
async function closeDetail(){
  if(!detailOpen.value)return;
  detailOpen.value=false;
  document.body.style.overflow=previousBodyOverflow;
  await nextTick();
  const target=detailTrigger?.isConnected ? detailTrigger : document.querySelector('.gallery-page .header-actions button');
  target?.focus({preventScroll:true});
  detailTrigger=null;
}
function handleDetailKeydown(event){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeDetail();return;}
  if(event.key!=='Tab')return;
  const controls=[...detailDialog.value.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>el.getClientRects().length);
  const first=controls[0],last=controls.at(-1);
  if(!first){event.preventDefault();detailDialog.value.focus();return;}
  if(event.shiftKey&&(document.activeElement===first||document.activeElement===detailDialog.value)){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===detailDialog.value)){event.preventDefault();first.focus();}
}

async function copyPrompt(){try{await navigator.clipboard.writeText(detail.value.prompt);const result=await api.post(`/render-gallery/${detail.value.id}/copy`);detail.value.starCount=result.starCount;message.success('Prompt 已复制，并为作品增加一颗星');await Promise.all([loadItems(),loadStats()])}catch(error){message.error(error?.error||'复制失败，请重试')}}
async function like(item){try{const result=await api.post(`/render-gallery/${item.id}/like`);item.likedByMe=true;item.starCount=result.starCount;message.success(result.added?'已为喜欢的作品点亮一颗星':'你已经喜欢过这幅作品');await Promise.all([loadItems(),loadStats()])}catch(error){message.error(error?.error||'操作失败')}}
function resetForm(){Object.assign(form,{title:'',platforms:[],otherPlatform:'',category:'',projectChoice:'',prompt:''});if(imageInput.value)imageInput.value.value='';if(parameterInput.value)parameterInput.value.value=''}
async function submitUpload(){if(!form.platforms.length)return message.warning('请至少选择一个使用平台');const image=imageInput.value?.files?.[0];if(!image)return message.warning('请选择作品图片');const data=new FormData();data.append('image',image);const parameter=parameterInput.value?.files?.[0];if(parameter)data.append('parameterImage',parameter);data.append('title',form.title);data.append('platforms',JSON.stringify(form.platforms));data.append('otherPlatform',form.otherPlatform);data.append('category',form.category);data.append('isPractice',String(form.projectChoice==='practice'));if(form.projectChoice!=='practice')data.append('projectId',form.projectChoice);data.append('prompt',form.prompt);submitting.value=true;try{await api.post('/render-gallery',data,{headers:{'Content-Type':'multipart/form-data'},timeout:120000});message.success('作品已发布到渲染图榜');uploadOpen.value=false;resetForm();await loadAll()}catch(error){const detail=error?.error||error?.message;if(error?.httpStatus===413)message.error(detail||'图片总大小超过服务器限制，请压缩后重试');else message.error(detail||'上传失败，请重试')}finally{submitting.value=false}}
function removeItem(){Modal.confirm({title:'确认删除这幅作品？',content:'删除后将不再出现在图榜中。',okText:'确认删除',cancelText:'取消',okType:'danger',async onOk(){await api.delete(`/render-gallery/${detail.value.id}`);message.success('作品已删除');closeDetail();await loadAll()}})}
function barHeight(count){const max=Math.max(1,...stats.platforms.map(item=>Number(item.count)||0));return `${Math.max(3,Number(count||0)/max*190)}px`}
onMounted(loadAll);
onBeforeUnmount(()=>{clearTimeout(searchTimer);if(detailOpen.value)document.body.style.overflow=previousBodyOverflow;});
</script>

<style scoped>
.gallery-page{min-height:100vh;color:#24213a;background:radial-gradient(circle at 88% 4%,#e8e4ff 0,transparent 30%),linear-gradient(180deg,#fbfaff,#f4f3f9 65%,#efedf7);--purple:#6657df;--muted:#7a7690;--line:#e9e7f2;--shadow:0 18px 50px rgba(48,39,94,.12)}*{box-sizing:border-box}.shell{width:min(1540px,calc(100% - 48px));margin:auto}.page-header{height:82px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(95,84,160,.13)}.brand{display:flex;align-items:center;gap:14px}.mark{width:40px;height:40px;border-radius:12px;background:linear-gradient(145deg,#493aaf,#806af1);display:grid;place-items:center;color:#fff;font-weight:900;box-shadow:0 10px 24px #6255d944}.brand b,.brand small{display:block}.brand small{color:var(--muted);letter-spacing:2px;margin-top:2px}.header-actions{display:flex;align-items:center;gap:15px;color:var(--muted)}button{font:inherit;cursor:pointer}.header-actions button,.hero-actions button{border:1px solid var(--line);background:#fff;padding:11px 17px;border-radius:12px;color:#24213a}.hero{padding:58px 0 30px;display:grid;grid-template-columns:1.2fr .8fr;gap:42px;align-items:end}.eyebrow{color:var(--purple);font-size:11px;font-weight:800;letter-spacing:4px}.hero h1{font-size:clamp(48px,6vw,84px);line-height:1;margin:16px 0 18px;letter-spacing:-5px}.hero h1 span{color:var(--purple)}.hero p{font-size:17px;line-height:1.9;color:var(--muted);max-width:760px;margin:0}.hero-actions{display:flex;gap:12px;margin-top:25px}.hero-actions .primary{border:0;background:linear-gradient(120deg,var(--purple),#8c63ed);color:#fff;font-weight:800;box-shadow:0 10px 25px #6657df3d}.hero-stats{display:grid;grid-template-columns:repeat(3,1fr);background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:var(--shadow);overflow:hidden}.hero-stats>div{padding:24px 20px;border-right:1px solid var(--line)}.hero-stats>div:last-child{border:0}.hero-stats strong,.hero-stats span{display:block}.hero-stats strong{font-size:30px}.hero-stats span{color:var(--muted);font-size:12px}.latest-notice{margin:0 0 18px}.latest-notice button{width:100%;display:grid;grid-template-columns:auto 62px 1fr auto;align-items:center;gap:14px;padding:11px 16px;border:1px solid #ded8ff;border-radius:17px;background:linear-gradient(90deg,#f4f1ff,#fff);text-align:left;box-shadow:0 8px 25px #594cb31a}.latest-notice img{width:62px;height:48px;object-fit:cover;border-radius:10px}.new-badge{padding:5px 8px;border-radius:8px;background:var(--purple);color:#fff;font-size:10px;font-weight:900;letter-spacing:1px}.latest-copy b,.latest-copy strong,.latest-copy small{display:block}.latest-copy b{color:var(--purple);font-size:11px}.latest-copy strong{margin:2px 0;font-size:14px}.latest-copy small{color:var(--muted)}.latest-notice em{font-style:normal;color:var(--purple);font-size:12px;font-weight:800}.boards{display:grid;grid-template-columns:1.25fr .62fr .62fr;gap:18px;margin:20px 0 26px}.board{background:#ffffffe6;border:1px solid var(--line);border-radius:22px;padding:20px;box-shadow:0 10px 35px #38306412}.board-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}.board-head h2{font-size:16px;margin:0}.board-head span{font-size:11px;color:var(--muted)}.top-works{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.top-work-card{min-width:0}.top-works button{position:relative;width:100%;height:155px;padding:0;border:0;border-radius:16px;overflow:hidden;background:#ddd}.top-works img{width:100%;height:100%;object-fit:cover;transition:.3s}.top-works button:hover img{transform:scale(1.04)}.top-works i{position:absolute;top:10px;left:10px;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#fff;color:var(--purple);font-style:normal;font-weight:900;box-shadow:0 4px 15px #0003}.top-works button>b{position:absolute;inset:auto 0 0;padding:35px 12px 12px;text-align:left;background:linear-gradient(transparent,#120e26dc);color:#fff;font-size:12px}.work-author{display:flex;justify-content:space-between;gap:8px;padding:8px 3px 0;font-size:10px}.work-author span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#49455f;font-weight:800}.work-author strong{flex:none;color:var(--purple);font-weight:700}.rank-list{display:grid;gap:7px}.rank-list>div{display:grid;grid-template-columns:34px 1fr auto;align-items:center;gap:9px;padding:7px;border-radius:12px}.rank-list>div:first-child{background:#f2efff}.rank-list i{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;font-style:normal;font-weight:800}.avatar{background:linear-gradient(145deg,#7464e7,#ab84f4);color:#fff}.platform-index{background:#eefaf7;color:#23816f}.rank-list span b,.rank-list span small{display:block}.rank-list span b{font-size:12px}.rank-list small{font-size:10px;color:var(--muted)}.rank-list strong{font-size:11px;color:var(--purple)}.works-section{scroll-margin-top:16px}.toolbar{position:sticky;top:0;z-index:10;padding:14px;background:#f8f7fce8;backdrop-filter:blur(15px);border:1px solid var(--line);border-radius:18px;box-shadow:0 8px 30px #3c326911}.toolbar>input{width:100%;border:0;background:#fff;border-radius:12px;padding:12px 15px;outline:none;margin-bottom:10px}.filter-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:8px}.filter-row>span{width:62px;color:var(--muted);font-size:12px}.filter-row button{border:1px solid var(--line);background:#fff;padding:7px 11px;border-radius:10px;color:var(--muted);font-size:12px}.filter-row button.active{background:#24213a;color:#fff;border-color:#24213a}.section-title{display:flex;justify-content:space-between;align-items:end;margin:30px 2px 18px}.section-title h2{font-size:26px;margin:0}.section-title p{margin:5px 0 0;color:var(--muted)}.section-title>span{color:var(--muted);font-size:12px}.image-wall{columns:4 280px;column-gap:16px}.image-card{break-inside:avoid;margin-bottom:16px;background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 7px 25px #2a224f12;transition:.25s}.image-card:hover{transform:translateY(-4px);box-shadow:var(--shadow)}.image-button{display:block;width:100%;padding:0;border:0;background:#e9e7ef}.image-button img{display:block;width:100%;height:auto}.like-button{width:100%;padding:10px;border:0;border-top:1px solid var(--line);background:#fff;color:var(--muted);font-size:12px}.like-button span{font-size:17px;margin-right:6px}.like-button:hover,.like-button.liked{color:#d34a79;background:#fff8fb}.like-button:disabled{cursor:default}.empty{padding:80px;text-align:center;color:var(--muted);background:#fff;border-radius:18px}.usage{margin:42px 0 80px;padding:28px;background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:0 10px 35px #38306412}.usage-head{display:flex;justify-content:space-between;align-items:end;margin-bottom:26px}.usage-head h2{margin:0;font-size:23px}.usage-head p{margin:6px 0 0;color:var(--muted);font-size:13px}.bar-chart{height:260px;display:flex;align-items:flex-end;gap:clamp(14px,4vw,62px);padding:18px 5% 0;border-bottom:1px solid var(--line);background:repeating-linear-gradient(to top,transparent 0,transparent 51px,#eeecf5 52px)}.bar-item{flex:1;min-width:65px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center}.bar{width:min(84px,70%);min-height:3px;border-radius:14px 14px 0 0;background:linear-gradient(180deg,#8e6df0,#5a4bd3);position:relative;box-shadow:0 -8px 25px #6657df25}.bar strong{position:absolute;left:50%;top:-25px;transform:translateX(-50%);color:var(--purple);font-size:12px}.bar-item>b{height:42px;padding-top:10px;font-size:11px;text-align:center}.overlay,.drawer{position:fixed;inset:0;z-index:50;background:#110d21d2;backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:28px}.detail-modal{position:relative;width:min(1220px,96vw);max-height:92vh;background:#fff;border-radius:24px;overflow:hidden;display:grid;grid-template-columns:1.35fr .65fr;box-shadow:0 30px 100px #0007}.close{position:absolute;right:16px;top:16px;z-index:2;border:0;background:#f1eff7;width:38px;height:38px;border-radius:50%;font-size:22px}.detail-image{background:#15121e;display:grid;place-items:center;min-height:580px}.detail-image>img{width:100%;height:100%;max-height:92vh;object-fit:contain}.detail-info{padding:34px;overflow:auto;max-height:92vh}.star-count{display:inline-block;padding:9px 13px;border-radius:12px;background:#fff6df;color:#a86500;font-weight:900}.detail-info h2{font-size:25px;line-height:1.35;margin:16px 0 10px}.badges{display:flex;gap:6px;flex-wrap:wrap}.badges span{font-size:10px;padding:5px 8px;border-radius:8px;background:#f0edff;color:var(--purple);font-weight:800}.detail-info dl{display:grid;grid-template-columns:70px 1fr;gap:10px;font-size:13px;margin:20px 0}.detail-info dt{color:var(--muted)}.detail-info dd{margin:0}.detail-info h3{font-size:11px;color:var(--muted);letter-spacing:2px;margin:18px 0 8px}.detail-info pre{white-space:pre-wrap;line-height:1.8;background:#f5f3fa;border:1px solid var(--line);padding:15px;border-radius:14px;max-height:260px;overflow:auto;font:13px/1.8 inherit}.copy-button,.submit-button{width:100%;border:0;background:var(--purple);color:#fff;padding:12px;border-radius:12px;font-weight:800}.parameter img{display:block;width:100%;max-height:240px;object-fit:contain;border:1px solid var(--line);border-radius:12px}.delete-button{margin-top:18px;border:0;background:transparent;color:#c63e62;font-size:12px}.drawer{justify-content:flex-end;padding:0}.upload-panel{position:relative;width:min(540px,100%);height:100%;background:#fff;padding:34px;overflow:auto}.upload-panel h2{font-size:28px;margin:0}.upload-panel>p{color:var(--muted)}.upload-panel>label,.upload-panel fieldset{display:block;margin:18px 0;border:0;padding:0;font-size:12px;font-weight:800}.upload-panel input[type=text],.upload-panel>label>input,.upload-panel select,.upload-panel textarea,.upload-panel fieldset>input{display:block;width:100%;margin-top:7px;border:1px solid var(--line);border-radius:12px;padding:12px;background:#faf9fd}.upload-panel textarea{min-height:150px;resize:vertical}.upload-panel fieldset{border:1px solid var(--line);border-radius:14px;padding:14px}.upload-panel legend{padding:0 5px}.upload-panel .check{display:inline-flex;align-items:center;gap:5px;margin:4px 13px 4px 0;font-weight:500}.upload-panel .check input{margin:0}.submit-button:disabled{opacity:.55}.header-actions button:hover,.filter-row button:hover{border-color:var(--purple);color:var(--purple)}
@media(max-width:1100px){.boards{grid-template-columns:1fr 1fr}.works-board{grid-column:1/-1}}@media(max-width:900px){.shell{width:calc(100% - 24px)}.hero{grid-template-columns:1fr}.boards{grid-template-columns:1fr}.works-board{grid-column:auto}.detail-modal{grid-template-columns:1fr;overflow:auto}.detail-image{min-height:300px;height:48vh}.detail-info{max-height:none}}@media(max-width:600px){.hero h1{font-size:50px}.hero-stats{grid-template-columns:1fr}.hero-stats>div{border-right:0;border-bottom:1px solid var(--line)}.latest-notice button{grid-template-columns:auto 52px 1fr}.latest-notice img{width:52px}.latest-notice em{display:none}.top-works{grid-template-columns:1fr}.image-wall{columns:1}.overlay{padding:7px}.bar-chart{overflow-x:auto;justify-content:flex-start}.bar-item{flex:0 0 75px}}
</style>

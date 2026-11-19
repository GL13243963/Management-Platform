<template><RenderGallery v-if="ready" /><section v-else class="platform-state" role="status"><h1>渲染图榜</h1><p>{{ error || '正在确认平台登录状态…' }}</p><button v-if="error" @click="load">重新连接</button><button @click="returnToOs()">返回 OS 主页</button></section></template>
<script setup>
import {onMounted,onUnmounted,ref} from 'vue';
import RenderGallery from './views/RenderGallery.vue';
import {identity,refreshIdentity} from './platform/identity';
import {identityFailure,returnToOs} from './platform/navigation';
const ready=ref(false),error=ref('');
let timer,disposed=false,loading=false;
function redirect(event){ready.value=false;identity.user=null;returnToOs(event.detail);}
async function load(){
  if(loading)return;loading=true;
  try {await refreshIdentity();if(!disposed){error.value='';ready.value=true;window.__renderGalleryBoot?.done();}}
  catch(e){if(!disposed){ready.value=false;identity.user=null;const reason=identityFailure(e);if(reason)returnToOs(reason);else {error.value=e.error||'平台连接失败，请重试';window.__renderGalleryBoot?.done();}}}
  finally{loading=false;}
}
onMounted(()=>{window.addEventListener('platform-auth-required',redirect);window.addEventListener('focus',load);load();timer=setInterval(load,30000);});
onUnmounted(()=>{disposed=true;clearInterval(timer);window.removeEventListener('platform-auth-required',redirect);window.removeEventListener('focus',load);identity.user=null;});
</script>
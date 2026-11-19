<template><Legacy v-if="legacy" /><section v-else class="entry-state" role="status"><h1>工具矩阵</h1><p>{{ error || '正在打开工具矩阵…' }}</p><button v-if="error" @click="load">重新连接</button><button v-if="recoverable" @click="openLegacy">打开旧版</button><button @click="router.push('/os')">返回 OS 主页</button></section></template>
<script setup>
import {defineAsyncComponent,onMounted,ref,watch,onUnmounted} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import api from '../api';
import {useAuthStore} from '../stores/auth';
const Legacy=defineAsyncComponent(()=>import('./ToolMatrix.vue')),route=useRoute(),router=useRouter(),auth=useAuthStore();
const legacy=ref(false),error=ref(''),recoverable=ref(false);let generation=0;
function authError(e){if(e.httpStatus===401){auth.user=null;auth.ready=true;router.replace('/login');return true;}if(e.code==='PASSWORD_CHANGE_REQUIRED'){if(auth.user)auth.user.mustChangePassword=true;router.replace('/change-password');return true;}return false;}
async function eligible(){const apps=await api.get('/os/v1/apps');if(!apps.some(a=>a.appId==='tool-matrix'&&a.visible&&a.status==='enabled'))throw {error:'工具矩阵暂不可访问',code:'MODULE_FORBIDDEN',httpStatus:403};}
async function load(){
 const current=++generation;legacy.value=false;error.value='';recoverable.value=false;
 try{await eligible();if(current!==generation)return;
  if(route.query.view==='legacy'){legacy.value=true;return;}
  recoverable.value=true;const value=await api.get('/os/v1/apps/tool-matrix/runtime');if(current!==generation)return;
  if(value.mode==='legacy'){legacy.value=true;return;}
  if(value.mode!=='independent'||!/^v\d+\.\d+\.\d+$/.test(value.version)||value.entry!=='/apps/tool-matrix/versions/'+value.version+'/index.html')throw {error:'工具入口配置无效'};
  window.location.assign(value.entry);
 }catch(e){if(current!==generation)return;if(authError(e)){recoverable.value=false;return;}if(e.httpStatus===403)recoverable.value=false;error.value=e.error||'暂时无法连接工具矩阵';}
}
function openLegacy(){router.replace({path:'/tool-matrix',query:{view:'legacy'}});}
onMounted(load);watch(()=>route.query.view,load);onUnmounted(()=>generation++);
</script>
<style scoped>.entry-state{max-width:640px;margin:80px auto;padding:24px}.entry-state button{margin:8px;padding:10px 18px;cursor:pointer}</style>

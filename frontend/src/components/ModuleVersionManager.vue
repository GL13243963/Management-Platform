<template><div><p v-if="error" role="alert" class="error">{{ error }}</p>    <p v-if="toolLoading" role="status">正在校验已安装版本…</p>
    <div v-if="tool" class="tool">
     <div class="current"><strong>当前使用：{{ tool.mode==='legacy'?'旧版':tool.mode==='independent'?tool.activeVersion:'配置异常' }}</strong><span>上一版本：{{ tool.previousVersion || '暂无' }}</span></div>
     <p v-if="tool.configError" class="error" role="alert">{{ tool.configError }}</p>
     <div class="upload"><h3>上传{{ name }}更新包</h3><p>上传开发人员提供的专用ZIP包。校验通过后，再确认启用。</p><label>选择更新包<input :ref="setFileInput" type="file" accept=".zip" :disabled="busy" @change="chooseFile"></label><span>{{ file?.name || '尚未选择文件' }}</span><button :disabled="busy||!file" @click="upload">{{ busy?'正在处理…':'上传并校验' }}</button></div>
     <p v-if="notice" class="success" role="status">{{ notice }}</p>
     <div class="actions"><button :disabled="busy||!tool.stateToken||!tool.previousVersion" @click="confirmSwitch('previous','回退到上一版本')">回退到上一版本</button><button :disabled="busy||!tool.stateToken||tool.mode==='legacy'" @click="confirmSwitch('legacy','切回旧版')">切回旧版</button><button :disabled="busy" @click="loadTool">刷新版本</button></div>
     <h3>已安装版本</h3><p v-if="!tool.versions.length">暂无独立版本，请先上传更新包。</p>
     <div v-for="v in tool.versions" :key="v.version" class="version"><div><strong>{{ v.version }}</strong><small>{{ v.valid?'校验通过 · '+formatBytes(v.bytes):'校验未通过' }}{{ tool.mode==='independent'&&tool.activeVersion===v.version?' · 当前使用':'' }}</small></div><button :disabled="busy||!tool.stateToken||!v.valid||(tool.mode==='independent'&&tool.activeVersion===v.version)" @click="confirmSwitch(v.version,'启用 '+v.version)">启用此版本</button></div>
     <p class="hint">切换后，返回OS重新进入{{ name }}即可使用。账号、业务记录和附件继续保留。</p>
    </div>
</div></template>
<script setup>
import {ref,onMounted} from 'vue';import {useRouter} from 'vue-router';import {Modal} from 'ant-design-vue';import {useAuthStore} from '../stores/auth';import api from '../api';
const props=defineProps({appId:{type:String,required:true},name:{type:String,required:true}});
const router=useRouter(),auth=useAuthStore(),error=ref(''),tool=ref(null),toolLoading=ref(false),busy=ref(false),notice=ref(''),file=ref(null),fileInput=ref(null);
const headers={'X-Platform-Action':'module-management-v1'};
function formatBytes(v){return (v/1024/1024).toFixed(2)+' MB';}
function handleError(e){
 if(e.httpStatus===401){auth.user=null;auth.ready=true;router.replace('/login');}
 else if(e.code==='PASSWORD_CHANGE_REQUIRED'){if(auth.user)auth.user.mustChangePassword=true;router.replace('/change-password');}
 else if(e.httpStatus===403){auth.ready=false;auth.loadMe().then(()=>router.replace('/os'));}
 error.value=e.error||'读取失败，请重试';
}
async function loadTool(){toolLoading.value=true;try{tool.value=await api.get('/os/v1/app-management/'+props.appId+'');}catch(e){tool.value=null;handleError(e);}finally{toolLoading.value=false;}}
function setFileInput(element){fileInput.value=element;}
function chooseFile(e){file.value=e.target.files?.[0]||null;notice.value='';}
async function upload(){if(!file.value||busy.value)return;if(file.value.size>32*1024*1024){error.value='请选择32MB以内的更新包';return;}busy.value=true;error.value='';try{const data=new FormData();data.append('file',file.value);const result=await api.post('/os/v1/app-management/'+props.appId+'/packages',data,{headers,timeout:60000});notice.value=result.version+' 已校验并安装，请在下方确认启用。';file.value=null;if(fileInput.value)fileInput.value.value='';await loadTool();}catch(e){handleError(e);}finally{busy.value=false;}}
function confirmSwitch(target,title){if(busy.value)return;const stateToken=tool.value?.stateToken;Modal.confirm({title,content:'仅切换'+props.name+'前端。操作完成后请返回OS重新进入；业务数据与附件保持。',okText:'确认操作',cancelText:'取消',async onOk(){busy.value=true;error.value='';try{await api.post('/os/v1/app-management/'+props.appId+'/activate',{target,stateToken},{headers});notice.value=title+'成功';await loadTool();}catch(e){handleError(e);if(e.httpStatus===412)await loadTool();}finally{busy.value=false;}}});}

onMounted(loadTool);
</script>
<style scoped>
.management{min-height:100vh;background:#f8f8fc;color:#302d47;padding:32px 5vw}.management header{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:28px}.eyebrow{font-size:11px;letter-spacing:2px;color:#7c6cf2}h1{margin:10px 0;font-size:32px}p{line-height:1.7;color:#77738b}button{padding:10px 16px;border:1px solid #dfdde8;border-radius:10px;background:white;color:#6656df;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid #7c6cf2;outline-offset:3px}.layout{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}nav{display:flex;flex-direction:column;gap:10px}nav button{text-align:left;padding:16px}nav strong,nav small{display:block}nav small{margin-top:6px;color:#77738b}nav .selected{border-color:#7c6cf2;background:#eeeafe}.panel.wide{grid-column:1/-1}.panel.focused{border-color:#7c6cf2}.panel{scroll-margin-top:24px;min-width:0;padding:28px;border:1px solid #ebe9f2;border-radius:18px;background:white}h2{margin-top:0}h3{font-size:16px}.current{display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap}.current span{color:#77738b}.upload{margin:24px 0;padding:20px;border:1px dashed #c8c1f1;border-radius:14px}.upload label{display:block;font-size:14px;margin-bottom:10px}.upload input{display:block;margin-top:10px;max-width:100%}.upload>span{display:block;word-break:break-all;color:#77738b;margin-bottom:12px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0}.version{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 0;border-bottom:1px solid #ebe9f2}.version small{display:block;margin-top:7px;color:#77738b}.error{padding:14px;background:#fff1f0;color:#a33d45;border-radius:10px}.success{padding:12px;background:#eefaf5;color:#39775c}.hint{font-size:13px}@media(max-width:700px){.management{padding:22px 16px}.management header{align-items:flex-start;flex-direction:column}.layout{grid-template-columns:1fr}nav{display:grid;grid-template-columns:1fr 1fr}.panel{padding:18px}.version{align-items:flex-start;flex-wrap:wrap}}
</style>


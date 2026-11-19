const express=require('express'),multer=require('multer');
const {requireAnyRole}=require('../middleware/auth'),{validateRegistry}=require('../services/app-registry');
const runtime=require('../services/tool-matrix-runtime'),packages=require('../services/tool-matrix-packages');
const {expensePilotInfo}=require('../services/expense-pilot-info');
function createRouter({configPath,assetRoot,registryPath,currentVersion=()=> 'unknown',appId='tool-matrix',availableModules=['tool-matrix']}){
 runtime.appId(appId);
 const router=express.Router();router.use(requireAnyRole('admin'));router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
 function writeGuard(req,res,next){const origin=req.get('origin');if(req.get('X-Platform-Action')!=='module-management-v1'||req.get('sec-fetch-site')==='cross-site'||(origin&&origin!==req.protocol+'://'+req.get('host')))return res.status(403).json({error:'请从平台管理页面执行操作',code:'ACTION_ORIGIN_REQUIRED'});next();}
 function error(res,e){const status=e.code==='STALE_STATE'?412:e.code==='VERSION_EXISTS'?409:e.code==='EEXIST'?423:400;return res.status(status).json({code:e.code==='STALE_STATE'?'STALE_STATE':'MODULE_UPDATE_REJECTED',error:({412:'配置已变化，请刷新后重试',409:'该版本已存在，请使用新版本号',423:'已有版本操作正在执行，请稍后重试',400:'操作未完成，请检查更新包格式、校验结果和目标版本'})[status]});}
 router.get('/',(req,res)=>{try{const version=currentVersion(),apps=validateRegistry(runtime.readJson(registryPath));res.json({modules:[{appId:'os-core',name:'OS主平台',capability:'whole-system',version},...apps.map(a=>({appId:a.appId,name:a.name,status:a.status,capability:availableModules.includes(a.appId)?'frontend-update':a.status==='placeholder'?'placeholder':'integrated',version:['operations','render-gallery'].includes(a.appId)?version:null,...(a.appId==='expense-assistant'?{pilot:expensePilotInfo(a)}:{})}))]});}catch{res.status(503).json({error:'平台清单暂不可用'});}});
 router.get('/'+appId,(req,res)=>{try{res.json(packages.describe(configPath,assetRoot,appId));}catch{res.status(503).json({error:'版本信息暂不可用'});}});
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:32*1024*1024,files:1,fields:0}});
 router.post('/'+appId+'/packages',writeGuard,(req,res)=>{upload.single('file')(req,res,async e=>{
  if(e)return res.status(e.code==='LIMIT_FILE_SIZE'?413:400).json({error:'请选择32MB以内的模块专用ZIP更新包'});
  if(!req.file||!req.file.originalname.toLowerCase().endsWith('.zip'))return res.status(400).json({error:'请选择模块专用ZIP更新包'});
  try{const result=await packages.importPackage(req.file.buffer,assetRoot,appId);req.audit('module_package_staged','app',appId,result);res.status(201).json(result);}catch(err){error(res,err);}
 });});
 router.post('/'+appId+'/activate',writeGuard,(req,res)=>{
  if(!req.is('application/json')||typeof req.body?.stateToken!=='string'||!/^[a-f0-9]{64}$/.test(req.body.stateToken))return res.status(400).json({error:'请刷新版本信息后操作'});
  const target=req.body.target;try{if(!['legacy','previous'].includes(target))runtime.version(target);const state=runtime.switchVersion(configPath,assetRoot,target,{expectedToken:req.body.stateToken,appId});req.audit('module_version_changed','app',appId,{target,mode:state.mode,version:state.activeVersion});res.json({mode:state.mode,activeVersion:state.activeVersion,previousVersion:state.previousVersion});}catch(e){error(res,e);}
 });return router;
}
module.exports={createRouter};

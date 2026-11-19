const express=require('express'),path=require('node:path');
const {authenticate,requireChangedPassword}=require('../middleware/auth');
const {listApps}=require('../services/app-registry');
const service=require('../services/tool-matrix-runtime');
function createModule(options={}){
 const moduleId=service.appId(options.appId||'tool-matrix'),prefix=({'tool-matrix':'TOOL_MATRIX','render-gallery':'RENDER_GALLERY',operations:'OPERATIONS','expense-assistant':'EXPENSE_ASSISTANT'})[moduleId];
 const configPath=options.configPath||process.env[prefix+'_RUNTIME_CONFIG']||path.join(__dirname,'../data/'+moduleId+'-runtime.json');
 const assetRoot=options.assetRoot||process.env[prefix+'_ASSET_ROOT']||path.join(__dirname,'../../app-assets/'+moduleId);
 const registryPath=options.registryPath||path.join(__dirname,'../data/os-apps.json');
 function access(req,res,next){res.set('Cache-Control','no-store');try{
  const app=listApps(service.readJson(registryPath),req.auth.user).find(a=>a.appId===moduleId);
  const allowed = moduleId === 'expense-assistant'
    ? app?.status === 'placeholder' && process.env.EXPENSE_PILOT_ENABLED === 'true'
    : app?.status === 'enabled';
  if(!app?.visible||!allowed)return res.status(403).json({code:'MODULE_FORBIDDEN',error:'模块暂不可访问'});
  next();
 }catch{return res.status(503).json({code:'APP_REGISTRY_UNAVAILABLE',error:'模块清单暂不可用'});}}
 const api=express.Router();api.use(access);
 api.route('/').get((req,res)=>{try{res.json(service.runtime(configPath,assetRoot,moduleId));}catch{res.status(503).json({code:'MODULE_UNAVAILABLE',error:'模块入口暂不可用'});}}).all((req,res)=>res.status(405).set('Allow','GET, HEAD').end());
 const assets=express.Router();assets.use((req,res,next)=>{
  res.set('Cache-Control','no-store');const html=/\/index\.html$/.test(req.path);
  // Reuse the existing authentication implementation, adapting only HTML error responses.
  const adapter={setHeader:(...args)=>res.setHeader(...args)};
  adapter.status=function(code){this._code=code;return this;};
  adapter.json=function(body){if(html&&this._code===401)return res.redirect(302,'/#/login');if(html&&body.code==='PASSWORD_CHANGE_REQUIRED')return res.redirect(302,'/#/change-password');return res.status(this._code||401).json(body);};
  authenticate(req,adapter,()=>requireChangedPassword(req,adapter,()=>access(req,res,next)));
 });
 assets.use((req,res)=>{
  if(!['GET','HEAD'].includes(req.method))return res.status(405).set('Allow','GET, HEAD').end();
  const match=/^\/versions\/([^/]+)\/(.+)$/.exec(req.path);if(!match)return res.status(404).end();
  try{
   service.version(match[1]);const name=decodeURIComponent(match[2]);if(!service.safeName(name))return res.status(404).end();
   const release=service.verifyRelease(assetRoot,match[1],moduleId);let bytes;
   if(name==='manifest.json')bytes=Buffer.from(JSON.stringify(release.manifest));else bytes=release.buffers.get(name);
   if(!bytes)return res.status(404).end();
   const immutable=/^assets\/.+-[a-zA-Z0-9_-]{8,}\.(m?js|css|woff2?|png|svg|webp)$/.test(name);
   res.set('Cache-Control',immutable?'private, max-age=31536000, immutable':'no-store').set('X-Content-Type-Options','nosniff');
   res.type(path.extname(name)).send(bytes);
  }catch{return res.status(404).end();}
 });
 return {api,assets,access,appId:moduleId,configPath,assetRoot,registryPath};
}
module.exports={createModule};

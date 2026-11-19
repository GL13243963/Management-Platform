const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION=/^v(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;
const MAX_FILES=1000,MAX_BYTES=30*1024*1024;
function version(v){if(typeof v!=='string'||!VERSION.test(v))throw Error('Invalid version');return v;}
function safeName(name){return typeof name==='string'&&name.length<=240&&!name.split('/').some(s=>!s||s==='.'||s==='..'||s.startsWith('.'))&&/^[a-zA-Z0-9_./-]+$/.test(name)&&/\.(html|m?js|css|json|svg|png|jpe?g|webp|ico|woff2?|ttf)$/.test(name)&&!name.split('/').some(s=>['node_modules','data','uploads','src'].includes(s));}
function noLinks(p){
 const absolute=path.resolve(p),parsed=path.parse(absolute);let cursor=parsed.root;
 for(const part of absolute.slice(parsed.root.length).split(path.sep)){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Symlink rejected');}
 return absolute;
}
function readJson(file,max=256*1024){noLinks(file);if(fs.statSync(file).size>max)throw Error('JSON too large');return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function readConfig(file){
 const c=readJson(file,4096);
 if(!c||!['legacy','independent'].includes(c.mode)||Object.keys(c).some(k=>!['mode','activeVersion','previousVersion'].includes(k)))throw Error('Invalid config');
 for(const k of ['activeVersion','previousVersion'])if(c[k]!==null)version(c[k]);
 if(c.mode==='independent'&&!c.activeVersion)throw Error('Missing active version');return c;
}
function digest(data){return crypto.createHash('sha256').update(data).digest('hex');}
function appId(value){if(!['tool-matrix','render-gallery','operations','expense-assistant'].includes(value))throw Error('Unsupported app');return value;}
function verifyRelease(assetRoot,v,moduleId='tool-matrix'){
 appId(moduleId);
 version(v);const dir=noLinks(path.join(path.resolve(assetRoot),'releases',v)),m=readJson(path.join(dir,'manifest.json'));
 if(m.appId!==moduleId||m.version!==v||m.entry!=='index.html'||!Array.isArray(m.files)||!m.files.length||m.files.length>MAX_FILES)throw Error('Invalid manifest');
 const names=new Set(),buffers=new Map();let total=0;
 for(const f of m.files){
  if(!safeName(f.path)||f.path==='manifest.json'||names.has(f.path.toLowerCase())||!Number.isSafeInteger(f.bytes)||f.bytes<0||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('Invalid file');
  names.add(f.path.toLowerCase());total+=f.bytes;if(total>MAX_BYTES)throw Error('Release too large');
  const filename=noLinks(path.join(dir,f.path)),stat=fs.statSync(filename);
  if(!stat.isFile()||stat.size!==f.bytes)throw Error('Size mismatch');const bytes=fs.readFileSync(filename);
  if(digest(bytes)!==f.sha256)throw Error('Hash mismatch');buffers.set(f.path,bytes);
 }
 if(!buffers.has('index.html')||!buffers.has('boot.js'))throw Error('Missing entry or boot guard');
 function walk(base,prefix=''){for(const e of fs.readdirSync(base,{withFileTypes:true})){const relative=prefix+e.name;if(e.isSymbolicLink())throw Error('Symlink rejected');if(e.isDirectory())walk(path.join(base,e.name),relative+'/');else if(relative!=='manifest.json'&&!buffers.has(relative))throw Error('Unlisted file');}}
 walk(dir);return {manifest:m,buffers};
}
function runtime(configPath,assetRoot,moduleId='tool-matrix'){appId(moduleId);const c=readConfig(configPath);if(c.mode==='legacy')return {mode:'legacy',version:null,entry:null};verifyRelease(assetRoot,c.activeVersion,moduleId);return {mode:'independent',version:c.activeVersion,entry:'/apps/'+moduleId+'/versions/'+c.activeVersion+'/index.html'};}
function stage(input,assetRoot,v,moduleId='tool-matrix'){
 appId(moduleId);
 version(v);const src=noLinks(path.resolve(input)),root=path.resolve(assetRoot);
 if(src===root||root.startsWith(src+path.sep)||src.startsWith(root+path.sep))throw Error('Source and destination overlap');
 fs.mkdirSync(path.join(root,'releases'),{recursive:true});noLinks(path.join(root,'releases'));const target=path.join(root,'releases',v);
 if(fs.existsSync(target))throw Error('Version already exists');const tmp=fs.mkdtempSync(path.join(root,'releases','.stage-')),entries=[];let total=0;
 try{
  function walk(base,prefix=''){for(const e of fs.readdirSync(base,{withFileTypes:true})){
   const name=prefix+e.name,source=path.join(base,e.name);if(e.isSymbolicLink())throw Error('Symlink rejected');
   if(e.isDirectory()){if(!/^[a-zA-Z0-9_-]+$/.test(e.name)||['src','node_modules','data','uploads'].includes(e.name))throw Error('Directory rejected');walk(source,name+'/');}
   else{if(!safeName(name)||name==='manifest.json'||entries.length>=MAX_FILES)throw Error('Asset rejected');const size=fs.statSync(source).size;total+=size;if(total>MAX_BYTES)throw Error('Release too large');
    const bytes=fs.readFileSync(source),dest=path.join(tmp,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes,{flag:'wx'});entries.push({path:name,bytes:bytes.length,sha256:digest(bytes)});
   }
  }}walk(src);if(!entries.some(f=>f.path==='index.html')||!entries.some(f=>f.path==='boot.js'))throw Error('Missing entry/boot guard');
  fs.writeFileSync(path.join(tmp,'manifest.json'),JSON.stringify({appId:moduleId,version:v,entry:'index.html',files:entries},null,2));
  // Rename only after every byte is staged; existing immutable versions are never overwritten.
  fs.renameSync(tmp,target);
  try{verifyRelease(root,v,moduleId);}catch(e){fs.rmSync(target,{recursive:true,force:true});throw e;}return target;
 }finally{if(fs.existsSync(tmp))fs.rmSync(tmp,{recursive:true,force:true});}
}
function stateToken(file){noLinks(file);if(fs.statSync(file).size>4096)throw Error('Config too large');return digest(fs.readFileSync(file));}
function switchVersion(configPath,assetRoot,target,options={}){
 const file=path.resolve(configPath);noLinks(path.dirname(file));const lock=file+'.lock';let fd,temp;
 try{fd=fs.openSync(lock,'wx');if(options.expectedToken && stateToken(file)!==options.expectedToken){const error=Error('配置已变化，请刷新后重试');error.code='STALE_STATE';throw error;}let current;
  try{current=readConfig(file);}catch(e){if(target!=='legacy')throw e;noLinks(file);if(fs.statSync(file).size>4096)throw e;fs.copyFileSync(file,file+'.invalid-'+crypto.randomUUID()+'.bak',fs.constants.COPYFILE_EXCL);current={mode:'legacy',activeVersion:null,previousVersion:null};}
  let next;
  if(target==='legacy')next={...current,mode:'legacy'};
  else{const v=target==='previous'?current.previousVersion:target;version(v);verifyRelease(assetRoot,v,options.appId||'tool-matrix');next={mode:'independent',activeVersion:v,previousVersion:current.activeVersion===v?current.previousVersion:current.activeVersion};}
  temp=file+'.'+crypto.randomUUID()+'.tmp';const out=fs.openSync(temp,'wx');try{fs.writeFileSync(out,JSON.stringify(next,null,2));fs.fsyncSync(out);}finally{fs.closeSync(out);}
  fs.renameSync(temp,file);return next;
 }finally{if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
}
module.exports={appId,stateToken,version,safeName,noLinks,readJson,readConfig,digest,verifyRelease,runtime,stage,switchVersion};

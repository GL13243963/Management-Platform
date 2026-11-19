const fs=require('node:fs'),path=require('node:path'),yauzl=require('yauzl');
const runtime=require('./tool-matrix-runtime'),LIMIT=30*1024*1024;
function describe(configPath,assetRoot,moduleId='tool-matrix'){
 runtime.appId(moduleId);
 let config=null,configError=null,token=null;
 try{token=runtime.stateToken(configPath);config=runtime.readConfig(configPath);}catch{configError='当前配置无法读取，可尝试恢复旧版';}
 const versions=[],dir=path.join(assetRoot,'releases');
 if(fs.existsSync(dir)){runtime.noLinks(dir);for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  if(!e.isDirectory()||!/^v\d+\.\d+\.\d+$/.test(e.name))continue;
  try{const release=runtime.verifyRelease(assetRoot,e.name,moduleId);versions.push({version:e.name,valid:true,files:release.manifest.files.length,bytes:release.manifest.files.reduce((n,f)=>n+f.bytes,0)});}
  catch{versions.push({version:e.name,valid:false,error:'文件校验未通过'});}
 }}
 versions.sort((a,b)=>{const aa=a.version.slice(1).split('.').map(Number),bb=b.version.slice(1).split('.').map(Number);for(let i=0;i<3;i++)if(aa[i]!==bb[i])return bb[i]-aa[i];return 0;});
 return {mode:config?.mode||'unknown',activeVersion:config?.activeVersion||null,previousVersion:config?.previousVersion||null,configError,stateToken:token,versions};
}
async function importPackage(buffer,assetRoot,moduleId='tool-matrix'){
 runtime.appId(moduleId);
 fs.mkdirSync(assetRoot,{recursive:true});runtime.noLinks(assetRoot);const lock=path.join(assetRoot,'.upload.lock');let fd,temp;
 try{
  fd=fs.openSync(lock,'wx');temp=fs.mkdtempSync(path.join(assetRoot,'.upload-'));
  const incoming=path.join(temp,'incoming');fs.mkdirSync(incoming);await extract(buffer,incoming);
  const manifest=runtime.readJson(path.join(incoming,'manifest.json'));runtime.version(manifest.version);
  fs.mkdirSync(path.join(temp,'releases'));fs.renameSync(incoming,path.join(temp,'releases',manifest.version));
  const checked=runtime.verifyRelease(temp,manifest.version,moduleId);
  fs.mkdirSync(path.join(assetRoot,'releases'),{recursive:true});runtime.noLinks(path.join(assetRoot,'releases'));
  const target=path.join(assetRoot,'releases',manifest.version);if(fs.existsSync(target)){const e=Error('Version exists');e.code='VERSION_EXISTS';throw e;}
  fs.renameSync(path.join(temp,'releases',manifest.version),target);return {version:checked.manifest.version,files:checked.manifest.files.length};
 }finally{if(temp)fs.rmSync(temp,{recursive:true,force:true});if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
}
function extract(buffer,destination){
 return new Promise((resolve,reject)=>{
  let finished=false,zip,total=0,count=0;const seen=new Set();
  const fail=e=>{if(finished)return;finished=true;clearTimeout(timer);if(zip)zip.close();reject(e);};
  const timer=setTimeout(()=>fail(Error('Package timeout')),15000);
  yauzl.fromBuffer(buffer,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,z)=>{
   if(error)return fail(error);zip=z;zip.on('error',fail);zip.on('end',()=>{if(!finished){finished=true;clearTimeout(timer);resolve();}});
   zip.on('entry',entry=>{
    if(finished)return;
    try{
     if(++count>1001)throw Error('Too many files');
     const name=entry.fileName,dir=name.endsWith('/'),mode=(entry.externalFileAttributes>>>16)&0xf000;
     if(entry.generalPurposeBitFlag&1 || (mode && mode!==0x8000 && mode!==0x4000))throw Error('File type rejected');
     if(!runtime.safeName(dir?name+'placeholder.js':name)||seen.has(name.toLowerCase()))throw Error('Path rejected');
     seen.add(name.toLowerCase());total+=entry.uncompressedSize;
     if(total>LIMIT+256*1024||(!dir&&entry.uncompressedSize>LIMIT))throw Error('Package too large');
     if(dir){zip.readEntry();return;}
     zip.openReadStream(entry,(e,stream)=>{
      if(e)return fail(e);const chunks=[];let size=0;
      stream.on('error',fail);stream.on('data',chunk=>{size+=chunk.length;if(size>entry.uncompressedSize||size>LIMIT){stream.destroy();fail(Error('Size mismatch'));}else chunks.push(chunk);});
      stream.on('end',()=>{if(finished)return;try{if(size!==entry.uncompressedSize)throw Error('Size mismatch');const file=path.join(destination,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.concat(chunks),{flag:'wx'});zip.readEntry();}catch(e){fail(e);}});
     });
    }catch(e){fail(e);}
   });zip.readEntry();
  });
 });
}
module.exports={describe,importPackage};

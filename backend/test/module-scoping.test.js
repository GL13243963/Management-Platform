const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const runtime=require('../src/services/tool-matrix-runtime');
test('module manifests, version pointers and locks are scoped independently',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'module-scoping-'));
 try{
 const dist=path.join(tmp,'dist'),tool=path.join(tmp,'tool'),gallery=path.join(tmp,'gallery'),tc=path.join(tmp,'tool.json'),gc=path.join(tmp,'gallery.json');
 fs.mkdirSync(dist);fs.writeFileSync(path.join(dist,'index.html'),'<h1>fixture</h1>');fs.writeFileSync(path.join(dist,'boot.js'),'/* fixture */');
 const base={mode:'legacy',activeVersion:null,previousVersion:null};fs.writeFileSync(tc,JSON.stringify(base));fs.writeFileSync(gc,JSON.stringify(base));
 runtime.stage(dist,tool,'v1.0.0');runtime.stage(dist,gallery,'v1.0.0','render-gallery');
 assert.throws(()=>runtime.verifyRelease(tool,'v1.0.0','render-gallery'));assert.throws(()=>runtime.verifyRelease(gallery,'v1.0.0'));assert.throws(()=>runtime.verifyRelease(gallery,'v1.0.0','expense-assistant'));
 runtime.switchVersion(gc,gallery,'v1.0.0',{appId:'render-gallery'});assert.equal(runtime.runtime(gc,gallery,'render-gallery').entry,'/apps/render-gallery/versions/v1.0.0/index.html');assert.deepEqual(runtime.readConfig(tc),base);
 fs.writeFileSync(gc+'.lock','held');assert.throws(()=>runtime.switchVersion(gc,gallery,'legacy',{appId:'render-gallery'}));runtime.switchVersion(tc,tool,'v1.0.0');assert.equal(runtime.readConfig(tc).activeVersion,'v1.0.0');assert.equal(fs.readFileSync(gc+'.lock','utf8'),'held');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

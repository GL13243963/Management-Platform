const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'platform-management-'));process.env.APP_DB_PATH=path.join(dir,'data/app.db');process.env.NODE_ENV='test';
const {db,Employee}=require('../src/models'),{User,Session}=require('../src/models/auth'),{hashPassword,hashSessionToken}=require('../src/services/password'),runtime=require('../src/services/tool-matrix-runtime');
const config=path.join(dir,'runtime.json'),assets=path.join(dir,'assets'),registry=path.join(dir,'apps.json');
const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,typeof v==='string'?v:JSON.stringify(v));};
function crc(b){let n=0xffffffff;for(const byte of b){n^=byte;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
function zip(entries){
 let offset=0;const data=[],central=[];
 for(const e of entries){const name=Buffer.from(e.name),content=Buffer.from(e.content),local=Buffer.alloc(30),header=Buffer.alloc(46),method=e.method||0,compressed=method===8?zlib.deflateRawSync(content):content,size=e.size||content.length;
 local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(e.flags||0,6);local.writeUInt16LE(method,8);local.writeUInt32LE(crc(content),14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(size,22);local.writeUInt16LE(name.length,26);
 header.writeUInt32LE(0x02014b50,0);header.writeUInt16LE(0x0314,4);header.writeUInt16LE(20,6);header.writeUInt16LE(e.flags||0,8);header.writeUInt16LE(method,10);header.writeUInt32LE(crc(content),16);header.writeUInt32LE(compressed.length,20);header.writeUInt32LE(size,24);header.writeUInt16LE(name.length,28);header.writeUInt32LE(e.attrs||0,38);header.writeUInt32LE(offset,42);
 data.push(local,name,compressed);central.push(header,name);offset+=local.length+name.length+compressed.length;
 }const c=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(c.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...data,c,end]);
}
function entries(v='v2.0.0'){
 const files=[{name:'index.html',content:'<!doctype html><title>module</title>'},{name:'boot.js',content:'window.boot=1;'}];
 const manifest={appId:'tool-matrix',version:v,entry:'index.html',files:files.map(f=>({path:f.name,bytes:Buffer.byteLength(f.content),sha256:runtime.digest(Buffer.from(f.content))}))};
 return [{name:'manifest.json',content:JSON.stringify(manifest)},...files];
}
let server,base,adminId;const cookies={},action={'X-Platform-Action':'module-management-v1'};
test.before(async()=>{
 write(config,{mode:'independent',activeVersion:'v1.0.0',previousVersion:null});fs.copyFileSync(path.join(__dirname,'../src/data/os-apps.json'),registry);
 const input=path.join(dir,'dist');for(const e of entries('v1.0.0').slice(1))write(path.join(input,e.name),e.content);runtime.stage(input,assets,'v1.0.0');
 const hash=await hashPassword('FixtureOnly88');
 for(const [role,must]of [['admin',false],['employee',false],['leader',false],['guest',false],['change',true]]){
 const u=User.create({username:'manager-'+role,passwordHash:hash,roles:[role==='change'?'admin':role],mustChangePassword:must}),token=crypto.randomBytes(20).toString('hex');if(role==='admin')adminId=u.id;Session.create({userId:u.id,tokenHash:hashSessionToken(token),expiresAt:new Date(Date.now()+3600000).toISOString()});cookies[role]='management_session='+token;
 }
 const express=require('express'),{authenticate,requireChangedPassword}=require('../src/middleware/auth'),app=express();app.use(express.json());app.use(authenticate,requireChangedPassword);app.use('/api/os/v1/app-management',require('../src/routes/app-management').createRouter({configPath:config,assetRoot:assets,registryPath:registry,currentVersion:()=> 'test-os'}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{await new Promise(r=>server.close(r));db.raw.close();fs.rmSync(dir,{recursive:true,force:true});});
function request(p='',role='admin',options={}){return fetch(base+'/api/os/v1/app-management'+p,{...options,headers:{...(role?{cookie:cookies[role]}:{}),...options.headers}});}
async function state(){return(await request('/tool-matrix')).json();}
async function activate(target,token){return request('/tool-matrix/activate','admin',{method:'POST',headers:{...action,'content-type':'application/json'},body:JSON.stringify({target,stateToken:token||((await state()).stateToken)})});}
function upload(buffer){const f=new FormData();f.append('file',new Blob([buffer]),'module.zip');return request('/tool-matrix/packages','admin',{method:'POST',headers:action,body:f});}
test('only changed-password admins can read or mutate management',async()=>{assert.equal((await request('',null)).status,401);assert.equal((await request('','change')).status,403);for(const role of ['employee','leader','guest'])for(const p of ['', '/tool-matrix'])assert.equal((await request(p,role)).status,403);for(const role of ['employee','leader','guest'])assert.equal((await request('/tool-matrix/activate',role,{method:'POST',headers:action})).status,403);});
test('management lists core and five apps with truthful capabilities',async()=>{const r=await request();assert.equal(r.headers.get('cache-control'),'no-store');const {modules}=await r.json();assert.equal(modules.length,6);assert.equal(modules.filter(m=>m.capability==='placeholder').length,2);assert.equal(modules.find(m=>m.appId==='operations').capability,'integrated');assert.equal(modules.find(m=>m.appId==='tool-matrix').capability,'frontend-update');assert.equal((await request('/render-gallery/activate','admin',{method:'POST',headers:action})).status,404);});
test('write action requires same origin marker and fresh state token',async()=>{assert.equal((await request('/tool-matrix/activate','admin',{method:'POST'})).status,403);assert.equal((await request('/tool-matrix/activate','admin',{method:'POST',headers:{...action,origin:'https://evil.example'}})).status,403);assert.equal((await request('/tool-matrix/activate','admin',{method:'POST',headers:action})).status,400);});
test('upload validates new version without activating it',async()=>{const r=await upload(zip(entries()));assert.equal(r.status,201);assert.equal((await r.json()).version,'v2.0.0');const s=await state();assert.equal(s.activeVersion,'v1.0.0');assert.ok(s.versions.some(v=>v.version==='v2.0.0'&&v.valid));});
test('activate and rollback preserve data and reject stale browser state',async()=>{const token=(await state()).stateToken;assert.equal((await activate('v2.0.0',token)).status,200);assert.equal((await activate('legacy',token)).status,412);assert.equal((await state()).activeVersion,'v2.0.0');assert.equal((await activate('previous')).status,200);assert.equal((await state()).activeVersion,'v1.0.0');assert.equal((await activate('legacy')).status,200);assert.equal((await state()).mode,'legacy');});
test('duplicate version never overwrites installed bytes',async()=>{const before=fs.readFileSync(path.join(assets,'releases/v2.0.0/manifest.json'),'utf8');assert.equal((await upload(zip(entries()))).status,409);assert.equal(fs.readFileSync(path.join(assets,'releases/v2.0.0/manifest.json'),'utf8'),before);});
test('bad archives, foreign app, traversal, symlink, duplicate paths and oversize rejected',async()=>{
 const foreign=entries('v3.0.0'),m=JSON.parse(foreign[0].content);m.appId='render-gallery';foreign[0].content=JSON.stringify(m);
 const broken=entries('v3.0.0');broken[1].content='tamper';
 const cases=[Buffer.from('not zip'),zip(foreign),zip(broken),zip([...entries('v3.0.0'),{name:'../escape.js',content:'x'}]),zip([...entries('v3.0.0'),{name:'link.js',content:'index.html',attrs:(0xa1ff0000>>>0)}]),zip([...entries('v3.0.0'),{name:'BOOT.js',content:'x'}]),zip([...entries('v3.0.0'),{name:'large.js',content:'x',method:8,size:31*1024*1024}]),zip([...entries('v3.0.0'),{name:'app.db',content:'x'}])];
 for(let i=0;i<cases.length;i++)assert.equal((await upload(cases[i])).status,400,'case '+i);
 assert.ok(!fs.existsSync(path.join(assets,'releases/v3.0.0')));assert.equal(fs.readdirSync(assets).filter(n=>n.startsWith('.upload')).length,0);
});
test('invalid targets and damaged installed assets cannot activate',async()=>{assert.equal((await activate('../bad')).status,400);const f=path.join(assets,'releases/v2.0.0/boot.js'),old=fs.readFileSync(f);fs.writeFileSync(f,'tampered');assert.equal((await state()).versions.find(v=>v.version==='v2.0.0').valid,false);assert.equal((await activate('v2.0.0')).status,400);fs.writeFileSync(f,old);});
test('upload lock preserves competing operation',async()=>{const f=path.join(assets,'.upload.lock');write(f,'held');assert.equal((await upload(zip(entries('v3.0.0')))).status,423);assert.equal(fs.readFileSync(f,'utf8'),'held');fs.unlinkSync(f);});
test('corrupt configuration can recover to legacy with evidence',async()=>{write(config,'broken');const s=await state();assert.ok(s.configError);assert.equal((await activate('legacy',s.stateToken)).status,200);assert.equal((await state()).mode,'legacy');assert.ok(fs.readdirSync(dir).some(n=>n.startsWith('runtime.json.invalid-')));});
test('successful changes are audited and revoked admin cannot manage',async()=>{assert.ok(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='module_version_changed'").get().n>=3);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='module_package_staged'").get().n,1);User.setRoles(adminId,['employee']);assert.equal((await request()).status,403);assert.equal((await activate('legacy')).status,403);});

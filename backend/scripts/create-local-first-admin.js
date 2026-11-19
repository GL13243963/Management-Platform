const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync,backup}=require('node:sqlite');
const {hashPassword,validatePassword}=require('../src/services/password');
async function createFirstAdmin(db,password){
 const invalid=validatePassword(password);if(invalid)throw Error(invalid);
 const hash=await hashPassword(password);db.exec('PRAGMA foreign_keys=ON');db.exec('BEGIN IMMEDIATE');
 try{
  if(db.prepare('SELECT COUNT(*) AS count FROM users').get().count!==0)throw Error('已有账号，拒绝创建或重置');
  const id=Number(db.prepare('INSERT INTO users (employeeId,username,passwordHash,mustChangePassword) VALUES (NULL,?,?,1)').run('v2-admin',hash).lastInsertRowid);
  db.prepare("INSERT INTO user_roles (userId,role,team) VALUES (?,'admin','')").run(id);
  db.prepare('INSERT INTO audit_logs (userId,username,action,entityType,entityId,details) VALUES (?,?,?,?,?,?)').run(id,'v2-admin','local_first_admin_created','user',String(id),JSON.stringify({scope:'V2-local',mustChangePassword:true}));
  db.exec('COMMIT');return {id,username:'v2-admin',roles:['admin'],mustChangePassword:true};
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
}
async function main(){
 require('../src/utils/runtime').assertSupportedRuntime();
 const root=path.resolve(__dirname,'../..'),file=path.join(root,'backend/data/app.db');
 if(!process.argv.includes('--apply')){console.log(JSON.stringify({database:file,action:'create first local admin',username:'v2-admin',role:'admin',mustChangePassword:true,applied:false}));return;}
 if(process.argv.length!==4||process.argv[2]!=='--apply')throw Error('Usage: --apply <absolute backup file>');
 const backupFile=process.argv[3],evidence=path.join(root,'migration-evidence')+path.sep;
 if(!path.isAbsolute(backupFile)||!path.resolve(backupFile).startsWith(evidence)||fs.existsSync(backupFile))throw Error('Use a new backup file inside V2 migration-evidence');
 const source=new DatabaseSync(file,{readOnly:true});
 try{if(source.prepare('SELECT COUNT(*) AS count FROM users').get().count!==0)throw Error('已有账号，拒绝创建或重置');await backup(source,backupFile);}finally{source.close();}
 const password='V2!'+crypto.randomBytes(18).toString('base64url')+'9',db=new DatabaseSync(file);
 try{const account=await createFirstAdmin(db,password);console.log(JSON.stringify({...account,temporaryPassword:password}));}finally{db.close();}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={createFirstAdmin};

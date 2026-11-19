const ROLES=new Set(['admin','leader','team_leader','employee','guest']);
const POLICY={
  operations:{type:'operations-default',path:null,statuses:['enabled','disabled']},
  'expense-assistant':{type:'route',path:'/coming-soon/expense',statuses:['placeholder','disabled']},
  'tool-matrix':{type:'route',path:'/tool-matrix',statuses:['enabled','disabled']},
  'render-gallery':{type:'route',path:'/render-gallery',statuses:['enabled','disabled']},
  'project-search':{type:'route',path:'/coming-soon/project-search',statuses:['placeholder','planned','disabled']},
};
function validateRegistry(records){
  if(!Array.isArray(records)||!records.length)throw new Error('Invalid app registry');
  const ids=new Set(),orders=new Set();
  return records.map(record=>{
    const policy=record&&Object.hasOwn(POLICY,record.appId)&&POLICY[record.appId];
    if(!policy||ids.has(record.appId)||!Number.isInteger(record.order)||record.order<1||orders.has(record.order))throw new Error('Invalid app identity or order');
    ids.add(record.appId);orders.add(record.order);
    for(const field of ['name','english','description'])if(typeof record[field]!=='string'||!record[field].trim()||record[field].length>200)throw new Error('Invalid display field');
    if(!policy.statuses.includes(record.status)||typeof record.visible!=='boolean')throw new Error('Invalid app status');
    if(!Array.isArray(record.allowedRoles)||!record.allowedRoles.length||record.allowedRoles.some(role=>!ROLES.has(role))||new Set(record.allowedRoles).size!==record.allowedRoles.length)throw new Error('Invalid allowed roles');
    if(!record.launch||record.launch.type!==policy.type||record.launch.path!==policy.path)throw new Error('Invalid app entry');
    return {appId:record.appId,name:record.name,english:record.english,description:record.description,order:record.order,status:record.status,visible:record.visible,allowedRoles:[...record.allowedRoles],launch:{type:record.launch.type,path:record.launch.path}};
  }).sort((a,b)=>a.order-b.order);
}
function listApps(records,user){
  const roles=new Set((user?.roles||[]).map(item=>item.role));
  return validateRegistry(records).filter(app=>app.allowedRoles.some(role=>roles.has(role))).map(({allowedRoles,...app})=>({...app,launch:['enabled','placeholder'].includes(app.status)?app.launch:null}));
}
module.exports={validateRegistry,listApps};

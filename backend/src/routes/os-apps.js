const express=require('express');
const fs=require('node:fs');
const path=require('node:path');
const {listApps}=require('../services/app-registry');
const {expensePilotInfo}=require('../services/expense-pilot-info');
function createRouter(readRegistry=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'../data/os-apps.json'),'utf8'))){
  const router=express.Router();
  router.get('/',(req,res)=>{
    res.set('Cache-Control','no-store');
        try {
      const user = req.auth.user;
      const apps = listApps(readRegistry(), user);
      res.json(apps.map(app => {
        const pilot = app.visible ? expensePilotInfo(app) : null;
        return pilot ? { ...app, pilot } : app;
      }));
    }
    catch{res.status(503).json({error:'模块入口暂不可用，请稍后重试',code:'APP_REGISTRY_UNAVAILABLE'});}
  });
  router.all('/',(req,res)=>res.status(405).set('Allow','GET').json({error:'模块清单仅支持读取'}));
  return router;
}
module.exports=createRouter();
module.exports.createRouter=createRouter;

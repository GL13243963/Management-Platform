import {defineStore} from 'pinia';import api from '../api';
export const useAuthStore=defineStore('auth',{state:()=>({user:null,ready:false}),getters:{isLoggedIn:s=>!!s.user,isAdmin:s=>!!s.user?.roles?.some(r=>r.role==='admin'),isLeader:s=>!!s.user?.roles?.some(r=>r.role==='leader'),isTeamLeader:s=>!!s.user?.roles?.some(r=>r.role==='team_leader')},actions:{
 hasRole(role){return !!this.user?.roles?.some(r=>r.role===role);},
 async loadMe(){try{const result=await api.get('/auth/me'),apps=await api.get('/os/v1/apps');if(!apps.some(a=>a.appId==='operations'&&a.status==='enabled'&&a.visible))throw Error('运营平台暂不可访问');this.user=result.user;return this.user;}catch{this.user=null;return null;}finally{this.ready=true;}},
 async logout(){try{await api.post('/auth/logout');}finally{this.user=null;this.ready=true;}}
}});

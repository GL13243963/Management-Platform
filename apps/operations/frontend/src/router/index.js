import {createRouter,createWebHashHistory} from 'vue-router';import {useAuthStore} from '../stores/auth';import {returnCore} from '../platform/navigation';
const routes=[{path:'/',component:{render:()=>null}},{ path: '/data', name: 'DataOps', component: () => import('../views/DataOps.vue'), meta: { title: '数据及审批', roles: ['admin'] } },{ path: '/attendance-board', name: 'AttendanceBoard', component: () => import('../views/Dashboard.vue'), meta: { title: '考勤看板', roles: ['admin', 'leader'] } },{ path: '/project-board', name: 'ProjectBoard', component: () => import('../views/Projects.vue'), meta: { title: '项目看板', roles: ['admin', 'leader', 'team_leader', 'employee', 'guest'] } },{ path: '/weekly-report', name: 'WeeklyReport', component: () => import('../views/WeeklyReport.vue'), meta: { title: '每周项目填报', roles: ['employee'] } },{ path: '/team-review', name: 'TeamReview', component: () => import('../views/TeamReview.vue'), meta: { title: '小组填报核对', roles: ['admin', 'team_leader'] } },{ path: '/attendance', redirect: '/data?tab=approval' },{ path: '/dashboard', redirect: '/attendance-board' },{ path: '/projects', redirect: '/project-board' },{ path: '/employees', redirect: '/data?tab=people' },{ path: '/analytics', redirect: '/attendance-board' },];
const router=createRouter({history:createWebHashHistory(),routes});
export function operationsDefaultPath(auth) {
  if (auth.hasRole('admin')) return '/data';
  if (auth.hasRole('leader')) return '/attendance-board';
  if (auth.hasRole('guest')) return '/project-board';
  return '/weekly-report';
}

router.beforeEach(async to=>{
 const auth=useAuthStore();await auth.loadMe();
 if(!auth.isLoggedIn){returnCore('login');return false;}
 if(auth.user.mustChangePassword){returnCore('password');return false;}
 if(to.path==='/data'&&['accounts','system'].includes(to.query.tab)){returnCore(to.query.tab);return false;}
 if(['/os','/login','/change-password','/platform-management'].includes(to.path)){returnCore(to.path==='/change-password'?'password':to.path==='/login'?'login':'home');return false;}
 if(to.path==='/')return operationsDefaultPath(auth);
 const roles=to.meta.roles||[];if(roles.length&&!roles.some(r=>auth.hasRole(r)))return '/project-board';
 return true;
});
router.afterEach(()=>{document.title='运营平台 · 创新中心 OS';window.__operationsBoot?.done();});
export default router;

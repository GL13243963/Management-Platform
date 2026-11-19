import { createRouter, createWebHashHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import api from '../api';
import {isOperationsEntry,operationsEntry} from './operations-entry';

const routes = [
  { path: '/', name: 'Home', component: { render: () => null } },
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue'), meta: { public: true, authShell: true, title: '登录' } },
  { path: '/change-password', name: 'ChangePassword', component: () => import('../views/ChangePassword.vue'), meta: { authShell: true, title: '修改密码' } },
  { path: '/platform-management', name: 'PlatformManagement', component: () => import('../views/PlatformManagement.vue'), meta: { osShell: true, roles: ['admin'], title: '平台管理' } },
  { path: '/os', name: 'OsHome', component: () => import('../views/OsHome.vue'), meta: { osShell: true, title: '首页' } },
  { path: '/render-gallery', name: 'RenderGallery', component: () => import('../views/RenderGalleryEntry.vue'), meta: { osShell: true, title: '渲染图榜' } },
  { path: '/tool-matrix', name: 'ToolMatrix', component: () => import('../views/ToolMatrixEntry.vue'), meta: { osShell: true, title: '工具矩阵' } },
  { path: '/coming-soon/masters', redirect: '/render-gallery' },
  { path: '/coming-soon/course', redirect: '/os' },
  { path: '/coming-soon/:platform', name: 'ComingSoon', component: () => import('../views/ComingSoon.vue'), meta: { osShell: true, title: '开发中' } },
  { path: '/data', name: 'DataOps', component: () => import('../views/DataOps.vue'), meta: { title: '数据及审批', roles: ['admin'] } },
  { path: '/attendance-board', name: 'AttendanceBoard', component: () => import('../views/Dashboard.vue'), meta: { title: '考勤看板', roles: ['admin', 'leader'] } },
  { path: '/project-board', name: 'ProjectBoard', component: () => import('../views/Projects.vue'), meta: { title: '项目看板', roles: ['admin', 'leader', 'team_leader', 'employee', 'guest'] } },
  { path: '/weekly-report', name: 'WeeklyReport', component: () => import('../views/WeeklyReport.vue'), meta: { title: '每周项目填报', roles: ['employee'] } },
  { path: '/team-review', name: 'TeamReview', component: () => import('../views/TeamReview.vue'), meta: { title: '小组填报核对', roles: ['admin', 'team_leader'] } },
  { path: '/attendance', redirect: '/data?tab=approval' },
  { path: '/dashboard', redirect: '/attendance-board' },
  { path: '/projects', redirect: '/project-board' },
  { path: '/employees', redirect: '/data?tab=people' },
  { path: '/analytics', redirect: '/attendance-board' },
];

const router = createRouter({ history: createWebHashHistory(), routes });

// A user may keep the platform open while a new frontend build replaces the
// hashed lazy-loaded files. Reload once so navigation uses the new file map.
router.onError(error => {
  const message = String(error?.message || error || '');
  const isStaleChunk = /dynamically imported module|module script|loading chunk|importing a module/i.test(message);
  if (!isStaleChunk) return;
  const key = 'management_chunk_reload_at';
  const lastReload = Number(sessionStorage.getItem(key) || 0);
  if (Date.now() - lastReload > 10000) {
    sessionStorage.setItem(key, String(Date.now()));
    window.location.reload();
  }
});

export function operationsDefaultPath(auth) {
  if (auth.hasRole('admin')) return '/data';
  if (auth.hasRole('leader')) return '/attendance-board';
  if (auth.hasRole('guest')) return '/project-board';
  return '/weekly-report';
}

function defaultPath() { return '/os'; }

router.beforeEach(async to => {
  const auth = useAuthStore();
  if (to.meta.public) return auth.isLoggedIn
    ? (auth.user.mustChangePassword ? '/change-password' : defaultPath(auth))
    : true;
  if (!auth.ready && to.path === '/') return '/login';
  if (!auth.ready) await auth.loadMe();
  if (!auth.isLoggedIn) return { path: '/login', query: { redirect: to.fullPath } };
  if (auth.user.mustChangePassword && to.path !== '/change-password') return '/change-password';
  if (!auth.user.mustChangePassword && to.path === '/change-password') return defaultPath(auth);
  if (to.path === '/') return defaultPath(auth);
  const roles = to.meta.roles || [];
  if (roles.length && !roles.some(role => auth.hasRole(role))) return defaultPath(auth);
  if(isOperationsEntry(to)){
    try{const apps=await api.get('/os/v1/apps');if(!apps.some(a=>a.appId==='operations'&&a.visible&&a.status==='enabled'))return '/os';
      if(to.query.view!=='legacy'){const url=operationsEntry(await api.get('/os/v1/apps/operations/runtime'),to);if(url){window.location.assign(url);return false;}}
    }catch(e){if(e.httpStatus===401){auth.user=null;auth.ready=true;return '/login';}if(e.code==='PASSWORD_CHANGE_REQUIRED'){if(auth.user)auth.user.mustChangePassword=true;return '/change-password';}return '/os';}
  }
  return true;
});

router.afterEach(to => { document.title = `${to.meta.title || '运营平台'} - 创新中心 OS`; });

export default router;

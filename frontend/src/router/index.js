import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/', redirect: '/data' },
  { path: '/data', name: 'DataOps', component: () => import('../views/DataOps.vue'), meta: { title: '数据及审批' } },
  { path: '/attendance-board', name: 'AttendanceBoard', component: () => import('../views/Dashboard.vue'), meta: { title: '考勤看板' } },
  { path: '/project-board', name: 'ProjectBoard', component: () => import('../views/Projects.vue'), meta: { title: '项目看板' } },
  { path: '/attendance', redirect: '/data?tab=approval' },
  { path: '/dashboard', redirect: '/attendance-board' },
  { path: '/projects', redirect: '/project-board' },
  { path: '/employees', redirect: '/data?tab=people' },
  { path: '/analytics', redirect: '/attendance-board' },
];

export default createRouter({ history: createWebHashHistory(), routes });

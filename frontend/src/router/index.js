import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'Dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '数据概览' } },
  { path: '/attendance', name: 'Attendance', component: () => import('../views/Attendance.vue'), meta: { title: '考勤管理' } },
  { path: '/projects', name: 'Projects', component: () => import('../views/Projects.vue'), meta: { title: '项目管理' } },
  { path: '/allocation', name: 'Allocation', component: () => import('../views/Allocation.vue'), meta: { title: '项目分配' } },
  { path: '/employees', name: 'Employees', component: () => import('../views/Employees.vue'), meta: { title: '人员管理' } },
  { path: '/analytics', name: 'Analytics', component: () => import('../views/Analytics.vue'), meta: { title: '统计分析' } },
];

export default createRouter({ history: createWebHashHistory(), routes });

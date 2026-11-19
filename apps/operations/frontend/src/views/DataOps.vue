<template>
  <div class="page data-ops">
    <h1 class="page-title">数据及审批</h1>
    <p class="page-subtitle">导入与校验数据 · 处理考勤审批 · 维护人员和项目信息</p>
    <DataCoveragePanel />
    <p><a-button @click="returnCore('accounts')">账号与权限（主平台）</a-button> <a-button @click="returnCore('system')">系统更新（主平台）</a-button></p>
    <a-tabs v-model:activeKey="activeTab" type="card" class="ops-tabs" @change="syncTab">
      <a-tab-pane key="approval" tab="考勤导入与审批"><Attendance /></a-tab-pane>
      <a-tab-pane key="leave" tab="调休管理"><CompLeaveManager /></a-tab-pane>
      <a-tab-pane key="people" tab="人员信息"><Employees /></a-tab-pane>
      <a-tab-pane key="projects" tab="项目数据与维护"><Projects /></a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { returnCore } from '../platform/navigation';
import DataCoveragePanel from '../components/DataCoveragePanel.vue';
import Attendance from './Attendance.vue';
import Employees from './Employees.vue';
import Projects from './Projects.vue';
import CompLeaveManager from '../components/CompLeaveManager.vue';
const route = useRoute(), router = useRouter();
const activeTab = ref('approval');
function syncTab(key) { router.replace({ path: '/data', query: { tab: key } }); }
onMounted(() => { if (['approval', 'leave', 'people', 'projects'].includes(route.query.tab)) activeTab.value = route.query.tab; });
</script>

<style scoped>
.ops-tabs:deep(>.ant-tabs-content-holder>.ant-tabs-content>.ant-tabs-tabpane>.page){padding:8px 0}.ops-tabs:deep(.page>.page-title),.ops-tabs:deep(.page>.page-subtitle),.ops-tabs:deep(.page>.ant-alert:first-of-type){display:none}
@media(max-width:760px){.data-ops{padding:20px 12px;min-width:0;box-sizing:border-box}.ops-tabs{min-width:0}}
</style>

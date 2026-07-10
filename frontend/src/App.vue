<template>
  <a-config-provider :locale="zhCN" :theme="theme">
    <a-layout style="min-height:100vh">
      <a-layout-header class="hdr">
        <div class="brand">
          <div class="logo">中</div>
          <div>
            <div class="brand-title">创新中心管理平台</div>
            <div class="brand-sub">Innovation Center Management</div>
          </div>
        </div>
        <div class="hdr-right">
          <a-space :size="14">
            <span class="date">{{ today }}</span>
            <a-avatar style="background: var(--brand)">管</a-avatar>
          </a-space>
        </div>
      </a-layout-header>
      <a-layout>
        <a-layout-sider width="220" theme="light" class="sider">
          <a-menu
            :selectedKeys="[$route.name]"
            mode="inline"
            @click="({key}) => $router.push({name: key})"
          >
            <a-menu-item key="Dashboard">
              <template #icon><dashboard-outlined /></template>
              数据概览
            </a-menu-item>
            <a-menu-item key="Attendance">
              <template #icon><clock-circle-outlined /></template>
              考勤管理
            </a-menu-item>
            <a-menu-item key="Projects">
              <template #icon><project-outlined /></template>
              项目管理
            </a-menu-item>
            <a-menu-item key="Allocation">
              <template #icon><partition-outlined /></template>
              项目分配
            </a-menu-item>
            <a-menu-item key="Employees">
              <template #icon><team-outlined /></template>
              人员管理
            </a-menu-item>
            <a-menu-item key="Analytics">
              <template #icon><bar-chart-outlined /></template>
              统计分析
            </a-menu-item>
          </a-menu>
        </a-layout-sider>
        <a-layout-content>
          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </a-layout-content>
      </a-layout>
    </a-layout>
  </a-config-provider>
</template>

<script setup>
import { computed } from 'vue';
import dayjs from 'dayjs';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import {
  DashboardOutlined, ClockCircleOutlined, ProjectOutlined,
  PartitionOutlined, TeamOutlined, BarChartOutlined,
} from '@ant-design/icons-vue';

const today = computed(() => dayjs().format('YYYY年MM月DD日 dddd'));

const theme = {
  token: {
    colorPrimary: '#0074C4',
    colorInfo: '#0074C4',
    borderRadius: 8,
    fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", Segoe UI, Roboto, sans-serif',
  },
  components: {
    Menu: {
      itemSelectedBg: '#E6F1FA',
      itemSelectedColor: '#0074C4',
      itemHoverBg: '#F5F7FA',
    },
  },
};
</script>

<style scoped>
.hdr {
  background: linear-gradient(90deg, #0074C4 0%, #005A9E 100%);
  padding: 0 28px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 2px 8px rgba(0,116,196,0.15);
}
.brand { display: flex; align-items: center; gap: 14px; color: #fff; }
.logo {
  width: 38px; height: 38px; border-radius: 8px;
  background: rgba(255,255,255,0.18);
  color: #fff; font-weight: 700; font-size: 18px;
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
}
.brand-title { font-size: 16px; font-weight: 600; line-height: 1.2; }
.brand-sub { font-size: 11px; opacity: 0.75; letter-spacing: 0.4px; }
.hdr-right { display: flex; align-items: center; }
.date { color: rgba(255,255,255,0.85); font-size: 13px; }

.sider {
  background: #fff !important;
  box-shadow: 1px 0 4px rgba(0,0,0,0.04);
  padding-top: 8px;
}
:deep(.ant-menu-inline) { border-inline-end: none !important; }
:deep(.ant-menu-item) {
  margin: 4px 12px !important;
  width: calc(100% - 24px) !important;
  border-radius: 6px !important;
}
</style>

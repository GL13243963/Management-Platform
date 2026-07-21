<template>
  <a-config-provider :locale="zhCN" :theme="theme">
    <a-layout style="min-height:100vh">
      <a-layout-header class="hdr">
        <div class="hdr-inner">
          <div class="brand">
            <div class="logo">
              <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="40" height="40" rx="8" fill="rgba(255,255,255,0.18)"/>
                <path d="M12 12H28V16H16V20H28V28H12V12Z" fill="white"/>
              </svg>
            </div>
            <div class="brand-text">
              <div class="brand-title">创新中心管理平台</div>
              <div class="brand-sub">Innovation Center Management</div>
            </div>
          </div>
          <div class="hdr-right">
            <a-space :size="16">
              <div class="date-widget">
                <div class="date-day">{{ dayOfWeek }}</div>
                <div class="date-full">{{ today }}</div>
              </div>
              <a-avatar class="user-avatar" size="large">管</a-avatar>
            </a-space>
          </div>
        </div>
      </a-layout-header>
      <a-layout>
        <a-layout-sider width="240" theme="light" class="sider">
          <div class="sider-content">
            <a-menu
              :selectedKeys="[$route.name]"
              mode="inline"
              @click="({key}) => $router.push({name: key})"
            >
              <a-menu-item key="Dashboard">
                <template #icon><dashboard-outlined /></template>
                <span>数据概览</span>
              </a-menu-item>
              <a-menu-item key="Attendance">
                <template #icon><clock-circle-outlined /></template>
                <span>考勤管理</span>
              </a-menu-item>
              <a-menu-item key="Projects">
                <template #icon><project-outlined /></template>
                <span>项目管理</span>
              </a-menu-item>
              <a-menu-item key="Allocation">
                <template #icon><partition-outlined /></template>
                <span>项目分配</span>
              </a-menu-item>
              <a-menu-item key="Employees">
                <template #icon><team-outlined /></template>
                <span>人员管理</span>
              </a-menu-item>
              <a-menu-item key="Analytics">
                <template #icon><bar-chart-outlined /></template>
                <span>统计分析</span>
              </a-menu-item>
            </a-menu>
          </div>
        </a-layout-sider>
        <a-layout-content class="main-content">
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
import 'dayjs/locale/zh-cn';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import {
  DashboardOutlined, ClockCircleOutlined, ProjectOutlined,
  PartitionOutlined, TeamOutlined, BarChartOutlined,
} from '@ant-design/icons-vue';

dayjs.locale('zh-cn');

const today = computed(() => dayjs().format('YYYY年MM月DD日'));
const dayOfWeek = computed(() => dayjs().format('dddd'));

const theme = {
  token: {
    colorPrimary: '#0074C4',
    colorInfo: '#0074C4',
    colorSuccess: '#10B981',
    colorWarning: '#F59E0B',
    colorError: '#EF4444',
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
  background: linear-gradient(135deg, #0074C4 0%, #0066AA 50%, #005A9E 100%);
  height: auto;
  box-shadow: 0 4px 16px rgba(0, 90, 158, 0.2);
  position: relative;
  z-index: 10;
}

.hdr-inner {
  padding: 0 32px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  color: #fff;
}

.logo {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
}

.logo svg {
  width: 100%;
  height: 100%;
  display: block;
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.5px;
}

.brand-sub {
  font-size: 11px;
  opacity: 0.75;
  letter-spacing: 1px;
  margin-top: 2px;
}

.hdr-right {
  display: flex;
  align-items: center;
}

.date-widget {
  text-align: right;
  color: rgba(255, 255, 255, 0.95);
}

.date-day {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
}

.date-full {
  font-size: 12px;
  opacity: 0.8;
  margin-top: 2px;
}

.user-avatar {
  background: rgba(255, 255, 255, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.3);
  font-weight: 700;
  backdrop-filter: blur(4px);
}

.sider {
  background: #fff !important;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.04);
  padding-top: 12px;
  height: calc(100vh - 72px);
  overflow-y: auto;
  overflow-x: hidden;
}

.sider-content {
  padding: 8px 0;
}

:deep(.ant-menu-inline) {
  border-inline-end: none !important;
}

:deep(.ant-menu-item) {
  margin: 4px 14px !important;
  width: calc(100% - 28px) !important;
  border-radius: 10px !important;
  height: 44px !important;
  line-height: 44px !important;
}

:deep(.ant-menu-item .anticon) {
  font-size: 17px;
}

.main-content {
  overflow-y: auto;
  height: calc(100vh - 72px);
  background: var(--bg);
}
</style>

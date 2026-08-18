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
              <a-button class="export-btn" @click="exportModal.open = true">导出领导看板</a-button>
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
              <a-menu-item key="DataOps">
                <template #icon><database-outlined /></template>
                <span>数据及审批</span>
              </a-menu-item>
              <a-menu-item key="AttendanceBoard">
                <template #icon><clock-circle-outlined /></template>
                <span>考勤看板</span>
              </a-menu-item>
              <a-menu-item key="ProjectBoard">
                <template #icon><project-outlined /></template>
                <span>项目看板</span>
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
      <a-modal v-model:open="exportModal.open" title="导出领导看板" ok-text="生成单一 HTML" @ok="exportReport">
        <a-form layout="vertical"><a-form-item label="汇报标题"><a-input v-model:value="exportModal.title" /></a-form-item><a-form-item label="数据日期范围"><a-range-picker v-model:value="exportModal.range" :allow-clear="false" style="width:100%" /></a-form-item><a-alert type="info" show-icon message="将生成完全离线、只读的综合看板 HTML，可直接发送给领导。" /></a-form>
      </a-modal>
    </a-layout>
  </a-config-provider>
</template>

<script setup>
import { computed, reactive } from 'vue';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import {
  DatabaseOutlined, ClockCircleOutlined, ProjectOutlined,
} from '@ant-design/icons-vue';

dayjs.locale('zh-cn');

const today = computed(() => dayjs().format('YYYY年MM月DD日'));
const dayOfWeek = computed(() => dayjs().format('dddd'));
const exportModal = reactive({ open: false, title: '创新中心运营看板', range: [dayjs().subtract(30, 'day'), dayjs()] });
function exportReport() {
  const params = new URLSearchParams({ title: exportModal.title, startDate: exportModal.range[0].format('YYYY-MM-DD'), endDate: exportModal.range[1].format('YYYY-MM-DD') });
  window.location.href = `/api/analytics/leadership-report?${params}`;
  exportModal.open = false;
}

const theme = {
  token: {
    colorPrimary: '#7C6CF2',
    colorInfo: '#7C6CF2',
    colorSuccess: '#55CDB1',
    colorWarning: '#F2C75C',
    colorError: '#F3789B',
    colorText: '#302D47',
    colorTextSecondary: '#77738B',
    colorBorder: '#EBE9F2',
    colorBgLayout: '#F8F8FC',
    borderRadius: 10,
    fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", Segoe UI, Roboto, sans-serif',
  },
  components: {
    Menu: {
      itemSelectedBg: '#EEEAFE',
      itemSelectedColor: '#6656DF',
      itemHoverBg: '#F8F6FF',
    },
  },
};
</script>

<style scoped>
.hdr {
  background: linear-gradient(120deg, #8171F4 0%, #7563EC 55%, #A597F7 100%);
  height: auto;
  box-shadow: 0 5px 20px rgba(103, 86, 223, 0.20);
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
.export-btn{color:#6656DF;border:0;background:#fff;box-shadow:0 4px 14px rgba(54,40,135,.16);font-weight:600}

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
  background: #FFFEFF !important;
  box-shadow: 3px 0 18px rgba(74, 64, 126, 0.055);
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

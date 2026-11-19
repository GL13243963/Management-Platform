<template>
  <router-view v-if="$route.meta.authShell || $route.meta.osShell" />
  <a-config-provider v-else :locale="zhCN" :theme="theme">
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
              <div class="brand-title">创新中心 OS · 运营平台</div>
              <div class="brand-sub">INNOVATION CENTER OS · OPERATIONS</div>
            </div>
          </div>
          <div class="hdr-right">
            <a-space :size="16">
              <button class="os-home-button" type="button" @click="$router.push('/os')">
                <appstore-outlined />
                <span>OS 主页</span>
              </button>
              <div class="date-widget">
                <div class="date-day">{{ dayOfWeek }}</div>
                <div class="date-full">{{ today }}</div>
              </div>
              <a-dropdown placement="bottomRight">
                <button class="user-menu-button" type="button">
                  <a-avatar class="user-avatar" size="large">{{ userInitial }}</a-avatar>
                  <span class="user-name">{{ auth.user?.username }}</span>
                </button>
                <template #overlay>
                  <a-menu @click="handleUserMenu">
                    <a-menu-item key="password"><lock-outlined /> 修改密码</a-menu-item>
                    <a-menu-divider />
                    <a-menu-item key="logout"><logout-outlined /> 退出登录</a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
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
              <a-menu-item v-if="auth.isAdmin" key="DataOps">
                <template #icon><database-outlined /></template>
                <span>数据及审批</span>
              </a-menu-item>
              <a-menu-item v-if="auth.isAdmin || auth.isLeader" key="AttendanceBoard">
                <template #icon><clock-circle-outlined /></template>
                <span>考勤看板</span>
              </a-menu-item>
              <a-menu-item v-if="auth.hasRole('employee')" key="WeeklyReport">
                <template #icon><form-outlined /></template>
                <span>每周项目填报</span>
              </a-menu-item>
              <a-menu-item v-if="auth.isAdmin || auth.isTeamLeader" key="TeamReview">
                <template #icon><team-outlined /></template>
                <span>小组填报核对</span>
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
    </a-layout>
  </a-config-provider>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import {
  DatabaseOutlined, ClockCircleOutlined, ProjectOutlined, LockOutlined, LogoutOutlined,
  FormOutlined, TeamOutlined, AppstoreOutlined,
} from '@ant-design/icons-vue';
import { useAuthStore } from './stores/auth';

dayjs.locale('zh-cn');

const today = computed(() => dayjs().format('YYYY年MM月DD日'));
const dayOfWeek = computed(() => dayjs().format('dddd'));
const auth = useAuthStore();
const router = useRouter();
const userInitial = computed(() => String(auth.user?.username || '用').slice(0, 1));
async function handleUserMenu({ key }) {
  if (key === 'password') return router.push('/change-password');
  if (key === 'logout') { await auth.logout(); await router.replace('/login'); }
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
.os-home-button{display:flex;align-items:center;gap:7px;padding:8px 13px;border:1px solid rgba(255,255,255,.32);border-radius:9px;background:rgba(255,255,255,.12);color:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:.2s ease}.os-home-button:hover{background:rgba(255,255,255,.22);transform:translateY(-1px)}.os-home-button:focus-visible{outline:2px solid #fff;outline-offset:2px}
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

.user-menu-button{display:flex;align-items:center;gap:9px;padding:0;border:0;background:transparent;color:#fff;cursor:pointer}.user-name{font-size:14px;font-weight:600}.user-menu-button:focus-visible{outline:2px solid #fff;outline-offset:4px;border-radius:8px}

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

@media(max-width:760px){.hdr-inner{padding:0 12px}.brand-sub,.date-widget,.user-name,.os-home-button span{display:none}.os-home-button{padding:8px}.sider{width:72px!important;min-width:72px!important;max-width:72px!important;flex:0 0 72px!important}.sider :deep(.ant-menu-title-content){display:none}.main-content{min-width:0}.brand-title{font-size:15px}.logo{width:38px;height:38px}}
</style>

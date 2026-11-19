<template>
  <section class="overview" aria-labelledby="activity-title">
    <div class="overview-header">
      <h2 id="activity-title">运行概览</h2>
      <a-button size="small" :loading="loading" @click="load">刷新</a-button>
    </div>
    <p v-if="error" role="status" class="error-note">{{ error }}</p>
    <p v-else-if="!data" role="status">正在读取访问统计…</p>
    <template v-if="data">
      <dl class="metrics">
        <div><dt>最近 5 分钟活跃</dt><dd>{{ data.activeUsers.length }} 人</dd></div>
        <div><dt>昨日访客 · {{ data.yesterday.date }}</dt><dd>{{ countLabel(data.yesterday.count) }}</dd></div>
        <div><dt>上周访客 · {{ data.lastWeek.start }} 至 {{ data.lastWeek.end }}</dt><dd>{{ countLabel(data.lastWeek.count) }}</dd></div>
      </dl>
      <details>
        <summary>查看活跃账号与每日访客</summary>
        <div class="breakdown">
          <section>
            <h3>活跃账号</h3>
            <p v-if="!data.activeUsers.length">最近 5 分钟没有符合条件的账号。</p>
            <ul v-else>
              <li v-for="user in data.activeUsers" :key="user.username">
                <span>{{ user.name && user.name !== user.username ? user.name + '（' + user.username + '）' : user.username }}</span>
                <time :datetime="user.lastSeen">{{ formatTime(user.lastSeen) }}</time>
              </li>
            </ul>
          </section>
          <section>
            <h3>上周每日访客</h3>
            <ul>
              <li v-for="day in data.lastWeek.days" :key="day.date">
                <time :datetime="day.date">{{ day.date }}</time><span>{{ countLabel(day.count) }}</span>
              </li>
            </ul>
          </section>
        </div>
      </details>
      <p class="note">按北京时间和账号去重。活跃账号须仍登录，且最近 5 分钟有成功的平台请求。更新时间 {{ formatTime(data.asOf) }}。</p>
    </template>
  </section>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import api from '../api';

const data = ref(null);
const error = ref('');
const loading = ref(false);
let timer;
const clock = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const formatTime = value => clock.format(new Date(value));
const countLabel = count => count == null ? '统计积累中' : count + ' 人';

async function load() {
  if (loading.value) return;
  loading.value = true;
  try {
    data.value = await api.get('/os/v1/app-management/activity');
    error.value = '';
  } catch (err) {
    data.value = null;
    error.value = err.httpStatus === 404 ? '运行概览需要新版主平台后端。' : '暂时无法读取运行概览，请刷新重试。';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  timer = setInterval(() => { if (!document.hidden) load(); }, 60000);
});
onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.overview { margin-bottom: 24px; padding: 20px 24px; border: 1px solid #ebe9f2; border-radius: 18px; background: white; }
.overview-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
h2 { margin: 0; font-size: 19px; }
h3 { font-size: 14px; }
.metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 14px 0; }
.metrics div { background: #f6f5fc; border-radius: 10px; padding: 10px 12px; }
dt, .note { color: #625e76; font-size: 12px; }
dd { margin: 4px 0 0; font-size: 18px; font-weight: 650; }
summary { cursor: pointer; color: #5b4ac5; font-weight: 600; }
.breakdown { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-top: 12px; }
ul { margin: 0; padding: 0; list-style: none; }
li { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-bottom: 1px solid #f0eef6; overflow-wrap: anywhere; }
time { white-space: nowrap; }
.note { margin: 8px 0 0; }
.error-note { color: #a33d45; }
@media (max-width: 650px) { .metrics, .breakdown { grid-template-columns: minmax(0, 1fr); } }
</style>

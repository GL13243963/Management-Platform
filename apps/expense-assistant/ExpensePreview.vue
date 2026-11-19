<script setup>
import { computed, reactive, ref } from 'vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import { executionTask } from '@prototype/browser-agent/runner.js';
import ExpenseLogin from './ExpenseLogin.vue';
import PilotGuide from './PilotGuide.vue';

const theme = { token: {
  colorPrimary: '#7C6CF2', colorInfo: '#7C6CF2', colorText: '#302D47',
  colorTextSecondary: '#77738B', colorBorder: '#EBE9F2', borderRadius: 10,
} };
const details = reactive({ employeeName: '', projectNumber: '', projectName: '' });
const files = ref([]);
const materials = ref(null);
const confirmed = ref(false);
const draftSaved = ref(false);
const task = ref(null);
const pilot = import.meta.env.MODE === 'os-pilot';
const busy = ref(false);
const error = ref('');
const steps = ['准备材料', '核对票据', '企业登录', '草稿回执'].map(title => ({ title }));
const stage = computed(() => draftSaved.value ? 3 : confirmed.value ? 2 : materials.value ? 1 : 0);

function selectFiles(event) {
  files.value = Array.from(event.target.files);
  materials.value = null;
  confirmed.value = false;
  draftSaved.value = false;
  error.value = '';
}

async function analyze() {
  if (busy.value) return;
  error.value = '';
  if (Object.values(details).some(value => !value.trim()) || !files.value.length) {
    error.value = '请填写完整的报销信息，并选择发票和行程单。';
    return;
  }
  busy.value = true;
  try {
    const { analyzeMaterials } = await import('./materials.js');
    materials.value = await analyzeMaterials(files.value);
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}

function confirmMaterials() {
  error.value = '';
  try {
    const trimmedDetails = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value.trim()]));
    task.value = executionTask(trimmedDetails, materials.value.matches);
    confirmed.value = true;
  } catch (cause) {
    error.value = cause.message;
  }
}

function editMaterials() {
  confirmed.value = false;
  draftSaved.value = false;
  materials.value = null;
  error.value = '';
}
</script>

<template>
  <a-config-provider :theme="theme" :locale="zhCN">
    <header class="topbar">
      <strong>创新中心 OS</strong>
      <span>填单助手 · {{ pilot ? '测试版' : '验收预览' }}</span>
      <a-button v-if="pilot" class="return-home" href="/#/os">返回 OS 首页</a-button>
    </header>
    <main class="page expense-page">
      <h1 class="page-title">通用报销单填报</h1>
      <p class="page-subtitle" v-if="pilot">核对电子发票和行程单后，由本人扫码登录。助手自动填表并保存草稿，审批由本人提交。</p>
      <p class="page-subtitle" v-else>核对电子发票和行程单后，由本人登录企业报账系统。助手保存草稿，审批由本人提交。</p>
      <PilotGuide v-if="pilot" />
      <section class="card" aria-label="填报进度">
        <a-steps :current="stage" :items="steps" size="small" />
      </section>

      <section class="card">
        <h2>报销信息</h2>
        <a-form layout="vertical" :model="details" @finish="analyze"
          @finish-failed="error = '请填写完整的报销信息，并选择发票和行程单。'">
          <div class="fields">
            <a-form-item label="报销人" name="employeeName" required>
              <a-input v-model:value="details.employeeName" :maxlength="30" :disabled="busy || !!materials" />
            </a-form-item>
            <a-form-item label="项目编号" name="projectNumber" required>
              <a-input v-model:value="details.projectNumber" :maxlength="30" :disabled="busy || !!materials" />
            </a-form-item>
            <a-form-item label="项目名称" name="projectName" required>
              <a-input v-model:value="details.projectName" :maxlength="80" :disabled="busy || !!materials" />
            </a-form-item>
          </div>
          <div class="file-field">
            <label for="pdfs">发票和行程单 PDF</label>
            <input id="pdfs" type="file" accept=".pdf,application/pdf" multiple :disabled="busy || !!materials" @change="selectFiles">
            <span>每单 1–10 张电子发票，单个文件最多 20 MB。</span>
          </div>
          <a-button v-if="!materials" type="primary" html-type="submit" :loading="busy">识别材料</a-button>
          <a-button v-else @click="editMaterials">返回修改</a-button>
        </a-form>
      </section>

      <section v-if="materials" class="card">
        <h2>核对票据</h2>
        <a-alert v-if="materials.unused.length" type="warning" show-icon
          :message="`未纳入本次填报的文件：${materials.unused.join('、')}`" />
        <article v-for="(match, index) in materials.matches" :key="index" class="ticket">
          <h3>{{ match.invoice.fileName }} · ¥{{ Number(match.invoice.total).toFixed(2) }}</h3>
          <p>{{ match.itinerary?.fileName || match.reason }}</p>
          <div v-if="match.itinerary" class="fields">
            <label>出发城市<a-input v-model:value="match.origin" :disabled="confirmed" /></label>
            <label>到达城市<a-input v-model:value="match.destination" :disabled="confirmed" /></label>
            <label>出发日期<input v-model="match.dateFrom" class="ant-input" type="date" :disabled="confirmed"></label>
            <label>到达日期<input v-model="match.dateTo" class="ant-input" type="date" :disabled="confirmed"></label>
            <label class="full">行程备注<a-input v-model:value="match.remark" :maxlength="60" :disabled="confirmed" /></label>
          </div>
        </article>
        <a-button v-if="!confirmed" type="primary" @click="confirmMaterials">确认材料</a-button>
      </section>

      <a-alert v-if="error" type="error" show-icon :message="error" />
      <section v-if="confirmed" class="card">
        <h2>企业登录</h2>
        <ExpenseLogin :task="task" :files="files" @saved="draftSaved = true" />
      </section>
    </main>
  </a-config-provider>
</template>

<style scoped>
.topbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 20px; padding: 16px 32px; background: white; border-bottom: 1px solid var(--border); }
.topbar strong { color: var(--brand-dark); }
.topbar span, .file-field span, .ticket p { color: var(--muted); font-size: 13px; }
.return-home { margin-inline-start: auto; }
.expense-page { max-width: 1064px; margin: auto; }
h2 { color: var(--ink); font-size: 16px; margin: 0 0 16px; }
h3 { color: var(--ink); font-size: 14px; overflow-wrap: anywhere; }
.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
.fields label, .file-field { display: grid; gap: 6px; }
.file-field { margin: 0 0 18px; }
.file-field input { max-width: 100%; }
.ticket { padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.full { grid-column: 1 / -1; }
@media (max-width: 600px) {
  .expense-page, .topbar { padding: 16px; }
  .fields { grid-template-columns: 1fr; }
}
</style>

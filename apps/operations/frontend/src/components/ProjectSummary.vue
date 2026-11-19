<template>
  <a-spin :spinning="loadingOptions">
    <a-alert v-if="loadError" type="error" show-icon :message="loadError">
      <template #action><a-button size="small" @click="loadOptions">重试</a-button></template>
    </a-alert>
    <a-empty v-else-if="!loadingOptions && !options.length" description="暂无可总结的项目。请管理员核对项目负责人。" />
    <template v-else-if="options.length">
      <a-form layout="vertical" :disabled="generating || importing" @finish="generate">
        <div class="summary-fields">
          <a-form-item label="项目名称">
            <a-select v-model:value="projectId" show-search option-filter-prop="label"
              :options="options" placeholder="搜索项目名称或单号" @change="selectProject" />
          </a-form-item>
          <a-form-item label="实际开始日期">
            <a-date-picker v-model:value="startDate" value-format="YYYY-MM-DD" />
          </a-form-item>
          <a-form-item label="实际结束日期">
            <a-date-picker v-model:value="endDate" value-format="YYYY-MM-DD" />
          </a-form-item>
        </div>
        <a-form-item label="导入 Excel 进度表">
          <a-upload accept=".xlsx" :show-upload-list="false" :before-upload="importProgress">
            <a-button :loading="importing" :disabled="!projectId">选择 Excel</a-button>
          </a-upload>
          <span v-if="importName" class="import-name">{{ importName }}</span>
          <a-alert v-if="importError" class="import-feedback" type="error" show-icon :message="importError" />
          <details v-if="imported.length" class="import-feedback">
            <summary>查看 {{ imported.length }} 条导入节点</summary>
            <ol class="milestones">
              <li v-for="(item, index) in imported" :key="index">{{ item.date }} · {{ item.title }}</li>
            </ol>
          </details>
        </a-form-item>
        <a-form-item label="项目进度表" extra="从 Excel 复制含表头的区域。至少需要「里程碑」「日期」两列，可加「说明」。">
          <a-textarea v-model:value="progressTable" :rows="5" :maxlength="24000" :placeholder="example" />
        </a-form-item>
        <div class="summary-actions">
          <a-checkbox v-model:checked="confirmed">{{ imported.length ? '我确认项目已结束，导入日期和节点符合实际' : '我确认这个项目已结束' }}</a-checkbox>
          <a-button type="primary" html-type="submit" :loading="generating" :disabled="!canGenerate">生成项目总结</a-button>
        </div>
      </a-form>
      <a-alert v-if="error" class="summary-result" type="error" show-icon :message="error" />
      <article v-if="report" class="summary-result" aria-live="polite">
        <h2>{{ report.project.name }}</h2>
        <p>{{ report.startDate }} 至 {{ report.endDate }} · 负责人：{{ report.project.manager || '未登记' }}</p>
        <dl class="summary-metrics">
          <div><dt>项目历时</dt><dd>{{ report.durationDays }} 天</dd></div>
          <div><dt>累计项目工时</dt><dd>{{ fmtHours(report.totalHours) }} 小时</dd></div>
          <div><dt>有项目工时的日期</dt><dd>{{ report.attendanceDays }} 天</dd></div>
          <div><dt>工时最大贡献者</dt><dd>{{ topContributors }}</dd></div>
          <div><dt>最晚下班打卡</dt><dd v-if="report.latestPunch">{{ report.latestPunch.time }} · {{ report.latestPunch.name }}<small>{{ report.latestPunch.date }}</small></dd><dd v-else>暂无记录</dd></div>
        </dl>
        <p class="summary-note">工时按参与者当天考勤及项目分配比例计算。最晚打卡只比较有项目工时的日期，显示当日下班时刻，无法区分当天打卡对应的具体项目。</p>
        <div class="summary-details">
          <section>
            <h3>项目里程碑</h3>
            <ol class="milestones">
              <li v-for="(item, index) in report.milestones" :key="index">
                <time :datetime="item.date">{{ item.date }}</time> <b>{{ item.title }}</b>
                <div v-if="item.note">{{ item.note }}</div>
              </li>
            </ol>
          </section>
          <section>
            <h3>人员工时</h3>
            <a-table :data-source="report.members" :columns="memberColumns" row-key="id" size="small" :pagination="false">
              <template #bodyCell="{ column, record }">
                <template v-if="column.dataIndex === 'hours'">{{ fmtHours(record.hours) }}</template>
              </template>
            </a-table>
          </section>
        </div>
      </article>
    </template>
  </a-spin>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import api from '../api';
import { fmtHours } from '../lib/format';

const projects = ref([]);
const projectId = ref(null);
const startDate = ref(null);
const endDate = ref(null);
const progressTable = ref('');
const importing = ref(false);
const imported = ref([]);
const importName = ref('');
const importError = ref('');
const confirmed = ref(false);
const loadingOptions = ref(true);
const generating = ref(false);
const loadError = ref('');
const error = ref('');
const report = ref(null);

const example = '里程碑\t日期\t说明\n方案评审\t2026-09-18\t评审通过';
const memberColumns = [
  { title: '姓名', dataIndex: 'name' },
  { title: '项目工时（小时）', dataIndex: 'hours', align: 'right' },
  { title: '有工时天数', dataIndex: 'days', align: 'right' },
];
const options = computed(() => projects.value.map(project => ({
  value: project.id, label: project.code ? project.name + '（' + project.code + '）' : project.name,
})));
const canGenerate = computed(() => projectId.value && startDate.value && endDate.value && confirmed.value && progressTable.value.trim());
const topContributors = computed(() => report.value?.topContributors.length
  ? report.value.topContributors.map(person => person.name).join('、') + ' · ' + fmtHours(report.value.topContributors[0].hours) + ' 小时'
  : '暂无工时');

async function loadOptions() {
  loadingOptions.value = true;
  loadError.value = '';
  try { projects.value = await api.get('/projects/summary-options'); }
  catch (err) { loadError.value = err.httpStatus === 404 ? '项目总结需要更新后的 V2 后端' : err.error || '无法加载项目列表'; }
  finally { loadingOptions.value = false; }
}

function selectProject(id) {
  startDate.value = projects.value.find(project => project.id === id)?.startDate || null;
  endDate.value = null;
  confirmed.value = false;
  progressTable.value = '';
  imported.value = [];
  importName.value = '';
  importError.value = '';
}
watch([projectId, startDate, endDate, progressTable, confirmed], () => {
  report.value = null;
  error.value = '';
});

async function importProgress(file) {
  if (importing.value || !projectId.value) return false;
  importing.value = true;
  importError.value = '';
  try {
    const { readProgressPlan } = await import('../lib/progress-plan.mjs');
    const result = await readProgressPlan(file);
    imported.value = result.items;
    importName.value = file.name;
    progressTable.value = result.table;
    startDate.value = result.items[0].date;
    endDate.value = result.items.at(-1).date;
    confirmed.value = false;
  } catch (err) {
    importError.value = err.message || '无法读取 Excel 进度表';
  } finally {
    importing.value = false;
  }
  return false;
}
watch(progressTable, () => {
  if (imported.value.length && progressTable.value !== importedTable()) {
    imported.value = [];
    importName.value = '';
    confirmed.value = false;
  }
});
function importedTable() {
  return ['里程碑\t日期', ...imported.value.map(item => item.title + '\t' + item.date)].join('\n');
}

async function generate() {
  if (!canGenerate.value || generating.value) return;
  report.value = null;
  error.value = '';
  generating.value = true;
  try {
    report.value = await api.post('/projects/' + projectId.value + '/summary', {
      startDate: startDate.value, endDate: endDate.value,
      confirmed: confirmed.value, progressTable: progressTable.value,
    });
  } catch (err) { error.value = err.error || '项目总结生成失败'; }
  finally { generating.value = false; }
}

onMounted(loadOptions);
</script>

<style scoped>
.import-name { margin-left: 12px; overflow-wrap: anywhere; }
.import-feedback { margin-top: 8px; }
.import-feedback summary { cursor: pointer; }
.import-feedback ol { max-height: 200px; overflow: auto; }
.summary-fields { display: grid; grid-template-columns: minmax(200px, 2fr) repeat(2, minmax(150px, 1fr)); gap: 12px; }
.summary-fields :deep(.ant-picker) { width: 100%; }
.summary-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.summary-result { margin-top: 24px; }
article.summary-result { border-top: 1px solid #e9e6f2; padding-top: 20px; }
.summary-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: 10px; }
.summary-metrics div { background: #f6f5fc; border-radius: 8px; padding: 12px; }
.summary-metrics dt, .summary-note { color: var(--muted, #595569); font-size: 12px; }
.summary-metrics dd { margin: 4px 0 0; font-weight: 650; overflow-wrap: anywhere; }
.summary-metrics small { display: block; font-weight: 400; }
.summary-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.milestones { padding-left: 20px; }
.milestones li { margin-bottom: 10px; overflow-wrap: anywhere; }
.milestones time { color: var(--muted, #595569); margin-right: 4px; }
@media (max-width: 680px) { .summary-fields, .summary-details { grid-template-columns: minmax(0, 1fr); } }
</style>

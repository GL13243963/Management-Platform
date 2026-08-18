<template>
  <div class="page">
    <h1 class="page-title">项目看板</h1>
    <p class="page-subtitle">人员及项目分配图谱 · 项目工时 · 完成进度与风险</p>

    <DataDateBanner :range="range" />

    <div class="card toolbar-card">
      <a-space wrap>
        <a-upload name="file" :custom-request="handleImport" :show-upload-list="false" accept=".xlsx,.xls">
          <a-button><template #icon><upload-outlined /></template>导入分配表</a-button>
        </a-upload>
        <a-button type="primary" @click="openNew"><template #icon><plus-outlined /></template>新建项目</a-button>
        <a-button v-if="selectedKey" @click="clearSelection">显示全部关系</a-button>
      </a-space>
      <a-range-picker v-model:value="range" @change="load" style="width: 300px" />
    </div>

    <a-alert
      v-if="importResult"
      :type="importResult.employeesNotFound?.length ? 'warning' : 'success'"
      show-icon
      closable
      style="margin-bottom: 18px"
      :message="`分配表导入完成：${importResult.periods?.join('、')} · 新增 ${importResult.created} · 更新 ${importResult.updated} · 清理 ${importResult.removed}`"
      :description="importResult.employeesNotFound?.length
        ? `未匹配员工：${importResult.employeesNotFound.join('、')}`
        : '最新分配表已同步到人员与项目关系图谱'"
      @close="importResult = null"
    />

    <div class="resource-stats">
      <div class="resource-stat"><span>本期分摊工时</span><b>{{ fmtHours(graph.summary.totalAllocatedHours) }}</b></div>
      <div class="resource-stat"><span>活跃项目</span><b>{{ graph.summary.activeProjectCount }}</b></div>
      <div class="resource-stat warning"><span>多项目人员</span><b>{{ graph.summary.multiProjectEmployeeCount }}</b></div>
      <div class="resource-stat danger"><span>未分配工时人员</span><b>{{ graph.summary.unallocatedEmployeeCount }}</b></div>
      <div class="resource-stat"><span>零工时关系</span><b>{{ graph.summary.zeroHourRelationCount }}</b></div>
    </div>

    <div v-if="riskMessages.length" class="risk-strip">
      <a-tag v-for="risk in riskMessages" :key="risk.text" :color="risk.color">{{ risk.text }}</a-tag>
    </div>

    <div class="card resource-panel">
      <a-tabs v-model:activeKey="activeView" @change="onViewChange">
        <a-tab-pane key="graph" tab="人员—项目图谱">
          <div class="graph-guide">
            <span><i class="legend-dot planning"></i>规划组</span>
            <span><i class="legend-dot architecture"></i>方案组</span>
            <span><i class="legend-dot ungrouped"></i>未分组人员</span>
            <span><i class="legend-dot project"></i>项目（颜色循环使用）</span>
            <span><i class="legend-line"></i>线色对应项目</span>
            <span><i class="legend-line dashed"></i>有分配但本期零工时</span>
            <span>点击人员聚焦关系；点击项目填写完成进度</span>
          </div>
          <div ref="resourceChart" class="resource-chart" :style="{ height: `${chartHeight}px` }"></div>
          <a-empty v-if="!graph.links.length" description="所选周期暂无人员—项目分配关系" />
        </a-tab-pane>

        <a-tab-pane key="matrix" tab="工时热力矩阵">
          <div class="matrix-note">颜色越深代表分摊工时越高；点击有数值的单元格可聚焦该人员或项目。</div>
          <div class="matrix-scroll">
            <table class="heat-matrix">
              <thead><tr><th class="sticky-col">人员</th><th v-for="project in matrixProjects" :key="project.id">{{ project.name }}</th><th>合计</th></tr></thead>
              <tbody>
                <tr v-for="employee in matrixEmployees" :key="employee.id">
                  <th class="sticky-col clickable" @click="selectNode(`employee-${employee.id}`)">{{ employee.name }}</th>
                  <td
                    v-for="project in matrixProjects"
                    :key="project.id"
                    :style="heatStyle(linkFor(employee.id, project.id)?.hours || 0)"
                    :class="{ clickable: linkFor(employee.id, project.id) }"
                    @click="linkFor(employee.id, project.id) && selectNode(`project-${project.id}`)"
                  >
                    {{ linkFor(employee.id, project.id) ? fmtHours(linkFor(employee.id, project.id).hours) : '—' }}
                  </td>
                  <td class="total-cell">{{ fmtHours(employee.allocatedHours) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </a-tab-pane>

        <a-tab-pane key="projects" tab="项目工时卡片">
          <div class="project-grid">
            <div v-for="project in sortedProjects" :key="project.id" class="project-work-card" @click="selectNode(`project-${project.id}`)">
              <div class="project-card-head"><b>{{ project.name }}</b><a-tag :color="project.singlePointRisk ? 'warning' : 'blue'">{{ project.memberCount }} 人</a-tag></div>
              <div class="project-hours">{{ fmtHours(project.hours) }}</div>
              <div class="project-meta"><span>人工成本</span><b>¥{{ formatMoney(project.cost) }}</b></div>
              <div class="project-meta"><span>最高贡献者</span><b>{{ project.topContributor || '—' }}</b></div>
              <div class="project-meta"><span>最高贡献占比</span><b :class="{ risk: project.singlePointRisk }">{{ project.dependencyRate }}%</b></div>
            </div>
          </div>
        </a-tab-pane>

        <a-tab-pane key="detail" tab="项目明细">
          <a-table :data-source="rows" :columns="cols" row-key="id" size="middle">
            <template #bodyCell="{ column, record }">
              <template v-if="column.dataIndex === 'memberNames'">
                <div class="tag-wrap"><a-tag v-for="name in record.memberNames || []" :key="name" color="blue">{{ name }}</a-tag><span v-if="!record.memberNames?.length">—</span></div>
              </template>
              <template v-if="column.dataIndex === 'totalHours'"><b>{{ fmtHours(record.totalHours) }}</b></template>
              <template v-if="column.dataIndex === 'status'"><a-tag :color="record.status === 'active' ? 'success' : 'default'">{{ record.status === 'active' ? '进行中' : '已归档' }}</a-tag></template>
              <template v-if="column.dataIndex === 'actions'">
                <a-button size="small" type="link" @click="edit(record)">编辑</a-button>
                <a-button size="small" type="link" danger @click="archive(record)">{{ record.status === 'active' ? '归档' : '恢复' }}</a-button>
              </template>
            </template>
          </a-table>
        </a-tab-pane>
      </a-tabs>
    </div>

    <a-modal v-model:open="modal.open" :title="modal.record?.id ? '编辑项目' : '新建项目'" @ok="submit" :width="720">
      <a-form layout="vertical"><a-row :gutter="16">
        <a-col :span="12"><a-form-item label="项目代码"><a-input v-model:value="modal.record.code" /></a-form-item></a-col>
        <a-col :span="12"><a-form-item label="项目名称"><a-input v-model:value="modal.record.name" /></a-form-item></a-col>
        <a-col :span="12"><a-form-item label="负责人"><a-input v-model:value="modal.record.manager" /></a-form-item></a-col>
        <a-col :span="12"><a-form-item label="开始日期"><a-date-picker v-model:value="modal.record.startDate" value-format="YYYY-MM-DD" style="width:100%" /></a-form-item></a-col>
        <a-col :span="24"><a-form-item label="描述"><a-textarea v-model:value="modal.record.description" :rows="2" /></a-form-item></a-col>
        <a-col v-if="!modal.record.id" :span="24"><a-form-item label="初始成员（勾选后可设置权重）">
          <a-table :data-source="employees" :columns="memberCols" :pagination="false" size="small" row-key="id" :row-selection="{ selectedRowKeys: memberSelection, onChange: keys => memberSelection = keys }">
            <template #bodyCell="{ column, record }"><template v-if="column.dataIndex === 'weight'"><a-input-number :min="0" :max="1" :step="0.1" :value="memberWeights[record.id] ?? 1" @change="v => memberWeights[record.id] = v" /></template></template>
          </a-table>
        </a-form-item></a-col>
      </a-row></a-form>
    </a-modal>

    <a-modal v-model:open="progressModal.open" title="项目进度" ok-text="保存进度" :confirm-loading="progressModal.loading" @ok="saveProjectProgress">
      <a-descriptions :column="1" bordered size="small" style="margin-bottom:18px">
        <a-descriptions-item label="项目名称">{{ progressModal.project?.name }}</a-descriptions-item>
        <a-descriptions-item label="当前周期">{{ rangeLabel }}</a-descriptions-item>
        <a-descriptions-item label="已产生工时总计"><b>{{ fmtHours(progressModal.project?.hours) }}</b></a-descriptions-item>
      </a-descriptions>
      <a-form layout="vertical"><a-form-item label="项目完成百分比">
        <a-input-number v-model:value="progressModal.completionPercent" :min="0" :max="100" :step="1" style="width:180px" /><span style="margin-left:8px">%</span>
      </a-form-item></a-form>
      <a-progress :percent="Number(progressModal.completionPercent || 0)" />
    </a-modal>

    <a-modal
      v-model:open="importModal.open"
      title="确认新项目处理方式"
      :width="760"
      :confirm-loading="importModal.loading"
      ok-text="确认并导入"
      cancel-text="取消导入"
      @ok="confirmImport"
      @cancel="cancelImport"
    >
      <a-alert type="info" show-icon message="以下名称在现有项目中不存在。请选择新建项目，或归并到一个已有项目。" style="margin-bottom:16px" />
      <a-table :data-source="importModal.unknownProjects" :columns="importProjectCols" :pagination="false" row-key="name" size="small">
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'action'">
            <a-radio-group v-model:value="importResolutions[record.name].action">
              <a-radio value="create">新建项目</a-radio>
              <a-radio value="merge">归并到已有项目</a-radio>
            </a-radio-group>
          </template>
          <template v-if="column.dataIndex === 'target'">
            <a-select
              v-model:value="importResolutions[record.name].projectId"
              show-search
              option-filter-prop="label"
              placeholder="选择归并目标"
              :disabled="importResolutions[record.name].action !== 'merge'"
              :options="importModal.existingProjects.map(project => ({ value: project.id, label: project.name }))"
              style="width:100%"
            />
          </template>
        </template>
      </a-table>
      <p style="margin-top:14px;color:var(--muted)">导入完成后，仍可在“项目明细 → 编辑”中手动修改项目名称。</p>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import * as echarts from 'echarts';
import { message } from 'ant-design-vue';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons-vue';
import api from '../api';
import { fmtHours } from '../lib/format';
import DataDateBanner from '../components/DataDateBanner.vue';

const EMPTY_GRAPH = { summary: { totalAllocatedHours: 0, activeProjectCount: 0, multiProjectEmployeeCount: 0, unallocatedEmployeeCount: 0, zeroHourRelationCount: 0, singlePointRiskCount: 0 }, employees: [], projects: [], links: [] };
const range = ref([dayjs().subtract(30, 'day'), dayjs()]);
const rows = ref([]);
const employees = ref([]);
const graph = ref(EMPTY_GRAPH);
const activeView = ref('graph');
const selectedKey = ref(null);
const resourceChart = ref(null);
const memberSelection = ref([]);
const memberWeights = reactive({});
const importResult = ref(null);
const modal = reactive({ open: false, record: {} });
const importModal = reactive({ open: false, loading: false, file: null, unknownProjects: [], existingProjects: [] });
const importResolutions = reactive({});
const progressModal = reactive({ open: false, loading: false, project: null, completionPercent: 0 });
let chart = null;

const cols = [
  { title: '代码', dataIndex: 'code', width: 110 }, { title: '名称', dataIndex: 'name', width: 180 },
  { title: '人员构成', dataIndex: 'memberNames' }, { title: '累计工时', dataIndex: 'totalHours', width: 110, sorter: (a, b) => a.totalHours - b.totalHours },
  { title: '开始日期', dataIndex: 'startDate', width: 120 }, { title: '状态', dataIndex: 'status', width: 90 },
  { title: '操作', dataIndex: 'actions', width: 140, fixed: 'right' },
];
const memberCols = [{ title: '姓名', dataIndex: 'name' }, { title: '部门', dataIndex: 'department' }, { title: '权重', dataIndex: 'weight', width: 120 }];
const importProjectCols = [
  { title: '表中新增名称', dataIndex: 'name', width: 190 },
  { title: '处理方式', dataIndex: 'action', width: 280 },
  { title: '归并目标', dataIndex: 'target' },
];
const matrixEmployees = computed(() => graph.value.employees.filter(item => item.projectCount || item.unallocatedHours));
const matrixProjects = computed(() => graph.value.projects.filter(item => item.memberCount));
const sortedProjects = computed(() => [...graph.value.projects].filter(item => item.memberCount || item.hours).sort((a, b) => b.hours - a.hours));
const maxMatrixHours = computed(() => Math.max(1, ...graph.value.links.map(link => link.hours)));
const chartHeight = computed(() => Math.max(520, Math.max(matrixEmployees.value.length, matrixProjects.value.length) * 58 + 90));
const riskMessages = computed(() => {
  const result = [];
  if (graph.value.summary.multiProjectEmployeeCount) result.push({ color: 'orange', text: `${graph.value.summary.multiProjectEmployeeCount} 人同时参与多个项目` });
  if (graph.value.summary.unallocatedEmployeeCount) result.push({ color: 'red', text: `${graph.value.summary.unallocatedEmployeeCount} 人存在未分配工时` });
  if (graph.value.summary.singlePointRiskCount) result.push({ color: 'gold', text: `${graph.value.summary.singlePointRiskCount} 个项目存在单点依赖` });
  if (graph.value.summary.zeroHourRelationCount) result.push({ color: 'default', text: `${graph.value.summary.zeroHourRelationCount} 条分配关系本期零工时` });
  return result;
});
const rangeLabel = computed(() => range.value?.length === 2 ? `${range.value[0].format('YYYY-MM-DD')} 至 ${range.value[1].format('YYYY-MM-DD')}` : '全部周期');

function params() { return { startDate: range.value?.[0]?.format('YYYY-MM-DD'), endDate: range.value?.[1]?.format('YYYY-MM-DD') }; }
async function load() {
  const p = params();
  [rows.value, employees.value, graph.value] = await Promise.all([
    api.get('/projects/overview', { params: p }), api.get('/employees'), api.get('/projects/resource-graph', { params: p }),
  ]);
  selectedKey.value = null;
  await nextTick();
  renderGraph();
}

function renderGraph() {
  if (!resourceChart.value || activeView.value !== 'graph') return;
  if (!chart) {
    chart = echarts.init(resourceChart.value);
    chart.on('click', event => {
      if (event.seriesType !== 'scatter' || !event.data?.kind) return;
      event.data.kind === '项目' ? openProjectProgress(event.data.meta) : selectNode(event.data.id);
    });
  }
  const people = matrixEmployees.value;
  const projects = matrixProjects.value;
  const connected = new Set();
  if (selectedKey.value) {
    connected.add(selectedKey.value);
    for (const link of graph.value.links) {
      const employeeKey = `employee-${link.employeeId}`, projectKey = `project-${link.projectId}`;
      if (employeeKey === selectedKey.value || projectKey === selectedKey.value) { connected.add(employeeKey); connected.add(projectKey); }
    }
  }
  const nodeOpacity = id => !selectedKey.value || connected.has(id) ? 1 : 0.16;
  const yAt = (index, count) => 60 + index * Math.max(50, (chartHeight.value - 120) / Math.max(1, count - 1));
  const peopleY = new Map(people.map((person, index) => [person.id, yAt(index, people.length)]));
  const projectsY = new Map(projects.map((project, index) => [project.id, yAt(index, projects.length)]));
  const projectColors = new Map(projects.map((project, index) => [project.id, projectColor(project, index)]));
  const peopleData = people.map(person => ({
    id: `employee-${person.id}`,
    name: person.name,
    value: [120, peopleY.get(person.id)],
    symbol: numberedCircleSymbol(person.projectCount, teamColor(person.team)),
    symbolSize: PERSON_NODE_SIZE,
    itemStyle: { opacity: nodeOpacity(`employee-${person.id}`), shadowBlur: 12, shadowColor: `${teamColor(person.team)}55` },
    meta: person,
    kind: '人员',
  }));
  const projectData = projects.map(project => {
    const color = projectColors.get(project.id);
    return {
      id: `project-${project.id}`,
      name: project.name,
      value: [860, projectsY.get(project.id)],
      symbol: projectProgressSymbol(project, color),
      symbolSize: PROJECT_NODE_SIZE,
      itemStyle: { opacity: nodeOpacity(`project-${project.id}`), shadowBlur: 10, shadowColor: `${color}55` },
      label: { color },
      meta: project,
      kind: '项目',
    };
  });
  const links = graph.value.links.filter(link => peopleY.has(link.employeeId) && projectsY.has(link.projectId)).map(link => {
    const source = `employee-${link.employeeId}`, target = `project-${link.projectId}`;
    const visible = !selectedKey.value || (connected.has(source) && connected.has(target));
    return {
      value: [120, peopleY.get(link.employeeId), 860, projectsY.get(link.projectId)],
      meta: link,
      kind: '关系',
      lineWidth: 1.6,
      lineOpacity: visible ? (link.hasActualHours ? 0.48 : 0.24) : 0.025,
      lineColor: projectColors.get(link.projectId),
      dashed: !link.hasActualHours,
    };
  });
  chart.setOption({
    animationDurationUpdate: 350,
    grid: { left: 0, right: 0, top: 0, bottom: 0, containLabel: false },
    xAxis: { type: 'value', min: 0, max: 980, show: false },
    yAxis: { type: 'value', min: 0, max: chartHeight.value, inverse: true, show: false },
    tooltip: { formatter: item => item.data.kind === '关系'
      ? `<b>${item.data.meta.employeeName} → ${item.data.meta.projectName}</b><br/>分摊工时：${fmtHours(item.data.meta.hours)}<br/>平均权重：${item.data.meta.weight}<br/>人工成本：¥${formatMoney(item.data.meta.cost)}`
      : item.data.kind === '人员'
        ? `<b>${item.data.name}</b><br/>总工时：${fmtHours(item.data.meta.totalHours)}<br/>分摊工时：${fmtHours(item.data.meta.allocatedHours)}<br/>参与项目：${item.data.meta.projectCount}`
        : `<b>${item.data.name}</b><br/>完成进度：${item.data.meta.completionPercent || 0}%<br/>已产生工时：${fmtHours(item.data.meta.hours)}<br/>参与人员：${item.data.meta.memberCount}<br/>点击填写项目进度` },
    series: [
      {
        name: '人员—项目关系',
        type: 'custom',
        coordinateSystem: 'cartesian2d',
        data: links,
        z: 1,
        renderItem(params, api) {
          const start = api.coord([api.value(0), api.value(1)]);
          const end = api.coord([api.value(2), api.value(3)]);
          const handle = (end[0] - start[0]) * 0.44;
          const shape = {
            x1: start[0], y1: start[1],
            cpx1: start[0] + handle, cpy1: start[1],
            cpx2: end[0] - handle, cpy2: end[1],
            x2: end[0], y2: end[1],
          };
          const link = links[params.dataIndex];
          return {
            type: 'group',
            children: [
              { type: 'bezierCurve', shape, style: { fill: null, stroke: 'rgba(0,0,0,0)', lineWidth: Math.max(10, link.lineWidth + 7) } },
              {
                type: 'bezierCurve',
                shape,
                style: { fill: null, stroke: link.lineColor, lineWidth: link.lineWidth, opacity: link.lineOpacity, lineDash: link.dashed ? [6, 5] : null, lineCap: 'round' },
                emphasis: { style: { opacity: 0.92, lineWidth: link.lineWidth } },
              },
            ],
          };
        },
      },
      {
        name: '人员',
        type: 'scatter',
        data: peopleData,
        z: 3,
        label: { show: true, formatter: '{b}', position: 'left', distance: 12, color: '#49455F', fontSize: 12, fontWeight: 600 },
        emphasis: { scale: false },
      },
      {
        name: '项目',
        type: 'scatter',
        data: projectData,
        z: 3,
        label: { show: true, formatter: '{b}', position: 'right', distance: 13, color: '#8E3F62', fontSize: 12, fontWeight: 600 },
        emphasis: { scale: false },
      },
    ],
  }, true);
  chart.resize();
}

function selectNode(key) { selectedKey.value = key; activeView.value = 'graph'; nextTick(renderGraph); }
function clearSelection() { selectedKey.value = null; renderGraph(); }
function onViewChange(key) { if (key === 'graph') nextTick(renderGraph); }
function linkFor(employeeId, projectId) { return graph.value.links.find(link => link.employeeId === employeeId && link.projectId === projectId); }
function heatStyle(hours) { const intensity = hours ? 0.12 + 0.7 * hours / maxMatrixHours.value : 0; return { background: hours ? `rgba(124,108,242,${intensity})` : '#FAF9FE', color: intensity > 0.48 ? '#fff' : '#49455F' }; }
function formatMoney(value) { return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }); }
function teamColor(team) { return team === '规划组' ? '#7C6CF2' : team === '方案组' ? '#55CDB1' : '#A9A5B8'; }
const PERSON_NODE_SIZE = 38;
const PROJECT_NODE_SIZE = 48;
const COMPLETED_PROJECT_COLOR = '#9CA3AF';
const PROJECT_COLORS = ['#E11D48', '#7C3AED', '#0891B2', '#059669', '#EA580C', '#4F46E5', '#C026D3', '#0F766E', '#CA8A04', '#2563EB'];
function projectColor(project, index) {
  if (Number(project.completionPercent) >= 100) return COMPLETED_PROJECT_COLOR;
  const seed = Number(project.id);
  return PROJECT_COLORS[(Number.isFinite(seed) ? Math.abs(seed) : index) % PROJECT_COLORS.length];
}
function numberedCircleSymbol(count, color) {
  const text = String(Math.max(0, Number(count) || 0));
  const fontSize = text.length > 2 ? 10 : 14;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="18" fill="${color}" stroke="#fff" stroke-width="3"/><text x="24" y="25" fill="#fff" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700">${text}</text></svg>`;
  return `image://data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
function projectProgressSymbol(project, color) {
  const percent = Math.max(0, Math.min(100, Number(project.completionPercent) || 0));
  const radius = 17, circumference = 2 * Math.PI * radius;
  const progress = circumference * percent / 100;
  const count = String(Math.max(0, Number(project.memberCount) || 0));
  const fontSize = count.length > 2 ? 9 : 13;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="13" fill="${color}"/><circle cx="24" cy="24" r="17" fill="none" stroke="${color}" stroke-opacity=".2" stroke-width="4"/><circle cx="24" cy="24" r="17" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${progress} ${circumference}" transform="rotate(-90 24 24)"/><text x="24" y="25" fill="#fff" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700">${count}</text></svg>`;
  return `image://data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
function openProjectProgress(project) { progressModal.project = project; progressModal.completionPercent = Number(project.completionPercent) || 0; progressModal.open = true; }
async function saveProjectProgress() {
  const value = Number(progressModal.completionPercent);
  if (!Number.isFinite(value) || value < 0 || value > 100) return message.warning('完成百分比必须在 0 到 100 之间');
  progressModal.loading = true;
  try { await api.put(`/projects/${progressModal.project.id}`, { completionPercent: value }); message.success('项目进度已保存'); progressModal.open = false; await load(); }
  finally { progressModal.loading = false; }
}

async function handleImport({ file, onSuccess, onError }) {
  const fd = allocationForm(file);
  try {
    const preview = await api.post('/projects/preview-allocations', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    if (!preview.unknownProjects.length) return executeImport(file, {}, onSuccess, onError);
    Object.keys(importResolutions).forEach(key => delete importResolutions[key]);
    preview.unknownProjects.forEach(name => { importResolutions[name] = { action: 'create', projectId: null }; });
    Object.assign(importModal, { open: true, file, unknownProjects: preview.unknownProjects.map(name => ({ name })), existingProjects: preview.existingProjects, onSuccess, onError });
  }
  catch (error) {
    const detail = error?.error || error?.message;
    message.error(detail || '导入预检失败，请重启服务后重试');
    onError?.(error);
  }
}
function allocationForm(file, resolutions) {
  const fd = new FormData();
  fd.append('file', file); fd.append('year', String(range.value?.[0]?.year() || dayjs().year()));
  if (resolutions) fd.append('resolutions', JSON.stringify(resolutions));
  return fd;
}
async function executeImport(file, resolutions, onSuccess, onError) {
  try {
    const result = await api.post('/projects/import-allocations', allocationForm(file, resolutions), { headers: { 'Content-Type': 'multipart/form-data' } });
    importResult.value = result; message.success(`导入成功（${result.year}年）`); onSuccess?.(result); await load();
  } catch (error) {
    message.error(error?.error || error?.message || '导入失败，请重启服务后重试');
    onError?.(error); throw error;
  }
}
async function confirmImport() {
  const missing = importModal.unknownProjects.find(({ name }) => importResolutions[name].action === 'merge' && !importResolutions[name].projectId);
  if (missing) return message.warning(`请为“${missing.name}”选择归并目标`);
  importModal.loading = true;
  try { await executeImport(importModal.file, { ...importResolutions }, importModal.onSuccess, importModal.onError); importModal.open = false; }
  catch {} finally { importModal.loading = false; }
}
function cancelImport() { importModal.file = null; }
function openNew() { modal.record = { code: '', name: '', manager: '', startDate: null, description: '' }; memberSelection.value = []; Object.keys(memberWeights).forEach(key => delete memberWeights[key]); modal.open = true; }
function edit(record) { const { memberCount, memberNames, totalHours, ...project } = record; modal.record = project; modal.open = true; }
async function submit() {
  if (!modal.record.name) return message.warning('请输入项目名称');
  if (modal.record.id) await api.put(`/projects/${modal.record.id}`, modal.record);
  else await api.post('/projects', { ...modal.record, members: memberSelection.value.map(id => ({ employeeId: id, weight: memberWeights[id] ?? 1, role: 'member' })) });
  message.success('已保存'); modal.open = false; load();
}
async function archive(record) { await api.put(`/projects/${record.id}`, { status: record.status === 'active' ? 'archived' : 'active' }); message.success(record.status === 'active' ? '已归档' : '已恢复'); load(); }
function handleResize() { chart?.resize(); }
onMounted(() => { window.addEventListener('resize', handleResize); load(); });
onBeforeUnmount(() => { window.removeEventListener('resize', handleResize); chart?.dispose(); chart = null; });
</script>

<style scoped>
.toolbar-card{display:flex;justify-content:space-between;align-items:center;padding:16px 20px}.resource-stats{display:grid;grid-template-columns:repeat(5,minmax(145px,1fr));gap:14px;margin-bottom:16px}.resource-stat{background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px 18px;box-shadow:var(--card-shadow)}.resource-stat span{display:block;color:var(--muted);font-size:12px;margin-bottom:8px}.resource-stat b{font-size:24px;color:var(--ink)}.resource-stat.warning{border-left:4px solid #F59E0B}.resource-stat.danger{border-left:4px solid #EF4444}.risk-strip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.resource-panel{padding-top:8px}.graph-guide{display:flex;gap:18px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin:4px 0 12px}.legend-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px}.legend-dot.person{background:#0074C4}.legend-dot.project{background:#10B981}.legend-line{display:inline-block;width:28px;border-top:3px solid #5B8FF9;margin:0 5px 3px 0}.legend-line.dashed{border-top-style:dashed;border-top-color:#9CA3AF}.resource-chart{width:100%;min-height:520px;border-radius:16px;background:radial-gradient(circle at 15% 45%,rgba(118,183,243,.10),transparent 34%),radial-gradient(circle at 86% 50%,rgba(249,168,212,.13),transparent 36%),linear-gradient(180deg,#fff 0%,#fdfcff 100%)}.matrix-note{font-size:12px;color:var(--muted);margin-bottom:12px}.matrix-scroll{overflow:auto;max-height:650px}.heat-matrix{border-collapse:separate;border-spacing:2px;min-width:100%;font-size:12px}.heat-matrix th,.heat-matrix td{padding:10px 12px;text-align:center;min-width:100px;border-radius:4px}.heat-matrix thead th{background:#F3F4F6;position:sticky;top:0;z-index:2}.heat-matrix .sticky-col{position:sticky;left:0;z-index:3;background:#fff;text-align:left;min-width:110px}.heat-matrix .total-cell{font-weight:700;background:#E6F1FA}.clickable{cursor:pointer}.project-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}.project-work-card{border:1px solid #E5E7EB;border-radius:12px;padding:18px;cursor:pointer;transition:.2s}.project-work-card:hover{transform:translateY(-3px);box-shadow:var(--card-shadow-hover);border-color:#9CC9E8}.project-card-head{display:flex;justify-content:space-between;gap:8px;align-items:start}.project-hours{font-size:30px;font-weight:700;color:var(--brand);margin:18px 0}.project-meta{display:flex;justify-content:space-between;color:var(--muted);font-size:13px;margin-top:8px}.project-meta b{color:var(--ink)}.project-meta b.risk{color:#EF4444}.tag-wrap{display:flex;flex-wrap:wrap;gap:4px}@media(max-width:1000px){.resource-stats{grid-template-columns:repeat(2,1fr)}.toolbar-card{align-items:stretch;flex-direction:column}.resource-chart{overflow:auto}}
.legend-dot.planning{background:#7C6CF2}.legend-dot.architecture{background:#55CDB1}.legend-dot.ungrouped{background:#A9A5B8}.legend-dot.project{background:conic-gradient(#E11D48,#7C3AED,#0891B2,#059669,#EA580C,#E11D48)}
</style>

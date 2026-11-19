<template>
  <div class="page">
    <h1 class="page-title">项目看板</h1>
    <p class="page-subtitle">{{ isPlainEmployee ? '查看人员与项目分配关系' : '人员及项目分配图谱 · 项目工时 · 完成进度与风险' }}</p>

    <DataDateBanner v-if="auth.isAdmin || auth.isLeader || auth.isTeamLeader" :range="range" :show-default-range="false" />

    <div class="card toolbar-card">
      <a-space wrap>
        <a-upload v-if="canManageProjects" name="file" :custom-request="handleImport" :show-upload-list="false" accept=".xlsx,.xls">
          <a-button><template #icon><upload-outlined /></template>导入分配表</a-button>
        </a-upload>
        <a-button v-if="canCreateProjects" type="primary" @click="openNew"><template #icon><plus-outlined /></template>新建项目</a-button>
        <a-button v-if="selectedKey && !isSelfScoped" @click="clearSelection">显示全部关系</a-button>
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

    <div v-if="!isPlainEmployee" class="resource-stats">
      <div class="resource-stat"><span>本期分摊工时</span><b>{{ fmtHours(graph.summary.totalAllocatedHours) }}</b></div>
      <div class="resource-stat"><span>活跃项目</span><b>{{ graph.summary.activeProjectCount }}</b></div>
      <div class="resource-stat warning"><span>多项目人员</span><b>{{ graph.summary.multiProjectEmployeeCount }}</b></div>
      <div class="resource-stat danger"><span>未分配工时人员</span><b>{{ graph.summary.unallocatedEmployeeCount }}</b></div>
      <div class="resource-stat"><span>零工时关系</span><b>{{ graph.summary.zeroHourRelationCount }}</b></div>
    </div>

    <div v-if="!isPlainEmployee && riskMessages.length" class="risk-strip">
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
            <span>{{ canManageProjects ? '点击人员聚焦关系；点击项目填写完成进度' : '点击人员或项目聚焦关系' }}</span>
          </div>
          <div ref="resourceChart" class="resource-chart" :style="{ height: `${chartHeight}px` }"></div>
          <a-empty v-if="!graph.links.length" description="所选周期暂无人员—项目分配关系" />
        </a-tab-pane>

        <a-tab-pane v-if="!isPlainEmployee" key="matrix" tab="工时热力矩阵">
          <div class="matrix-note">单元格颜色越深代表人员分摊工时越高；项目表头颜色越深代表项目合计工时越高。</div>
          <div class="matrix-scroll">
            <table class="heat-matrix">
              <thead><tr>
                <th class="sticky-col">人员</th>
                <th
                  v-for="project in matrixProjects"
                  :key="project.id"
                  class="project-total-header clickable"
                  :style="projectHeaderStyle(matrixProjectHours(project.id))"
                  @click="selectNode(`project-${project.id}`)"
                >
                  <span class="project-header-name">{{ project.name }}</span>
                  <strong class="project-header-hours">{{ fmtHours(matrixProjectHours(project.id)) }} 小时</strong>
                </th>
                <th>合计</th>
              </tr></thead>
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

        <a-tab-pane v-if="!isPlainEmployee" key="projects" tab="项目时序一览">
          <div class="timeline-toolbar">
            <a-radio-group v-model:value="timelineTeam" button-style="solid">
              <a-radio-button v-for="option in timelineTeamOptions" :key="option.value" :value="option.value">{{ option.label }}</a-radio-button>
            </a-radio-group>
            <span class="timeline-legend">按上方日期范围统计。颜色越深，占当周可见项目总工时的比例越高；悬停可查看实际工时。</span>
          </div>
          <ProjectWeekHeatmap v-if="timelineProjects.length" :projects="timelineProjects"
            :timeline="timeline" @edit="openProjectProgress" />
          <a-empty v-else description="当前小组暂无项目时序数据" />
        </a-tab-pane>

        <a-tab-pane v-if="!isPlainEmployee" key="detail" tab="项目明细">
          <a-table :data-source="rows" :columns="cols" row-key="id" size="middle">
            <template #bodyCell="{ column, record }">
              <template v-if="column.dataIndex === 'memberNames'">
                <div class="tag-wrap"><a-tag v-for="name in record.memberNames || []" :key="name" color="blue">{{ name }}</a-tag><span v-if="!record.memberNames?.length">—</span></div>
              </template>
              <template v-if="column.dataIndex === 'code'">{{ record.code || '' }}</template>
              <template v-if="column.dataIndex === 'totalHours'"><b>{{ fmtHours(record.totalHours) }}</b></template>
              <template v-if="column.dataIndex === 'status'"><a-tag :color="record.status === 'active' ? 'success' : 'default'">{{ record.status === 'active' ? '进行中' : '已归档' }}</a-tag></template>
              <template v-if="column.dataIndex === 'actions'">
                <a-button v-if="record.canEditProgress" size="small" type="link" @click="openProjectProgress(record)">编辑进度</a-button>
                <a-button v-if="record.canRename" size="small" type="link" @click="edit(record)">{{ canManageProjects ? '编辑项目' : '维护项目' }}</a-button>
                <a-button v-if="record.canMerge" size="small" type="link" @click="openMerge(record)">合并</a-button>
                <a-popconfirm v-if="record.canDelete" title="确认删除该项目？历史数据会保留。" ok-text="确认删除" @confirm="removeProject(record)">
                  <a-button size="small" type="link" danger>删除</a-button>
                </a-popconfirm>
                <a-button v-if="canManageProjects" size="small" type="link" danger @click="archive(record)">{{ record.status === 'active' ? '归档' : '恢复' }}</a-button>
              </template>
            </template>
          </a-table>
        </a-tab-pane>
        <a-tab-pane key="summary" tab="项目总结">
          <ProjectSummary />
        </a-tab-pane>
      </a-tabs>
    </div>

    <a-modal v-model:open="modal.open" :title="modal.record?.id ? '编辑项目' : '新建项目'" @ok="submit" :width="720">
      <a-form layout="vertical"><a-row :gutter="16">
        <a-col :span="12"><a-form-item label="项目单号（可留空）"><a-input v-model:value="modal.record.code" placeholder="没有单号可留空" /></a-form-item></a-col>
        <a-col :span="12"><a-form-item label="项目名称"><a-input v-model:value="modal.record.name" /></a-form-item></a-col>
        <a-col v-if="!modal.record.id" :span="12"><a-form-item label="所属小组"><a-select v-model:value="modal.record.team" :options="teamOptions" :disabled="auth.isTeamLeader && !auth.isAdmin && !auth.isLeader" /></a-form-item></a-col>
        <a-col v-if="canManageProjects" :span="12"><a-form-item label="负责人"><a-input v-model:value="modal.record.manager" /></a-form-item></a-col>
        <a-col v-if="canMaintainProjectNames" :span="12"><a-form-item label="开始时间"><a-date-picker v-model:value="modal.record.startDate" value-format="YYYY-MM-DD" style="width:100%" /></a-form-item></a-col>
        <a-col v-if="canMaintainProjectNames" :span="12"><a-form-item label="预计完成时间">
          <a-space><a-date-picker v-if="modal.record.endDate !== '待定'" v-model:value="modal.record.endDate" value-format="YYYY-MM-DD" /><a-checkbox :checked="modal.record.endDate === '待定'" @change="togglePendingEnd">待定</a-checkbox></a-space>
        </a-form-item></a-col>
        <a-col v-if="canManageProjects" :span="24"><a-form-item label="描述"><a-textarea v-model:value="modal.record.description" :rows="2" /></a-form-item></a-col>
        <a-col v-if="canManageProjects && !modal.record.id" :span="24"><a-form-item label="初始成员（勾选后可设置权重）">
          <a-table :data-source="employees" :columns="memberCols" :pagination="false" size="small" row-key="id" :row-selection="{ selectedRowKeys: memberSelection, onChange: keys => memberSelection = keys }">
            <template #bodyCell="{ column, record }"><template v-if="column.dataIndex === 'weight'"><a-input-number :min="0" :max="1" :step="0.1" :value="memberWeights[record.id] ?? 1" @change="v => memberWeights[record.id] = v" /></template></template>
          </a-table>
        </a-form-item></a-col>
      </a-row></a-form>
    </a-modal>

    <a-modal v-model:open="mergeModal.open" title="合并项目" ok-text="确认合并" :confirm-loading="mergeModal.loading" @ok="confirmMerge">
      <a-alert type="warning" show-icon style="margin-bottom:16px" :message="`“${mergeModal.source?.name || ''}”的历史记录将并入目标项目`" description="合并后原项目不再出现在项目名单中，历史填报和人员关系会保留在目标项目下。" />
      <a-form layout="vertical"><a-form-item label="目标项目">
        <a-select v-model:value="mergeModal.targetProjectId" show-search option-filter-prop="label" placeholder="请选择要合并到的项目" :options="mergeTargetOptions" />
      </a-form-item></a-form>
    </a-modal>

    <a-modal v-model:open="progressModal.open" title="项目进度" ok-text="保存进度" :confirm-loading="progressModal.loading" @ok="saveProjectProgress">
      <a-descriptions :column="1" bordered size="small" style="margin-bottom:18px">
        <a-descriptions-item label="项目名称">{{ progressModal.project?.name }}</a-descriptions-item>
        <a-descriptions-item label="当前周期">{{ rangeLabel }}</a-descriptions-item>
        <a-descriptions-item label="已产生工时总计"><b>{{ fmtHours(progressModal.project?.hours ?? progressModal.project?.totalHours) }}</b></a-descriptions-item>
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
import ProjectWeekHeatmap from '../components/ProjectWeekHeatmap.vue';
import ProjectSummary from '../components/ProjectSummary.vue';
import { loadLatestProjectAllocationMonth, weekRange } from '../lib/coverage';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const canManageProjects = computed(() => auth.isAdmin);
const canCreateProjects = computed(() => auth.isAdmin || auth.isLeader || auth.isTeamLeader);
const canMaintainProjectNames = computed(() => canCreateProjects.value);
const isPlainEmployee = computed(() => !auth.isAdmin && !auth.isLeader && !auth.isTeamLeader);
const isSelfScoped = computed(() => isPlainEmployee.value && graph.value.employees.some(person => Number(person.id) === Number(auth.user?.employeeId)));
const canSeeCost = computed(() => auth.isAdmin || auth.isLeader);
const teamOptions = [{ label: '方案组', value: '方案组' }, { label: '规划组', value: '规划组' }];

const EMPTY_GRAPH = { summary: { totalAllocatedHours: 0, activeProjectCount: 0, multiProjectEmployeeCount: 0, unallocatedEmployeeCount: 0, zeroHourRelationCount: 0, singlePointRiskCount: 0 }, employees: [], projects: [], links: [] };
const range = ref(weekRange());
const rows = ref([]);
const employees = ref([]);
const graph = ref(EMPTY_GRAPH);
const timeline = ref({ startDate: null, endDate: null, projects: [], segments: [] });
const activeView = ref('graph');
const selectedKey = ref(null);
const resourceChart = ref(null);
const timelineTeam = ref('all');
const memberSelection = ref([]);
const memberWeights = reactive({});
const importResult = ref(null);
const modal = reactive({ open: false, record: {} });
const importModal = reactive({ open: false, loading: false, file: null, unknownProjects: [], existingProjects: [] });
const importResolutions = reactive({});
const progressModal = reactive({ open: false, loading: false, project: null, completionPercent: 0 });
const mergeModal = reactive({ open: false, loading: false, source: null, targetProjectId: null });
let chart = null;

const cols = computed(() => [
  { title: '项目单号', dataIndex: 'code', width: 130 }, { title: '名称', dataIndex: 'name', width: 180 },
  { title: '人员构成', dataIndex: 'memberNames' }, { title: '累计工时', dataIndex: 'totalHours', width: 110, sorter: (a, b) => a.totalHours - b.totalHours },
  { title: '开始时间', dataIndex: 'startDate', width: 120 }, { title: '预计完成时间', dataIndex: 'endDate', width: 130 },
  { title: '状态', dataIndex: 'status', width: 90 },
  ...(canMaintainProjectNames.value ? [{ title: '操作', dataIndex: 'actions', width: 320, fixed: 'right' }] : []),
]);
const memberCols = [{ title: '姓名', dataIndex: 'name' }, { title: '组别', dataIndex: 'team' }, { title: '权重', dataIndex: 'weight', width: 120 }];
const importProjectCols = [
  { title: '表中新增名称', dataIndex: 'name', width: 190 },
  { title: '处理方式', dataIndex: 'action', width: 280 },
  { title: '归并目标', dataIndex: 'target' },
];
const matrixEmployees = computed(() => graph.value.employees.filter(item => item.projectCount || item.unallocatedHours));
const projectsWithMembers = computed(() => graph.value.projects.filter(project => project.memberCount));
const matrixProjectTotals = computed(() => {
  const totals = new Map(projectsWithMembers.value.map(project => [project.id, 0]));
  for (const link of graph.value.links) {
    if (totals.has(link.projectId)) totals.set(link.projectId, (totals.get(link.projectId) || 0) + (Number(link.hours) || 0));
  }
  return totals;
});
const matrixProjects = computed(() => [...projectsWithMembers.value].sort((a, b) =>
  matrixProjectTotals.value.get(b.id) - matrixProjectTotals.value.get(a.id)
  || a.name.localeCompare(b.name, 'zh-CN') || a.id - b.id));
const timelineTeamOptions = computed(() => {
  if (auth.isAdmin || auth.isLeader) return [
    { label: '全部', value: 'all' },
    { label: '方案组', value: '方案组' },
    { label: '规划组', value: '规划组' },
  ];
  const teams = [...new Set((auth.user?.roles || []).filter(role => role.role === 'team_leader').map(role => role.team).filter(Boolean))];
  return teams.map(team => ({ label: team, value: team }));
});
const timelineProjects = computed(() => timeline.value.projects
  .filter(project => timelineTeam.value === 'all'
    || project.effectiveTeam === timelineTeam.value
    || project.team === timelineTeam.value
    || project.associatedTeams?.includes(timelineTeam.value))
  .sort((a, b) => String(a.timelineStart || '').localeCompare(String(b.timelineStart || '')) || a.name.localeCompare(b.name, 'zh-CN')));
const maxMatrixHours = computed(() => Math.max(1, ...graph.value.links.map(link => link.hours)));
const maxMatrixProjectHours = computed(() => Math.max(1, ...matrixProjectTotals.value.values()));
const chartHeight = computed(() => Math.max(560, Math.max(matrixEmployees.value.length, matrixProjects.value.length) * 70 + 100));
const riskMessages = computed(() => {
  const result = [];
  if (graph.value.summary.multiProjectEmployeeCount) result.push({ color: 'orange', text: `${graph.value.summary.multiProjectEmployeeCount} 人同时参与多个项目` });
  if (graph.value.summary.unallocatedEmployeeCount) result.push({ color: 'red', text: `${graph.value.summary.unallocatedEmployeeCount} 人存在未分配工时` });
  if (graph.value.summary.singlePointRiskCount) result.push({ color: 'gold', text: `${graph.value.summary.singlePointRiskCount} 个项目存在单点依赖` });
  if (graph.value.summary.zeroHourRelationCount) result.push({ color: 'default', text: `${graph.value.summary.zeroHourRelationCount} 条分配关系本期零工时` });
  return result;
});
const rangeLabel = computed(() => range.value?.length === 2 ? `${range.value[0].format('YYYY-MM-DD')} 至 ${range.value[1].format('YYYY-MM-DD')}` : '全部周期');
const mergeTargetOptions = computed(() => rows.value
  .filter(project => project.id !== mergeModal.source?.id && project.canMerge)
  .map(project => ({ value: project.id, label: project.code ? `${project.name}（${project.code}）` : project.name })));

function params() { return { startDate: range.value?.[0]?.format('YYYY-MM-DD'), endDate: range.value?.[1]?.format('YYYY-MM-DD') }; }
async function load() {
  const p = params();
  [rows.value, employees.value, graph.value, timeline.value] = await Promise.all([
    api.get('/projects/overview', { params: p }), api.get('/employees'), api.get('/projects/resource-graph', { params: p }), api.get('/projects/timeline', { params: p }),
  ]);
  if (!timelineTeamOptions.value.some(option => option.value === timelineTeam.value)) {
    timelineTeam.value = timelineTeamOptions.value[0]?.value || 'all';
  }
  selectedKey.value = isSelfScoped.value ? `employee-${auth.user.employeeId}` : null;
  await nextTick();
  renderGraph();
}

function renderGraph() {
  if (!resourceChart.value || activeView.value !== 'graph') return;
  if (!chart) {
    chart = echarts.init(resourceChart.value);
    chart.on('click', event => {
      if (event.seriesType !== 'scatter' || !event.data?.kind) return;
      if (event.data.kind === '项目' && event.data.meta.canEditProgress) {
        openProjectProgress(event.data.meta);
        return;
      }
      if (isSelfScoped.value) {
        if (event.data.kind !== '项目') return;
        const ownProjects = new Set(graph.value.links.filter(link => Number(link.employeeId) === Number(auth.user.employeeId)).map(link => link.projectId));
        if (!ownProjects.has(event.data.meta.id)) return;
      }
      selectNode(event.data.id);
    });
    chart.getZr().on('click', event => { if (!event.target && !isSelfScoped.value) clearSelection(); });
  }
  const { people, projects } = clusteredGraphOrder(matrixEmployees.value, projectsWithMembers.value, graph.value.links);
  const connected = new Set();
  if (selectedKey.value) {
    connected.add(selectedKey.value);
    if (selectedKey.value.startsWith('employee-')) {
      const employeeId = Number(selectedKey.value.slice('employee-'.length));
      const relatedProjectIds = new Set(graph.value.links.filter(link => link.employeeId === employeeId).map(link => link.projectId));
      for (const projectId of relatedProjectIds) connected.add(`project-${projectId}`);
      for (const link of graph.value.links.filter(link => relatedProjectIds.has(link.projectId))) connected.add(`employee-${link.employeeId}`);
    } else {
      for (const link of graph.value.links) if (`project-${link.projectId}` === selectedKey.value) connected.add(`employee-${link.employeeId}`);
    }
  }
  const nodeOpacity = id => !selectedKey.value || connected.has(id) ? 1 : 0.1;
  const yAt = (index, count) => 60 + index * Math.max(64, (chartHeight.value - 120) / Math.max(1, count - 1));
  const peopleY = new Map(people.map((person, index) => [person.id, yAt(index, people.length)]));
  const projectsY = new Map(projects.map((project, index) => [project.id, yAt(index, projects.length)]));
  const projectColors = new Map(projects.map((project, index) => [project.id, projectColor(project, index)]));
  const peopleData = people.map(person => ({
    id: `employee-${person.id}`,
    name: person.name,
    value: [GRAPH_LEFT_X, peopleY.get(person.id)],
    symbol: numberedCircleSymbol(person.projectCount, PERSON_NODE_COLOR),
    symbolSize: PERSON_NODE_SIZE,
    itemStyle: { opacity: nodeOpacity(`employee-${person.id}`), shadowBlur: 12, shadowColor: `${PERSON_NODE_COLOR}55` },
    meta: person,
    kind: '人员',
  }));
  const projectData = projects.map(project => {
    const color = projectColors.get(project.id);
    return {
      id: `project-${project.id}`,
      name: project.name,
      value: [GRAPH_RIGHT_X, projectsY.get(project.id)],
      symbol: projectProgressSymbol(project, color),
      symbolSize: PROJECT_NODE_SIZE,
      itemStyle: { opacity: nodeOpacity(`project-${project.id}`), shadowBlur: 10, shadowColor: `${color}55` },
      label: { color, formatter: project.code ? `${project.name}\n${project.code}` : project.name },
      meta: project,
      kind: '项目',
    };
  });
  const links = graph.value.links.filter(link => peopleY.has(link.employeeId) && projectsY.has(link.projectId)).map(link => {
    const source = `employee-${link.employeeId}`, target = `project-${link.projectId}`;
    const visible = !selectedKey.value || (connected.has(source) && connected.has(target));
    return {
      value: [GRAPH_LEFT_X, peopleY.get(link.employeeId), GRAPH_RIGHT_X, projectsY.get(link.projectId)],
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
      ? `<b>${item.data.meta.employeeName} → ${item.data.meta.projectName}</b><br/>分摊工时：${fmtHours(item.data.meta.hours)}<br/>平均权重：${item.data.meta.weight}${canSeeCost.value ? `<br/>人工成本：¥${formatMoney(item.data.meta.cost)}` : ''}`
      : item.data.kind === '人员'
        ? `<b>${item.data.name}</b><br/>总工时：${fmtHours(item.data.meta.totalHours)}<br/>分摊工时：${fmtHours(item.data.meta.allocatedHours)}<br/>参与项目：${item.data.meta.projectCount}`
        : `<b>${item.data.name}</b>${item.data.meta.code ? `<br/>项目单号：${item.data.meta.code}` : ''}<br/>开始时间：${item.data.meta.startDate || '—'}<br/>预计完成：${item.data.meta.endDate || '—'}<br/>完成进度：${item.data.meta.completionPercent || 0}%<br/>已产生工时：${fmtHours(item.data.meta.hours)}<br/>参与人员：${item.data.meta.memberCount}${item.data.meta.canEditProgress ? '<br/>点击项目图标可编辑进度' : ''}` },
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
        label: { show: true, formatter: '{b}', position: 'left', distance: 14, color: '#38344D', fontSize: 15, lineHeight: 21, fontWeight: 700, textBorderColor: '#fff', textBorderWidth: 3 },
        emphasis: { scale: false },
      },
      {
        name: '项目',
        type: 'scatter',
        data: projectData,
        z: 3,
        label: { show: true, formatter: '{b}', position: 'right', distance: 14, color: '#8E3F62', fontSize: 15, lineHeight: 21, fontWeight: 700, textBorderColor: '#fff', textBorderWidth: 3 },
        emphasis: { scale: false },
      },
    ],
  }, true);
  chart.resize();
}

function selectNode(key) { selectedKey.value = key; activeView.value = 'graph'; nextTick(renderGraph); }
function clearSelection() { selectedKey.value = isSelfScoped.value ? `employee-${auth.user.employeeId}` : null; renderGraph(); }
function onViewChange(key) {
  if (key === 'graph') nextTick(renderGraph);
}
function linkFor(employeeId, projectId) { return graph.value.links.find(link => link.employeeId === employeeId && link.projectId === projectId); }
function matrixProjectHours(projectId) { return Math.round((matrixProjectTotals.value.get(projectId) || 0) * 100) / 100; }
function heatStyle(hours) { const intensity = hours ? 0.12 + 0.7 * hours / maxMatrixHours.value : 0; return { background: hours ? `rgba(124,108,242,${intensity})` : '#FAF9FE', color: intensity > 0.48 ? '#fff' : '#49455F' }; }
function projectHeaderStyle(hours) {
  const intensity = hours ? 0.14 + 0.72 * hours / maxMatrixProjectHours.value : 0;
  return {
    background: hours ? `rgba(0,116,196,${intensity})` : '#F3F4F6',
    color: intensity > 0.48 ? '#fff' : '#29445B',
  };
}
function formatMoney(value) { return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }); }
const PERSON_NODE_COLOR = '#7C6CF2';
const GRAPH_LEFT_X = 235;
const GRAPH_RIGHT_X = 700;
const PERSON_NODE_SIZE = 52;
const PROJECT_NODE_SIZE = 76;
const COMPLETED_PROJECT_COLOR = '#9CA3AF';
const PROJECT_COLORS = ['#B91C1C', '#B45309', '#0891B2', '#059669', '#EA580C', '#0369A1', '#4D7C0F', '#0F766E', '#CA8A04', '#475569'];
function projectColor(project, index) {
  if (Number(project.completionPercent) >= 100) return COMPLETED_PROJECT_COLOR;
  const seed = Number(project.id);
  return PROJECT_COLORS[(Number.isFinite(seed) ? Math.abs(seed) : index) % PROJECT_COLORS.length];
}
function clusteredGraphOrder(sourcePeople, sourceProjects, links) {
  let people = [...sourcePeople].sort((a, b) => String(a.team || '').localeCompare(String(b.team || ''), 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN'));
  let projects = [...sourceProjects].sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name, 'zh-CN'));
  const linkedProjects = employeeId => links.filter(link => link.employeeId === employeeId).map(link => link.projectId);
  const linkedPeople = projectId => links.filter(link => link.projectId === projectId).map(link => link.employeeId);
  const averageIndex = (ids, order) => {
    const indices = ids.map(id => order.findIndex(item => item.id === id)).filter(index => index >= 0);
    return indices.length ? indices.reduce((sum, index) => sum + index, 0) / indices.length : Number.MAX_SAFE_INTEGER;
  };
  for (let pass = 0; pass < 6; pass += 1) {
    people.sort((a, b) => averageIndex(linkedProjects(a.id), projects) - averageIndex(linkedProjects(b.id), projects)
      || String(a.team || '').localeCompare(String(b.team || ''), 'zh-CN') || a.name.localeCompare(b.name, 'zh-CN'));
    projects.sort((a, b) => averageIndex(linkedPeople(a.id), people) - averageIndex(linkedPeople(b.id), people)
      || b.memberCount - a.memberCount || a.name.localeCompare(b.name, 'zh-CN'));
  }
  return { people, projects };
}
function numberedCircleSymbol(count, color) {
  const text = String(Math.max(0, Number(count) || 0));
  const fontSize = text.length > 2 ? 12 : 16;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="${color}" stroke="#fff" stroke-width="3"/><text x="24" y="25" fill="#fff" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700">${text}</text></svg>`;
  return `image://data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
function projectProgressSymbol(project, color) {
  const percent = Math.max(0, Math.min(100, Number(project.completionPercent) || 0));
  const radius = 17, circumference = 2 * Math.PI * radius;
  const progress = circumference * percent / 100;
  const count = String(Math.max(0, Number(project.memberCount) || 0));
  const fontSize = count.length > 2 ? 11 : 15;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="13" fill="${color}"/><circle cx="24" cy="24" r="17" fill="none" stroke="${color}" stroke-opacity=".2" stroke-width="4"/><circle cx="24" cy="24" r="17" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${progress} ${circumference}" transform="rotate(-90 24 24)"/><text x="24" y="25" fill="#fff" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700">${count}</text></svg>`;
  return `image://data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
function openProjectProgress(project) { if (!project?.canEditProgress) return; progressModal.project = project; progressModal.completionPercent = Number(project.completionPercent) || 0; progressModal.open = true; }
async function saveProjectProgress() {
  const value = Number(progressModal.completionPercent);
  if (!Number.isFinite(value) || value < 0 || value > 100) return message.warning('完成百分比必须在 0 到 100 之间');
  progressModal.loading = true;
  try { await api.put(`/projects/${progressModal.project.id}`, { completionPercent: value }); message.success('项目进度已保存'); progressModal.open = false; await load(); }
  catch (error) { message.error(error?.error || error?.message || '项目进度保存失败'); }
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
function ownLeaderTeam() { return auth.user?.roles?.find(role => role.role === 'team_leader')?.team || '方案组'; }
function openNew() { modal.record = { code: '', name: '', team: auth.isTeamLeader && !auth.isAdmin && !auth.isLeader ? ownLeaderTeam() : undefined, manager: '', startDate: null, endDate: null, description: '' }; memberSelection.value = []; Object.keys(memberWeights).forEach(key => delete memberWeights[key]); modal.open = true; }
function edit(record) { const { memberCount, memberNames, totalHours, ...project } = record; modal.record = project; modal.open = true; }
function togglePendingEnd(event) { modal.record.endDate = event.target.checked ? '待定' : null; }
async function submit() {
  if (!modal.record.name) return message.warning('请输入项目名称');
  if (!modal.record.startDate) return message.warning('请选择项目开始时间');
  if (!modal.record.endDate) return message.warning('请选择预计完成时间，或勾选待定');
  try {
    if (modal.record.id) await api.put(`/projects/${modal.record.id}`, canManageProjects.value ? modal.record : { name: modal.record.name, code: modal.record.code, startDate: modal.record.startDate, endDate: modal.record.endDate });
    else {
      if (!modal.record.team) return message.warning('请选择所属小组');
      const payload = canManageProjects.value
        ? { ...modal.record, members: memberSelection.value.map(id => ({ employeeId: id, weight: memberWeights[id] ?? 1, role: 'member' })) }
        : { code: modal.record.code, name: modal.record.name, team: modal.record.team, startDate: modal.record.startDate, endDate: modal.record.endDate };
      await api.post('/projects', payload);
    }
    message.success(modal.record.id ? '项目名称及资料已更新' : '项目已创建'); modal.open = false; load();
  } catch (error) { message.error(error?.error || '保存失败'); }
}
function openMerge(record) { Object.assign(mergeModal, { open: true, loading: false, source: record, targetProjectId: null }); }
async function confirmMerge() {
  if (!mergeModal.targetProjectId) return message.warning('请选择目标项目');
  mergeModal.loading = true;
  try {
    await api.post(`/projects/${mergeModal.source.id}/merge`, { targetProjectId: mergeModal.targetProjectId });
    message.success('项目已合并，历史数据已转入目标项目'); mergeModal.open = false; await load();
  } catch (error) { message.error(error?.error || '合并失败'); }
  finally { mergeModal.loading = false; }
}
async function removeProject(record) {
  try { await api.delete(`/projects/${record.id}`); message.success('项目已删除，历史数据已保留'); await load(); }
  catch (error) { message.error(error?.error || '删除失败'); }
}
async function archive(record) { await api.put(`/projects/${record.id}`, { status: record.status === 'active' ? 'archived' : 'active' }); message.success(record.status === 'active' ? '已归档' : '已恢复'); load(); }
function handleResize() { chart?.resize(); }
onMounted(async () => {
  window.addEventListener('resize', handleResize);
  range.value = await loadLatestProjectAllocationMonth(range.value);
  await load();
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  chart?.dispose(); chart = null;
});
</script>

<style scoped>
.toolbar-card{display:flex;justify-content:space-between;align-items:center;padding:16px 20px}.resource-stats{display:grid;grid-template-columns:repeat(5,minmax(145px,1fr));gap:14px;margin-bottom:16px}.resource-stat{background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px 18px;box-shadow:var(--card-shadow)}.resource-stat span{display:block;color:var(--muted);font-size:12px;margin-bottom:8px}.resource-stat b{font-size:24px;color:var(--ink)}.resource-stat.warning{border-left:4px solid #F59E0B}.resource-stat.danger{border-left:4px solid #EF4444}.risk-strip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.resource-panel{padding-top:8px}.graph-guide{display:flex;gap:18px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin:4px 0 12px}.legend-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px}.legend-dot.person{background:#7C6CF2}.legend-dot.project{background:#10B981}.legend-line{display:inline-block;width:28px;border-top:3px solid #5B8FF9;margin:0 5px 3px 0}.legend-line.dashed{border-top-style:dashed;border-top-color:#9CA3AF}.resource-chart{width:100%;min-height:520px;border-radius:16px;background:radial-gradient(circle at 15% 45%,rgba(118,183,243,.10),transparent 34%),radial-gradient(circle at 86% 50%,rgba(249,168,212,.13),transparent 36%),linear-gradient(180deg,#fff 0%,#fdfcff 100%)}.matrix-note{font-size:12px;color:var(--muted);margin-bottom:12px}.matrix-scroll{overflow:auto;max-height:650px}.heat-matrix{border-collapse:separate;border-spacing:2px;min-width:100%;font-size:12px}.heat-matrix th,.heat-matrix td{padding:10px 12px;text-align:center;min-width:100px;border-radius:4px}.heat-matrix thead th{background:#F3F4F6;position:sticky;top:0;z-index:2}.heat-matrix .sticky-col{position:sticky;left:0;z-index:3;background:#fff;text-align:left;min-width:110px}.heat-matrix .project-total-header{min-width:132px;padding:9px 12px;transition:filter .2s ease}.heat-matrix .project-total-header:hover{filter:brightness(.94)}.project-header-name,.project-header-hours{display:block}.project-header-name{font-weight:700;line-height:1.35}.project-header-hours{margin-top:5px;font-size:13px;line-height:1.2}.heat-matrix .total-cell{font-weight:700;background:#E6F1FA}.clickable{cursor:pointer}.timeline-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:2px 0 12px}.timeline-legend{display:flex;align-items:center;gap:18px;flex-wrap:wrap;color:var(--muted);font-size:12px}.tag-wrap{display:flex;flex-wrap:wrap;gap:4px}@media(max-width:1000px){.resource-stats{grid-template-columns:repeat(2,1fr)}.toolbar-card{align-items:stretch;flex-direction:column}.resource-chart{overflow:auto}.timeline-toolbar{align-items:flex-start;flex-direction:column}}
.legend-dot.planning{background:#7C6CF2}.legend-dot.architecture{background:#55CDB1}.legend-dot.ungrouped{background:#A9A5B8}.legend-dot.project{background:conic-gradient(#E11D48,#7C3AED,#0891B2,#059669,#EA580C,#E11D48)}
</style>

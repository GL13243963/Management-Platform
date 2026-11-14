<template>
  <div class="page">
    <h1 class="page-title">人员管理</h1>
    <p class="page-subtitle">员工信息 · 本周期工时 · 本周期参与项目</p>

    <DataDateBanner :range="range" />

    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px">
        <a-space>
          <a-button type="primary" @click="openNew">
            <template #icon><plus-outlined /></template>
            新增员工
          </a-button>
        </a-space>
        <a-range-picker v-model:value="range" @change="load" style="width: 300px" />
      </div>
      <a-table :data-source="rows" :columns="cols" row-key="id" size="middle">
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'team'">
            <a-tag v-if="record.team" :color="record.team === '规划组' ? 'geekblue' : 'green'">{{ record.team }}</a-tag>
            <span v-else style="color: #bbb">—</span>
          </template>
          <template v-if="column.dataIndex === 'totalHours'">
            <b>{{ fmtHours(record.totalHours) }}</b>
          </template>
          <template v-if="column.dataIndex === 'projectNames'">
            <div class="tag-wrap">
              <a-tag v-for="name in (record.projectNames || []).slice(0, 3)" :key="name" color="cyan">
                {{ name }}
              </a-tag>
              <a-tooltip v-if="(record.projectNames || []).length > 3" :title="record.projectNames.slice(3).join('、')">
                <a-tag>+{{ record.projectNames.length - 3 }}</a-tag>
              </a-tooltip>
              <span v-if="!record.projectNames?.length" style="color: #bbb">—</span>
            </div>
          </template>
          <template v-if="column.dataIndex === 'active'">
            <a-tag :color="record.active ? 'success' : 'default'">
              {{ record.active ? '在职' : '停用' }}
            </a-tag>
          </template>
          <template v-if="column.dataIndex === 'actions'">
            <a-button size="small" type="link" @click="edit(record)">编辑</a-button>
            <a-button size="small" type="link" @click="openCompLeave(record)">调休</a-button>
            <a-popconfirm title="确认删除？" @confirm="remove(record)">
              <a-button size="small" type="link" danger>删除</a-button>
            </a-popconfirm>
          </template>
        </template>
      </a-table>
    </div>

    <a-modal v-model:open="modal.open" :title="modal.record?.id ? '编辑员工' : '新增员工'" @ok="submit" :width="600">
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="姓名">
              <a-input v-model:value="modal.record.name" placeholder="请输入姓名" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="组别">
              <a-select v-model:value="modal.record.team" placeholder="请选择组别" allowClear>
                <a-select-option value="规划组">规划组</a-select-option>
                <a-select-option value="方案组">方案组</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12"><a-form-item label="工作年限">
            <a-input-number v-model:value="modal.record.workYears" :min="0" :max="60" :step="0.5" style="width:100%" placeholder="请输入年数" />
          </a-form-item></a-col>
          <a-col :span="12"><a-form-item label="本科毕业院校">
            <a-input v-model:value="modal.record.undergraduateSchool" placeholder="请输入本科毕业院校" />
          </a-form-item></a-col>
          <a-col :span="12"><a-form-item label="研究生毕业院校">
            <a-input v-model:value="modal.record.graduateSchool" placeholder="没有可留空" />
          </a-form-item></a-col>
          <a-col :span="12">
            <a-form-item label="小时成本（元）">
              <a-input-number v-model:value="modal.record.hourlyRate" :min="0" style="width: 100%" placeholder="请输入" />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </a-modal>

    <!-- Comp leave modal -->
    <a-modal
      v-model:open="compModal.open"
      :title="`考勤安排 - ${compModal.employeeName || ''}`"
      @ok="submitCompLeave"
      ok-text="确认录入"
      :width="520"
    >
      <a-form layout="vertical">
        <a-form-item label="安排类型">
          <a-radio-group v-model:value="compModal.type" button-style="solid"><a-radio-button value="comp_leave">调休</a-radio-button><a-radio-button value="remote_work">居家办公</a-radio-button></a-radio-group>
        </a-form-item>
        <a-alert type="info" show-icon :message="compModal.type === 'remote_work' ? '居家办公按8小时统计，不生成打卡记录。' : '调休不计工作时长和考勤异常。'" style="margin-bottom:12px" />
        <a-form-item label="选择日期（可多选）">
          <a-date-picker
            v-model:value="compModal.newDate"
            style="width: 100%"
            value-format="YYYY-MM-DD"
            placeholder="选择日期后点击添加"
          />
        </a-form-item>
        <div style="margin-bottom: 12px">
          <a-button size="small" @click="addCompDate" :disabled="!compModal.newDate">
            + 添加到列表
          </a-button>
        </div>
        <a-form-item label="待录入日期">
          <div v-if="compModal.pendingDates.length" style="display: flex; flex-wrap: wrap; gap: 6px">
            <a-tag
              v-for="d in compModal.pendingDates"
              :key="d"
              closable
              @close="removePendingDate(d)"
              color="purple"
            >
              {{ d }}
            </a-tag>
          </div>
          <span v-else style="color: #bbb; font-size: 13px">尚未选择日期</span>
        </a-form-item>
        <a-form-item label="备注（可选）">
          <a-input v-model:value="compModal.note" placeholder="填写安排说明（可选）" />
        </a-form-item>
        <a-divider style="margin: 12px 0" />
        <a-form-item label="已有安排">
          <div v-if="compModal.existingDates.length" style="display: flex; flex-wrap: wrap; gap: 6px">
            <a-tag
              v-for="item in compModal.existingDates"
              :key="item.date"
              closable
              @close="cancelCompDate(item.date)"
              :color="item.type === 'remote_work' ? 'cyan' : 'purple'"
            >
              {{ item.date }} · {{ item.type === 'remote_work' ? '居家办公' : '调休' }}
            </a-tag>
          </div>
          <span v-else style="color: #bbb; font-size: 13px">暂无安排</span>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import dayjs from 'dayjs';
import { message } from 'ant-design-vue';
import { PlusOutlined } from '@ant-design/icons-vue';
import api from '../api';
import { fmtHours } from '../lib/format';
import DataDateBanner from '../components/DataDateBanner.vue';
import { loadLatestAttendanceMonth } from '../lib/coverage';

const range = ref([dayjs().subtract(30, 'day'), dayjs()]);
const rows = ref([]);
const modal = reactive({ open: false, record: {} });
const compModal = reactive({
  open: false,
  employeeId: null,
  employeeName: '',
  newDate: null,
  pendingDates: [],
  existingDates: [],
  note: '',
  type: 'comp_leave',
});

const cols = [
  { title: '姓名', dataIndex: 'name', width: 110 },
  { title: '组别', dataIndex: 'team', width: 100 },
  { title: '工作年限', dataIndex: 'workYears', width: 100, customRender: ({ text }) => text == null ? '—' : `${text} 年` },
  { title: '本科毕业院校', dataIndex: 'undergraduateSchool', width: 160 },
  { title: '研究生毕业院校', dataIndex: 'graduateSchool', width: 160 },
  { title: '本周期工时', dataIndex: 'totalHours', width: 120, sorter: (a, b) => a.totalHours - b.totalHours, defaultSortOrder: 'descend' },
  { title: '本周期参与项目', dataIndex: 'projectNames', width: 220 },
  { title: '小时成本', dataIndex: 'hourlyRate', width: 110 },
  { title: '状态', dataIndex: 'active', width: 80 },
  { title: '操作', dataIndex: 'actions', width: 190, fixed: 'right' },
];

function params() {
  return {
    startDate: range.value?.[0]?.format('YYYY-MM-DD'),
    endDate: range.value?.[1]?.format('YYYY-MM-DD'),
  };
}

async function load() {
  rows.value = await api.get('/employees/overview', { params: params() });
}

function openNew() {
  modal.record = { name: '', team: null, workYears: null, undergraduateSchool: '', graduateSchool: '', hourlyRate: 0, active: true };
  modal.open = true;
}

function edit(r) {
  // Strip computed overview fields before opening edit modal
  const { totalHours, attendanceDays, lateDays, earlyDays, missedPunchDays, projectCount, projectNames, ...emp } = r;
  modal.record = emp;
  modal.open = true;
}

async function submit() {
  if (!modal.record.name) {
    message.warning('请输入姓名');
    return;
  }
  if (modal.record.id) {
    await api.put(`/employees/${modal.record.id}`, modal.record);
  } else {
    await api.post('/employees', modal.record);
  }
  message.success('已保存');
  modal.open = false;
  load();
}

async function remove(r) {
  await api.delete(`/employees/${r.id}`);
  message.success('已删除');
  load();
}

// --- Comp leave ---
async function openCompLeave(record) {
  compModal.employeeId = record.id;
  compModal.employeeName = record.name;
  compModal.newDate = null;
  compModal.pendingDates = [];
  compModal.note = '';
  compModal.type = 'comp_leave';
  try {
    compModal.existingDates = await api.get(`/employees/${record.id}/comp-leave`);
  } catch {
    compModal.existingDates = [];
  }
  compModal.open = true;
}

function addCompDate() {
  if (compModal.newDate && !compModal.pendingDates.includes(compModal.newDate)) {
    compModal.pendingDates.push(compModal.newDate);
  }
  compModal.newDate = null;
}

function removePendingDate(date) {
  compModal.pendingDates = compModal.pendingDates.filter(d => d !== date);
}

async function submitCompLeave() {
  if (!compModal.pendingDates.length) {
    message.warning('请至少添加一个日期');
    return;
  }
  await api.post('/employees/comp-leave/batch', {
    employeeIds: [compModal.employeeId], dates: compModal.pendingDates,
    note: compModal.note, type: compModal.type,
  });
  message.success(`已录入 ${compModal.pendingDates.length} 天考勤安排`);
  compModal.open = false;
  load();
}

async function cancelCompDate(date) {
  await api.delete(`/employees/${compModal.employeeId}/comp-leave/${date}`);
  compModal.existingDates = compModal.existingDates.filter(d => d.date !== date);
  message.success('已撤销安排');
  load();
}

onMounted(async () => {
  range.value = await loadLatestAttendanceMonth(range.value);
  await load();
});
</script>

<style scoped>
.tag-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>

<template>
  <section class="accounts">
    <div class="account-actions">
      <div><h2>账号与权限</h2><p>员工账号使用员工姓名；也可创建不进入员工名单的访客或VIP账号。</p></div>
      <a-space>
        <a-button @click="load">刷新</a-button>
        <a-button @click="openNonEmployee">创建非员工账号</a-button>
        <a-button type="primary" @click="syncModal.open = true">为新增员工创建账号</a-button>
      </a-space>
    </div>

    <a-table :data-source="users" :columns="columns" row-key="id" :loading="loading" size="middle">
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'roles'">
          <a-space wrap><a-tag v-for="role in record.roles" :key="`${role.role}-${role.team}`" :color="roleColor(role.role)">{{ roleLabel(role) }}</a-tag></a-space>
        </template>
        <template v-else-if="column.dataIndex === 'status'">
          <a-tag :color="record.active ? (record.lockedUntil ? 'error' : 'success') : 'default'">
            {{ !record.active ? '已停用' : record.lockedUntil ? '已锁定' : record.mustChangePassword ? '待首次改密' : '正常' }}
          </a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'actions'">
          <a-space wrap>
            <a-button size="small" @click="openRoles(record)">设置权限</a-button>
            <a-button size="small" @click="openReset(record)">重置密码</a-button>
            <a-button v-if="record.lockedUntil" size="small" @click="unlock(record)">解锁</a-button>
            <a-button size="small" :danger="record.active" @click="toggleActive(record)">{{ record.active ? '停用' : '启用' }}</a-button>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal v-model:open="syncModal.open" title="创建新增员工账号" ok-text="创建账号" :confirm-loading="syncModal.loading" @ok="syncEmployees">
      <a-alert type="info" show-icon message="只为尚无账号的在职员工创建账号，不会覆盖已有账号。" style="margin-bottom:18px" />
      <a-form layout="vertical"><a-form-item label="统一临时密码"><a-input-password v-model:value="syncModal.password" placeholder="至少8位，同时包含字母和数字" /></a-form-item></a-form>
    </a-modal>

    <a-modal v-model:open="createModal.open" title="创建非员工账号" ok-text="创建账号" :confirm-loading="createModal.loading" @ok="createNonEmployee">
      <a-alert type="info" show-icon message="该账号不会进入员工名单，不参加考勤，也不需要每周填报。" style="margin-bottom:18px" />
      <a-form layout="vertical">
        <a-form-item label="登录姓名"><a-input v-model:value="createModal.username" placeholder="请输入登录姓名或账号名称" /></a-form-item>
        <a-form-item label="账号身份"><a-select v-model:value="createModal.accountType" :options="nonEmployeeTypes" /></a-form-item>
        <a-form-item label="临时密码"><a-input-password v-model:value="createModal.password" placeholder="至少8位，同时包含字母和数字" /></a-form-item>
      </a-form>
    </a-modal>

    <a-modal v-model:open="roleModal.open" :title="`设置权限：${roleModal.user?.username || ''}`" ok-text="保存权限" :confirm-loading="roleModal.loading" @ok="saveRoles">
      <template v-if="!roleModal.user?.employeeId">
        <a-radio-group v-model:value="roleModal.nonEmployeeType">
          <a-radio value="guest">访客（无个人项目填报权限）</a-radio>
          <a-radio value="vip">VIP（查看全部数据并维护项目名单）</a-radio>
        </a-radio-group>
        <p class="role-note">非员工账号不会进入员工名单，不参加考勤和每周填报。</p>
      </template>
      <template v-else>
        <a-checkbox v-model:checked="roleModal.admin">管理员（全部平台权限）</a-checkbox>
        <a-checkbox v-model:checked="roleModal.leader">VIP（可查看全部数据并维护项目名单）</a-checkbox>
        <a-checkbox v-model:checked="roleModal.teamLeader">组长（本组明细与跨组汇总）</a-checkbox>
        <a-select v-if="roleModal.teamLeader" v-model:value="roleModal.team" style="width:180px;margin:12px 0 0 24px" :options="teamOptions" />
        <a-checkbox v-model:checked="roleModal.employee">个人填报（填写自己的项目情况）</a-checkbox>
        <p class="role-note">VIP账号可只选择“VIP”；组长和管理员如需填报自己的项目，同时勾选“个人填报”。</p>
      </template>
    </a-modal>

    <a-modal v-model:open="resetModal.open" :title="`重置密码：${resetModal.user?.username || ''}`" ok-text="确认重置" :confirm-loading="resetModal.loading" @ok="resetPassword">
      <a-alert type="warning" show-icon message="重置后，该账号会退出所有设备，并在下次登录时强制修改密码。" style="margin-bottom:18px" />
      <a-form layout="vertical"><a-form-item label="统一临时密码"><a-input-password v-model:value="resetModal.password" /></a-form-item></a-form>
    </a-modal>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { Modal, message } from 'ant-design-vue';
import api from '../api';

const users = ref([]);
const loading = ref(false);
const syncModal = reactive({ open: false, loading: false, password: '' });
const createModal = reactive({ open: false, loading: false, username: '', accountType: 'guest', password: '' });
const roleModal = reactive({ open: false, loading: false, user: null, admin: false, leader: false, teamLeader: false, employee: false, team: '方案组', nonEmployeeType: 'guest' });
const resetModal = reactive({ open: false, loading: false, user: null, password: '' });
const teamOptions = [{ label: '方案组', value: '方案组' }, { label: '规划组', value: '规划组' }];
const nonEmployeeTypes = [{ label: '访客（无个人项目填报权限）', value: 'guest' }, { label: 'VIP（查看全部数据并维护项目名单）', value: 'vip' }];
const columns = [
  { title: '登录姓名', dataIndex: 'username', width: 130 },
  { title: '账号类型', customRender: ({ record }) => record.employeeId ? '员工账号' : '非员工账号', width: 110 },
  { title: '所属组', customRender: ({ record }) => record.employee?.team || '—', width: 100 },
  { title: '权限', dataIndex: 'roles' },
  { title: '状态', dataIndex: 'status', width: 120 },
  { title: '操作', dataIndex: 'actions', width: 310 },
];

function hasRole(user, role) { return user.roles?.some(item => item.role === role); }
function roleLabel(role) { return ({ admin: '管理员', leader: 'VIP', team_leader: `${role.team}组长`, employee: '个人填报', guest: '访客' })[role.role] || role.role; }
function roleColor(role) { return ({ admin: 'red', leader: 'purple', team_leader: 'blue', employee: 'green', guest: 'default' })[role] || 'default'; }
async function load() { loading.value = true; try { users.value = await api.get('/users'); } finally { loading.value = false; } }

function openNonEmployee() { Object.assign(createModal, { open: true, loading: false, username: '', accountType: 'guest', password: '' }); }
async function createNonEmployee() {
  if (!createModal.username.trim()) return message.warning('请输入登录姓名');
  if (!createModal.password) return message.warning('请输入临时密码');
  createModal.loading = true;
  try {
    await api.post('/users/non-employee', { username: createModal.username.trim(), accountType: createModal.accountType, temporaryPassword: createModal.password });
    message.success(`非员工${createModal.accountType === 'vip' ? 'VIP' : '访客'}账号已创建`);
    createModal.open = false; await load();
  } catch (error) { message.error(error?.error || '创建失败'); }
  finally { createModal.loading = false; }
}

async function syncEmployees() {
  if (!syncModal.password) return message.warning('请输入统一临时密码');
  syncModal.loading = true;
  try {
    const result = await api.post('/users/sync-employees', { temporaryPassword: syncModal.password });
    message.success(result.count ? `已创建 ${result.count} 个账号` : '所有在职员工都已有账号');
    syncModal.open = false; syncModal.password = ''; await load();
  } catch (error) { message.error(error?.error || '创建失败'); }
  finally { syncModal.loading = false; }
}

function openRoles(user) {
  Object.assign(roleModal, {
    open: true, user,
    admin: hasRole(user, 'admin'), leader: hasRole(user, 'leader'), teamLeader: hasRole(user, 'team_leader'),
    employee: hasRole(user, 'employee'),
    team: user.roles?.find(item => item.role === 'team_leader')?.team || user.employee?.team || '方案组',
    nonEmployeeType: hasRole(user, 'leader') ? 'vip' : 'guest',
  });
}
async function saveRoles() {
  roleModal.loading = true;
  try {
    const roles = roleModal.user?.employeeId ? [] : [{ role: roleModal.nonEmployeeType === 'vip' ? 'leader' : 'guest' }];
    if (!roleModal.user?.employeeId) {
      await api.put(`/users/${roleModal.user.id}/roles`, { roles });
      message.success('权限已保存'); roleModal.open = false; await load(); return;
    }
    if (roleModal.admin) roles.push({ role: 'admin' });
    if (roleModal.leader) roles.push({ role: 'leader' });
    if (roleModal.teamLeader) roles.push({ role: 'team_leader', team: roleModal.team });
    if (roleModal.employee) roles.push({ role: 'employee' });
    if (!roles.length) return message.warning('账号至少需要一个角色');
    await api.put(`/users/${roleModal.user.id}/roles`, { roles });
    message.success('权限已保存'); roleModal.open = false; await load();
  } catch (error) { message.error(error?.error || '保存失败'); }
  finally { roleModal.loading = false; }
}

function openReset(user) { Object.assign(resetModal, { open: true, user, password: '' }); }
async function resetPassword() {
  if (!resetModal.password) return message.warning('请输入统一临时密码');
  resetModal.loading = true;
  try { await api.post(`/users/${resetModal.user.id}/reset-password`, { temporaryPassword: resetModal.password }); message.success('密码已重置'); resetModal.open = false; await load(); }
  catch (error) { message.error(error?.error || '重置失败'); }
  finally { resetModal.loading = false; }
}
async function unlock(user) { await api.post(`/users/${user.id}/unlock`); message.success('账号已解锁'); await load(); }
function toggleActive(user) {
  Modal.confirm({ title: `${user.active ? '停用' : '启用'}账号“${user.username}”？`, onOk: async () => {
    try { await api.put(`/users/${user.id}/active`, { active: !user.active }); message.success(user.active ? '账号已停用' : '账号已启用'); await load(); }
    catch (error) { message.error(error?.error || '操作失败'); }
  } });
}
onMounted(load);
</script>

<style scoped>
.accounts{padding:8px 0}.account-actions{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:18px}.account-actions h2{margin:0 0 4px}.account-actions p,.role-note{margin:0;color:var(--muted)}.role-note{margin-top:18px;font-size:12px}.ant-checkbox-wrapper{display:block;margin:0 0 14px}@media(max-width:760px){.account-actions{align-items:flex-start;flex-direction:column}}
</style>

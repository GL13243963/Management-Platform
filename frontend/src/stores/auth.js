import { defineStore } from 'pinia';
import api from '../api';

const sessionChecks = new WeakMap();

export const useAuthStore = defineStore('auth', {
  state: () => ({ user: null, ready: false, sessionError: '' }),
  getters: {
    isLoggedIn: state => !!state.user,
    isAdmin: state => state.user?.roles?.some(item => item.role === 'admin') || false,
    isLeader: state => state.user?.roles?.some(item => item.role === 'leader') || false,
    isTeamLeader: state => state.user?.roles?.some(item => item.role === 'team_leader') || false,
  },
  actions: {
    hasRole(role) { return this.user?.roles?.some(item => item.role === role) || false; },
    loadMe() {
      const pending = sessionChecks.get(this);
      if (pending) return pending;
      this.sessionError = '';
      const check = api.get('/auth/me', { timeout: 6000 })
        .then(result => {
          if (!this.ready) this.user = result.user;
        })
        .catch(error => {
          if (!this.ready && error.httpStatus !== 401) {
            this.sessionError = '登录状态检查未完成。可以直接登录，也可以重试检查。';
          }
        })
        .finally(() => {
          this.ready = true;
          sessionChecks.delete(this);
        })
        .then(() => this.user);
      sessionChecks.set(this, check);
      return check;
    },
    async login(username, password) {
      const result = await api.post('/auth/login', { username, password });
      this.user = result.user;
      this.sessionError = '';
      this.ready = true;
      return result.user;
    },
    async changePassword(currentPassword, newPassword) {
      const result = await api.post('/auth/change-password', { currentPassword, newPassword });
      this.user = result.user;
      return result.user;
    },
    async logout() {
      try { await api.post('/auth/logout'); } finally { this.user = null; this.ready = true; }
    },
  },
});

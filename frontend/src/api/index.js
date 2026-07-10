import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

api.interceptors.response.use(
  r => r.data,
  e => {
    console.error(e);
    return Promise.reject(e.response?.data || e);
  }
);

export default api;

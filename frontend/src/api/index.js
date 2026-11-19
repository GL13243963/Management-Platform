import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  withCredentials: true,
});

api.interceptors.response.use(
  r => r.data,
  e => {
    console.error(e);
    const payload = e.response?.data;
    if (payload && typeof payload === 'object') return Promise.reject({ ...payload, httpStatus: e.response.status });
    return Promise.reject({ error: typeof payload === 'string' && payload ? payload : e.message, httpStatus: e.response?.status });
  }
);

export default api;

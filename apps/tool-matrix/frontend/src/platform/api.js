import axios from 'axios';
import { identityFailure } from './navigation';
const api=axios.create({baseURL:'/api',timeout:30000,withCredentials:true});
api.interceptors.response.use(r=>r.data,e=>{
  const body=e.response?.data;
  const error={...(body && typeof body==='object'?body:{error:typeof body==='string'?body:e.message}),httpStatus:e.response?.status};
  const reason=identityFailure(error);
  if(reason) window.dispatchEvent(new CustomEvent('platform-auth-required',{detail:reason}));
  return Promise.reject(error);
});
export default api;

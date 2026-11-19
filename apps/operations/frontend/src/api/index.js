import axios from 'axios';import {returnCore} from '../platform/navigation';
const api=axios.create({baseURL:'/api',timeout:30000,withCredentials:true});
api.interceptors.response.use(r=>r.data,e=>{const data=e.response?.data,error={...(data&&typeof data==='object'?data:{error:e.message}),httpStatus:e.response?.status};if(error.httpStatus===401)returnCore('login');if(error.code==='PASSWORD_CHANGE_REQUIRED')returnCore('password');return Promise.reject(error);});export default api;

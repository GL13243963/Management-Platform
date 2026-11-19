import { reactive } from 'vue';
import api from './api';
export const identity=reactive({user:null});
export async function refreshIdentity() {
  const result=await api.get('/auth/me');
  if(!result?.user?.active) throw {error:'当前账号不可用',httpStatus:401};
  if(result.user.mustChangePassword) throw {error:'请先修改密码',code:'PASSWORD_CHANGE_REQUIRED'};
  const apps=await api.get('/os/v1/apps');
  if(!apps.some(a=>a.appId==='tool-matrix'&&a.visible&&a.status==='enabled'))throw {error:'工具矩阵暂不可访问',httpStatus:403,code:'MODULE_FORBIDDEN'};
  identity.user=result.user;
  return result.user;
}

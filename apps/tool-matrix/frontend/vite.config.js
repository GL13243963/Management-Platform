import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig(({command})=>{
  const port=process.env.TOOL_MATRIX_TEST_BACKEND_PORT;
  if(command==='serve' && (!/^\d+$/.test(port||'') || Number(port)<1024 || Number(port)>65535 || ['3001','3002'].includes(port))) throw new Error('Set TOOL_MATRIX_TEST_BACKEND_PORT to an isolated backend port (not 3001/3002)');
  return {plugins:[vue()],base:'./',server:{host:'127.0.0.1',port:5175,strictPort:true,proxy:port?{'/api':{target:'http://127.0.0.1:'+port,changeOrigin:false}}:undefined}};
});
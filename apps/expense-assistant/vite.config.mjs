import vue from '../../frontend/node_modules/@vitejs/plugin-vue/dist/index.mjs';
import { fileURLToPath } from 'node:url';

const localPath = relative => fileURLToPath(new URL(relative, import.meta.url));

export default {
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      vue: localPath('../../frontend/node_modules/vue'),
      'ant-design-vue': localPath('../../frontend/node_modules/ant-design-vue'),
      '@prototype': localPath('../../../M-baoxiao'),
    },
  },
};

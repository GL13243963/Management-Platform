import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      ...(process.env.V2_BACKEND_PORT ? { '/apps/operations': 'http://127.0.0.1:' + process.env.V2_BACKEND_PORT, '/apps/render-gallery': 'http://127.0.0.1:' + process.env.V2_BACKEND_PORT, '/apps/tool-matrix': 'http://127.0.0.1:' + process.env.V2_BACKEND_PORT } : {}),
      '/api': process.env.V2_BACKEND_PORT ? `http://127.0.0.1:${process.env.V2_BACKEND_PORT}` : 'http://localhost:3001',
    },
  },
});

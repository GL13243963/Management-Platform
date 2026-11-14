import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Antd, { ConfigProvider } from 'ant-design-vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import 'ant-design-vue/dist/reset.css';
import './styles/global.css';

import App from './App.vue';
import router from './router';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(Antd);
app.component('AConfigProvider', ConfigProvider);
app.mount('#app');

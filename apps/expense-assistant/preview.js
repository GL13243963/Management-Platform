import { createApp } from 'vue';
import { Alert, Button, ConfigProvider, Form, Input, Steps } from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';
import '../../frontend/src/styles/global.css';
import ExpensePreview from './ExpensePreview.vue';

const app = createApp(ExpensePreview);
for (const component of [Alert, Button, ConfigProvider, Form, Input, Steps]) {
  app.use(component);
}
app.mount('#app');

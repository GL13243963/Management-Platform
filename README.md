# 创新中心管理平台 · Innovation Center Management Platform

面向中建创新中心的**本地化**人员与项目管理系统。支持考勤导入自动核算工时、项目主副权重时间序列分配、多维度分析看板。

- **前端**：Vue 3 + Ant Design Vue 4 + Vite + ECharts
- **后端**：Node.js + Express + Node.js 内置 SQLite
- **主题色**：中建蓝 `#0074C4`
- **部署形态**：本机服务 + 浏览器访问（数据100%本地）

---

## ⚡ 一键运行

1. 确认已安装 **Node.js 22.5+**：<https://nodejs.org/>
2. 双击项目根目录下的 **`start.bat`**
3. 浏览器自动打开 <http://localhost:3001>

首次运行会自动安装依赖 & 构建前端（约 2–5 分钟）。之后启动只需几秒。

如需前后端热更新开发模式，双击 **`start-dev.bat`**（前端地址：<http://localhost:5173>）。

---

## 📁 目录结构

```
创新中心管理/
├── backend/
│   ├── src/
│   │   ├── index.js              入口 & 静态资源
│   │   ├── db.js                 Node.js 内置 SQLite
│   │   ├── models/               数据模型
│   │   ├── services/
│   │   │   ├── attendance.js     工时计算 & 迟到/早退判定
│   │   │   └── allocation.js     项目权重分配 & 聚合
│   │   ├── routes/
│   │   │   ├── employees.js
│   │   │   ├── projects.js
│   │   │   ├── attendance.js     Excel 导入 / 手动异常
│   │   │   └── analytics.js      多维统计
│   │   └── utils/seed.js         示例数据（可选）
│   ├── data/app.db               运行时自动创建
│   └── uploads/                  上传文件暂存
├── frontend/
│   └── src/
│       ├── App.vue               顶栏 + 侧边栏 + 路由
│       ├── views/
│       │   ├── Dashboard.vue
│       │   ├── Attendance.vue
│       │   ├── Projects.vue
│       │   ├── Allocation.vue    ← 滑块调权重
│       │   ├── Employees.vue
│       │   └── Analytics.vue
│       └── styles/global.css     中建蓝设计令牌
├── start.bat                     一键生产启动
├── start-dev.bat                 前后端开发模式
└── README.md
```

---

## 🗄 数据库表设计

| 表 | 关键字段 | 说明 |
|---|---|---|
| `employees` | name, employeeNo, department, hourlyRate | 员工信息与小时成本 |
| `projects` | code, name, manager, status | 项目主表 |
| `project_memberships` | employeeId, projectId, **weight, effectiveFrom, effectiveTo** | **时间序列**成员归属 |
| `attendance_logs` | employeeId, date, clockIn, clockOut, workHours, status, overrideType | 每日打卡（唯一：员工+日期） |
| `adjustments` | attendanceLogId, type, reason | 请假/出差/调休 审计日志 |

**权重时间序列**：调整权重时，旧记录的 `effectiveTo` 会被写为昨天，然后插入新记录（`effectiveFrom = 今天`）。历史工时永远绑定当时的分配比例。

---

## 🔌 核心 API

```
GET    /api/employees / POST / PUT /:id / DELETE /:id
GET    /api/projects  / POST / PUT /:id / DELETE /:id
GET    /api/projects/:id/members
GET    /api/projects/:id/history           权重历史
POST   /api/projects/:id/members            加入成员
POST   /api/projects/:id/members/:mId/weight  调整权重（写入新历史行）
DELETE /api/projects/:id/members/:mId         移出（当天关闭）

POST   /api/attendance/import  (multipart/form-data, file=)  Excel/CSV 导入
GET    /api/attendance?startDate=&endDate=&employeeId=&status=
PATCH  /api/attendance/:id     异常标记 / 手动改工时

GET    /api/analytics/summary
GET    /api/analytics/by-project
GET    /api/analytics/by-employee
GET    /api/analytics/labor-cost
```

---

## 📥 Excel 导入格式

自动识别下列列名（中英混用可）：

| 姓名 / name | 日期 / date | 上班打卡 / clockIn | 下班打卡 / clockOut |
|---|---|---|---|
| 张伟 | 2026-07-01 | 09:32 | 17:35 |
| 李娜 | 2026-07-01 | 09:41 | 17:28 |

**工时规则**：
- 标准班：`09:35 – 17:30`
- 上班 > 09:35 → 标记 **迟到**
- 下班 < 17:30 → 标记 **早退**
- 工时 = 下班时间 − 上班时间
- 手动标记「请假 / 出差 / 调休」后，清除迟到/早退，工时按 8 小时全勤计入

---

## 🎨 视觉规范

| 令牌 | 值 |
|---|---|
| Primary | `#0074C4` |
| Hover | `#E6F1FA` |
| 卡片圆角 | `8px` |
| 卡片阴影 | `0 4px 12px rgba(0,0,0,0.08)` |
| 模块间距 | `20–24px` |
| 表格 | 斑马纹 + hover 高亮 + 表头灰底 |

---

## 🌱 示例数据（可选）

想快速体验界面：

```bash
cd backend
npm run seed   # 会清空并写入 4 名员工、2 个项目、10 天考勤
```

⚠️ `npm run seed` 会 **重建** `app.db`，请勿在生产数据上执行。

---

## ❓ 常见问题

- **端口冲突**：修改 `backend/src/index.js` 中的 `PORT`，或设置环境变量 `PORT=3002`
- **重置数据库**：删除 `backend/data/app.db`，下次启动会自动重建
- **想在局域网内其他电脑访问**：Windows 防火墙放行 3001 端口，其他设备访问 `http://<本机IP>:3001`

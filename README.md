<div align="center">
  <a href="./README_en.md">English</a> | 简体中文
</div>

# Fitness-Food (饮食管理与 AI 营养分析系统)

![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?style=flat-square&logo=tailwind-css)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)
![AI](https://img.shields.io/badge/AI-Enabled-brightgreen?style=flat-square)

本项目是一个集成 AI 智能语义分析与多维数据可视化的饮食管理系统。系统旨在通过技术手段简化每日营养追踪的繁琐流程，并基于大语言模型（LLM）提供精准的膳食反馈，助力用户科学达成健身与健康目标。

## 🏛️ 系统工程与技术解析

### 1. 现代化全栈架构 (Modern Full-stack)
- **Next.js 15 (App Router)**: 系统核心路由逻辑基于 Next.js 15 构建。通过深度应用 Server Components，我们将复杂的数据库查询逻辑保留在服务端，显著降低了客户端的 JS 执行压力。
- **React 19 Concurrent Mode**: 利用 React 19 的最新特性，系统在处理图表渲染与表单校验等高频交互时，能保持界面的极高响应速度。

### 2. AI 驱动的录入管道 (AI-Powered Ingestion)
传统的饮食记录系统需要手动检索食材，录入效率低下。本项目引入了 **AI 语义解析模块**：
- **逻辑流**: 用户输入自然语言 -> 后端 AI 解析器识别食材与近似分量 -> 根据内置营养数据库或大模型知识库估算热量、蛋白质、碳水、脂肪。
- **提示词工程**: 在 `src/ai` 目录下，我们精心设计了针对营养成分拆解的系统提示词，确保了解析结果的标准化与高准确度。

### 3. 数据可视化工程 (Data Visualization)
集成 **Recharts** 构建实时监控仪表盘：
- **宏量元素看板**: 通过环形图（Pie Chart）实时反馈每日摄入占比，引导用户平衡营养结构。
- **动态趋势分析**: 利用平滑折线图展示摄入量与体重的关联趋势，支持动态的时间跨度筛选。

## 📂 核心目录解析

```text
fitness-food/
├── src/
│   ├── ai/             # AI 解析引擎核心逻辑、提示词模板与数据标准化中间件
│   ├── app/            # Next.js 15 页面、全局布局与强类型的 API 端点实现
│   ├── components/     # UI 原子组件、业务仪表盘模块与交互式 Recharts 包装器
│   ├── lib/            # 针对边缘环境优化的数据库连接池与通用底层工具函数
│   └── hooks/          # 封装了数据流管理、SWR 同步与状态持久化逻辑
├── db/                 # SQL 初始化脚本、模式定义与压力测试种子数据
├── deploy/             # 用于一键启动的环境编排配置
└── package.json        # 详尽的依赖管理与项目生命周期钩子
```

## 🚀 开发者快速部署

### 1. 物理环境
- Node.js >= 20
- PostgreSQL >= 16

### 2. 部署流程
```bash
# 安装依赖
npm install

# 配置 .env.local
# DATABASE_URL=postgresql://user:password@localhost:5432/fitness_food

# 数据库模式初始化
npm run db:setup

# 启动高性能开发环境
npm run dev
```

## 许可证
本项目遵循 MIT License 协议。

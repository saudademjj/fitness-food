<div align="center">
  <a href="./README.md">简体中文</a> | <a href="./README_en.md">English</a>
</div>

# Fitness-Food (饮食管理与 AI 营养分析系统 / Fitness-Food Diet Management & AI Nutrition System)

![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?style=flat-square&logo=tailwind-css)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)
![AI](https://img.shields.io/badge/AI-Enabled-brightgreen?style=flat-square)

本项目是一个现代化的全栈饮食追踪与营养分析应用。系统结合了直观的数据可视化图表与基于大语言模型（LLM）的语义分析逻辑，旨在协助用户通过数据化手段精确管理每日营养摄入，助力健身目标的达成。

This project is a modern full-stack diet tracking and nutrition analysis application. Combining intuitive data visualization with LLM-based semantic analysis, the system helps users precisely manage daily nutritional intake through data-driven methods to achieve fitness goals.

## 核心工程点 / Engineering Highlights

### 1. 多维营养分析 (Multi-dimensional Nutrition Analysis)
- **数据可视化**: 集成 Recharts 动态渲染环形营养素占比图与热量摄入趋势图。 / Dynamic Recharts for nutrient distribution and calorie trends.
- **目标达成监控**: 实时对比每日设定的宏量营养素阈值（蛋白质、碳水、脂肪），并提供直观的进度预警。 / Real-time monitoring of daily macronutrient thresholds with progress alerts.

### 2. AI 赋能实验 (AI-Powered Exploration)
- **语义化解析**: 尝试利用 AI 模块对非结构化的饮食描述进行营养成分拆解，降低录入成本。 / Utilizing AI modules to decompose unstructured dietary descriptions into nutritional data.
- **智能改进建议**: 基于用户的历史记录与目标（增肌/减脂），动态生成饮食优化策略。 / Dynamically generating diet optimization strategies based on history and goals.

## 技术栈拆解 / Technical Stack Analysis

| 层级 / Layer | 技术选型 / Technology | 核心用途 / Purpose |
| :--- | :--- | :--- |
| **应用框架** | Next.js 15 (App Router) | 利用 React 19 并发特性与 Server Components。 / RSC and concurrent features. |
| **数据持久层** | PostgreSQL (Node-postgres) | 维护用户画像、食谱库与摄入流水。 / Profile, recipe library, and intake logs. |
| **运行时校验** | Zod | 严格保证 API 端点入参的类型安全性。 / Strict type safety for API inputs. |
| **可视化引擎** | Recharts | 渲染高性能的客户端交互图表。 / High-performance interactive charts. |

## 项目目录结构 / Project Structure

```text
fitness-food/
├── src/
│   ├── ai/             # AI 核心分析逻辑、提示词模板与解析中间件 / AI logic & prompt engineering
│   ├── app/            # Next.js 15 页面容器、API 路由与全局布局 / Next.js pages & API routes
│   ├── components/     # UI 原子组件、业务统计看板与表单模块 / Components & dashboards
│   ├── hooks/          # 数据流管理与状态持久化自定义 Hook / Data flow & state hooks
│   └── lib/            # 数据库连接池封装与共享底层工具类 / DB clients & core utilities
├── db/                 # 物理存储初始化脚本与种子数据 / Database schemas & seed data
├── deploy/             # 容器化部署与 CI/CD 相关配置 / Deployment & CI/CD configs
└── package.json        # 依赖管理、构建脚本与项目元数据 / Dependencies & scripts
```

## 快速运行 / Quick Start
```bash
# 安装项目依赖 / Install dependencies
npm install

# 配置环境变量 / Setup environment
# 在 .env.local 中配置 DATABASE_URL=postgresql://...

# 启动开发服务器 / Launch development server
npm run dev
```

## 未来路线图 / Roadmap
- [ ] 接入图像识别 API，实现通过拍照自动抓取食物营养成分。
- [ ] 增加多用户饮食 PK 与社交激励排行榜功能。
- [ ] 完善支持 PWA 离线存储，确保在无网环境下依然可以记录。

## 许可证 / License
本项目采用 MIT License 协议。 / Licensed under the MIT License.

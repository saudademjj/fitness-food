# Fitness-Food (全栈健身饮食管理与 AI 营养分析系统)

[![Next.js](https://img.shields.io/badge/Next.js-15.5-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind--CSS-3.4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![AI Powered](https://img.shields.io/badge/AI-Enabled-brightgreen)](https://openai.com/)

Fitness-Food 是一款现代化的健身饮食管理工具，旨在通过数据化手段优化营养追踪与健康管理流程。项目集成了直观的数据可视化分析与 AI 驱动的营养评估建议，帮助用户实现精确的阶段性健身目标。

## 核心功能

- 结构化饮食追踪: 实现每日餐食的高效录入，支持自定义食材库与热量自动汇总。
- 多维数据可视化: 集成 Recharts 动态图表，直观呈现宏量营养素占比、每日热量趋势及体重变化曲线。
- AI 营养评估系统: 基于大语言模型对用户摄入内容进行深度分析，提供针对性的优化建议与补剂方案。
- 现代化 UI/UX: 基于 Radix UI 核心组件与 Tailwind CSS 构建，支持完全的响应式标准。
- 目标进度动态监控: 实时对比每日设定的营养阈值（碳水、蛋白质、脂肪），并提供直观的进度预警。

## 技术栈

### 前端层 (Frontend)
- 框架: Next.js 15 (App Router)
- 核心引擎: React 19
- 数据图表: Recharts
- 逻辑校验: React Hook Form + Zod
- 组件库: Radix UI + Tailwind CSS

### 后端与存储 (Backend & Storage)
- 数据库: PostgreSQL (Node-postgres 驱动)
- AI 核心逻辑: 自研 AI 解析层 (位于 src/ai 模块)
- 时间处理: date-fns
- 维护工具: tsx (运行环境优化)

## 项目结构

```text
.
├── src
│   ├── ai              # AI 分析引擎模块
│   ├── app             # Next.js 路由与页面容器
│   ├── components      # 原子化业务组件库
│   ├── hooks           # 数据流与生命周期钩子
│   ├── lib             # 数据库引擎与工具函数库
│   └── scripts         # 数据库健康检查与监控脚本
├── db                  # 数据库初始化脚本
├── deploy              # 容器化部署配置
└── package.json
```

## 快速启动

### 1. 基础配置
安装依赖包：
```bash
npm install
```

### 2. 数据库配置
在 `.env.local` 中配置 PostgreSQL 连接串：
```env
DATABASE_URL=postgresql://user:password@localhost:5432/fitness_food
```

### 3. 环境启动
```bash
npm run dev
```

## 未来路线
- 引入多模态视觉识别技术，通过食物图片自动抓取营养成分数据。
- 接入第三方健康平台 (Apple Health / Google Fit) 实现数据的无缝同步。
- 引入 PWA 支持，优化弱网环境下的数据离线写入性能。

## 许可证
本项目采用 MIT License 协议。

---
Developed by [saudademjj](https://github.com/saudademjj)

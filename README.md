# Fitness-Food (饮食管理与 AI 营养分析系统)

[![Next.js](https://img.shields.io/badge/Next.js-15.5-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind--CSS-3.4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![AI](https://img.shields.io/badge/AI-Enabled-brightgreen)](https://openai.com/)

Fitness-Food 是一款用于个人饮食追踪与营养分析的 Web 应用。项目结合了基础的数据录入与可视化图表，并尝试引入 AI 模块以辅助用户进行营养摄入评估。

## 主要功能

- 饮食记录: 每日餐食的热量与营养素录入及持久化存储。
- 数据可视化: 利用 Recharts 动态展示营养摄入趋势及体重变化。
- AI 分析实验: 基于 LLM 对摄入内容进行分析并给出改进建议。
- 目标设定: 支持设定每日宏量营养素目标，并实时对比当前进度。

## 技术栈

- 前端: Next.js 15, React 19, Recharts, Tailwind CSS
- 后端与数据库: PostgreSQL (Node-postgres), AI 处理模块
- 开发工具: Radix UI, zod (数据校验), date-fns

## 项目结构

```text
.
├── src
│   ├── ai              # AI 分析模块
│   ├── app             # Next.js 页面与路由
│   ├── components      # UI 组件
│   ├── hooks           # 自定义 Hook
│   ├── lib             # 数据库引擎
│   └── scripts         # 维护脚本
├── db                  # SQL 初始化文件
└── package.json
```

## 快速启动

### 1. 配置
`npm install` 之后，在 `.env.local` 配置数据库连接：
```env
DATABASE_URL=postgresql://user:password@localhost:5432/fitness_food
```

### 2. 运行
`npm run dev`

## 许可证
MIT License

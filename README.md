# Fitness-Food (饮食管理与 AI 营养分析系统 / Fitness-Food Diet Management & AI Nutrition System)

本项目是一个现代化的全栈饮食追踪与营养分析应用。通过数据可视化展示摄入趋势，并利用 AI 模块提供初步的膳食建议，协助用户科学管理健康与健身目标。

This project is a modern full-stack diet tracking and nutrition analysis application. It features data visualization of intake trends and an AI module for dietary suggestions, helping users scientifically manage their health and fitness goals.

## 核心特性 / Core Features

- 饮食追踪 (Dietary Tracking):
    - 实现餐食热量与宏量营养素 (蛋白质、碳水、脂肪) 的分级录入。 / Multi-level logging for calories and macronutrients.
    - 支持历史数据按天检索与对比。 / Daily historical data retrieval and comparison.

- AI 营养助手 (AI Nutrition Assistant):
    - 结合大语言模型对记录内容进行语义化分析。 / Semantic analysis of records using LLMs.
    - 提供个性化的饮食配比优化建议。 / Personalized optimization suggestions for dietary balance.

- 数据可视化 (Data Visualization):
    - 基于 Recharts 渲染营养素分布环形图与热量趋势折线图。 / Recharts-based nutrient distribution and calorie trend charts.
    - 实时呈现目标达成百分比进度条。 / Real-time percentage progress bars for goal achievement.

## 技术栈 / Technical Stack

- 前端: Next.js 15 (App Router), React 19, Recharts, Tailwind CSS.
- 后端: Node.js (Next.js API Routes), AI 分析引擎模块.
- 存储: PostgreSQL (pg 驱动), 持久化用户摄入与个人配置数据.
- 工具: Radix UI (无障碍组件), zod (运行时数据校验), date-fns (时间处理).

## 项目结构 / Project Structure

```text
fitness-food/
├── src/
│   ├── ai/             # AI 解析逻辑与提示词模板 / AI parsing logic and templates
│   ├── app/            # Next.js 15 页面与 API 路由 / Next.js pages and API routes
│   ├── components/     # UI 基础组件与统计看板组件 / UI and dashboard components
│   ├── hooks/          # 数据流与状态持久化钩子 / Data flow and state hooks
│   └── lib/            # 数据库访问客户端与通用工具 / DB client and utilities
├── db/                 # SQL 初始化与播种脚本 / SQL initialization and seeding
└── package.json        # 依赖与脚本定义 / Dependencies and scripts
```

## 快速开始 / Quick Start

```bash
npm install
# 配置 .env.local (DATABASE_URL)
npm run dev
```

## 许可证 / License
本项目采用 [MIT License](LICENSE) 协议。 / This project is licensed under the MIT License.

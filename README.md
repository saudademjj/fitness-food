<div align="center">
  <a href="./README_en.md">English</a> | 简体中文
</div>

# Fitness-Food (饮食管理与 AI 营养分析系统)

![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?style=flat-square&logo=tailwind-css)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)
![AI](https://img.shields.io/badge/AI-Enabled-brightgreen?style=flat-square)

本项目是一款现代化的全栈饮食追踪与营养分析应用。系统结合了直观的数据可视化技术与大语言模型（LLM）的语义分析能力，旨在协助用户通过数据化手段精确管理每日营养摄入，科学达成增肌或减脂目标。

## 核心工程点

### 1. 多维营养数据可视化
集成 **Recharts** 驱动的动态统计模块：
- **实时看板**: 动态渲染蛋白质、碳水化合物与脂肪的每日摄入比例环形图。
- **趋势分析**: 呈现热量摄入与体重波动的关联性折线图，辅助用户进行阶段性复盘。

### 2. AI 赋能的交互实验
系统尝试引入 AI 模块以优化传统饮食记录的繁琐流程：
- **非结构化录入**: 允许用户输入自然语言（如“中午吃了一个巨无霸和一小份薯条”），通过 AI 模块自动拆解营养成分。
- **智能策略生成**: 根据用户的历史摄入数据与健身目标，动态提供膳食优化建议。

### 3. 类型安全的工程实践
- **全链路校验**: 结合 Zod 与 React Hook Form，在客户端与 API 端点实现双重 Schema 校验，确保摄入数据的高准确性。
- **持久层治理**: 基于 PostgreSQL 维护用户画像与食谱库，利用索引优化历史记录的分页查询。

## 项目结构图

```text
fitness-food/
├── src/
│   ├── ai/             # AI 分析引擎核心逻辑与提示词模板
│   ├── app/            # Next.js 15 App Router 页面与 API 端点
│   ├── components/     # UI 原子组件、业务看板与交互图表
│   ├── hooks/          # 数据流管理与状态持久化逻辑
│   └── lib/            # 数据库连接池封装与底层工具函数库
├── db/                 # SQL 初始化脚本与结构定义
├── deploy/             # 环境编排相关配置文件
└── package.json        # 依赖清单与项目生命周期定义
```

## 许可证
本项目采用 MIT License 协议。

<div align="center">
  <a href="./README_en.md">English</a> | 简体中文
</div>

# Fitness-Food -- 饮食管理与 AI 营养分析系统

![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?style=flat-square&logo=tailwind-css)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)
![AI](https://img.shields.io/badge/Gemini_AI-Enabled-brightgreen?style=flat-square)

Fitness-Food 是一套结合 AI 自然语言解析、PostgreSQL 营养数据库查询与交互式营养追踪的饮食管理系统。系统在运行时优先使用数据库直接匹配简单食物描述，仅在需要自然语言解析时才调用 Gemini 模型，并支持复合菜品的运行时营养聚合，输出完整的 23 项营养素数据。

## 系统亮点

- 简单食物描述优先命中 PostgreSQL，避免不必要的模型调用开销
- Gemini 仅用于复杂描述、食物拆解和保守的兜底估算
- 复合菜品支持「食谱 / AI 拆解原料 -> 逐原料数据库查询 -> 运行时聚合」的完整流程
- 界面追踪完整的 23 项营养素组，包括钾、锌、维生素 A/C/D/B12 和叶酸
- 确认对话框中的克重调整在本地重新计算，不额外消耗模型预算
- 运行时可观测性覆盖查询未命中、解析遥测、错误遥测和物化视图刷新状态

## 查询优先级

1. `recipe_alias` 精确匹配标准食谱
2. `canonical_food_alias` 精确匹配规范食物名
3. `app_catalog_profile_23.food_name_zh` 直接匹配
4. Gemini 兜底，附带保守校验与数值钳位

## 运行时营养管线

- `core.portion_reference` 提供中式标准份量参考与单位换算
- 安全的 `pg_trgm` 模糊匹配替代危险的 `ILIKE '%term%'` 子串查询
- 运行时校验在严格品类中拒绝明显不一致的数据库候选项，必要时回退到品牌营养数据
- `app.food_log_item.per100g_profile` 和 `app.food_log_item.totals_profile` 存储完整的 23 项营养素 JSON
- `app.lookup_miss_telemetry` 维护反馈闭环，用于别名和 ETL 清洗
- `app.food_parse_telemetry`、`app.runtime_error_telemetry` 和 `app.materialized_view_refresh_state` 支撑生产环境健康检查与刷新编排

## 技术架构

### 前端

- Next.js 15 App Router + React 19 Server Components
- Tailwind CSS 3.4 响应式布局
- shadcn/ui 组件库（基于 Radix UI）
- 表单校验：React Hook Form + Zod
- 图表可视化：Recharts

### 后端

- Next.js Server Actions（类型安全的服务端操作）
- PostgreSQL 16 + pg_trgm 扩展
- 物化视图加速高频查询
- Gemini AI 自然语言食物解析引擎

### AI 解析引擎

- 多级 Prompt 模板：简单食物、复合菜品、份量估算
- 保守校验策略：营养素数值钳位、异常值拒绝
- 解析遥测：记录每次 AI 调用的输入输出与耗时

## 目录结构

```text
fitness-food/
├── src/
│   ├── ai/             # AI 解析引擎、Prompt 模板与营养兜底逻辑
│   ├── app/            # Next.js 15 页面、布局与类型化 Server Actions
│   ├── components/     # UI 组件与营养仪表盘模块
│   ├── lib/            # 数据库查询、校验、运行时聚合与工具函数
│   └── hooks/          # 数据流管理与状态辅助
├── db/                 # SQL 迁移脚本、报告与刷新脚本
├── deploy/             # 部署配置与 systemd 资产
├── docs/               # 项目文档
└── package.json        # 依赖与生命周期脚本
```

## 快速开始

### 环境要求

- Node.js >= 20
- PostgreSQL >= 16（需启用 pg_trgm 扩展）

### 安装与启动

```bash
git clone https://github.com/saudademjj/fitness-food.git
cd fitness-food
npm install
```

### 数据库初始化

1. 执行迁移脚本：

```bash
psql "$DATABASE_URL" -f db/migrations/20260316_food_system_upgrade.sql
psql "$DATABASE_URL" -f db/migrations/20260316_nutrition_profile23_upgrade.sql
psql "$DATABASE_URL" -f db/migrations/20260317_nutrition_runtime_hardening.sql
psql "$DATABASE_URL" -f db/migrations/20260317_runtime_composite_observability.sql
psql "$DATABASE_URL" -f db/migrations/20260319_runtime_lookup_brand_safety.sql
```

2. 刷新物化视图：

```bash
bash ./db/refresh_materialized_views.sh
```

### 启动开发服务器

```bash
npm run dev
```

访问 `http://localhost:9002` 即可使用。

### 其他命令

```bash
npm run build        # 生产构建
npm run test         # 运行测试
npm run typecheck    # 类型检查
npm run lint         # 代码检查
```

## 运行时健康检查

```bash
npm run report:runtime-db    # 生成运行时数据库健康报告
```

该命令会检查物化视图刷新状态、查询未命中统计和错误遥测汇总。

## 许可证

MIT License

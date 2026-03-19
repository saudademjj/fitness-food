<div align="center">

<a href="./README_en.md">English</a> | 简体中文

# Fitness-Food

### 饮食管理与 AI 营养分析系统

![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?style=flat-square&logo=tailwind-css)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)
![Qwen](https://img.shields.io/badge/Qwen_3.5-Enabled-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

Fitness-Food 是一套面向中文用户的智能饮食管理系统。通过自然语言描述即可完成食物记录，系统优先从 PostgreSQL 营养数据库精确匹配，仅在必要时调用 Qwen 3.5 AI 进行解析，最终输出完整的 23 项营养素追踪数据。

</div>

---

## 目录

- [核心特性](#核心特性)
- [系统架构](#系统架构)
- [营养素查询管线](#营养素查询管线)
- [23 项营养素追踪](#23-项营养素追踪)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [数据库初始化](#数据库初始化)
- [可用命令](#可用命令)
- [运行时可观测性](#运行时可观测性)
- [认证系统](#认证系统)
- [部署](#部署)
- [许可证](#许可证)

---

## 核心特性

### 智能食物解析

- 支持自然语言输入，如「一碗米饭加两个煎蛋」，系统自动拆解为独立食物条目
- 复合菜品（如「番茄炒蛋」）自动拆解原料，逐一查询数据库后运行时聚合营养数据
- 份量智能估算，识别「小/中/大/超大」等量词，并根据烹饪方式（生/熟/炒/炸/烤/炖/汤）自动调整

### 数据库优先策略

- 简单食物描述直接命中 PostgreSQL，零模型调用开销
- Qwen 3.5 AI 仅作为兜底手段，用于复杂描述和无法匹配的场景
- 安全的 `pg_trgm` 模糊匹配替代危险的 `ILIKE '%term%'` 子串查询
- 品牌食品（如可口可乐、麦乐鸡）使用策划好的品牌营养数据覆盖

### 完整营养追踪

- 追踪 23 项营养素，远超传统的卡路里/三大宏量营养素模式
- 营养素分组展示：宏量营养素、电解质、矿物质、维生素
- 每条记录标注数据来源与可靠性（精确匹配 / 模糊匹配 / AI 估算 / 复合聚合）
- 确认对话框中调整克重时，营养数据在本地实时重算，不额外消耗模型预算

### 交互式仪表盘

- 四大核心指标（热量、蛋白质、碳水、脂肪）进度条实时展示
- 可展开的 23 项营养素详情网格，按分组着色显示
- 每条食物记录展示匹配模式、置信度、校验标记等元数据
- 基于 Recharts 的营养趋势图表可视化

### 双模式用户体系

- 匿名用户：数据存储在本地，即开即用
- 认证用户：通过 Magic Link 邮箱登录，数据同步至 PostgreSQL
- 登录后支持将本地草稿一键迁移至云端

---

## 系统架构

```
                    用户输入（自然语言）
                           |
                    +------v------+
                    |  文本预处理  |  归一化、分段、量词提取
                    +------+------+
                           |
              +------------v------------+
              |     直接解析器（快速路径）  |
              +------------+------------+
                           |
            +--------------+--------------+
            |              |              |
     单一食物匹配    多食物拆分     复合菜品检测
            |              |              |
            v              v              v
    +-------+-------+  逐段解析   食谱原料查询
    | 四级查询优先级  |     |        + 运行时聚合
    +-------+-------+     |              |
            |              +---------+----+
            v                        |
    +-------+--------+              v
    | 营养数据组装     |<-----------+
    | (23项完整档案)   |
    +-------+---------+
            |
            v
    +-------+---------+
    |  校验与遥测记录   |  异常值拒绝、热力学一致性检查
    +-------+---------+
            |
            v
    +-------+---------+
    |  确认对话框       |  克重调整、本地重算
    +-------+---------+
            |
            v
    +-------+---------+
    |  持久化存储       |  本地 / PostgreSQL
    +-----------------+
```

---

## 营养素查询管线

系统采用四级优先级策略，逐级尝试直到命中：

| 优先级 | 查询层 | 说明 |
|:---:|---|---|
| 1 | `recipe_alias` | 精确匹配标准食谱名称 |
| 2 | `canonical_food_alias` | 精确匹配规范食物别名 |
| 3 | `app_catalog_profile_23` | 食物目录直接匹配 + `pg_trgm` 模糊匹配 |
| 4 | Qwen 3.5 AI 兜底 | 自然语言解析，附带保守校验与数值钳位 |

关键机制：

- 物化视图加速高频查询，由 systemd 定时器每日自动刷新
- 运行时校验在严格品类中拒绝明显不一致的数据库候选项
- `lookup_miss_telemetry` 维护反馈闭环，驱动别名补充和 ETL 清洗
- AI 调用记录完整的输入输出、Token 消耗与耗时，用于成本监控

---

## 23 项营养素追踪

| 分组 | 营养素 |
|---|---|
| 宏量营养素 | 热量 (kcal)、蛋白质 (g)、碳水化合物 (g)、脂肪 (g)、膳食纤维 (g)、糖 (g) |
| 电解质 | 钠 (mg)、钾 (mg) |
| 矿物质 | 钙 (mg)、镁 (mg)、铁 (mg)、锌 (mg) |
| 维生素 | 维生素 A (mcg)、维生素 C (mg)、维生素 D (mcg)、维生素 E (mg)、维生素 K (mcg)、硫胺素 B1 (mg)、核黄素 B2 (mg)、烟酸 B3 (mg)、维生素 B6 (mg)、维生素 B12 (mcg)、叶酸 (mcg) |

每条食物记录存储 `per100g_profile`（每百克营养档案）和 `totals_profile`（实际摄入总量），并标注数据状态：已测量 / 估算 / 部分缺失 / 缺失。

---

## 技术栈

### 前端

| 技术 | 用途 |
|---|---|
| Next.js 15 App Router | 页面路由与服务端渲染 |
| React 19 Server Components | 服务端组件与流式渲染 |
| Tailwind CSS 3.4 | 响应式样式系统 |
| shadcn/ui (Radix UI) | 无障碍 UI 组件库 |
| React Hook Form + Zod | 表单管理与类型安全校验 |
| Recharts | 营养数据图表可视化 |
| Lucide React | 图标库 |

### 后端

| 技术 | 用途 |
|---|---|
| Next.js Server Actions | 类型安全的服务端操作 |
| PostgreSQL 16 | 主数据库，营养数据与用户日志 |
| pg_trgm 扩展 | 三元组模糊匹配 |
| 物化视图 | 高频查询加速 |
| node-pg | 数据库连接池 |

### AI 与解析

| 技术 | 用途 |
|---|---|
| DashScope / Qwen API | 自然语言食物描述解析 |
| 多级 Prompt 模板 | 简单食物 / 复合菜品 / 份量估算 |
| 保守校验策略 | 营养素数值钳位、异常值拒绝、热力学一致性检查 |
| 解析遥测 | 记录每次 AI 调用的输入输出、Token 与耗时 |

### 认证与安全

| 技术 | 用途 |
|---|---|
| Magic Link 邮箱认证 | 无密码登录，15 分钟链接有效期 |
| 会话管理 | 30 天会话有效期 |
| 速率限制 | 匿名 8 次/分钟，认证 20 次/分钟 |

---

## 目录结构

```text
fitness-food/
├── src/
│   ├── ai/
│   │   └── flows/
│   │       └── parse-food-description-flow.ts   # AI 解析编排：直接解析 -> 分段 -> Qwen 兜底
│   ├── app/
│   │   ├── page.tsx                             # 主页面与状态协调器
│   │   ├── layout.tsx                           # 根布局
│   │   ├── auth/callback/route.ts               # Magic Link 回调处理
│   │   └── actions/
│   │       ├── auth.ts                          # 认证相关 Server Actions
│   │       ├── food.ts                          # 食物解析 Server Actions（含速率限制）
│   │       └── logs.ts                          # 食物日志 CRUD、导出、本地迁移
│   ├── components/
│   │   ├── macro-calculator/
│   │   │   ├── dashboard-summary.tsx            # 营养仪表盘（四大指标 + 23项详情）
│   │   │   ├── food-input-form.tsx              # 自然语言食物输入表单
│   │   │   ├── food-log-list.tsx                # 食物记录列表（含元数据徽章）
│   │   │   ├── confirmation-dialog.tsx          # 解析确认对话框（克重调整）
│   │   │   ├── nutrition-detail-grid.tsx        # 23项营养素网格展示
│   │   │   └── types.ts                        # 类型定义
│   │   └── ui/                                  # 35 个 shadcn/ui 基础组件
│   ├── hooks/
│   │   ├── use-food-log.ts                      # 食物日志状态管理
│   │   └── use-mobile.tsx                       # 移动端检测
│   └── lib/
│       ├── nutrition-profile.ts                 # 23项营养素字段定义与聚合函数
│       ├── nutrition-db.ts                      # 四级优先级数据库查询解析器
│       ├── food-contract.ts                     # Zod Schema 与校验标记定义
│       ├── food-text.ts                         # 文本归一化与食物名提取
│       ├── direct-food-parser.ts                # 直接解析快速路径
│       ├── composite-dish.ts                    # 复合菜品原料拆解与聚合
│       ├── portion-reference.ts                 # 中式份量参考与单位换算
│       ├── resolved-food.ts                     # 最终食物条目组装
│       ├── validation.ts                        # 宏量营养素校验与一致性检查
│       ├── food-log-db.ts                       # 食物日志数据库操作
│       ├── auth.ts                              # Magic Link 认证逻辑
│       ├── smtp.ts                              # 邮件发送
│       ├── db.ts                                # PostgreSQL 连接池
│       ├── qwen.ts                              # DashScope / Qwen API 集成（重试、超时）
│       ├── rate-limit.ts                        # 内存速率限制器
│       ├── runtime-observability.ts             # 解析遥测与错误记录
│       ├── ai-usage-telemetry.ts                # AI 调用 Token 与耗时追踪
│       ├── miss-telemetry.ts                    # 查询未命中反馈闭环
│       └── ...                                  # 其他工具函数
├── db/
│   ├── migrations/                              # 9 个 SQL 迁移脚本
│   │   ├── 20260316_food_system_upgrade.sql
│   │   ├── 20260316_nutrition_profile23_upgrade.sql
│   │   ├── 20260317_nutrition_runtime_hardening.sql
│   │   ├── 20260317_runtime_composite_observability.sql
│   │   ├── 20260319_runtime_lookup_brand_safety.sql
│   │   └── ...
│   ├── refresh_materialized_views.sh            # 物化视图刷新脚本
│   └── reports/                                 # 数据库健康报告 SQL
├── deploy/
│   └── systemd/                                 # 物化视图每日刷新定时器
│       ├── fitness-food-refresh.service
│       └── fitness-food-refresh.timer
├── docs/
│   ├── deployment.md                            # 部署与运维文档
│   └── blueprint.md                             # 早期设计蓝图（仅供参考）
├── scripts/
│   └── report-runtime-db-health.ts              # 运行时数据库健康检查脚本
└── package.json
```

---

## 快速开始

### 环境要求

- Node.js >= 20
- PostgreSQL >= 16（需启用 `pg_trgm` 扩展）
- DashScope API Key（用于 AI 兜底解析）

### 1. 克隆与安装

```bash
git clone https://github.com/saudademjj/fitness-food.git
cd fitness-food
npm install
```

### 2. 配置环境变量

在项目根目录创建 `.env.local` 文件：

```bash
# 数据库连接（必需）
DATABASE_URL=postgresql://localhost:5432/foodetl_local

# DashScope / Qwen（AI 兜底解析需要）
DASHSCOPE_API_KEY=your_dashscope_api_key
QWEN_MODEL=qwen3.5-plus

# Magic Link 认证（可选，不配置则仅支持匿名模式）
APP_BASE_URL=http://localhost:9002
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_FROM=noreply@example.com
```

### 3. 初始化数据库

```bash
# 执行迁移脚本
psql "$DATABASE_URL" -f db/migrations/20260316_food_system_upgrade.sql
psql "$DATABASE_URL" -f db/migrations/20260316_nutrition_profile23_upgrade.sql
psql "$DATABASE_URL" -f db/migrations/20260317_nutrition_runtime_hardening.sql
psql "$DATABASE_URL" -f db/migrations/20260317_runtime_composite_observability.sql
psql "$DATABASE_URL" -f db/migrations/20260319_runtime_lookup_brand_safety.sql

# 刷新物化视图
bash ./db/refresh_materialized_views.sh
```

### 4. 启动开发服务器

```bash
npm run dev
```

访问 `http://localhost:9002` 即可使用。

---

## 环境变量

| 变量 | 必需 | 说明 |
|---|:---:|---|
| `DATABASE_URL` | 是 | PostgreSQL 连接字符串 |
| `DASHSCOPE_API_KEY` | 是 | 阿里云百炼 DashScope API 密钥，用于 AI 兜底解析 |
| `QWEN_MODEL` | 否 | Qwen 模型名，默认 `qwen3.5-plus` |
| `APP_BASE_URL` | 否 | 应用基础 URL，Magic Link 认证需要 |
| `SMTP_HOST` | 否 | SMTP 服务器地址 |
| `SMTP_PORT` | 否 | SMTP 端口 |
| `SMTP_FROM` | 否 | 发件人邮箱地址 |

> 也可使用 `PGHOST`、`PGPORT`、`PGDATABASE` 等 `PG*` 环境变量替代 `DATABASE_URL`。

---

## 可用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动开发服务器（Turbopack，端口 9002） |
| `npm run build` | 生产环境构建 |
| `npm run start` | 启动生产服务器 |
| `npm run test` | 运行全部测试 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 代码检查 |
| `npm run report:runtime-db` | 生成运行时数据库健康报告 |

运行单个测试文件：

```bash
npx tsx --test src/lib/nutrition-db.test.ts
```

---

## 运行时可观测性

系统内置多维度的运行时监控能力：

| 遥测表 | 用途 |
|---|---|
| `app.food_parse_telemetry` | 记录每次食物解析的输入、输出、耗时与结果 |
| `app.lookup_miss_telemetry` | 记录数据库查询未命中，驱动别名补充与 ETL 优化 |
| `app.runtime_error_telemetry` | 捕获运行时错误，支撑生产环境排障 |
| `app.ai_usage_telemetry` | 追踪 Qwen API 调用的 Token 消耗与延迟 |
| `app.materialized_view_refresh_state` | 物化视图刷新状态与时间戳 |

生成健康报告：

```bash
npm run report:runtime-db
```

该命令输出物化视图刷新状态、查询未命中统计和错误遥测汇总。

---

## 认证系统

系统采用 Magic Link 无密码认证方案：

1. 用户输入邮箱，系统生成一次性登录链接（15 分钟有效）
2. 用户点击邮件中的链接完成登录
3. 登录后创建 30 天有效期的会话
4. 认证用户的食物日志同步至 PostgreSQL
5. 登录后可将匿名模式下的本地数据一键迁移至云端

未配置 SMTP 时，系统以匿名模式运行，数据仅存储在浏览器本地。

---

## 部署

项目包含 systemd 定时器配置，用于生产环境中每日自动刷新物化视图：

```text
deploy/systemd/
├── fitness-food-refresh.service    # 刷新服务单元
└── fitness-food-refresh.timer      # 每日定时触发器
```

详细部署指南请参阅 [docs/deployment.md](./docs/deployment.md)。

项目同时提供 `apphosting.yaml` 配置文件，支持 Firebase App Hosting 等托管平台部署。

---

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。

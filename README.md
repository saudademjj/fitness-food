<div align="center">
  <p>AI-Powered Diet & Nutrition Analysis System / 饮食管理与 AI 营养分析系统</p>
  <p>
    <a href="#english">English</a> •
    <a href="#简体中文">简体中文</a>
  </p>
</div>

---

<h2 id="english">English</h2>

# Fitness-Food

![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?style=flat-square&logo=tailwind-css)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)
![AI](https://img.shields.io/badge/AI-Enabled-brightgreen?style=flat-square)

**Fitness-Food** is a diet management system that combines AI parsing, PostgreSQL-backed nutrition lookup, and interactive nutrition tracking. The current runtime prioritizes direct database matches for simple foods, uses Gemini only when natural-language parsing is actually needed, and supports runtime composite-dish aggregation with full 23-field nutrition output.

### System Highlights

- Simple single-food descriptions hit PostgreSQL first, avoiding unnecessary model calls.
- Gemini is reserved for complex descriptions, food decomposition, and conservative fallback estimation.
- Composite dishes can now follow a `recipe / AI ingredients -> per-ingredient DB lookup -> runtime aggregation` flow instead of stopping at loose ingredient lists.
- The UI tracks complete 23-field nutrition groups, including potassium, zinc, vitamin A, vitamin C, vitamin D, vitamin B12, and folate.
- Weight adjustments in the confirmation dialog are recalculated locally without spending extra model budget.
- Runtime observability now covers lookup misses, parse telemetry, error telemetry, and materialized-view refresh state.

### Result Priority

1. `recipe_alias` exact match to a standard recipe
2. `canonical_food_alias` exact match to a canonical food
3. Direct `app_catalog_profile_23.food_name_zh` match
4. Gemini fallback with conservative validation and clamping

### Runtime Nutrition Pipeline

- `core.portion_reference` provides canonical Chinese serving-size references and unit conversions.
- Safe `pg_trgm` fuzzy matching replaces dangerous `ILIKE '%term%'` substring lookups.
- Runtime validation now rejects obviously inconsistent DB candidates in strict categories and can fall back to curated brand nutrition where needed.
- `app.food_log_item.per100g_profile` and `app.food_log_item.totals_profile` store complete 23-field nutrition JSON.
- `app.lookup_miss_telemetry` keeps a feedback loop for alias and ETL cleanup.
- `app.food_parse_telemetry`, `app.runtime_error_telemetry`, and `app.materialized_view_refresh_state` support production health checks and refresh orchestration.

### Core Directory Structure

```text
fitness-food/
├── src/
│   ├── ai/             # AI parsing engine, prompt templates, and nutrition fallback logic
│   ├── app/            # Next.js 15 pages, layouts, and typed server actions
│   ├── components/     # UI components and nutrition dashboard modules
│   ├── lib/            # DB lookup, validation, runtime aggregation, and utilities
│   └── hooks/          # Data flow management and state helpers
├── db/                 # SQL migrations, reports, and refresh scripts
├── deploy/             # Deployment and systemd assets
└── package.json        # Dependencies and lifecycle scripts
```

### Database Bootstrap

1. Run migrations:

   ```bash
   psql "$DATABASE_URL" -f db/migrations/20260316_food_system_upgrade.sql
   psql "$DATABASE_URL" -f db/migrations/20260316_nutrition_profile23_upgrade.sql
   psql "$DATABASE_URL" -f db/migrations/20260317_nutrition_runtime_hardening.sql
   psql "$DATABASE_URL" -f db/migrations/20260317_runtime_composite_observability.sql
   psql "$DATABASE_URL" -f db/migrations/20260319_runtime_lookup_brand_safety.sql
   ```

2. Refresh materialized views:

   ```bash
   bash ./db/refresh_materialized_views.sh
   ```

3. If you keep a separate DB project, you can also run the same SQL and refresh flow from `/Users/saudade/Downloads/微调_食物描述`.

### Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local env file:

   ```bash
   cp .env.example .env.local
   ```

3. Fill in `.env.local`:

   ```env
   GEMINI_API_KEY=your_google_ai_studio_api_key
   GEMINI_MODEL=gemini-3-flash-preview
   APP_BASE_URL=http://localhost:9002
   DATABASE_URL=postgresql://localhost:5432/foodetl_local
   SMTP_HOST=smtp.your-provider.example.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=your_smtp_user
   SMTP_PASS=your_smtp_password
   SMTP_FROM=Fitness Food <noreply@example.com>
   ```

4. Start development:

   ```bash
   npm run dev
   ```

### Deployment Notes

- The Debian server runs Next.js, PostgreSQL access, and Nginx reverse proxying.
- Email login requires `APP_BASE_URL` plus SMTP configuration.
- Gemini runs only from the Next.js server side.
- Alias updates take effect immediately; lower-level food/recipe changes mark the nutrition matviews as pending refresh.
- `deploy/systemd/fitness-food-refresh.service` and `deploy/systemd/fitness-food-refresh.timer` support hourly pending-check refreshes.

### Common Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`
- `npm run report:runtime-db`

### License

This project is open-sourced under the MIT License.

---

<h2 id="简体中文">简体中文</h2>

# Fitness-Food

`Fitness Food` 是一个结合 AI 解析、PostgreSQL 营养查库和交互式营养追踪的饮食管理系统。当前运行时优先对简单食物描述做数据库直查，只在真正需要自然语言拆解时调用 Gemini，并支持复合菜的运行时聚算和完整 `23` 项营养输出。

### 当前能力

- 简单单品描述优先直接命中 PostgreSQL，尽量不调用模型。
- Gemini 只在复杂描述、食物拆解和保守兜底估算时使用。
- 复合菜支持“`recipe / AI 原料拆解 -> 原料逐项查库 -> 运行时聚算整菜`”闭环。
- 前端默认按分组展示完整 `23` 项营养目标进度，包含 `potassium / zinc / vitaminA / vitaminC / vitaminD / vitaminB12 / folate` 等微量。
- 用户在确认弹窗里调节重量后，数值会本地实时重算，不会重复消耗模型额度。
- 运行时观测已覆盖 lookup miss、解析遥测、错误遥测和物化视图刷新状态。

### 结果来源优先级

1. `recipe_alias` 命中标准食谱
2. `canonical_food_alias` 命中标准营养库食物
3. `app_catalog_profile_23.food_name_zh` 直接命中
4. Gemini 兜底，并附带保守校验和修正

### 运行时营养管线

- `core.portion_reference` 提供中文标准份量和量词换算。
- 安全的 `pg_trgm` fuzzy 替代危险的 `ILIKE '%词%'` 子串查找。
- 严格类别下的明显异常数据库候选会被运行时校验拦掉，必要时会退到人工校准的品牌营养覆盖。
- `app.food_log_item.per100g_profile / totals_profile` 以 JSONB 保存完整 `23` 项营养。
- `app.lookup_miss_telemetry` 记录发布层 miss，便于后续 alias / ETL 回补。
- `app.food_parse_telemetry`、`app.runtime_error_telemetry`、`app.materialized_view_refresh_state` 支持线上健康检查和刷新编排。

### 核心目录

```text
fitness-food/
├── src/
│   ├── ai/             # AI 解析引擎、提示词模板和兜底逻辑
│   ├── app/            # Next.js 15 页面、布局和服务端动作
│   ├── components/     # UI 组件和营养看板模块
│   ├── lib/            # 查库、校验、运行时聚算和通用工具
│   └── hooks/          # 数据流和状态辅助逻辑
├── db/                 # SQL migration、报告和 refresh 脚本
├── deploy/             # 部署和 systemd 资产
└── package.json        # 依赖和脚本
```

### 数据库初始化

1. 执行迁移：

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

3. 如果你维护独立数据库工程，也可以在 `/Users/saudade/Downloads/微调_食物描述` 中执行同名 SQL 和刷新流程。

### 本地开发

1. 安装依赖：

   ```bash
   npm install
   ```

2. 创建环境变量文件：

   ```bash
   cp .env.example .env.local
   ```

3. 在 `.env.local` 中填写：

   ```env
   GEMINI_API_KEY=your_google_ai_studio_api_key
   GEMINI_MODEL=gemini-3-flash-preview
   APP_BASE_URL=http://localhost:9002
   DATABASE_URL=postgresql://localhost:5432/foodetl_local
   SMTP_HOST=smtp.your-provider.example.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=your_smtp_user
   SMTP_PASS=your_smtp_password
   SMTP_FROM=Fitness Food <noreply@example.com>
   ```

4. 启动开发环境：

   ```bash
   npm run dev
   ```

### 部署说明

- Debian 服务器负责运行 Next.js、连接 PostgreSQL，并由 Nginx 做反向代理。
- 邮箱登录需要额外配置 `APP_BASE_URL` 和 SMTP 环境变量。
- Gemini 只从 Next.js 服务端调用。
- alias 更新会即时生效；更底层的 food / recipe 数据变化会自动把营养物化视图标记为待刷新。
- 可以安装 `deploy/systemd/fitness-food-refresh.service` 和 `deploy/systemd/fitness-food-refresh.timer`，按小时检查 pending 状态后再决定是否刷新。

### 常用脚本

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`
- `npm run report:runtime-db`

### 许可证

本项目遵循 MIT License 协议。

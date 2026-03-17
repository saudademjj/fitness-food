# Fitness Food

<p align="right">中文 | <a href="https://github.com/saudademjj/fitness-food/tree/en/readme">English</a></p>

`Fitness Food` 是一个基于 `Next.js 15` 的中文饮食记录工具。当前版本保留现有前端页面，但把核心能力升级为“数据库优先、模型兜底”的营养计算流程：

- 简单单品描述优先直接命中 `PostgreSQL` 营养数据库，尽量不调用模型
- `Gemini 3 Flash Preview` 只在复杂描述时负责食物拆解、默认克重估算和兜底营养估算
- `PostgreSQL` 负责提供真实营养值，优先命中标准食谱和营养库
- 前端默认按分组展示完整 `23` 项营养目标进度，包含多种微量营养素
- 用户在确认弹窗里调节重量后，数值会本地实时重算，不会重复消耗模型额度
- 已加入邮箱魔法链接登录、云端历史记录、导出、服务端限流和本地草稿迁移

## 结果来源优先级

1. `recipe_alias` 命中标准食谱
2. `canonical_food_alias` 命中营养库食物
3. `app_catalog_profile_23.food_name_zh` 直接命中
4. 以上都失败时，使用 Gemini 返回的兜底每 `100g` 完整 `23` 项估算，并在必要时做保守修正

## 新增能力

- `core.portion_reference`：标准份量表，覆盖常见中文食物默认克重和量词换算
- `pg_trgm` + 安全 fuzzy：避免直接使用危险子串匹配
- `Gemini` fallback 校验：增加热力学一致性、类别约束和保守修正
- `app.*` 运行时表：支持用户、session、历史记录、导出和数据库限流
- `app.food_log_item.per100g_profile / totals_profile`：以 `JSONB` 存储完整 23 项营养
- `app.lookup_miss_telemetry`：记录发布层 miss，方便后续 alias / ETL 补齐
- 运行时会检查 `app_food_profile_23 / app_recipe_profile_23 / app_catalog_profile_23` 是否有数据

## 技术栈

- 前端：`Next.js 15`、`React 19`、`TypeScript`
- UI：`Tailwind CSS`、`Radix UI`
- 数据层：`PostgreSQL`
- AI：`Gemini 3 Flash Preview`
- 部署：适合部署在 Debian + Nginx 的自托管环境，也可继续演进到托管平台

## 数据库初始化

1. 执行迁移

```bash
psql "$DATABASE_URL" -f db/migrations/20260316_food_system_upgrade.sql
psql "$DATABASE_URL" -f db/migrations/20260316_nutrition_profile23_upgrade.sql
```

2. 刷新物化视图

```bash
bash ./db/refresh_materialized_views.sh
```

3. 如果你使用独立的数据库工程，也可以在对应数据工程中运行同名 SQL 和刷新脚本

## 本地开发

1. 安装依赖

```bash
npm install
```

2. 创建本地环境变量

```bash
cp .env.example .env.local
```

3. 在 `.env.local` 中填写至少这些配置

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

4. 启动开发环境

```bash
npm run dev
```

5. 打开 `http://localhost:9002`

## Gemini 策略

- 能从数据库直接算出的单品，例如 `一个包子`、`一杯豆浆`，会优先本地查库
- 遇到复合描述，才调用 Gemini 做拆解与默认份量估算
- Gemini 只承担“理解自然语言和估默认份量”的部分，最终营养仍然优先取数据库
- 当 AI fallback 结果不可靠时，系统会重试并做保守修正，同时保留来源风险意识

## 生产部署建议

- Debian 服务器负责运行 Next.js 应用、连接 PostgreSQL，并由 Nginx 提供 HTTPS 和反向代理
- 邮箱登录需要额外配置 `APP_BASE_URL` 和 SMTP 环境变量
- 为了控制 token 消耗，只在“提交一句话饮食描述”时调用模型一次
- 能直接命中数据库的短描述不走模型，克重调整也在前端本地重算
- 每次更新 alias、portion seed 或 ETL 发布层后，记得刷新物化视图
- 可安装 `deploy/systemd/fitness-food-refresh.service` 和 `deploy/systemd/fitness-food-refresh.timer` 作为定时刷新兜底

## 常用脚本

- `npm run dev`：启动开发环境
- `npm run build`：生成生产构建
- `npm run start`：启动生产服务
- `npm run typecheck`：执行 TypeScript 检查
- `npm run report:runtime-db`：输出运行时数据库覆盖情况与 miss 热点

## 许可证

本仓库采用 MIT License，详见 [LICENSE](./LICENSE)。

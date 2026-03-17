# Fitness Food

`Fitness Food` 是一个基于 `Next.js 15` 的中文饮食记录工具。当前版本保留现有前端页面，但把核心能力改成：

- 简单单品描述优先直接命中 `PostgreSQL` 营养数据库，尽量不调用模型
- `Gemini 3 Flash Preview` 只在复杂描述时负责食物拆解、默认克重估算和兜底营养估算
- `PostgreSQL` 负责提供真实营养值，优先命中标准食谱和营养库
- 前端默认按分组展示完整 `23` 项营养目标进度，包含 `potassium / zinc / vitaminA / vitaminC / vitaminD / vitaminB12 / folate` 等微量
- 用户在确认弹窗里调节重量后，数值会本地实时重算，不会重复消耗模型额度
- 新增邮箱魔法链接登录、云端历史记录、导出、服务端限流和本地草稿迁移

## 结果来源优先级

1. `recipe_alias` 命中标准食谱
2. `canonical_food_alias` 命中营养库食物
3. `app_catalog_profile_23.food_name_zh` 直接命中
4. 以上都失败时，使用 Gemini 返回的兜底每100g完整 23 项估算，并在必要时做保守修正

当前本地库里像 `包子`、`猪肉包子`、`宫保鸡丁` 这类常见项已经可以直接算；`豆浆` 也可以从库里取到核心营养值。

## 新增能力

- `core.portion_reference`：数据库标准份量表，覆盖常见中文食物默认克重和量词换算
- `pg_trgm` + 安全 fuzzy：不再用 `ILIKE '%词%'` 直接做危险子串匹配
- `Gemini` fallback 校验：增加热力学一致性、食物类别约束和保守修正，异常值不会再直接清零
- `app.*` 运行时表：支持用户、session、历史记录、导出和数据库限流
- `app.food_log_item.per100g_profile / totals_profile`：以 JSONB 存储完整 23 项营养
- `app.lookup_miss_telemetry`：记录发布层 miss，供后续 alias / ETL 补齐
- `generate_food_questions.py` 现在会同时输出 `question` 和 `expected_output_json`，DB miss 时优先保留为 `fallback_ready` 样本而不是整条丢弃
- 运行时会检查 `app_food_profile_23 / app_recipe_profile_23 / app_catalog_profile_23` 是否有数据，首次部署忘记 refresh 时会直接给出明确报错

## 数据库初始化

1. 执行迁移：

   ```bash
   psql "$DATABASE_URL" -f db/migrations/20260316_food_system_upgrade.sql
   psql "$DATABASE_URL" -f db/migrations/20260316_nutrition_profile23_upgrade.sql
   ```

2. 刷新物化视图：

   ```bash
   bash ./db/refresh_materialized_views.sh
   ```

3. 如果你使用独立的数据库工程，也可以在 `/Users/saudade/Downloads/微调_食物描述` 里运行同名 SQL 和刷新脚本。

## 本地开发

1. 安装依赖

   ```bash
   npm install
   ```

2. 创建本地环境变量

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

4. 启动开发环境

   ```bash
   npm run dev
   ```

5. 打开 [http://localhost:9002](http://localhost:9002)

## Gemini 策略

- 能从数据库直接算出的单品，例如 `一个包子`、`一杯豆浆`，会优先本地查库，跳过模型。
- 遇到 `今天早上吃了两个大肉包和一杯豆浆` 这类复合描述，才会调用 Gemini 做拆解。
- Gemini 只承担“理解人话和估默认份量”的部分，最终营养仍然优先取数据库。
- 当 AI fallback 营养值不可靠时，系统会先重试，最终仍不可靠则按类别做保守修正，并明确标注来源风险。

## 生产部署建议

- 你的 Debian 服务器负责：
  - 跑 Next.js 应用
  - 连接 PostgreSQL
  - 用 Nginx 做 HTTPS 和反向代理
- 邮箱登录需要额外配置 `APP_BASE_URL` 和 SMTP 环境变量
- Gemini API 直接由 Next.js 服务端调用，不需要额外的模型部署层。
- 为了控制 token 消耗：
  - 只在“提交一句话饮食描述”时调用模型一次
  - 能直接命中数据库的短描述不走模型
  - 克重调整在前端本地重算
  - 保持服务端限流
- 每次更新 alias、portion seed 或 ETL 发布层后，记得刷新物化视图
- 服务器可安装 `deploy/systemd/fitness-food-refresh.service` 和 `deploy/systemd/fitness-food-refresh.timer`，作为每日 04:10 的兜底刷新

## 常用脚本

- `npm run dev`：启动本地开发环境
- `npm run build`：生成生产构建
- `npm run start`：启动生产服务
- `npm run typecheck`：执行 TypeScript 检查
- `npm run report:runtime-db`：输出 `portion_reference` seed 量、发布层 publish_ready 规模和近 7 天 lookup miss 热点
- `python /Users/saudade/Downloads/微调_食物描述/generate_food_questions.py --coverage-report coverage.json`：导出训练词池 exact / fuzzy / fallback / miss 覆盖率

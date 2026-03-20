# 部署说明

## 1. 准备主模型与 reviewer 配置

默认推荐 OpenRouter 作为主模型入口：

```env
OPENROUTER_API_KEY=<your_openrouter_key>
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=xiaomi/mimo-v2-pro
PRIMARY_MODEL_ENABLE_THINKING=true
PRIMARY_MODEL_ENABLE_SEARCH=true
PRIMARY_MODEL_FORCE_SEARCH=false
PRIMARY_MODEL_SEARCH_STRATEGY=turbo
PRIMARY_MODEL_REQUEST_TIMEOUT_MS=45000
```

如果你需要切回 DashScope 兼容接口，也可以改成：

```env
DASHSCOPE_API_KEY=<your_dashscope_key>
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
PRIMARY_MODEL_ID=qwen3.5-plus
```

说明：

- `PRIMARY_MODEL_ENABLE_THINKING=true` 会开启推理思考
- `PRIMARY_MODEL_ENABLE_SEARCH=true` 会开启联网搜索能力
- `PRIMARY_MODEL_FORCE_SEARCH=false` 表示只在模型判断有必要时联网，避免每次饮食解析都额外增加延迟与成本
- `PRIMARY_MODEL_SEARCH_STRATEGY=turbo` 更适合当前饮食解析这种低延迟场景；如果你更看重检索深度，可以改成 `max`
- `PRIMARY_MODEL_REQUEST_TIMEOUT_MS=45000` 给思考和联网请求预留更长超时时间，避免品牌食品场景下过早超时

额外 reviewer 中，MiniMax 现在改走官方兼容 OpenAI API。如果你想显式控制，可以这样配：

```env
SECONDARY_REVIEW_ENABLE_MINIMAX=true
MINIMAX_API_KEY=<your_minimax_key>
MINIMAX_BASE_URL=https://api.minimax.io/v1
MINIMAX_REVIEW_MODEL=MiniMax-M2.7
MINIMAX_REVIEW_TIMEOUT_MS=30000
SECONDARY_REVIEW_ENABLE_DEEPSEEK=false
# 如果启用 DeepSeek reviewer，再单独配置它自己的超时：
# DEEPSEEK_REQUEST_TIMEOUT_MS=45000
```

说明：

- 当前三类 reviewer 的实际超时分别由 `PRIMARY_MODEL_REVIEW_REQUEST_TIMEOUT_MS`、`MINIMAX_REVIEW_TIMEOUT_MS`、`DEEPSEEK_REQUEST_TIMEOUT_MS` 控制。
- `SECONDARY_REVIEW_TIMEOUT_MS / SECONDARY_REVIEW_PROVIDER_TIMEOUT_MS` 这类外层总超时不再用于当前 reviewer 链路，避免聚合层比 provider 更早把请求判成“未返回”。
- 2026-03-20 起 reviewer 改为 MiniMax 官方兼容 OpenAI API；官方文档当前示例模型名为 `MiniMax-M2.7`，基地址为 `https://api.minimax.io/v1`。

## 2. 本地开发连接 PostgreSQL

如果你的 Mac 本机已经有 `foodetl_local`：

```env
DATABASE_URL=postgresql://localhost:5432/foodetl_local
```

如果你更习惯 `PG*` 变量，也可以不用 `DATABASE_URL`，直接设置：

```env
PGDATABASE=foodetl_local
PGHOST=localhost
PGPORT=5432
PGUSER=<your-user>
PGPASSWORD=<your-password>
```

## 3. Debian 服务器部署 Next.js

你的服务器当前已经具备：

- Debian 13
- PostgreSQL 17
- 足够的 CPU / 内存 / 磁盘

还需要补：

- Node.js 20 LTS
- npm
- Nginx

推荐步骤：

1. 安装 Node.js 20 和 Nginx
2. 把本仓库部署到服务器
3. 服务器上配置 `.env.local`
4. 执行数据库迁移：

   ```bash
   psql "$DATABASE_URL" -f db/migrations/20260316_food_system_upgrade.sql
   psql "$DATABASE_URL" -f db/migrations/20260316_nutrition_profile23_upgrade.sql
   psql "$DATABASE_URL" -f db/migrations/20260317_nutrition_runtime_hardening.sql
   psql "$DATABASE_URL" -f db/migrations/20260317_runtime_composite_observability.sql
   bash ./db/refresh_materialized_views.sh
   ```

5. 构建并启动应用：

   ```bash
   npm install
   npm run build
   npm run start
   ```

   如果跳出“营养物化视图为空”的报错，说明 `core.app_food_profile_23 / core.app_recipe_profile_23 / core.app_catalog_profile_23` 还没有 refresh 成功，先重新执行上面的 refresh 脚本再启动。

6. 用 `systemd` 托管 Next.js
7. 安装 `deploy/systemd/fitness-food-refresh.service` 与 `deploy/systemd/fitness-food-refresh.timer`

   现在 timer 按小时检查一次，但脚本会先读取 `app.materialized_view_refresh_state`；只有底层营养/recipe 数据被触发器标记为 pending 时，才会执行 `REFRESH MATERIALIZED VIEW CONCURRENTLY`

   如果这些物化视图的 owner 是 `postgres`，在服务器 `.env.local` 里额外加一行：

   ```env
   PG_REFRESH_AS_POSTGRES=1
   ```
8. 用 Nginx 反向代理到 Next.js 端口，并加 HTTPS

## 4. 成本控制建议

- 简单单品描述先直接查库，避免每次都走模型
- 主模型只在数据库无法直接命中时调用一次
- 前端调滑块不再请求模型
- 数据库优先，模型只负责识别、复合菜拆解和兜底
- 保持请求长度限制和 IP 限流，避免白白消耗额度

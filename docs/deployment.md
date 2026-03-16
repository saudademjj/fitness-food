# 部署说明

## 1. 准备 Gemini API

建议在 Google AI Studio 创建 API key，并把它放进应用环境变量里：

```env
GEMINI_API_KEY=<your_google_ai_studio_key>
GEMINI_MODEL=gemini-3-flash-preview
```

如果你需要显式覆盖 API 地址，也可以额外设置：

```env
GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta
```

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
4. 执行：

   ```bash
   npm install
   npm run build
   npm run start
   ```

5. 用 `systemd` 托管 Next.js
6. 用 Nginx 反向代理到 Next.js 端口，并加 HTTPS

## 4. 成本控制建议

- 简单单品描述先直接查库，避免每次都走模型
- Gemini 只在提交自然语言饮食描述时调用一次
- 前端调滑块不再请求模型
- 数据库优先，模型只负责识别和兜底
- 保持请求长度限制和 IP 限流，避免白白消耗额度

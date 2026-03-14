# Fitness Food

`Fitness Food` 是一个基于 `Next.js 15`、`Genkit` 和 `Gemini` 的中文营养记录工具，支持用自然语言录入饮食，并自动估算热量、宏量营养素、维生素和矿物质。

## 功能概览

- 自然语言记录饮食，例如“一个苹果，150 克鸡胸肉”
- 自动解析多种常见营养指标
- 本地保存每日记录与个人目标
- 通过 Firebase App Hosting 部署服务端 AI 能力

## 安全说明

- `GOOGLE_GENAI_API_KEY` 不应提交到仓库；本项目已通过 `.gitignore` 忽略所有 `.env*` 文件。
- 生产环境应通过 Firebase App Hosting Secret Manager 注入密钥，避免在代码库或前端源码中暴露。
- AI 解析入口运行在服务端，前端不会直接拿到 Gemini key。
- 服务端动作已增加基础输入长度校验和限流，降低公开页面被滥用刷取模型额度的风险。

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
   GOOGLE_GENAI_API_KEY=your_google_genai_api_key
   ```

4. 启动开发环境

   ```bash
   npm run dev
   ```

5. 打开 [http://localhost:9002](http://localhost:9002)

## Firebase App Hosting 部署

1. 在 Firebase 项目中创建运行时密钥：

   ```bash
   firebase apphosting:secrets:set GOOGLE_GENAI_API_KEY
   ```

2. 确认 `apphosting.yaml` 已引用该 secret。

3. 推送代码后，由 Firebase App Hosting 进行构建和发布。

## 常用脚本

- `npm run dev`：启动本地开发环境
- `npm run build`：生成生产构建
- `npm run start`：启动生产服务
- `npm run typecheck`：执行 TypeScript 检查
- `npm run genkit:dev`：启动 Genkit 开发服务

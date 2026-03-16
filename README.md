# Fitness Food

`Fitness Food` 是一个基于 `Next.js 15` 的中文饮食记录工具。当前版本保留现有前端页面，但把核心能力改成：

- 简单单品描述优先直接命中 `PostgreSQL` 营养数据库，尽量不调用模型
- `Gemini 3 Flash Preview` 只在复杂描述时负责食物拆解、默认克重估算和兜底营养估算
- `PostgreSQL` 负责提供真实营养值，优先命中标准食谱和营养库
- 前端只展示 `热量、蛋白质、碳水、脂肪` 四项核心营养
- 用户在确认弹窗里调节重量后，数值会本地实时重算，不会重复消耗模型额度

## 结果来源优先级

1. `recipe_alias` 命中标准食谱
2. `canonical_food_alias` 命中营养库食物
3. `app_catalog_profile_23.food_name_zh` 直接命中
4. 以上都失败时，使用 Gemini 返回的兜底每100g估算

当前本地库里像 `包子`、`猪肉包子`、`宫保鸡丁` 这类常见项已经可以直接算；`豆浆` 也可以从库里取到核心营养值。

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
   DATABASE_URL=postgresql://localhost:5432/foodetl_local
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

## 生产部署建议

- 你的 Debian 服务器负责：
  - 跑 Next.js 应用
  - 连接 PostgreSQL
  - 用 Nginx 做 HTTPS 和反向代理
- Gemini API 直接由 Next.js 服务端调用，不需要额外的模型部署层。
- 为了控制 token 消耗：
  - 只在“提交一句话饮食描述”时调用模型一次
  - 能直接命中数据库的短描述不走模型
  - 克重调整在前端本地重算
  - 保持服务端限流

## 常用脚本

- `npm run dev`：启动本地开发环境
- `npm run build`：生成生产构建
- `npm run start`：启动生产服务
- `npm run typecheck`：执行 TypeScript 检查

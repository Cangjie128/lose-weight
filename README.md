# 温和减脂记录与指导应用

一个中文网页端减脂记录工具，面向小基数减脂用户。支持每日体重、饮食照片、餐食 AI 粗略分析、运动、不适提醒、趋势图、月历打卡、个人设置和每日 AI 教练总结。

## 功能

- Supabase 邮箱注册/登录，数据按 `user_id` 隔离。
- 体重、饮食、餐食照片、运动、饮水、睡眠、身体感受和每日任务记录。
- 餐食图片上传前压缩，真实环境保存到 Supabase Storage 私有桶 `meal-images`。
- 饮食 AI 分析返回结构化 JSON，热量显示为范围，并提示“根据照片和描述估算，存在误差”。
- 每日 AI 总结包含体重解释、饮食、运动、改进重点、明日饮食和训练建议。
- 趋势页明确区分“单日体重”和“7日移动平均体重”，支持 7 日/30 日视图。
- 日历页用绿色、黄色、灰色展示完成状态，用温和图标提示体重波动。
- 未配置 Supabase 时自动进入本地演示模式，便于查看界面和基础交互。

## 本地启动

```bash
npm install
npm run dev
```

打开开发服务器输出的本地地址，通常是：

```text
http://localhost:3000
```

生产构建：

```bash
npm run build
npm run start
```

基础测试：

```bash
npm test
```

## 环境变量

复制 `.env.example` 为 `.env.local`，填入真实值：

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-5.6
```

注意：

- `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 会进入前端，这是 Supabase 的正常用法。
- `OPENAI_API_KEY` 只能放服务端环境变量，不要添加 `NEXT_PUBLIC_` 前缀。
- AI 模型可通过 `OPENAI_MODEL` 调整。

## Supabase 初始化

1. 创建 Supabase 项目。
2. 在 SQL Editor 中执行 `supabase/schema.sql`。
3. 在 Authentication 中启用邮箱登录。
4. 确认 Storage 中存在私有 bucket：`meal-images`。SQL 会自动创建并配置策略。
5. 将项目 URL 和 anon key 写入 `.env.local`。

数据库包含：

- `profiles`
- `challenges`
- `weight_records`
- `meal_records`
- `meal_images`
- `exercise_records`
- `daily_checkins`
- `daily_ai_summaries`

每张业务表都启用了 RLS，策略限制用户只能读取、创建、更新和删除自己的数据。

## OpenAI 接口

服务端接口位置：

- `app/api/analyze-meal/route.ts`
- `app/api/daily-summary/route.ts`

两个接口都使用 OpenAI Responses API，并校验结构化 JSON。AI 请求失败时，前端会显示错误提示，但不会影响手动记录。

## 部署

部署到支持 Next/Vite/Vinext 的平台时，需要配置同样的环境变量：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

如果使用 OpenAI Sites/Cloudflare Worker 运行，请在托管平台的环境变量设置中保存这些值，不要把真实密钥提交到仓库。

## 模拟数据说明

未配置 Supabase 环境变量时，应用会进入“本地演示模式”：

- 使用浏览器 `localStorage` 保存一份演示记录，刷新不会丢失。
- 不会进行真实注册/登录。
- 不会真实上传到 Supabase Storage。
- 如果配置了 `OPENAI_API_KEY`，AI 接口仍可被前端调用；否则会显示服务端未配置提示。

配置 Supabase 后会切换到真实用户、真实数据库和真实图片存储。

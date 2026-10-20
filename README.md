# lose-weight V2

中文减脂记录工具。小程序负责餐食识别、确定性统计和数据保存；长期分析由用户自己的 ChatGPT 承担。V2 基于 `94da171`，开发分支 `codex/lose-weight-v2`，不自动部署、不合并 main。

## 技术栈

Next.js 16.4、React 19、TypeScript、Tailwind CSS、Recharts、Supabase Auth/PostgreSQL/私有 Storage。ZIP 使用 fflate，演示照片使用 IndexedDB。Google OAuth 使用官方 google-auth-library，MCP 使用官方 TypeScript SDK。

## 独立本地试用

需要 Node.js >=22.13（建议 Node 24）。

```bash
npm ci
npm run preview:v2
```

启动脚本强制清空 Supabase、AI、Google 和服务端连接密钥，使用独立 `.next-v2` 构建，只监听本机。默认地址 http://127.0.0.1:3004/；端口占用时自动寻找下一个可用端口，以终端输出为准。不同端口的数据相互隔离，不读取原 3003 预览的数据，也不连接生产数据库。

```bash
npm run build:v2
npm run test:unit
npm run test:browser
```

浏览器验收脚本要求本地预览正在运行，使用隔离浏览器上下文并阻止外部请求。可设置 `PLAYWRIGHT_MODULE_PATH`、`CHROME_PATH`、`PREVIEW_URL`；截图和运行数据写入忽略的 `outputs/v2-acceptance`。也可安装本地 Playwright 并运行 `npx playwright install chromium`。

## 数据与备份

- 账号模式的唯一主数据库是 Supabase PostgreSQL；真实照片只存私有 `meal-images` 桶。没有另建 VPS 数据库。
- 本地演示不等于云同步。IndexedDB 保存记录、照片和恢复快照；旧 localStorage Base64 照片在原始快照保留、事务成功后迁移。
- 上传压缩为 JPEG，最长边 1200px，目标约 280KB；单次最多 6 张。识别单次最多 4 张，每张最多 300KB。
- 设置提供完整 ZIP 导出、导入、预览与容量估计。ZIP 包含 `manifest.json`、`records.json`、真实 `images/` 文件，校验 SHA-256 和关联。
- 不导出临时签名 URL、API Key、Google OAuth 凭证或 MCP 凭证。物理保留的未关联照片也包含在 ZIP 中。
- 恢复先下载当前完整 ZIP，再经用户确认合并。相同日期的体重/打卡/总结及相同 ID 的记录采用备份内容，个人设置恢复；未重复记录保留。云端结构化恢复使用单个 PostgreSQL 事务。
- 支持旧 JSON；只有路径而没有照片内容时必须明确选择仅合并记录。损坏 ZIP、缺图、容量不足、恢复中断都会停止并给出提示。
- 任何清理都不会自动删除历史数据或照片文件。200MB 和 10000 张是本版本 ZIP 处理上限，不是 Supabase 账户容量。

## 独立 Supabase 测试配置

当前没有测试项目，实云账号登录及跨设备验收尚待配置。甲骨文 VPS 将来可以运行网页/API，但不能替代 Supabase。请先创建独立测试项目，不要使用正式数据。

在测试项目按顺序执行：

1. `supabase/schema.sql`（新项目初始结构）。
2. `supabase/migrations/20261012_v2.sql`。
3. `supabase/migrations/20261014_connections.sql`。

启用邮箱认证；确认 `meal-images` 为私有桶。配置 `.env.local` 的 Supabase URL 和 anon key。URL/anon key 可进入前端，其余服务密钥绝不能加 `NEXT_PUBLIC_` 前缀。测试账号模式使用 `npm run dev -- --port 3005`，并将 `APP_ORIGIN` 设置为相同地址。

## 低成本餐食识别

```dotenv
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-flash
AI_DAILY_USER_LIMIT=20
AI_GLOBAL_DAILY_LIMIT=100
AI_MAX_OUTPUT_TOKENS=1200
AI_ALLOW_OPENAI_FALLBACK=false
```

DeepSeek 只接收餐食图片和餐食描述，不接收个人资料。需要有效 Supabase 登录和已保存的餐食；结果在服务端持久化后才返回，已保存结果直接复用。缺少食物/份量信息时数值置空，允许手动改名、重量和营养。

认证、数据库调用预留、10 秒调用间隔、每天每用户最多 20 次/全站最多 100 次、输出最多 1500 Tokens、30 秒超时共同保护费用。服务端可进一步降低上限。失败不会自动重试。密钥没配置时仍可手动记录和计算营养目标。

OpenAI 仅作为明确启用并逐次确认的可选餐食备用服务。营养累计、目标进度、下一餐及基础恢复建议不调用任何模型。`/api/daily-summary` 返回 410，保留已有历史总结，不再支付第二份总结费用。

## ChatGPT 数据连接

Google 摘要同步默认关闭，需要用户在设置中勾选隐私授权、完成 Google OAuth，再开启同步。授权回调仍保持关闭状态。

服务端配置：

```dotenv
APP_ORIGIN=http://127.0.0.1:3005
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
INTEGRATION_ENCRYPTION_KEY=
```

加密密钥为 32 随机字节的 64 位十六进制编码，可用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 本地生成。不要提交密钥。

Google Cloud 启用 Sheets API、配置 Web OAuth 客户端，并登记 `APP_ORIGIN/api/connections/google/callback` 为回调。仅申请 `drive.file`，为该应用创建独立私有摘要表；不会编辑其他表格或更改共享权限。OAuth state、PKCE、一次性过期状态和 HttpOnly cookie 保护授权。凭证经 AES-256-GCM 加密保存于仅服务端可访问的 Supabase 表。

摘要仅包含日期、体重、餐次、热量范围、宏量营养、未知餐次数、运动时长/次数和目标。没有照片、食物细节、健康备注、姓名、邮箱或账号 ID。开启后云端保存触发合并同步，也可立即同步；关闭停止后续同步，已发送的数据仍保留在用户自己的表格中。正在进行的网络请求可能已经完成。ChatGPT 需要用户自己的 Google Drive 连接读取该私有表；本次未向实际 Google 账号写入数据。

MCP 提供 `/api/mcp` 的无状态 JSON Streamable HTTP，只包含：

- `daily_records`：一天的体重、营养和运动统计。
- `seven_day_nutrition`：最近七个自然日。
- `weight_trend`：最多 365 天。
- `exercise_history`：最多 90 天，排除健康备注。

用户确认后生成 90 天只读 Bearer 凭证，仅显示一次，数据库仅存 SHA-256；可立即撤销，更新凭证会使旧凭证失效。每分钟最多 60 次。接口没有修改/删除工具。所有读取按凭证绑定的用户过滤，前端传入的用户 ID 不被接受。

当前 MCP 可供支持自定义 Bearer 的客户端联调。ChatGPT 原生远程连接还需要公开 HTTPS 地址、其要求的 OAuth/资源发现流程及真实客户端验收，属于后续接入工作；不能把本地地址宣称为已完成 ChatGPT 连接。

## 验收与上线边界

详见 `docs/V2_TEST_REPORT.md`。本地、模拟客户端和嵌入式 PostgreSQL 测试不是实云验收；真实 Supabase、Google OAuth 和 DeepSeek 识别准确度在测试配置完成后补测。

本分支不执行服务器登录、生产数据库迁移、线上部署或 main 合并。历史部署域名为 `slim.vidaxl.space`，此版本未修改该站点。

# lose-weight V2 开发验收报告

> 历史报告：以下描述早期 Supabase V2 验收。最新产品已转向每日行动教练，最终架构改为完全自托管，不使用 Supabase。当前交付、预览和限制请以 [行动教练验收报告](COACH_TEST_REPORT.md) 与 [自托管架构](SELF_HOSTED_ARCHITECTURE.md) 为准。

日期：2026-10-20。基准：`94da17123ba5d7ac16f701fcddd871c7c650a5a9`。分支：`codex/lose-weight-v2`。

结论：隔离本地开发版已通过构建、44 项自动化测试及桌面/手机浏览器验收。可以先试用手动记录、营养统计和完整 ZIP；不代表真实 Supabase、Google 或 DeepSeek 已完成联调。不合并 main，不部署生产。

## 预览与隔离

- 当前本机预览：`http://127.0.0.1:3004/`。停止后可运行 `npm run preview:v2` 重启；以终端实际端口为准。
- Next.js 16.4.0 / React 19.2.6 / Node 24.19.0，Windows、Chrome 无头浏览器。
- `.next-v2` 独立构建；预览强制清空 Supabase、AI、Google 和服务端连接密钥，只监听本机。
- 浏览器验收使用新的隔离上下文，阻断非本机请求。未读取、清空或覆盖用户原来的 3003 数据；未登录服务器或修改生产数据库。

## 已通过

| 范围 | 结果与证据 |
| --- | --- |
| 体重与历史 | 连续 30 个自然日载入、保存、刷新后读取正常；自然日范围、月界、上海午夜及 DST 测试通过。 |
| 饮食与运动 | 新增餐食、手工重量和营养、运动时长保存正常；营养和宏量进度为确定性计算，不调用模型。 |
| 照片持久化 | 浏览器真实分批上传 100 份合成 JPEG，包含一份 2400px 输入；压缩后均不超过 1200px 和 300KB，IndexedDB 读取正常。 |
| 容量压力 | 另外使用 100 个约 200KB 二进制压力样本验证约 20MB 的存储/ZIP 往返；不等同于真实餐食识别质量测试。 |
| 旧数据迁移 | Base64 照片迁移、原始恢复快照、容量不足不覆盖旧数据、多标签页版本冲突保护均通过。 |
| ZIP | 真实照片文件、清单和 SHA-256；预览不写入；恢复前 ZIP；合并幂等；恢复并再次导出后记录与照片哈希一致。未关联但物理保留的照片也可导出恢复。 |
| ZIP 异常 | 损坏 ZIP、缺失图片、修改后的记录、未知版本、路径/数量/解压容量限制均拒绝写入。模拟恢复中断后事务完整回滚。 |
| JSON 兼容 | 旧版 JSON 记录和 Base64 照片可解析；只有路径的照片明确提示，必须确认仅合并记录；取消预览不改变数据。 |
| 常见解压器 | Windows .NET ZIP 读取器成功读取 102 个条目：2 个 JSON + 100 张照片。macOS 使用标准 ZIP 格式，但未在实体 macOS 上执行。 |
| 趋势与移动端 | 桌面 1365×950、手机 390×844 及窄屏 320×740；曲线路径非空、按钮文本无溢出、页面无横向滚动。手机为浏览器模拟，不是实体手机。 |
| 低费用 AI | 已保存结果不再次调用；明确确认才重新识别；结果在服务端保存后返回。输入图片/文字、输出 Tokens、身份、数据库预算、超时及手动备用确认有测试。 |
| AI 故障 | 未配 Key 时手动功能正常；模拟 401/402/429/500/503、无效输出及超时，均明确失败且不自动重试或调用备用服务。信息不足时清空数值估计。 |
| Google 摘要 | 字段白名单不含照片、餐食细节、健康备注、身份信息；RAW 写入专用 Summary 页；模拟权限/限流错误。连续保存遇到忙锁时延后重试并再次检查开关；页面取消或关闭授权后不再启动同步。 |
| 凭证保护 | AES-256-GCM 随机 nonce、用户/用途绑定、篡改拒绝；连接表仅服务端访问；备份不含凭证。 |
| 只读 MCP | 使用真实 MCP SDK 测试 initialize、tools/list、tools/call；仅四个只读工具；拒绝未知工具、过大范围、跨来源请求和无授权请求。 |
| PostgreSQL | PGlite 实际 PostgreSQL 执行两份迁移及重复执行、RLS、跨用户照片关联、原子恢复、AI 预算和只读凭证过期/撤销/每分钟 60 次限制。不是伪造 SQL 返回值。 |
| 云端客户端 | 模拟 Supabase 验证 1201 行分页、用户作用域、私有文件读取、重复恢复 ID 映射、上传中断不提交记录、容量不足不清理历史。 |

## 本机测量

最新浏览器运行：首屏载入 2010ms；100 张合成 JPEG 压缩、写入和关联约 3080ms；ZIP 为 584226 字节。合成图尺寸与压缩率较低，不能据此推断真实照片、手机硬件或网络性能。

浏览器异常：0。外部请求：0。截图与可重现运行结果位于忽略目录 `outputs/v2-acceptance/`，包含 `results.json`、桌面/手机截图、两次完整 ZIP 和恢复前 ZIP。它们仅为虚构测试数据，不提交到 GitHub。

复现命令：`npm run build:v2`、`npm run test:unit`、`npm run lint`；另启动本地预览后运行 `npm run test:browser`。Windows 重新构建前需关闭正在使用同一构建目录的 V2 预览，不能删除浏览器存储来解决文件锁。

## 尚待真实配置验收

1. 没有 Supabase 测试项目：尚未验证真实邮箱登录、登出重登、另一台设备读取、Storage 签名链接及真实项目配额。先建独立测试项目并按 README 执行迁移；不能直接拿生产库验收。
2. 没有 DeepSeek Key：没有发生真实付费调用，尚未验证账户对 `deepseek-flash` 视觉接口的可用性、账单及真实餐食营养估计质量。当前仅用受控模拟响应验证协议和错误分支。
3. 没有 Google OAuth 测试客户端：授权/写入代码及模拟边界已实现，真实授权、令牌刷新、创建摘要表、ChatGPT Google Drive 读回仍待配置。此轮没有向实际 Google 账号发送任何健康数据。
4. MCP 当前供支持自定义 Bearer 的客户端使用。本地地址不能供远程 ChatGPT 直接访问；原生 ChatGPT MCP 接入仍需 HTTPS 地址、其要求的 OAuth/资源发现流程及真实客户端验收。本轮只实现可扩展只读接口，不宣称已经接通。
5. 只验收 Next.js Node standalone 路线，未验收原仓库备用 Sites/Cloudflare 构建。服务端加密和 OAuth 不应未经测试直接搬到 Edge runtime。

## 安全与上线边界

`npm audit --omit=dev`：0 个运行依赖漏洞。升级 Next.js、fflate、image-size，并更新相关锁定依赖。完整开发工具链审计仍有告警，未采用破坏性的 `audit fix --force`；备用构建和开发工具链需另行维护，不能把运行审计清零等同于所有部署路线安全。

ZIP 是完整个人数据备份，仍包含用户自行记录的健康内容，应由用户妥善保存。Google 默认只发摘要；关闭开关停止后续同步，但不会自动删除用户表格里已授权发送的历史摘要。已有在途请求可能已经完成。

等待用户试用确认后，另做真实服务配置验收及上线审批。本次不进行 main 合并、甲骨文服务器部署或生产数据迁移。

## 参考协议

- [Google Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Sheets create 与 drive.file 授权](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/create)
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [DeepSeek JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)
- [Mifflin 能量估算原始研究](https://pubmed.ncbi.nlm.nih.gov/2305711/)
- [NIDDK 成人能量模型适用边界](https://www.niddk.nih.gov/bwp)

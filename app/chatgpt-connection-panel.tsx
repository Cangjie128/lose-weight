"use client";
import { useEffect, useState } from "react";
import { Copy, Download, ExternalLink, Link, Loader2, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import type { AppData } from "@/lib/fat-loss";
import { summaryRows } from "@/lib/chatgpt-data";

type GoogleStatus = { configured: boolean; connected?: boolean; enabled?: boolean; spreadsheet_url?: string; last_synced_at?: string };
type McpStatus = { configured: boolean; enabled?: boolean; endpoint?: string; expires_at?: string };
export default function ChatgptConnectionPanel({ data,isDemo,getHeaders }: { data: AppData; isDemo: boolean; getHeaders: () => Promise<Record<string,string>> }) {
  const [google,setGoogle] = useState<GoogleStatus>({ configured: false,enabled: false });
  const [mcp,setMcp] = useState<McpStatus>({ configured: false,enabled: false });
  const [consent,setConsent] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [token,setToken] = useState("");
  async function api(path: string,method = "GET",body?: unknown) {
    const response = await fetch(path,{ method,headers: { ...(await getHeaders()),"Content-Type": "application/json" },...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "连接请求失败，原始记录未修改。");
    return result;
  }
  async function refresh() {
    if (isDemo) return;
    const [g,m] = await Promise.all([api("/api/connections/google"),api("/api/connections/mcp")]);
    setGoogle(g); setMcp(m);
  }
  useEffect(() => {
    let active = true;
    if (!isDemo) getHeaders().then((headers) => Promise.all([
      fetch("/api/connections/google",{ headers }).then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value; }),
      fetch("/api/connections/mcp",{ headers }).then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value; }),
    ])).then(([g,m]) => { if (active) { setGoogle(g); setMcp(m); } }).catch((error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  },[isDemo]); // eslint-disable-line react-hooks/exhaustive-deps
  async function perform(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); await refresh(); } catch(error) { setMessage(error instanceof Error ? error.message : "连接暂不可用。"); }
    finally { setBusy(false); }
  }
  function exportDigest() {
    const blob = new Blob([JSON.stringify({ format: "lose-weight-chatgpt-summary-v1",exported_at: new Date().toISOString(),rows: summaryRows(data) },null,2)],{ type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "lose-weight-chatgpt-summary.json"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  const button = "flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#d9ccb8] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50";
  return <section className="border-t border-[#eadfcf] pt-5">
    <h3 className="flex items-center gap-2 text-lg font-bold"><Link className="h-5 w-5" />ChatGPT 数据连接</h3>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><span className="font-semibold">Google Sheets 摘要同步</span><span>{google.enabled ? "已开启" : "已关闭"}</span>
      <button title="刷新连接状态" aria-label="刷新连接状态" className={button} disabled={busy || isDemo} onClick={() => void perform(refresh)}><RefreshCw className="h-4 w-4" /></button></div>
    <p className="mt-2 text-sm leading-6 text-[#667165]">发送日期、体重、营养累计与目标、运动时长和次数。不会发送照片、健康备注、姓名、邮箱或账号 ID。</p>
    <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" />我同意将上述统计数据同步到我的私有 Google Sheets 摘要表，并供已授权的 ChatGPT Google Drive 连接读取。</label>
    {!google.configured && <p className="mt-3 text-sm text-[#667165]">{isDemo ? "本地试用不发送云端数据。" : "Google 授权配置尚未完成。"}</p>}
    <div className="mt-3 flex flex-wrap gap-3">
      <button className={button} disabled={busy || isDemo || !google.configured || !consent} onClick={() => void perform(async () => { const result = await api("/api/connections/google/start","POST",{ consent: true }); window.location.assign(result.url); })}><Link className="h-4 w-4" />{google.connected ? "重新授权 Google" : "授权 Google"}</button>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" role="switch" aria-label="开启摘要同步" checked={Boolean(google.enabled)} disabled={busy || !google.connected || (!google.enabled && !consent)} onChange={(event) => { const enabled = event.target.checked; void perform(async () => { await api("/api/connections/google","PATCH",{ enabled,consent }); if (enabled) await api("/api/connections/google/sync","POST"); }); }} />摘要同步</label>
      <button className={button} disabled={busy || !google.enabled} onClick={() => void perform(async () => { const result = await api("/api/connections/google/sync","POST"); setMessage(`已同步 ${result.synced_days} 天摘要。`); })}><RefreshCw className="h-4 w-4" />立即同步</button>
      <button className={button} onClick={exportDigest}><Download className="h-4 w-4" />导出 ChatGPT 摘要</button>
    </div>
    {google.spreadsheet_url && <a href={google.spreadsheet_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm underline"><ExternalLink className="h-4 w-4" />打开私有摘要表</a>}
    {google.last_synced_at && <p className="mt-2 text-xs text-[#667165]">最近同步：{new Date(google.last_synced_at).toLocaleString()}</p>}
    <h4 className="mt-6 flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5" />MCP 只读连接</h4>
    <p className="mt-2 text-sm text-[#667165]">{mcp.enabled ? `已授权，凭证有效至 ${new Date(mcp.expires_at!).toLocaleDateString()}` : "未授权"}。仅提供统计查询，不提供修改或删除权限。</p>
    {!mcp.configured && <p className="mt-2 text-sm text-[#667165]">{isDemo ? "只读连接在云端账号模式下授权。" : "只读连接服务尚未配置。"}</p>}
    <div className="mt-3 flex flex-wrap gap-3">
      <button className={button} disabled={busy || !mcp.configured} onClick={() => { if (window.confirm("允许只读连接查询体重、营养与运动统计 90 天？新凭证会撤销旧凭证。")) void perform(async () => { const result = await api("/api/connections/mcp","POST",{ consent: true }); setToken(result.token); }); }}><ShieldCheck className="h-4 w-4" />{mcp.enabled ? "更新只读凭证" : "授权只读连接"}</button>
      <button className={button} disabled={busy || !mcp.enabled} onClick={() => void perform(async () => { await api("/api/connections/mcp","DELETE"); setToken(""); })}><Unplug className="h-4 w-4" />撤销只读授权</button>
    </div>
    {token && <div className="mt-3"><label className="text-sm">只读凭证（仅本次显示）<input readOnly type="password" value={token} className="mt-1 min-h-11 w-full rounded-md border p-2" /></label><button className={`${button} mt-2`} onClick={() => void navigator.clipboard.writeText(token).then(() => setMessage("只读凭证已复制。"),() => setMessage("浏览器不允许复制，请检查剪贴板权限。"))}><Copy className="h-4 w-4" />复制凭证</button></div>}
    {mcp.endpoint && <p className="mt-3 break-all text-xs text-[#667165]">连接地址：{mcp.endpoint}</p>}
    {busy && <p role="status" className="mt-3 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />正在处理连接</p>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}

"use client";
import { useEffect, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

type AiStatus = { provider: string; model: string; configured: boolean; local_test_mode: boolean; fallback_available: boolean; calls: number | null; input_tokens: number | null; output_tokens: number | null; user_daily_limit: number };
export default function AiStatusPanel({ getHeaders }: { getHeaders: () => Promise<Record<string,string>> }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  async function refresh() {
    try {
      const response = await fetch("/api/ai-status", { headers: await getHeaders(), cache: "no-store" });
      if (response.ok) setStatus(await response.json());
    } catch { setStatus(null); }
  }
  useEffect(() => {
    let active = true;
    getHeaders().then((headers) => fetch("/api/ai-status",{ headers,cache: "no-store" })).then((response) => response.json()).then((value) => { if (active) setStatus(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <section className="mt-5 border-t border-[#eadfcf] pt-4">
    <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-bold">AI 服务与调用预算</h4><button onClick={() => void refresh()} title="刷新使用量" aria-label="刷新 AI 使用量" className="grid h-9 w-9 place-items-center rounded border border-[#d9ccb8]"><RefreshCw className="h-4 w-4" /></button></div>
    <p className="mt-2 text-sm">{status ? `${status.provider === "deepseek" ? "DeepSeek" : "OpenAI"} · ${status.model} · ${status.configured ? "已配置" : "未配置"}` : "正在读取服务状态"}</p>
    {status && <p className="mt-2 text-xs text-[#667165]">{status.local_test_mode ? "本机回环 AI 测试模式已启用；结果保存到本地记录。" : "当前为安全预览，真实 AI 调用保持关闭。"}{!status.configured ? " 服务端尚未连接真实 AI，手动记录和营养计算仍可使用。" : ""}</p>}
    <p className="mt-2 text-sm text-[#667165]">今日调用：{status?.calls ?? "登录后可查看"}{status?.calls !== null && status?.calls !== undefined ? ` / ${status.user_daily_limit} 次` : ""}。预算按 UTC 每日重置。</p>
    {status?.input_tokens !== null && status?.input_tokens !== undefined && <p className="mt-1 text-xs text-[#667165]">已统计输入 {status.input_tokens} / 输出 {status.output_tokens || 0} tokens；实际账单以服务商为准。</p>}
    <p className="mt-2 text-xs text-[#667165]">{status?.fallback_available ? "OpenAI 备用已启用，每次使用前仍需明确确认。" : "备用付费模型未启用。"} 分析失败不会自动重试或切换付费服务。</p>
  </section>;
}

export function FallbackAnalysisAction({ onUse, disabled }: { onUse: () => void; disabled: boolean }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai-status").then((response) => response.json()).then((status) => { if (!cancelled) setAvailable(Boolean(status.fallback_available)); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return available ? <button disabled={disabled} onClick={onUse} className="flex min-h-10 items-center gap-2 rounded-md border border-[#e3d3bc] px-3 py-2 text-sm font-semibold disabled:opacity-50"><Sparkles className="h-4 w-4" />OpenAI 备用分析</button> : null;
}

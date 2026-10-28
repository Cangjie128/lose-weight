import { aiConfiguration, authenticateAi, isLocalAiTestMode, localAiStatus } from "@/lib/ai-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const localTestMode = isLocalAiTestMode();
  let calls: number | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  if (localTestMode) {
    const local = localAiStatus(); calls = local.calls; inputTokens = local.inputTokens; outputTokens = local.outputTokens;
  } else if (request.headers.has("authorization")) {
    try {
      const { client, userId } = await authenticateAi(request);
      const result = await client.from("ai_usage_daily").select("calls,input_tokens,output_tokens").eq("user_id", userId).eq("usage_date", new Date().toISOString().slice(0,10)).maybeSingle();
      if (!result.error) { calls = result.data?.calls || 0; inputTokens = result.data?.input_tokens || 0; outputTokens = result.data?.output_tokens || 0; }
    } catch { /* Status never exposes session tokens or provider keys. */ }
  }
  const provider = process.env.AI_PROVIDER || "deepseek";
  let configured = false;
  try { aiConfiguration(); configured = true; } catch { /* Missing keys keep paid calls disabled. */ }
  return Response.json({ provider, model: provider === "openai" ? process.env.OPENAI_MODEL || "gpt-5.6" : process.env.DEEPSEEK_MODEL || "deepseek-flash",
    configured,
    local_test_mode: localTestMode,
    fallback_available: !localTestMode && process.env.AI_ALLOW_OPENAI_FALLBACK === "true" && Boolean(process.env.OPENAI_API_KEY),
    user_daily_limit: localTestMode ? localAiStatus().dailyLimit : Math.max(1, Math.min(20, Number(process.env.AI_DAILY_USER_LIMIT) || 20)), calls, input_tokens: inputTokens, output_tokens: outputTokens, reset_timezone: "UTC",
  }, { headers: { "Cache-Control": "no-store" } });
}

import { z } from "zod";
import { AiError, authenticateAi, readBoundedJson } from "@/lib/ai-service";
import { checkOrigin, integrationFailure, integrationOrigin, issueReadToken, serviceDatabase, tokenHash } from "@/lib/integration-security";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ configured: false,enabled: false },{ headers: { "Cache-Control": "no-store" } });
  try {
    const { userId } = await authenticateAi(request);
    const result = await serviceDatabase().from("mcp_read_tokens").select("expires_at,revoked").eq("user_id",userId).maybeSingle();
    if (result.error) throw new AiError("无法读取只读连接状态。",503);
    return Response.json({ configured: true,enabled: Boolean(result.data && !result.data.revoked && new Date(result.data.expires_at).getTime() > Date.now()),expires_at: result.data?.expires_at,endpoint: `${integrationOrigin()}/api/mcp` },{ headers: { "Cache-Control": "no-store" } });
  } catch(error) { return integrationFailure(error); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    z.object({ consent: z.literal(true) }).strict().parse(await readBoundedJson(request));
    const { userId } = await authenticateAi(request);
    const token = issueReadToken(); const expires = new Date(Date.now()+90*86400000).toISOString();
    const result = await serviceDatabase().from("mcp_read_tokens").upsert({ user_id: userId,token_hash: tokenHash(token),expires_at: expires,revoked: false,window_calls: 0,window_started_at: new Date().toISOString() },{ onConflict: "user_id" });
    if (result.error) throw new AiError("无法创建只读凭证，原始数据未修改。",503);
    return Response.json({ token,expires_at: expires,endpoint: `${integrationOrigin()}/api/mcp` },{ headers: { "Cache-Control": "no-store" } });
  } catch(error) { return integrationFailure(error); }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const { userId } = await authenticateAi(request);
    const result = await serviceDatabase().from("mcp_read_tokens").update({ revoked: true }).eq("user_id",userId);
    if (result.error) throw new AiError("撤销失败，请稍后重试。",503);
    return Response.json({ enabled: false });
  } catch(error) { return integrationFailure(error); }
}

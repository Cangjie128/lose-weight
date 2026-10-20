import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { AiError } from "./ai-service.ts";
import { appDataSchema } from "./schemas.ts";
import { fetchAllRows } from "./cloud-storage.ts";

export function integrationOrigin() {
  const url = new URL(process.env.APP_ORIGIN || "http://127.0.0.1:3004");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost","127.0.0.1","[::1]"].includes(url.hostname))) throw new AiError("连接功能需要 HTTPS，或本机 localhost 测试地址。",503);
  return url.origin;
}

function encryptionKey() {
  const value = process.env.INTEGRATION_ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new AiError("服务端连接加密密钥尚未配置。",503,"INTEGRATION_NOT_CONFIGURED");
  return Buffer.from(value,"hex");
}
export function seal(value: unknown, purpose: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm",encryptionKey(),iv);
  cipher.setAAD(Buffer.from(purpose));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString("base64url");
}
export function unseal(value: string, purpose: string): unknown {
  try {
    const bytes = Buffer.from(value,"base64url");
    const cipher = createDecipheriv("aes-256-gcm",encryptionKey(),bytes.subarray(0,12));
    cipher.setAAD(Buffer.from(purpose)); cipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString("utf8"));
  } catch { throw new AiError("连接授权已失效或校验失败，请重新授权。",400,"INVALID_AUTH_STATE"); }
}
export function tokenHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function issueReadToken() { return `lw_mcp_${randomBytes(32).toString("base64url")}`; }

export function serviceDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || url.includes("your-project")) throw new AiError("连接服务尚未配置独立的 Supabase 项目。",503,"INTEGRATION_NOT_CONFIGURED");
  return createClient(url,key,{ auth: { persistSession: false, autoRefreshToken: false } });
}

export async function readOwnedData(client: ReturnType<typeof serviceDatabase>, userId: string) {
  const profile = await client.from("profiles").select("*").eq("user_id",userId).single();
  const challenge = await client.from("challenges").select("*").eq("user_id",userId).eq("status","active").order("created_at",{ ascending: false }).limit(1).single();
  if (profile.error || challenge.error) throw new AiError("尚无可读取的云端资料，请先保存个人设置。",404);
  const [weights,meals,exercises] = await Promise.all([fetchAllRows(client,"weight_records",userId),fetchAllRows(client,"meal_records",userId),fetchAllRows(client,"exercise_records",userId)]);
  return appDataSchema.parse({ profile: profile.data, challenge: challenge.data, weights, meals: meals.map((meal) => ({ ...meal, images: [] })), exercises, checkins: [], summaries: [] });
}

export function integrationFailure(error: unknown) {
  return Response.json({ error: error instanceof AiError ? error.message : "数据连接暂不可用，请检查配置、授权和网络。原始记录未修改。" },
    { status: error instanceof AiError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
}

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== integrationOrigin()) throw new AiError("不允许此来源访问连接接口。",403);
}

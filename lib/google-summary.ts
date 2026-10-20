import { OAuth2Client, CodeChallengeMethod, type Credentials } from "google-auth-library";
import { z } from "zod";
import { AiError, authenticateAi, readBoundedJson } from "./ai-service.ts";
import { checkOrigin, integrationFailure, integrationOrigin, readOwnedData, seal, serviceDatabase, tokenHash, unseal } from "./integration-security.ts";
import { summaryRows } from "./chatgpt-data.ts";

const scope = "https://www.googleapis.com/auth/drive.file";
const stateSchema = z.object({ userId: z.uuid(), state: z.string(), verifier: z.string(), expires: z.number() });
function oauthClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new AiError("Google Sheets 授权尚未配置，仍可导出摘要供 ChatGPT 分析。",503,"GOOGLE_NOT_CONFIGURED");
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,`${integrationOrigin()}/api/connections/google/callback`);
}
function stateCookie(value: string, age = 600) {
  return `lw_google_state=${value}; Path=/api/connections/google; HttpOnly; SameSite=Lax; Max-Age=${age}${integrationOrigin().startsWith("https:") ? "; Secure" : ""}`;
}
function configured() { return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.INTEGRATION_ENCRYPTION_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY); }

export async function startGoogleAuthorization(request: Request) {
  try {
    checkOrigin(request);
    const consent = z.object({ consent: z.literal(true) }).strict().parse(await readBoundedJson(request));
    if (!consent.consent) throw new AiError("必须先确认摘要同步授权。",400);
    const { userId } = await authenticateAi(request);
    const db = serviceDatabase(); const oauth = oauthClient();
    const { codeVerifier,codeChallenge } = await oauth.generateCodeVerifierAsync();
    const state = crypto.randomUUID(); const expires = Date.now()+600000;
    const ciphertext = seal({ userId,state,verifier: codeVerifier,expires },"google-state");
    const result = await db.from("google_authorization_states").insert({ state_hash: tokenHash(state),user_id: userId,expires_at: new Date(expires).toISOString() });
    if (result.error) throw new AiError("授权状态无法安全保存，未连接 Google。",503);
    const url = oauth.generateAuthUrl({ access_type: "offline",prompt: "consent",scope,state,code_challenge: codeChallenge,code_challenge_method: CodeChallengeMethod.S256 });
    return Response.json({ url },{ headers: { "Set-Cookie": stateCookie(ciphertext),"Cache-Control": "no-store" } });
  } catch(error) { return integrationFailure(error); }
}

export async function finishGoogleAuthorization(request: Request) {
  let outcome = "error";
  try {
    const url = new URL(request.url);
    if (url.searchParams.has("error")) throw new AiError("Google 授权已取消。",400);
    const cookie = request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith("lw_google_state="))?.slice(16);
    const state = stateSchema.parse(unseal(cookie || "","google-state"));
    if (state.expires < Date.now() || state.state !== url.searchParams.get("state")) throw new AiError("授权状态无效。",400);
    const code = url.searchParams.get("code");
    if (!code || code.length > 4000) throw new AiError("授权代码无效。",400);
    const db = serviceDatabase();
    // Atomic one-use claim prevents replaying the callback from another process.
    const claim = await db.from("google_authorization_states").delete().eq("state_hash",tokenHash(state.state)).eq("user_id",state.userId).gt("expires_at",new Date().toISOString()).select("user_id").single();
    if (claim.error || !claim.data) throw new AiError("授权已使用或过期。",400);
    const result = await oauthClient().getToken({ code,codeVerifier: state.verifier });
    if (!result.tokens.refresh_token || !result.tokens.scope?.split(" ").includes(scope)) throw new AiError("未取得摘要表所需权限，请重新授权。",403);
    const saved = await db.from("google_summary_connections").upsert({ user_id: state.userId,enabled: false,token_ciphertext: seal(result.tokens,`google-token:${state.userId}`),updated_at: new Date().toISOString() },{ onConflict: "user_id" });
    if (saved.error) throw new AiError("授权凭证无法安全保存，摘要同步未开启。",503);
    outcome = "authorized";
  } catch { /* Never reflect provider errors, codes or credentials into the URL. */ }
  return new Response(null,{ status: 303,headers: { Location: `${integrationOrigin()}/?google_connection=${outcome}`,"Set-Cookie": stateCookie("",0),"Cache-Control": "no-store","Referrer-Policy": "no-referrer" } });
}

export async function googleConnectionStatus(request: Request) {
  if (!configured()) return Response.json({ configured: false,enabled: false,connected: false },{ headers: { "Cache-Control": "no-store" } });
  try {
    const { userId } = await authenticateAi(request);
    const result = await serviceDatabase().from("google_summary_connections").select("enabled,spreadsheet_url,last_synced_at,synced_rows").eq("user_id",userId).maybeSingle();
    if (result.error) throw new AiError("无法读取摘要连接状态。",503);
    return Response.json({ configured: true,connected: Boolean(result.data),...result.data },{ headers: { "Cache-Control": "no-store" } });
  } catch(error) { return integrationFailure(error); }
}

export async function changeGoogleConnection(request: Request) {
  try {
    checkOrigin(request);
    const body = z.object({ enabled: z.boolean(),consent: z.boolean().default(false) }).strict().parse(await readBoundedJson(request));
    if (body.enabled && !body.consent) throw new AiError("请先确认发送体重和营养运动摘要。",403);
    const { userId } = await authenticateAi(request);
    const result = await serviceDatabase().from("google_summary_connections").update({ enabled: body.enabled,updated_at: new Date().toISOString() }).eq("user_id",userId).select("user_id").single();
    if (result.error) throw new AiError("请先授权 Google，原始记录未修改。",400);
    return Response.json({ enabled: body.enabled });
  } catch(error) { return integrationFailure(error); }
}

export async function writeSummarySheet(accessToken: string, spreadsheetId: string, rows: (string|number)[][], previousRows = 0, fetcher: typeof fetch = fetch) {
  if (!/^[a-zA-Z0-9_-]+$/.test(spreadsheetId)) throw new AiError("摘要表编号无效。",400);
  // Only the app-owned Summary tab is written; RAW avoids spreadsheet formula injection.
  const padded = [...rows];
  while (padded.length < previousRows) padded.push(Array(15).fill(""));
  const result = await fetcher(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,{
    method: "POST",headers: { Authorization: `Bearer ${accessToken}`,"Content-Type": "application/json" },signal: AbortSignal.timeout(25000),
    body: JSON.stringify({ valueInputOption: "RAW",data: [{ range: `Summary!A1:O${padded.length}`,values: padded }] }),
  });
  if (!result.ok) throw new AiError(result.status === 401 || result.status === 403 ? "Google 授权已失效或没有权限，请重新授权。" : result.status === 429 ? "Google Sheets 请求过于频繁，请稍后同步。" : "摘要同步失败，Supabase 原始记录未修改。",502);
}

export async function syncGoogleSummary(request: Request) {
  try {
    checkOrigin(request);
    const { client,userId } = await authenticateAi(request);
    const db = serviceDatabase();
    const reservation = await db.rpc("reserve_summary_sync",{ p_user_id: userId });
    if (reservation.error || !reservation.data) throw new AiError("摘要同步未开启或正在同步，请稍后重试。",409);
    const connection = await db.from("google_summary_connections").select("*").eq("user_id",userId).single();
    if (connection.error || !connection.data.enabled) throw new AiError("摘要同步已关闭。",403);
    const oauth = oauthClient();
    oauth.setCredentials(unseal(connection.data.token_ciphertext,`google-token:${userId}`) as Credentials);
    const { token } = await oauth.getAccessToken();
    if (!token) throw new AiError("Google 授权已失效，请重新授权。",401);
    const rows = summaryRows(await readOwnedData(client,userId));
    let spreadsheetId = connection.data.spreadsheet_id;
    let spreadsheetUrl = connection.data.spreadsheet_url;
    if (!spreadsheetId) {
      const created = await fetch("https://sheets.googleapis.com/v4/spreadsheets",{
        method: "POST",headers: { Authorization: `Bearer ${token}`,"Content-Type": "application/json" },signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ properties: { title: "lose-weight ChatGPT summary" },sheets: [{ properties: { title: "Summary",gridProperties: { rowCount: 10001,columnCount: 15,frozenRowCount: 1 } } }] }),
      });
      if (!created.ok) throw new AiError("无法创建私有摘要表，未修改其他 Google 文件。",502);
      const sheet = z.object({ spreadsheetId: z.string().regex(/^[a-zA-Z0-9_-]+$/),spreadsheetUrl: z.url().refine((value) => new URL(value).hostname === "docs.google.com") }).parse(await created.json());
      spreadsheetId = sheet.spreadsheetId; spreadsheetUrl = sheet.spreadsheetUrl;
      const saved = await db.from("google_summary_connections").update({ spreadsheet_id: spreadsheetId,spreadsheet_url: spreadsheetUrl }).eq("user_id",userId);
      if (saved.error) throw new AiError("摘要表已创建但编号保存失败，请检查连接配置。",503);
    }
    const enabled = await db.from("google_summary_connections").select("enabled").eq("user_id",userId).single();
    if (enabled.error || !enabled.data.enabled) throw new AiError("摘要同步已关闭，本次写入已停止。",403);
    await writeSummarySheet(token,spreadsheetId,rows,connection.data.synced_rows);
    const saved = await db.from("google_summary_connections").update({ token_ciphertext: seal(oauth.credentials,`google-token:${userId}`),last_synced_at: new Date().toISOString(),synced_rows: rows.length }).eq("user_id",userId);
    if (saved.error) throw new AiError("摘要已写入，但同步状态保存失败，请检查数据库。",503);
    return Response.json({ synced_days: rows.length-1,spreadsheet_url: spreadsheetUrl });
  } catch(error) { return integrationFailure(error); }
}

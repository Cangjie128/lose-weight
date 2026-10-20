import assert from "node:assert/strict";
import test from "node:test";
import { addDays,buildDefaultData,todayString } from "../lib/fat-loss.ts";
import { dailyDigest,queryReadTool,summaryRows } from "../lib/chatgpt-data.ts";
import { issueReadToken,seal,tokenHash,unseal } from "../lib/integration-security.ts";
import { writeSummarySheet } from "../lib/google-summary.ts";
import { handleReadMcp } from "../lib/mcp-read.ts";
import { scheduleSummarySync } from "../lib/summary-sync-client.ts";

function fixture() {
  const data = buildDefaultData("private-account-id");
  data.profile.age = 30; data.profile.health_notes = "PRIVATE_HEALTH_NOTE";
  data.profile.email = "PRIVATE_EMAIL";
  data.weights = [{ record_date: todayString(),weight_kg: 55,note: "PRIVATE_WEIGHT_NOTE" }];
  data.meals = [{ record_date: todayString(),food_name: "PRIVATE_FOOD_DETAIL",notes: "PRIVATE_MEAL_NOTE",images: [{ storage_path: "PRIVATE_PHOTO" }],nutrition: { calories_min: 400,calories_max: 500,protein_g: 25,fat_g: 15,carbohydrate_g: 60 } }];
  data.exercises = [{ record_date: todayString(),exercise_type: "步行",duration_min: 30,intensity: "低",discomfort_detail: "PRIVATE_PAIN_NOTE" }];
  return data;
}

test("Sheets summary contains deterministic allowlisted totals and no private data", () => {
  const data = fixture();
  const rows = summaryRows(data);
  assert.equal(rows.length,2); assert.equal(rows[1][1],55); assert.equal(rows[1][3],400); assert.equal(rows[1][9],30);
  assert.equal(JSON.stringify(rows).includes("PRIVATE"),false);
  assert.equal(JSON.stringify(rows).includes(data.profile.user_id),false);
  assert.equal(dailyDigest(data,todayString()).targets.calories > 1500,true);
});

test("read queries are bounded calendar ranges and exclude personal notes and photos", () => {
  const data = fixture();
  const week = queryReadTool(data,"seven_day_nutrition",{ end_date: todayString() });
  assert.equal(week.length,7); assert.equal(week[0].date,addDays(todayString(),-6));
  assert.equal(JSON.stringify(week).includes("PRIVATE"),false);
  assert.equal(queryReadTool(data,"exercise_history",{ end_date: todayString() })[0].duration_min,30);
  assert.throws(() => queryReadTool(data,"weight_trend",{ end_date: todayString(),days: 366 }));
  assert.throws(() => queryReadTool(data,"exercise_history",{ end_date: todayString(),user_id: "another-owner" }));
  assert.throws(() => queryReadTool(data,"delete_records",{}),/不允许/);
});

test("connection credentials are encrypted with authenticated purpose and random nonces", () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = "12".repeat(32);
  const first = seal({ refresh_token: "PRIVATE_TOKEN" },"google-token:alice");
  const second = seal({ refresh_token: "PRIVATE_TOKEN" },"google-token:alice");
  assert.notEqual(first,second); assert.equal(first.includes("PRIVATE_TOKEN"),false);
  assert.deepEqual(unseal(first,"google-token:alice"),{ refresh_token: "PRIVATE_TOKEN" });
  assert.throws(() => unseal(first,"google-token:bob"),/失效/);
  const bytes = Buffer.from(first,"base64url"); bytes[30] ^= 1;
  assert.throws(() => unseal(bytes.toString("base64url"),"google-token:alice"));
  const token = issueReadToken(); assert.match(token,/^lw_mcp_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(tokenHash(token),token); assert.equal(tokenHash(token).length,64);
  delete process.env.INTEGRATION_ENCRYPTION_KEY;
});

test("Sheets writes only the dedicated summary tab with RAW values and explicit errors",async () => {
  let request;
  await writeSummarySheet("PRIVATE_TOKEN","test-sheet",summaryRows(fixture()),4,async (url,init) => {
    request = { url,body: JSON.parse(init.body) }; return Response.json({});
  });
  assert.equal(request.body.valueInputOption,"RAW"); assert.equal(request.body.data[0].range,"Summary!A1:O4");
  assert.equal(request.body.data[0].values.length,4); assert.equal(JSON.stringify(request.body).includes("PRIVATE"),false);
  await assert.rejects(writeSummarySheet("token","test-sheet",[],0,async () => new Response(null,{ status: 403 })),/授权/);
  await assert.rejects(writeSummarySheet("token","test-sheet",[],0,async () => new Response(null,{ status: 429 })),/频繁/);
});

const rpc = (method,params = {},id = 1,headers = {}) => new Request("http://127.0.0.1:3004/api/mcp",{ method: "POST",headers: { "Content-Type": "application/json",Accept: "application/json, text/event-stream",...headers },body: JSON.stringify({ jsonrpc: "2.0",id,method,params }) });
test("real MCP SDK advertises only four read tools and never exposes mutations",async () => {
  const dependencies = { authorize: async () => async () => fixture() };
  const init = await handleReadMcp(rpc("initialize",{ protocolVersion: "2025-06-18",capabilities: {},clientInfo: { name: "local-test",version: "1" } }),dependencies);
  assert.equal(init.status,200); assert.equal((await init.json()).result.serverInfo.name,"lose-weight-readonly");
  const list = await handleReadMcp(rpc("tools/list"),dependencies);
  const tools = (await list.json()).result.tools;
  assert.equal(tools.length,4); assert.ok(tools.every((tool) => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));
  const answer = await handleReadMcp(rpc("tools/call",{ name: "seven_day_nutrition",arguments: { end_date: todayString() } }),dependencies);
  const body = await answer.json(); assert.equal(JSON.parse(body.result.content[0].text).length,7);
  assert.equal(JSON.stringify(body).includes("PRIVATE"),false);
  const unknown = await handleReadMcp(rpc("tools/call",{ name: "delete_records",arguments: {} }),dependencies);
  const denied = await unknown.json(); assert.ok(denied.error || denied.result?.isError);
  assert.equal((await handleReadMcp(rpc("tools/list"))).status,401);
  assert.equal((await handleReadMcp(rpc("tools/list",{},1,{ Origin: "https://attacker.example" }),dependencies)).status,403);
});

test("summary saves wait for the cloud queue, retry busy sync and recheck consent",async () => {
  const queue = []; const calls = []; const errors = [];
  let enabled = true; let synced = 0; let saved = false;
  const options = {
    getHeaders: async () => ({}),waitForSaves: async () => { saved = true; },onError: (message) => errors.push(message),
    schedule: (callback,delay) => { queue.push({ callback,delay }); return queue.length; },clear: () => undefined,
    fetcher: async (path) => {
      assert.equal(saved,true); calls.push(path);
      if (path.endsWith("/sync")) { synced++; return new Response(null,{ status: synced === 1 ? 409 : 200 }); }
      return Response.json({ enabled });
    },
  };
  const cancel = scheduleSummarySync(options);
  assert.equal(queue[0].delay,2500); await queue.shift().callback();
  assert.equal(queue[0].delay,65000); await queue.shift().callback();
  assert.equal(synced,2); assert.equal(queue.length,0); assert.deepEqual(errors,[]);
  enabled = false; scheduleSummarySync(options); await queue.shift().callback(); assert.equal(synced,2);
  enabled = true; scheduleSummarySync(options)(); await queue.shift().callback(); assert.equal(synced,2);
  assert.ok(calls.every((path) => path.startsWith("/api/connections/google"))); cancel();
});

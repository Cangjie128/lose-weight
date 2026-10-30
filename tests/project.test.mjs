import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contains the expected app surfaces", async () => {
  const [page, layout, app, mealApi, summaryApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fat-loss-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analyze-meal/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/daily-summary/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<FatLossApp \/>/);
  assert.match(layout, /我的减肥计划/);
  assert.match(app, /AI分析/);
  assert.match(app, /7日移动平均/);
  assert.match(app, /本地演示模式/);
  assert.match(app, /每日个性化减肥教练/);
  assert.match(app, /记录体重/);
  assert.match(app, /添加一条记录/);
  assert.match(app, /完整详情/);
  assert.doesNotMatch(layout + app,/拾光计划|SHIGUANG/);
  assert.match(mealApi, /handleAiRequest\(request, "meal"\)/);
  assert.match(summaryApi, /handleAiRequest\(request, "summary"\)/);
});

test("includes Supabase schema and deployment documentation", async () => {
  const [schema, envExample, readme, packageJson] = await Promise.all([
    readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  for (const table of [
    "profiles",
    "challenges",
    "weight_records",
    "meal_records",
    "meal_images",
    "exercise_records",
    "daily_checkins",
    "daily_ai_summaries",
  ]) {
    assert.match(schema, new RegExp(`create table if not exists public\\.${table}`));
  }

  assert.match(schema, /enable row level security/);
  assert.match(schema, /storage\.buckets/);
  assert.match(envExample, /OPENAI_API_KEY/);
  assert.match(envExample, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(readme, /Vercel|部署/);
  assert.match(packageJson, /"build": "next build"/);
  assert.match(packageJson,/preview:coach:ai/);
  assert.match(envExample,/LOCAL_AI_TEST_MODE=false/);
});

test("does not keep starter preview artifacts wired into the app", async () => {
  const [layout, page, packageJson] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(layout + page + packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(layout + page, /codex-preview|Your site is taking shape/);
});

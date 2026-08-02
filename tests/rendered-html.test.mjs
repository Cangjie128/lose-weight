import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Chinese fat-loss app shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN"/);
  assert.match(html, /<title>温和减脂记录与指导<\/title>/);
  assert.match(html, /正在准备你的减脂记录本|温和减脂/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("includes required implementation surfaces", async () => {
  const [app, schema, envExample, readme, packageJson] = await Promise.all([
    readFile(new URL("../app/fat-loss-app.tsx", import.meta.url), "utf8"),
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
  assert.match(app, /AI分析/);
  assert.match(app, /7日移动平均/);
  assert.match(app, /本地演示模式/);
  assert.match(envExample, /OPENAI_API_KEY/);
  assert.match(envExample, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(readme, /Supabase/);
  assert.match(packageJson, /@supabase\/supabase-js/);
  assert.match(packageJson, /recharts/);
});

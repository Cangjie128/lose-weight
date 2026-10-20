import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildDefaultData, todayString } from "../lib/fat-loss.ts";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";

test("PostgreSQL migration, RLS, atomic restore and AI budgets", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
      insert into auth.users values('${alice}'),('${bob}');
    `);
    const schema = (await readFile(new URL("../supabase/schema.sql",import.meta.url),"utf8")).replace("create extension if not exists pgcrypto;","");
    await db.exec(schema);
    const migration = await readFile(new URL("../supabase/migrations/20261012_v2.sql",import.meta.url),"utf8");
    await db.exec(migration);
    await db.exec(migration);
    const connections = await readFile(new URL("../supabase/migrations/20261014_connections.sql",import.meta.url),"utf8");
    await db.exec(connections); await db.exec(connections);
    await db.exec("grant usage on schema public,auth,storage to authenticated,anon; grant select,insert,update,delete on all tables in schema public to authenticated; revoke insert,update,delete on public.ai_usage_daily,public.ai_requests from authenticated;");
    await db.exec("revoke all on public.google_summary_connections,public.google_authorization_states,public.mcp_read_tokens from authenticated;");
    const actAs = async (owner) => db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${owner}';`);
    await t.test("credentials are server-only and revoked, expired and over-limit MCP tokens fail",async () => {
      await actAs(alice);
      await assert.rejects(db.query("select * from public.google_summary_connections"),/permission denied/);
      await assert.rejects(db.query("select public.reserve_mcp_read('secret-hash')"),/permission denied/);
      await db.exec(`reset role; insert into public.mcp_read_tokens(user_id,token_hash,expires_at) values('${alice}','secret-hash',now()+interval '1 day');`);
      for (let index=0;index<60;index++) assert.equal((await db.query("select public.reserve_mcp_read('secret-hash') owner")).rows[0].owner,alice);
      assert.equal((await db.query("select public.reserve_mcp_read('secret-hash') owner")).rows[0].owner,null);
      await db.exec("update public.mcp_read_tokens set window_calls=0,revoked=true;");
      assert.equal((await db.query("select public.reserve_mcp_read('secret-hash') owner")).rows[0].owner,null);
      await db.exec("update public.mcp_read_tokens set revoked=false,expires_at=now()-interval '1 second';");
      assert.equal((await db.query("select public.reserve_mcp_read('secret-hash') owner")).rows[0].owner,null);
    });
    await actAs(alice);
    const data = buildDefaultData(alice);
    data.profile.age = 30;
    data.meals = [{ id: crypto.randomUUID(), user_id: alice, record_date: todayString(), meal_type: "lunch", food_name: "测试午餐", portion: "200g", notes: "", ai_analysis: null,
      nutrition: { calories_min: 400, calories_max: 500, protein_g: 25, fat_g: 15, carbohydrate_g: 55, portion_g: 200, source: "manual" }, images: [] }];
    data.meals[0].images.push({ id: crypto.randomUUID(), user_id: alice, record_date: todayString(), meal_record_id: data.meals[0].id, storage_path: `${alice}/test/photo.jpg`, size_bytes: 250000, mime_type: "image/jpeg", sha256: "a".repeat(64) });
    data.weights = [{ id: crypto.randomUUID(), user_id: alice, record_date: todayString(), weight_kg: 55, note: "测试", high_salt: false, late_dinner: false, menstrual_period: false, bowel_movement: true, poor_sleep: false, hard_training_previous_day: false }];

    await t.test("restores all records with photo metadata and remains idempotent", async () => {
      await db.query("select public.restore_v2_backup($1::jsonb)",[JSON.stringify(data)]);
      await db.query("select public.restore_v2_backup($1::jsonb)",[JSON.stringify(data)]);
      assert.equal((await db.query("select count(*)::int n from public.meal_records")).rows[0].n,1);
      assert.equal((await db.query("select count(*)::int n from public.meal_images")).rows[0].n,1);
      assert.equal((await db.query("select nutrition->>'protein_g' protein from public.meal_records")).rows[0].protein,"25");
      assert.equal((await db.query("select storage_path from public.meal_images")).rows[0].storage_path,`${alice}/test/photo.jpg`);
    });

    await t.test("an invalid record rolls back profile and all structured updates", async () => {
      const invalid = structuredClone(data); invalid.profile.diet_preferences = "不应写入"; invalid.weights[0].weight_kg = 999;
      await assert.rejects(db.query("select public.restore_v2_backup($1::jsonb)",[JSON.stringify(invalid)]),/weight_records|check constraint/);
      assert.equal((await db.query("select diet_preferences from public.profiles")).rows[0].diet_preferences,data.profile.diet_preferences);
      assert.equal(Number((await db.query("select weight_kg from public.weight_records")).rows[0].weight_kg),55);
    });

    await t.test("another account cannot read or overwrite records or attach photos", async () => {
      await actAs(bob);
      assert.equal((await db.query("select count(*)::int n from public.meal_records")).rows[0].n,0);
      assert.equal((await db.query("select count(*)::int n from public.weight_records")).rows[0].n,0);
      await assert.rejects(db.query("select public.restore_v2_backup($1::jsonb)",[JSON.stringify(data)]),/owner mismatch/);
      await assert.rejects(db.query("insert into public.meal_images(user_id,record_date,meal_record_id,storage_path) values($1,$2,$3,$4)",[bob,todayString(),data.meals[0].id,`${bob}/photo.jpg`]),/row-level security/);
      await actAs(alice);
    });

    await t.test("AI rate limit, daily caps and actual token accounting are enforced in SQL", async () => {
      const first = (await db.query("select public.reserve_ai_call('deepseek',2,2) id")).rows[0].id;
      await db.query("select public.finish_ai_call($1,true,321,123,null)",[first]);
      await assert.rejects(db.query("select public.reserve_ai_call('deepseek',2,2)"),/AI_RATE_LIMIT/);
      assert.equal((await db.query("select input_tokens::int n from public.ai_usage_daily")).rows[0].n,321);
      await db.exec("reset role; update public.ai_requests set created_at = now() - interval '11 seconds';");
      await actAs(alice);
      await db.query("select public.reserve_ai_call('deepseek',2,2)");
      await assert.rejects(db.query("select public.reserve_ai_call('deepseek',2,2)"),/AI_DAILY_LIMIT/);
      await actAs(bob);
      await assert.rejects(db.query("select public.reserve_ai_call('deepseek',2,2)"),/AI_DAILY_LIMIT/);
      assert.equal((await db.query("select count(*)::int n from public.ai_usage_daily")).rows[0].n,0);
      await actAs(alice);
    });
  } finally { await db.close(); }
});

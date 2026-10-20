import assert from "node:assert/strict";
import test from "node:test";
import { AiError, authenticateAi, handleAiRequest } from "../lib/ai-service.ts";
import { addDays, buildDefaultData, todayString } from "../lib/fat-loss.ts";
import { calculateNutritionTargets, dailyNutrition, exerciseSuggestion } from "../lib/nutrition.ts";

const recognized = { foods: ["鸡蛋"], estimated_calories_min: 300, estimated_calories_max: 450, estimated_portion_g: 200, protein_g: 20, fat_g: 12, carbohydrate_g: 35, recognition_status: "recognized", protein_level: "基本够", carbohydrate_level: "适中", fat_level: "适中", vegetable_level: "不足", strengths: [], improvements: [], next_meal_suggestion: "配蔬菜和主食", uncertainty_note: "根据照片和描述估算，存在误差" };
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2WQAAAAASUVORK5CYII=";
const request = (body = {}) => new Request("http://localhost/api/analyze-meal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ food_name: "鸡蛋",portion: "一份",image_urls: [png],...body }) });
function mocked(response) {
  const calls = [];
  const finishes = [];
  return { calls, finishes, dependencies: {
    authenticate: async () => ({ client: {}, userId: "local-test-user" }),
    loadSaved: async () => ({ ai_analysis: null,nutrition: null }),
    persist: async () => undefined,
    reserve: async () => "test-reservation",
    finish: async (...args) => { finishes.push(args.slice(1)); },
    fetch: async (url,init) => { calls.push({ url, body: JSON.parse(init.body) }); return response; },
  } };
}

test("nutrition targets work without AI and guard missing age, special conditions and underweight", () => {
  const data = buildDefaultData("local");
  assert.equal(calculateNutritionTargets(data.profile).targets, null);
  data.profile.age = 30;
  const targets = calculateNutritionTargets(data.profile).targets;
  assert.ok(targets.calories >= 1500 && targets.protein_g > 60);
  data.profile.needs_professional_guidance = true;
  assert.equal(calculateNutritionTargets(data.profile).targets, null);
  data.profile.needs_professional_guidance = false; data.profile.age = 16;
  assert.equal(calculateNutritionTargets(data.profile).targets, null);
  data.profile.age = 30; data.profile.current_weight_kg = 42;
  assert.match(calculateNutritionTargets(data.profile).explanation, /不自动设置热量缺口/);
});

test("daily macros sum all meals and do not invent nutrition for unknown meals", () => {
  const meal = { nutrition: { calories_min: 300, calories_max: 450, protein_g: 20, fat_g: 12, carbohydrate_g: 35 } };
  const result = dailyNutrition([meal, meal, { nutrition: null }]);
  assert.equal(result.calories_min, 600); assert.equal(result.calories_max, 900);
  assert.equal(result.protein_g, 40); assert.equal(result.unknown, 1);
});

test("exercise recommendations respect recent pain, fatigue, recovery and preferences", () => {
  const data = buildDefaultData("local");
  data.profile.exercise_preferences = ["游泳"];
  assert.equal(exerciseSuggestion(data,todayString()).activity, "游泳");
  data.exercises = [{ record_date: addDays(todayString(),-1), has_discomfort: true, discomfort_detail: "头晕", intensity: "高", exercise_type: "跑步" }];
  assert.equal(exerciseSuggestion(data,todayString()).activity, "恢复与休息");
  data.exercises = []; data.checkins = [{ record_date: todayString(), fatigue_level: 8, sleep_hours: 5 }];
  assert.equal(exerciseSuggestion(data,todayString()).activity, "轻松步行或休息");
});

test("missing DeepSeek key fails clearly without calling OpenAI", async () => {
  process.env.AI_PROVIDER = "deepseek"; delete process.env.DEEPSEEK_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-not-real";
  const mock = mocked(new Response());
  const response = await handleAiRequest(request(),"meal",mock.dependencies);
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/DEEPSEEK_API_KEY/);
  assert.equal(mock.calls.length,0);
});

test("authentication and atomic budget checks happen before paid calls", async () => {
  process.env.DEEPSEEK_API_KEY = "test-only-not-real";
  const auth = await authenticateAi(request()).catch((error) => error);
  assert.equal(auth.status,401);
  const mock = mocked(new Response());
  const response = await handleAiRequest(request(),"meal",{ ...mock.dependencies, reserve: async () => { throw new AiError("今日调用已达上限",429,"DAILY_LIMIT"); } });
  assert.equal(response.status,429); assert.equal(mock.calls.length,0);
});

test("DeepSeek Flash receives JSON and vision content, returns nutrient grams and logs tokens", async () => {
  process.env.DEEPSEEK_API_KEY = "test-only-not-real";
  const mock = mocked(Response.json({ choices: [{ message: { content: JSON.stringify(recognized) } }], usage: { prompt_tokens: 321, completion_tokens: 123 } }));
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2WQAAAAASUVORK5CYII=";
  const response = await handleAiRequest(request({ food_name: "鸡蛋", image_urls: [png] }),"meal",mock.dependencies);
  assert.equal(response.status,200); assert.equal((await response.json()).analysis.protein_g,20);
  assert.equal(mock.calls[0].body.model,"deepseek-flash");
  assert.equal(mock.calls[0].body.response_format.type,"json_object");
  assert.equal(mock.calls[0].body.messages[1].content[1].type,"image_url");
  assert.deepEqual(mock.finishes[0], ["test-reservation",true,321,123]);
});

test("uncertain recognition clears every numerical estimate instead of inventing precision", async () => {
  const mock = mocked(Response.json({ choices: [{ message: { content: JSON.stringify({ ...recognized, recognition_status: "needs_info" }) } }] }));
  const response = await handleAiRequest(request(),"meal",mock.dependencies);
  const answer = (await response.json()).analysis;
  assert.equal(response.status,200); assert.equal(answer.protein_g,null); assert.equal(answer.estimated_calories_min,null);
});

test("provider quota, rate, bad output and timeout errors never trigger fallback", async () => {
  for (const status of [401,402,429,500,503]) {
    const mock = mocked(new Response("provider detail must not leak",{ status }));
    const response = await handleAiRequest(request(),"meal",mock.dependencies);
    assert.ok(response.status >= 400);
    assert.equal(mock.calls.length,1); assert.match(mock.calls[0].url,/deepseek/);
    assert.equal((await response.text()).includes("provider detail"),false);
    assert.equal(mock.finishes[0][1],false);
  }
  const bad = mocked(Response.json({ choices: [{ message: { content: "not JSON" } }] }));
  assert.equal((await handleAiRequest(request(),"meal",bad.dependencies)).status,422);
  const timeout = mocked(new Response());
  assert.equal((await handleAiRequest(request(),"meal",{ ...timeout.dependencies, fetch: async () => { throw new DOMException("test timeout","TimeoutError"); } })).status,504);
});

test("OpenAI fallback requires explicit per-request consent and a server enable flag", async () => {
  process.env.AI_ALLOW_OPENAI_FALLBACK = "true";
  const denied = mocked(new Response());
  assert.equal((await handleAiRequest(request({ food_name: "鸡蛋", use_fallback: true }),"meal",denied.dependencies)).status,403);
  assert.equal(denied.calls.length,0);
  const approved = mocked(Response.json({ output_text: JSON.stringify(recognized), usage: { input_tokens: 10, output_tokens: 20 } }));
  assert.equal((await handleAiRequest(request({ food_name: "鸡蛋", use_fallback: true, fallback_confirmed: true }),"meal",approved.dependencies)).status,200);
  assert.match(approved.calls[0].url,/api.openai.com/);
  delete process.env.OPENAI_API_KEY; delete process.env.DEEPSEEK_API_KEY; delete process.env.AI_ALLOW_OPENAI_FALLBACK;
});

test("saved recognition is returned without another paid call, even without a key", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  const mock = mocked(new Response());
  const response = await handleAiRequest(request(),"meal",{ ...mock.dependencies,loadSaved: async () => ({ ai_analysis: recognized }) });
  assert.equal(response.status,200); assert.equal((await response.json()).cached,true); assert.equal(mock.calls.length,0);
});

test("recognition is persisted server-side before responding and summaries never call a model", async () => {
  process.env.DEEPSEEK_API_KEY = "test-only-not-real";
  const mock = mocked(Response.json({ choices: [{ message: { content: JSON.stringify(recognized) } }] }));
  let persisted = false;
  const response = await handleAiRequest(request(),"meal",{ ...mock.dependencies,persist: async () => { persisted = true; } });
  assert.equal(response.status,200); assert.equal(persisted,true);
  assert.equal((await handleAiRequest(request(),"summary",mock.dependencies)).status,410); assert.equal(mock.calls.length,1);
  const failed = mocked(Response.json({ choices: [{ message: { content: JSON.stringify(recognized) } }] }));
  assert.equal((await handleAiRequest(request(),"meal",{ ...failed.dependencies,persist: async () => { throw new AiError("保存失败",503,"RESULT_NOT_SAVED"); } })).status,503);
  assert.equal(failed.calls.length,1);
});

test("input image count, text length and explicitly requested reanalysis are bounded",async () => {
  process.env.DEEPSEEK_API_KEY = "test-only-not-real";
  const mock = mocked(new Response());
  assert.equal((await handleAiRequest(request({ image_urls: Array(5).fill(png) }),"meal",mock.dependencies)).status,400);
  assert.equal((await handleAiRequest(request({ notes: "x".repeat(2001) }),"meal",mock.dependencies)).status,400);
  assert.equal((await handleAiRequest(request({ image_urls: [] }),"meal",mock.dependencies)).status,400);
  assert.equal(mock.calls.length,0);
  const incomplete = mocked(Response.json({ choices: [{ message: { content: JSON.stringify({ ...recognized,estimated_portion_g: null }) } }] }));
  assert.equal((await handleAiRequest(request(),"meal",incomplete.dependencies)).status,422);
  const redo = mocked(Response.json({ choices: [{ message: { content: JSON.stringify(recognized) } }] }));
  assert.equal((await handleAiRequest(request({ reanalyze_confirmed: true }),"meal",{ ...redo.dependencies,loadSaved: async () => ({ ai_analysis: recognized }) })).status,200);
  assert.equal(redo.calls.length,1);
});

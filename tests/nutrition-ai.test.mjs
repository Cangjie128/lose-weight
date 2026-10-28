import assert from "node:assert/strict";
import test from "node:test";
import { AiError, authenticateAi, handleAiRequest } from "../lib/ai-service.ts";
import { addDays, buildDefaultData, todayString } from "../lib/fat-loss.ts";
import { calculateNutritionTargets, dailyNutrition, exerciseSuggestion } from "../lib/nutrition.ts";
import { invalidateChangedAnalysis,nutritionFromAnalysis,recalculateMealAnalysis } from "../lib/meal-analysis.ts";

const recognized = { foods: ["鸡蛋"], food_items: [{ name:"鸡蛋",portion_description:"1个（约50g可食部分）",estimated_portion_g:50,portion_status:"estimated",calories_min:70,calories_max:80,protein_g:6.5,fat_g:5,carbohydrate_g:0.5 }], estimated_calories_min: 70, estimated_calories_max: 80, estimated_portion_g: 50, protein_g: 6.5, fat_g: 5, carbohydrate_g: 0.5, recognition_status: "recognized", protein_level: "基本够", carbohydrate_level: "适中", fat_level: "适中", vegetable_level: "不足", strengths: [], improvements: [], next_meal_suggestion: "配蔬菜和主食", uncertainty_note: "根据照片和描述估算，存在误差" };
const mixedMeal = { ...recognized,foods:["鸡蛋","纯牛奶"],food_items:[recognized.food_items[0],{ name:"纯牛奶",portion_description:"250ml",estimated_portion_g:250,portion_status:"estimated",calories_min:145,calories_max:165,protein_g:7.5,fat_g:7.5,carbohydrate_g:12 }],estimated_calories_min:215,estimated_calories_max:245,estimated_portion_g:300,protein_g:14,fat_g:12.5,carbohydrate_g:12.5 };
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

test("multi-food items deterministically recalculate the whole meal and invalidate changed portions", () => {
  const recalculated = recalculateMealAnalysis(mixedMeal);
  assert.equal(recalculated.estimated_calories_min,215); assert.equal(recalculated.protein_g,14);
  assert.equal(nutritionFromAnalysis(recalculated).calories_max,245);
  const invalid = invalidateChangedAnalysis(recalculated);
  assert.equal(invalid.recognition_status,"needs_info"); assert.equal(invalid.protein_g,null); assert.equal(nutritionFromAnalysis(invalid),null);
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
  assert.equal(response.status,200); assert.equal((await response.json()).analysis.protein_g,6.5);
  assert.equal(mock.calls[0].body.model,"deepseek-flash");
  assert.equal(mock.calls[0].body.response_format.type,"json_object");
  assert.equal(mock.calls[0].body.messages[1].content[1].type,"image_url");
  assert.deepEqual(mock.finishes[0], ["test-reservation",true,321,123]);
});

test("explicit loopback AI mode accepts text-only multi-food analysis without Supabase", async () => {
  process.env.LOCAL_AI_TEST_MODE="true"; process.env.NEXT_PUBLIC_DATA_BACKEND="local"; process.env.AI_PROVIDER="deepseek"; process.env.DEEPSEEK_API_KEY="test-only-not-real";
  try {
    const mock=mocked(Response.json({ choices:[{ message:{ content:JSON.stringify(mixedMeal) } }],usage:{ prompt_tokens:30,completion_tokens:40 } }));
    const localRequest=new Request("http://127.0.0.1:3005/api/analyze-meal",{ method:"POST",headers:{ "Content-Type":"application/json",Host:"127.0.0.1:3005",Origin:"http://127.0.0.1:3005" },body:JSON.stringify({ food_name:"一个鸡蛋、250ml纯牛奶",portion:"鸡蛋1个；牛奶250ml",notes:"无糖纯牛奶",image_urls:[] }) });
    const response=await handleAiRequest(localRequest,"meal",{ ...mock.dependencies,authenticate:async()=>{ throw Error("Supabase must not be used"); },localReserve:()=>"local:1",localFinish:()=>undefined });
    const payload=await response.json(); assert.equal(response.status,200); assert.equal(payload.local_test_mode,true); assert.equal(payload.analysis.food_items.length,2);
    assert.equal(mock.calls[0].body.messages[1].content.length,1); assert.match(mock.calls[0].body.messages[1].content[0].text,/250ml纯牛奶/);
  } finally { delete process.env.LOCAL_AI_TEST_MODE; delete process.env.NEXT_PUBLIC_DATA_BACKEND; }
});

test("explicit local AI mode without a server key fails clearly and makes no provider call",async()=>{
  const previousKey=process.env.DEEPSEEK_API_KEY;
  process.env.LOCAL_AI_TEST_MODE="true"; process.env.NEXT_PUBLIC_DATA_BACKEND="local"; process.env.AI_PROVIDER="deepseek"; delete process.env.DEEPSEEK_API_KEY;
  try {
    const mock=mocked(new Response());
    const localRequest=new Request("http://127.0.0.1:3007/api/analyze-meal",{ method:"POST",headers:{ "Content-Type":"application/json",Host:"127.0.0.1:3007",Origin:"http://127.0.0.1:3007" },body:JSON.stringify({ food_name:"一个鸡蛋、250ml纯牛奶",image_urls:[] }) });
    const response=await handleAiRequest(localRequest,"meal",{ ...mock.dependencies,localReserve:()=>"local:1",localFinish:()=>undefined });
    assert.equal(response.status,503); assert.match((await response.json()).error,/DEEPSEEK_API_KEY|尚未配置/); assert.equal(mock.calls.length,0);
  } finally {
    delete process.env.LOCAL_AI_TEST_MODE; delete process.env.NEXT_PUBLIC_DATA_BACKEND;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY=previousKey;
  }
});

test("local AI mode rejects non-loopback origins before any paid request",async()=>{
  process.env.LOCAL_AI_TEST_MODE="true"; process.env.NEXT_PUBLIC_DATA_BACKEND="local";
  try {
    const mock=mocked(new Response());
    const remote=new Request("http://127.0.0.1:3005/api/analyze-meal",{ method:"POST",headers:{ "Content-Type":"application/json",Host:"127.0.0.1:3005",Origin:"https://example.com" },body:JSON.stringify({ food_name:"鸡蛋",image_urls:[] }) });
    const response=await handleAiRequest(remote,"meal",mock.dependencies); assert.equal(response.status,403); assert.equal(mock.calls.length,0);
  } finally { delete process.env.LOCAL_AI_TEST_MODE; delete process.env.NEXT_PUBLIC_DATA_BACKEND; }
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
  assert.equal((await handleAiRequest(request({ food_name:"",portion:"",notes:"",image_urls: [] }),"meal",mock.dependencies)).status,400);
  assert.equal(mock.calls.length,0);
  const incomplete = mocked(Response.json({ choices: [{ message: { content: JSON.stringify({ ...recognized,food_items:[{ ...recognized.food_items[0],portion_status:"needs_confirmation",protein_g:null }] }) } }] }));
  const incompleteResponse=await handleAiRequest(request(),"meal",incomplete.dependencies); assert.equal(incompleteResponse.status,200); assert.equal((await incompleteResponse.json()).analysis.recognition_status,"needs_info");
  const redo = mocked(Response.json({ choices: [{ message: { content: JSON.stringify(recognized) } }] }));
  assert.equal((await handleAiRequest(request({ reanalyze_confirmed: true }),"meal",{ ...redo.dependencies,loadSaved: async () => ({ ai_analysis: recognized }) })).status,200);
  assert.equal(redo.calls.length,1);
});

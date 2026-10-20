import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import path from "node:path";
import { imageSize } from "image-size";
import { addDays,buildDefaultData,todayString,uid } from "../lib/fat-loss.ts";
import { createDataBackup } from "../lib/schemas.ts";
import { inspectBackup } from "../lib/zip-backup.ts";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || "C:/Users/mutian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"); }
const url = process.env.PREVIEW_URL || "http://127.0.0.1:3004/";
if (!["localhost","127.0.0.1"].includes(new URL(url).hostname)) throw Error("Browser acceptance runs only against a local isolated preview.");
const output = path.resolve("outputs/v2-acceptance"); await mkdir(output,{ recursive: true });
const results = []; const failures = []; const external = []; const metrics = {};
const data = buildDefaultData("demo-local-user"); data.profile.age = 30; data.profile.health_notes = "PRIVATE_HEALTH_NOTE";
data.weights = Array.from({ length: 30 },(_,index) => ({ id: uid(),user_id: data.profile.user_id,record_date: addDays(todayString(),index-29),weight_kg: Number((56-index*0.03).toFixed(2)),note: "PRIVATE_WEIGHT_NOTE",high_salt: false,late_dinner: false,menstrual_period: false,bowel_movement: true,poor_sleep: false,hard_training_previous_day: false }));
const browser = await playwright.chromium.launch({ headless: true,...(process.env.CHROME_PATH || process.platform === "win32" ? { executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe" } : {}) });
const context = await browser.newContext({ viewport: { width: 1365,height: 950 },locale: "zh-CN",timezoneId: "Asia/Shanghai",acceptDownloads: true });
await context.route("**/*",async (route) => {
  const target = new URL(route.request().url());
  if (["http:","https:"].includes(target.protocol) && target.origin !== new URL(url).origin) { external.push(target.origin); await route.abort(); }
  else await route.continue();
});
await context.addInitScript(({ data }) => { if (!localStorage.getItem("__v2_test_seed")) { localStorage.setItem("gentle-fat-loss-coach-demo-data",JSON.stringify(data)); localStorage.setItem("__v2_test_seed","1"); } },{ data });
const page = await context.newPage(); page.on("pageerror",(error) => failures.push(error.message)); page.on("dialog",(dialog) => dialog.accept());
page.setDefaultTimeout(20000);
const nav = async (name) => page.getByRole("button",{ name,exact: true }).filter({ visible: true }).first().click();
async function saved() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve,reject) => { const request = indexedDB.open("gentle-fat-loss-coach-v2",1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const record = await new Promise((resolve,reject) => { const request = db.transaction("records").objectStore("records").get("current"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    db.close(); return record.data;
  });
}
async function until(check,timeout = 30000) {
  const start = Date.now();
  while (!await check()) { if (Date.now()-start > timeout) throw Error("Acceptance condition timed out"); await page.waitForTimeout(150); }
}
async function download(button,filename) {
  const event = page.waitForEvent("download"); await page.getByRole("button",{ name: button,exact: true }).first().click();
  const file = await event; await file.saveAs(path.join(output,filename)); return await readFile(path.join(output,filename));
}
async function layout(label) {
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth,viewport: innerWidth }));
  assert.ok(width.scroll <= width.viewport+1,`${label} horizontal overflow: ${JSON.stringify(width)}`);
  const overflow = await page.locator("button:visible").evaluateAll((buttons) => buttons.filter((button) => button.scrollWidth > button.clientWidth+2).map((button) => button.textContent.trim()));
  assert.deepEqual(overflow,[],`${label} button text overflow`);
}
try {
  const start = Date.now(); await page.goto(url); await page.getByText("本地演示模式",{ exact: true }).waitFor(); metrics.initial_load_ms = Date.now()-start;
  assert.equal((await saved()).weights.length,30);
  await page.locator(".plan-records > summary").click();
  await page.getByLabel("体重 kg",{ exact: true }).fill("54.8"); await page.getByRole("button",{ name: "保存体重",exact: true }).click();
  await until(async () => (await saved()).weights.find((record) => record.record_date === todayString()).weight_kg === 54.8);
  await page.reload(); await page.locator(".plan-records > summary").click(); assert.equal(await page.getByLabel("体重 kg",{ exact: true }).inputValue(),"54.8");
  results.push("30 calendar days load; weight save and refresh persistence pass.");
  await page.screenshot({ path: path.join(output,"today-desktop.png"),fullPage: true }); await layout("desktop today");

  await nav("饮食");
  console.log("Acceptance: meal creation and manual nutrition");
  const breakfast = page.locator("section").filter({ has: page.getByRole("heading",{ name: "早餐",exact: true }) }).last();
  await breakfast.getByLabel("食物名称",{ exact: true }).fill("测试鸡蛋燕麦"); await breakfast.getByLabel("分量",{ exact: true }).fill("200g");
  await breakfast.getByRole("button",{ name: "新增早餐",exact: true }).click(); await until(async () => (await saved()).meals.length === 1);
  const meal = breakfast.locator("article").first();
  await meal.locator("summary").filter({ hasText: "营养数值" }).click();
  for (const [label,value] of [["食物重量 g（可选）","200"],["热量下限 kcal","400"],["热量上限 kcal","500"],["蛋白质 g","25"],["脂肪 g","15"],["碳水 g","60"]]) await meal.getByLabel(label,{ exact: true }).fill(value);
  await meal.getByRole("button",{ name: "保存营养数值",exact: true }).click(); await until(async () => (await saved()).meals[0].nutrition?.protein_g === 25);
  console.log("Acceptance: compressing and storing 100 photos");
  const photos = await page.evaluate(() => Array.from({ length: 100 },(_,index) => {
    const canvas = document.createElement("canvas"); canvas.width = index === 0 ? 2400 : 320; canvas.height = index === 0 ? 1600 : 240;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#ebf2f7"; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.scale(canvas.width/320,canvas.height/240); ctx.fillStyle = "white"; ctx.beginPath(); ctx.ellipse(160,115,110,90,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = "#65ac71"; ctx.fillRect(85,75,70,70); ctx.fillStyle = "#ffc95d"; ctx.beginPath(); ctx.ellipse(195,112,40,48,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = "#20252b"; ctx.font = "18px sans-serif"; ctx.fillText(`TEST MEAL ${index}`,88,218);
    return canvas.toDataURL("image/jpeg",0.95).split(",")[1];
  }));
  const uploadStart = Date.now();
  for (let index=0;index<100;index+=6) {
    const files = photos.slice(index,index+6).map((base64,offset) => ({ name: `meal-${index+offset}.jpg`,mimeType: "image/jpeg",buffer: Buffer.from(base64,"base64") }));
    await meal.locator('input[type="file"]').setInputFiles(files);
    await until(async () => (await saved()).meals[0].images.length === Math.min(100,index+6),60000);
    console.log(`Acceptance: ${Math.min(100,index+6)}/100 photos`);
  }
  metrics.upload_100_ms = Date.now()-uploadStart;
  assert.equal(await meal.locator('img[alt="餐食照片"]').count(),100);
  assert.ok((await saved()).meals[0].images.every((image) => image.size_bytes <= 300*1024 && image.storage_path.startsWith("idb:")));
  assert.equal(await page.evaluate(() => localStorage.getItem("gentle-fat-loss-coach-demo-data").includes("base64")),false);
  await nav("今日"); await page.locator(".plan-nutrition > summary").click(); await page.getByText("已摄入估计 400–500 kcal",{ exact: true }).waitFor();
  assert.equal(await page.getByRole("progressbar",{ name: "蛋白质摄入进度" }).getAttribute("value"),"25");
  results.push("100 actual JPEG uploads, <=1200px compression, IndexedDB storage and deterministic macro progress pass.");

  await nav("运动"); await page.getByLabel("时长 分钟",{ exact: true }).fill("25");
  await page.getByRole("button",{ name: "新增运动",exact: true }).click(); await until(async () => (await saved()).exercises.length === 1);
  await nav("趋势"); await page.waitForTimeout(1800);
  assert.ok((await page.locator(".recharts-line-curve").evaluateAll((curves) => curves.map((curve) => curve.getTotalLength()))).every((length) => length > 100));
  await page.screenshot({ path: path.join(output,"trends-desktop.png"),fullPage: true }); await layout("desktop trends");
  results.push("Exercise recording and rendered nonblank trend curves pass.");

  await nav("设置");
  assert.equal(await page.getByRole("switch",{ name: "开启摘要同步" }).isChecked(),false);
  assert.equal(await page.getByRole("button",{ name: "授权 Google",exact: true }).isEnabled(),false);
  const summary = await download("导出 ChatGPT 摘要","summary.json"); assert.equal(summary.toString().includes("PRIVATE"),false);
  const firstBytes = await download("导出完整 ZIP 备份","first.zip");
  const first = await inspectBackup(new Blob([firstBytes]),"first.zip"); assert.equal(first.photos.size,100);
  metrics.zip_bytes = firstBytes.length;
  for (const blob of first.photos.values()) { const size = imageSize(new Uint8Array(await blob.arrayBuffer())); assert.ok(Math.max(size.width,size.height) <= 1200); }
  await page.getByRole("button",{ name: "查看备份内容",exact: true }).click({ noWaitAfter: true });
  await page.getByLabel("选择 ZIP 或旧 JSON 备份").setInputFiles({ name: "first.zip",mimeType: "application/zip",buffer: firstBytes });
  await page.getByRole("dialog").waitFor(); await page.getByText("文件清单、SHA-256、关联校验通过",{ exact: true }).waitFor();
  await page.getByRole("button",{ name: "关闭",exact: true }).click(); assert.equal((await saved()).meals[0].images.length,100);
  await page.getByRole("button",{ name: "导入 ZIP 备份",exact: true }).click({ noWaitAfter: true });
  await page.getByLabel("选择 ZIP 或旧 JSON 备份").setInputFiles({ name: "first.zip",mimeType: "application/zip",buffer: firstBytes });
  await page.getByRole("dialog").waitFor();
  const beforeDownload = page.waitForEvent("download"); await page.getByRole("button",{ name: "合并恢复",exact: true }).click();
  await (await beforeDownload).saveAs(path.join(output,"pre-restore.zip"));
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const secondBytes = await download("导出完整 ZIP 备份","second.zip");
  const second = await inspectBackup(new Blob([secondBytes]),"second.zip");
  assert.deepEqual(second.data,first.data); assert.deepEqual(second.manifest.files,first.manifest.files);
  await page.reload(); await nav("饮食"); await until(async () => (await saved()).meals[0].images.length === 100);
  await until(async () => (await page.locator('img[alt="餐食照片"]').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))));
  results.push("ZIP preview is read-only; restore creates a prior ZIP; 100 photo hashes and records match re-export after reload.");
  const aiResponse = page.waitForResponse((response) => response.url().endsWith("/api/analyze-meal"));
  await page.getByRole("button",{ name: "AI分析",exact: true }).first().click(); assert.equal((await aiResponse).status(),401);
  await page.getByText("请先登录账号，再使用 AI 分析。手动记录不受影响。",{ exact: true }).waitFor();
  results.push("No provider keys: manual nutrition works; paid AI requires login; no paid fallback or summary calls.");

  await page.setViewportSize({ width: 390,height: 844 });
  for (const name of ["今日","饮食","运动","趋势","AI教练","设置"]) { await nav(name); await page.waitForTimeout(name === "趋势" ? 1800 : 100); await layout(`mobile ${name}`); await page.screenshot({ path: path.join(output,`mobile-${name}.png`) }); }
  await page.setViewportSize({ width: 320,height: 740 }); await nav("设置"); await layout("small mobile settings");
  await page.screenshot({ path: path.join(output,"small-mobile-settings.png") });
  results.push("390px and 320px mobile layouts: no page overflow or clipped button labels.");

  await page.getByRole("button",{ name: "导入 ZIP 备份",exact: true }).click({ noWaitAfter: true });
  await page.getByLabel("选择 ZIP 或旧 JSON 备份").setInputFiles({ name: "broken.zip",mimeType: "application/zip",buffer: Buffer.from("broken") });
  await page.getByText("ZIP 文件损坏或下载未完成，请重新选择完整备份。",{ exact: true }).waitFor();
  assert.equal((await saved()).meals[0].images.length,100);
  const json = Buffer.from(JSON.stringify(createDataBackup(data)));
  await page.getByLabel("选择 ZIP 或旧 JSON 备份").setInputFiles({ name: "legacy.json",mimeType: "application/json",buffer: json });
  await page.getByRole("dialog").waitFor(); await page.getByText("V1 JSON 兼容备份",{ exact: true }).waitFor(); await page.getByRole("button",{ name: "取消",exact: true }).click();
  results.push("Damaged ZIP preserves existing records; legacy JSON preview and cancel pass.");
  assert.deepEqual(failures,[]); assert.deepEqual(external,[]);
  await writeFile(path.join(output,"results.json"),JSON.stringify({ results,metrics,page_errors: failures,external_requests: external },null,2));
  console.log(JSON.stringify({ results,metrics,page_errors: failures,external_requests: external },null,2));
} catch(error) {
  await page.screenshot({ path: path.join(output,"failure.png"),fullPage: true,timeout: 10000 }).catch(() => undefined);
  await writeFile(path.join(output,"failure.json"),JSON.stringify({ message: error.message,results,metrics,page_errors: failures },null,2));
  throw error;
} finally { await context.close(); await browser.close(); }

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectBackup } from "../lib/zip-backup.ts";
import { todayString,addDays } from "../lib/fat-loss.ts";
const require=createRequire(import.meta.url);
let pw; try { pw=require("playwright"); } catch { pw=require(process.env.PLAYWRIGHT_MODULE_PATH || "C:/Users/mutian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"); }
const url=process.env.PREVIEW_URL || "http://127.0.0.1:3005/";
if(!["127.0.0.1","localhost"].includes(new URL(url).hostname)) throw Error("Local isolated preview only");
const output=path.resolve("outputs/coach-acceptance"); await mkdir(output,{ recursive:true });
const browser=await pw.chromium.launch({headless:true,...(process.platform==="win32" ? { executablePath:process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe" }:{})});
const context=await browser.newContext({viewport:{width:390,height:844},locale:"zh-CN",timezoneId:"Asia/Shanghai",acceptDownloads:true});
const errors=[],external=[],paid=[],results=[];
await context.route("**/*",async route=>{
  const target=new URL(route.request().url());
  if(["http:","https:"].includes(target.protocol) && target.origin!==new URL(url).origin) { external.push(target.origin); return route.abort(); }
  if(target.pathname.includes("/api/analyze-meal") || target.pathname.includes("/api/daily-summary")) paid.push(target.pathname);
  return route.continue();
});
const page=await context.newPage(); page.setDefaultTimeout(20000); page.on("pageerror",error=>errors.push(error.message));page.on("dialog",dialog=>dialog.accept());
const nav=async name=>{await page.getByRole("button",{name,exact:true}).filter({visible:true}).first().click();await page.evaluate(()=>scrollTo(0,0));};
const saved=()=>page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("gentle-fat-loss-coach-v2",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const data=await new Promise((resolve,reject)=>{const r=db.transaction("records").objectStore("records").get("current");r.onsuccess=()=>resolve(r.result.data);r.onerror=()=>reject(r.error);});db.close();return data;
});
async function until(check) { const start=Date.now();while(!await check()){if(Date.now()-start>20000)throw Error("Acceptance state timed out");await page.waitForTimeout(100);} }
async function layout(label) {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${label}: page overflow`);
  const clipped=await page.locator("button:visible").evaluateAll(items=>items.filter(item=>item.scrollWidth>item.clientWidth+2).map(item=>item.textContent)); assert.deepEqual(clipped,[],`${label}: clipped buttons`);
}
async function exportZip(filename) { const event=page.waitForEvent("download");await page.getByRole("button",{name:"导出完整 ZIP 备份",exact:true}).click();const file=await event;await file.saveAs(path.join(output,filename));return readFile(path.join(output,filename)); }
try {
  await page.goto(url); await page.getByRole("heading",{name:"今日减肥计划",exact:true}).waitFor();await until(async()=>Boolean((await saved()).plans?.length));
  const first=await saved();assert.equal(first.weights.length,0);assert.equal(first.plans[0].days.length,7);assert.equal(first.plans[0].days.flatMap(day=>day.tasks).length,49);
  assert.equal(await page.getByLabel("体重 kg",{exact:true}).isVisible(),true);assert.equal(await page.getByLabel("体重 kg",{exact:true}).inputValue(),"");
  await page.getByLabel("体重 kg",{exact:true}).fill("55.8");await page.getByRole("button",{name:"保存体重",exact:true}).click();await until(async()=>((await saved()).weights.length===1 && (await saved()).weights[0].weight_kg===55.8));
  await nav("趋势");await page.getByRole("button",{name:"记录体重",exact:true}).click();assert.equal(await page.getByLabel("体重 kg",{exact:true}).inputValue(),"55.8");await page.getByLabel("体重 kg",{exact:true}).fill("55.7");await page.getByRole("button",{name:"保存体重",exact:true}).click();await until(async()=>((await saved()).weights.length===1 && (await saved()).weights[0].weight_kg===55.7));await nav("今日");
  await layout("mobile first screen");await page.screenshot({path:path.join(output,"home-mobile.png")});
  results.push("New user receives 49 concrete actions; prominent home and trend weight entry starts blank and same-day saves update instead of duplicating.");
  const breakfast=page.locator(`.plan-task[data-task-id="${todayString()}:breakfast"]`);
  await breakfast.locator(".task-guide summary").click();assert.ok(await breakfast.locator("ol li").count()>=3);assert.equal(await breakfast.getByRole("link").count()>0,true);
  await breakfast.getByRole("button",{name:"完成",exact:true}).click();await page.getByRole("dialog").waitFor();
  await page.getByRole("dialog").getByRole("checkbox").check();await page.getByRole("button",{name:"确认完成",exact:true}).click();
  await until(async()=>(await saved()).meals.length===1);const meal=(await saved()).meals[0];assert.ok(meal.nutrition.calories_min>0);assert.equal(meal.plan_task_id,`${todayString()}:breakfast`);
  assert.ok(await page.getByRole("progressbar",{name:"今日行动进度"}).getAttribute("value")>0);
  const water=page.locator(`.plan-task[data-task-id="${todayString()}:water"]`);await water.getByRole("button",{name:"跳过",exact:true}).click();
  await until(async()=>(await saved()).task_updates.some(item=>item.id.endsWith(":water") && item.status==="skipped"));
  const sleep=page.locator(`.plan-task[data-task-id="${todayString()}:sleep"]`);await sleep.getByRole("button",{name:"稍后",exact:true}).click();
  await page.getByLabel("执行日期",{exact:true}).fill(addDays(todayString(),1));await page.getByLabel("执行时间",{exact:true}).fill("21:45");await page.getByRole("button",{name:"保存调整",exact:true}).click();
  await until(async()=>(await saved()).task_updates.some(item=>item.id.endsWith(":sleep") && item.scheduled_time==="21:45"));
  assert.equal(await page.locator(`.plan-task[data-task-id="${todayString()}:sleep"]`).count(),0);
  const dinner=page.locator(`.plan-task[data-task-id="${todayString()}:dinner"]`);const amount=await dinner.locator(".task-amount").innerText();
  await dinner.getByRole("button",{name:/替换/}).click();await until(async()=>(await saved()).task_updates.some(item=>item.id.endsWith(":dinner") && item.meal_choice===1));assert.notEqual(await dinner.locator(".task-amount").innerText(),amount);
  await page.reload();await page.getByRole("heading",{name:"今日减肥计划",exact:true}).waitFor();assert.equal((await saved()).meals.length,1);
  results.push("Meal completion explicitly confirms approximate intake; skip, cross-day reschedule and replacement survive refresh.");

  const photo = await page.evaluate(() => {
    const canvas=document.createElement("canvas");canvas.width=640;canvas.height=480;
    const context=canvas.getContext("2d");context.fillStyle="#82b66d";context.fillRect(0,0,640,480);
    context.fillStyle="#f5d88b";context.fillRect(160,100,320,280);
    return canvas.toDataURL("image/jpeg",0.8).split(",")[1];
  });
  const lunch=page.locator(`.plan-task[data-task-id="${todayString()}:lunch"]`);
  await lunch.locator('input[type="file"]').setInputFiles({name:"test-lunch.jpg",mimeType:"image/jpeg",buffer:Buffer.from(photo,"base64")});
  await until(async()=>(await saved()).meals.some(item=>item.plan_task_id===`${todayString()}:lunch` && item.images.length===1));
  await nav("今日");await page.getByRole("heading",{name:"今日减肥计划",exact:true}).waitFor();
  const photographed=(await saved()).meals.find(item=>item.plan_task_id===`${todayString()}:lunch`);
  assert.equal(photographed.nutrition,null);assert.equal(photographed.ai_analysis,null);
  await page.reload();await page.getByRole("heading",{name:"今日减肥计划",exact:true}).waitFor();
  assert.equal((await saved()).meals.find(item=>item.id===photographed.id).images.length,1);
  results.push("Home camera stores a real JPEG linked to the plan; refresh preserves it without invented nutrition or automatic AI calls.");

  const week=(await saved()).plans[0];const movementDay=week.days.find(day=>day.tasks.some(task=>task.kind==="exercise"));const movementIndex=week.days.findIndex(day=>day.date===movementDay.date);
  await page.locator(".plan-days button").nth(movementIndex).click();
  const movement=page.locator(`.plan-task[data-task-id="${movementDay.date}:movement"]`);
  await movement.getByRole("button",{name:"完成",exact:true}).click();await page.getByLabel("实际运动分钟",{exact:true}).fill("12");await page.getByRole("button",{name:"确认完成",exact:true}).click();
  await until(async()=>(await saved()).exercises.length===1);assert.equal((await saved()).exercises[0].duration_min,12);
  results.push("Confirmed actual training duration is recorded and task progress is synchronized.");
  await page.getByRole("button",{name:"回到今天",exact:true}).click().catch(()=>undefined);
  await page.getByRole("tab",{name:"本周总览",exact:true}).click();assert.equal(await page.locator(".week-day").count(),7);await layout("mobile weekly plan");
  await page.screenshot({path:path.join(output,"week-mobile.png"),fullPage:true});
  await page.getByRole("tab",{name:"每周复盘",exact:true}).click();await page.getByRole("button",{name:"用复盘安排下一周",exact:true}).click();
  await until(async()=>(await saved()).plans.length===2);assert.equal((await saved()).plans[0].week_start,first.plans[0].week_start);results.push("Weekly review creates a second week without overwriting the original plan or records.");

  await nav("设置");await page.getByLabel("每天可安排运动分钟",{exact:true}).fill("");assert.equal(await page.getByRole("heading",{name:"个人设置",exact:true}).count(),1);await page.getByLabel("每天可安排运动分钟",{exact:true}).fill("15");
  await page.getByLabel("年龄（岁）",{exact:true}).fill("30");await page.getByLabel("饮食类型",{exact:true}).selectOption("vegan");await page.getByRole("button",{name:"保存设置",exact:true}).click();await until(async()=>(await saved()).profile.planning.diet==="vegan");
  const before=await saved(); const zipBytes=await exportZip("coach.zip");const inspected=await inspectBackup(new Blob([zipBytes]),"coach.zip");assert.equal(inspected.data.plans.length,2);assert.equal(inspected.data.task_updates.length,before.task_updates.length);assert.equal(inspected.photos.size,1);
  await page.getByRole("button",{name:"导入 ZIP 备份",exact:true}).click();await page.getByLabel("选择 ZIP 或旧 JSON 备份").setInputFiles({name:"coach.zip",mimeType:"application/zip",buffer:zipBytes});await page.getByRole("dialog").waitFor();
  const pre=page.waitForEvent("download");await page.getByRole("button",{name:"合并恢复",exact:true}).click();await(await pre).saveAs(path.join(output,"before-restore.zip"));
  await page.getByRole("dialog").waitFor({state:"hidden"});
  const after=await inspectBackup(new Blob([await exportZip("coach-again.zip")]),"coach-again.zip");assert.deepEqual(after.data,inspected.data);
  assert.equal(after.photos.size,1);assert.equal(after.data.meals.find(item=>item.id===photographed.id).plan_task_id,`${todayString()}:lunch`);
  assert.deepEqual(Buffer.from(await after.photos.values().next().value.arrayBuffer()),Buffer.from(await inspected.photos.values().next().value.arrayBuffer()));
  results.push("Plans, preferences, records, task-linked photo bytes and execution updates survive full ZIP restore/re-export.");

  await nav("今日");await page.getByRole("tab",{name:"今日行动",exact:true}).click();
  await page.setViewportSize({width:1365,height:950});await page.evaluate(()=>scrollTo(0,0));await layout("desktop home");await page.screenshot({path:path.join(output,"home-desktop.png")});
  await page.getByRole("tab",{name:"本周总览",exact:true}).click();await layout("desktop week");await page.screenshot({path:path.join(output,"week-desktop.png"),fullPage:true});
  await page.setViewportSize({width:320,height:740});await page.getByRole("tab",{name:"今日行动",exact:true}).click();await layout("320px home");await page.screenshot({path:path.join(output,"home-320.png")});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(paid,[]);
  await writeFile(path.join(output,"results.json"),JSON.stringify({results,page_errors:errors,external_requests:external,paid_requests:paid,browser:browser.version()},null,2));console.log(JSON.stringify({results,page_errors:errors,external_requests:external,paid_requests:paid},null,2));
} catch(error) { await page.screenshot({path:path.join(output,"failure.png"),fullPage:true});await writeFile(path.join(output,"failure.json"),JSON.stringify({error:error.message,page_errors:errors,results},null,2));throw error; }
finally {await context.close();await browser.close();}

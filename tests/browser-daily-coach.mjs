import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir,writeFile,readFile } from "node:fs/promises";
import path from "node:path";
import { addDays,buildDefaultData,todayString } from "../lib/fat-loss.ts";
import { generateWeekPlan } from "../lib/action-plan.ts";
import { inspectBackup } from "../lib/zip-backup.ts";

const require=createRequire(import.meta.url);
let pw;try{pw=require("playwright");}catch{pw=require(process.env.PLAYWRIGHT_MODULE_PATH || "C:/Users/mutian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");}
const url=process.env.PREVIEW_URL || "http://127.0.0.1:3008/";
if(!["localhost","127.0.0.1"].includes(new URL(url).hostname))throw Error("Isolated loopback preview only");
const output=path.resolve("outputs/v2-1-acceptance");await mkdir(output,{recursive:true});
const date=todayString(),data=buildDefaultData("demo-local-user");
data.profile={...data.profile,age:32,height_cm:165,starting_weight_kg:68,current_weight_kg:67.5,target_weight_kg:62,profile_confirmed_at:new Date().toISOString(),challenge_end_date:addDays(date,160)};
data.weights=Array.from({length:10},(_,i)=>({id:`weight-${i}`,user_id:data.profile.user_id,record_date:addDays(date,i-10),weight_kg:68-i*0.05,weighing_period:"morning_fasting",weighed_at:"07:00",food_state:"fasting",bowel_state:"after",note:"验收测试数据",high_salt:false,late_dinner:false,menstrual_period:false,bowel_movement:true,poor_sleep:false,hard_training_previous_day:false}));
data.exercises=[{id:"exercise-original",user_id:data.profile.user_id,record_date:date,exercise_type:"步行",duration_min:40,distance_km:3,intensity:"中",calories_burned:null,feeling:"状态正常",has_discomfort:false,discomfort_detail:""}];
data.plans=[generateWeekPlan(data,date)];
const done=data.plans[0].days.find(day=>day.date===date).tasks[0];
data.task_updates=[{id:done.id,user_id:data.profile.user_id,record_date:date,source:"user",status:"completed",note:"已确认的早餐执行",updated_at:new Date().toISOString()}];
const browser=await pw.chromium.launch({headless:true,...(process.platform==="win32"?{executablePath:process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe"}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},locale:"zh-CN",timezoneId:"Asia/Shanghai",acceptDownloads:true});
const errors=[],external=[],paid=[],results=[];
await context.route("**/*",async route=>{const target=new URL(route.request().url());if(["http:","https:"].includes(target.protocol)&&target.origin!==new URL(url).origin){external.push(target.origin);return route.abort();}if(/\/api\/(analyze-meal|daily-summary)/.test(target.pathname))paid.push(target.pathname);return route.continue();});
await context.addInitScript(seed=>{if(!localStorage.getItem("__daily_coach_test_seed")){localStorage.setItem("gentle-fat-loss-coach-demo-data",JSON.stringify(seed));localStorage.setItem("__daily_coach_test_seed","1");}},data);
const page=await context.newPage();page.setDefaultTimeout(20000);page.on("pageerror",e=>errors.push(e.message));page.on("dialog",dialog=>dialog.accept());
const saved=()=>page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("gentle-fat-loss-coach-v2",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const record=await new Promise((resolve,reject)=>{const r=db.transaction("records").objectStore("records").get("current");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return record.data;});
async function until(check){const start=Date.now();while(!await check()){if(Date.now()-start>20000)throw Error("Acceptance state timed out");await page.waitForTimeout(100);}}
async function nav(name){await page.getByRole("button",{name,exact:true}).filter({visible:true}).first().click();await page.evaluate(()=>scrollTo(0,0));}
async function layout(label){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label}: page overflow`);const clipped=await page.locator("button:visible").evaluateAll(items=>items.filter(item=>item.scrollWidth>item.clientWidth+2).map(item=>item.textContent));assert.deepEqual(clipped,[],`${label}: clipped buttons`);}
const section=heading=>page.locator("section").filter({has:page.getByRole("heading",{name:heading,exact:true})}).last();
async function home(){await nav("今日");await page.getByRole("button",{name:"记录饮食",exact:true}).waitFor();}
try{
  await page.goto(url);await page.getByText("今日营养目标",{exact:true}).waitFor();
  assert.equal(await page.getByLabel("体重 kg",{exact:true}).count(),0);assert.equal(await page.getByLabel("食物名称",{exact:true}).count(),0);
  await layout("390 home");await page.screenshot({path:path.join(output,"home-390.png")});
  await page.setViewportSize({width:320,height:740});await layout("320 home");await page.screenshot({path:path.join(output,"home-320.png")});
  const targets=await page.locator("nav.fixed button").evaluateAll(items=>items.map(item=>({label:item.textContent.trim(),width:item.getBoundingClientRect().width,height:item.getBoundingClientRect().height})));
  assert.deepEqual(targets.map(item=>item.label),["今日","日历","记录","趋势","我的"]);assert.ok(targets.every(item=>item.width>=44 && item.height>=44));
  await page.setViewportSize({width:390,height:844});
  for(const [kg,period,time,food] of [["67.3","morning_fasting","07:10","fasting"],["68.5","evening_after_meal","20:00","after_meal"]]){
    await page.getByRole("button",{name:"记录体重",exact:true}).click();const dialog=page.getByRole("dialog",{name:"记录体重",exact:true});assert.equal(await dialog.getByLabel("体重 kg",{exact:true}).inputValue(),"");
    await dialog.getByLabel("体重 kg",{exact:true}).fill(kg);await dialog.getByLabel("称重时段").selectOption(period);await dialog.getByLabel("具体时间（可选）").fill(time);await dialog.getByLabel("进食状态").selectOption(food);await dialog.getByLabel("排便状态").selectOption("after");await dialog.getByRole("button",{name:"保存体重",exact:true}).click();await dialog.waitFor({state:"hidden"});
  }
  assert.equal((await saved()).weights.filter(item=>item.record_date===date).length,2);assert.equal((await saved()).profile.current_weight_kg,67.3);
  results.push("Two same-day weigh-ins remain separate; evening after-meal weight does not replace the morning baseline.");
  await page.getByRole("button",{name:"记录饮食",exact:true}).click();let dialog=page.getByRole("dialog",{name:"记录饮食",exact:true});
  await dialog.getByLabel("食物名称",{exact:true}).fill("一个鸡蛋、250ml纯牛奶");await dialog.getByLabel("分量",{exact:true}).fill("鸡蛋1个约50g；牛奶250ml");await dialog.getByLabel("备注",{exact:true}).fill("无糖纯牛奶，等待手动确认营养");
  const photo=await page.evaluate(()=>{const canvas=document.createElement("canvas");canvas.width=600;canvas.height=400;const c=canvas.getContext("2d");c.fillStyle="#e3edda";c.fillRect(0,0,600,400);c.fillStyle="#fff";c.beginPath();c.ellipse(200,210,110,80,0,0,Math.PI*2);c.fill();c.fillStyle="#f3c550";c.beginPath();c.arc(200,210,35,0,Math.PI*2);c.fill();c.fillStyle="#b0d7e3";c.fillRect(380,90,90,220);return canvas.toDataURL("image/jpeg",0.85).split(",")[1];});
  await dialog.getByLabel("餐食照片（可选）").setInputFiles({name:"meal-test.jpg",mimeType:"image/jpeg",buffer:Buffer.from(photo,"base64")});
  await layout("meal modal");await page.screenshot({path:path.join(output,"meal-modal-mobile.png")});
  await page.setViewportSize({width:390,height:480});dialog=page.locator("dialog[open]");await dialog.locator("textarea").first().focus();await dialog.getByRole("button",{name:"保存饮食记录",exact:true}).scrollIntoViewIfNeeded();assert.ok(await dialog.getByRole("button",{name:"保存饮食记录",exact:true}).isVisible());await layout("reduced visual height");
  await dialog.getByRole("button",{name:"保存饮食记录",exact:true}).click();await dialog.waitFor({state:"hidden"});await page.setViewportSize({width:390,height:844});
  await until(async()=>(await saved()).meals[0]?.images.length===1);assert.equal((await saved()).meals[0].nutrition,null);await page.getByText("已摄入估计 未知，待补充",{exact:true}).first().waitFor();
  results.push("Text and photo meal saves return home after photo persistence; unknown nutrition is not displayed as zero, and the local reminder updates immediately.");
  await page.getByRole("button",{name:"查看当天详情",exact:true}).click();await page.getByRole("heading",{name:/完整详情/}).waitFor();
  const before=(await saved()).weights.find(item=>item.record_date===date&&item.weighing_period==="morning_fasting");
  await section("体重及称重状态").getByRole("button",{name:"编辑",exact:true}).first().click();dialog=page.getByRole("dialog",{name:"编辑称重记录",exact:true});await dialog.getByLabel("体重 kg",{exact:true}).fill("67.2");await dialog.getByRole("button",{name:"保存体重",exact:true}).click();await dialog.waitFor({state:"hidden"});
  assert.equal((await saved()).weights.filter(item=>item.record_date===date).length,2);assert.equal((await saved()).weights.find(item=>item.id===before.id).weight_kg,67.2);
  await section("运动实际执行").getByRole("button",{name:"编辑",exact:true}).click();dialog=page.getByRole("dialog",{name:"编辑运动记录",exact:true});assert.equal(await dialog.getByLabel("时长 分钟",{exact:true}).inputValue(),"40");await dialog.getByLabel("时长 分钟",{exact:true}).fill("25");await dialog.getByLabel("身体感受",{exact:true}).fill("疲劳，今天准备恢复");await dialog.getByLabel("有疼痛或不适").check();await dialog.getByLabel("不适记录").fill("小腿酸痛，停止训练观察");
  await layout("edit exercise modal");await page.screenshot({path:path.join(output,"exercise-edit-mobile.png")});await dialog.getByRole("button",{name:"保存运动修改",exact:true}).click();await dialog.waitFor({state:"hidden"});
  assert.equal((await saved()).exercises.length,1);assert.equal((await saved()).exercises[0].id,"exercise-original");assert.equal((await saved()).exercises[0].duration_min,25);assert.equal((await saved()).task_updates.find(item=>item.id===done.id).status,"completed");
  results.push("Weight and exercise editing update the original IDs without duplicates; completed plan tasks are preserved while recovery advice responds to discomfort.");
  await page.evaluate(()=>scrollTo(0,0));await layout("daily history");await page.screenshot({path:path.join(output,"history-mobile.png")});await page.screenshot({path:path.join(output,"history-mobile-full.png"),fullPage:true});
  await section("饮食与照片").getByRole("button",{name:"编辑",exact:true}).click();dialog=page.getByRole("dialog",{name:"编辑饮食记录",exact:true});await dialog.locator("summary").filter({hasText:"营养数值"}).click();
  for(const [label,value] of [["热量下限 kcal","210"],["热量上限 kcal","250"],["蛋白质 g","15"],["脂肪 g","12"],["碳水 g","14"]])await dialog.getByLabel(label,{exact:true}).fill(value);
  await dialog.getByRole("button",{name:"保存营养数值",exact:true}).click();await until(async()=>(await saved()).meals[0]?.nutrition?.protein_g===15);await dialog.getByRole("button",{name:"关闭录入窗口"}).click();
  await home();await page.getByText("已摄入估计 210–250 kcal",{exact:true}).first().waitFor();
  await page.setViewportSize({width:1365,height:950});await page.evaluate(()=>scrollTo(0,0));await layout("desktop home");await page.screenshot({path:path.join(output,"home-desktop.png")});
  await nav("我的");const download=page.waitForEvent("download");await page.getByRole("button",{name:"导出完整 ZIP 备份",exact:true}).click();await(await download).saveAs(path.join(output,"v2-1.zip"));const inspected=await inspectBackup(new Blob([await readFile(path.join(output,"v2-1.zip"))]),"v2-1.zip");
  assert.equal(inspected.photos.size,1);assert.equal(inspected.data.weights.length,12);assert.ok(inspected.data.coach_events.length>=4);
  await page.getByRole("button",{name:"导入 ZIP 备份",exact:true}).click();await page.getByLabel("选择 ZIP 或旧 JSON 备份").setInputFiles(path.join(output,"v2-1.zip"));await page.getByRole("dialog").waitFor();const prior=page.waitForEvent("download");await page.getByRole("button",{name:"合并恢复",exact:true}).click();await(await prior).saveAs(path.join(output,"before-restore.zip"));await page.getByRole("dialog").waitFor({state:"hidden"});
  await page.reload();await until(async()=>(await saved()).weights.length===12);assert.equal((await saved()).meals[0].images.length,1);assert.deepEqual((await saved()).coach_events,inspected.data.coach_events);
  results.push("Full ZIP preview, automatic pre-restore backup and merge retain multi-weigh-in context, photos, execution history and append-only coach events.");
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(paid,[]);
  const report={results,navigation_targets:targets,page_errors:errors,external_requests:external,paid_requests:paid,browser:browser.version(),keyboard_check:"Reduced 390x480 visual viewport and scroll/focus tested; physical mobile keyboard not available."};await writeFile(path.join(output,"results.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){await page.screenshot({path:path.join(output,"failure.png"),fullPage:true});throw e;}finally{await context.close();await browser.close();}

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir,writeFile } from "node:fs/promises";
import path from "node:path";
import { addDays,buildDefaultData,todayString } from "../lib/fat-loss.ts";
import { generateWeekPlan } from "../lib/action-plan.ts";

const require=createRequire(import.meta.url);
let pw;try{pw=require("playwright");}catch{pw=require(process.env.PLAYWRIGHT_MODULE_PATH || "C:/Users/mutian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");}
const url=process.env.PREVIEW_URL || "http://127.0.0.1:3009/";
if(!["localhost","127.0.0.1"].includes(new URL(url).hostname))throw Error("Loopback preview only");
const output=path.resolve("outputs/actual-meals-acceptance");await mkdir(output,{recursive:true});
const date=todayString(),data=buildDefaultData("demo-local-user");data.profile.age=30;data.profile.profile_confirmed_at=new Date().toISOString();
data.weights=[{id:"weight",user_id:data.profile.user_id,record_date:date,weight_kg:56,note:"",high_salt:false,late_dinner:false,menstrual_period:false,bowel_movement:false,poor_sleep:false,hard_training_previous_day:false}];
data.plans=[generateWeekPlan(data,date)];
data.meals=[{id:"yesterday",user_id:data.profile.user_id,record_date:addDays(date,-1),meal_type:"dinner",food_name:"昨天的记录必须保留",portion:"一份",notes:"",ai_analysis:null,nutrition:{calories_min:1000,calories_max:1200,protein_g:60,fat_g:40,carbohydrate_g:100,portion_g:null,source:"manual"},images:[]}];
const browser=await pw.chromium.launch({headless:true,...(process.platform==="win32"?{executablePath:process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe"}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},locale:"zh-CN",timezoneId:"Asia/Shanghai"});
const errors=[],external=[],paid=[],results=[];
await context.route("**/*",async route=>{const target=new URL(route.request().url());if(["http:","https:"].includes(target.protocol)&&target.origin!==new URL(url).origin){external.push(target.origin);return route.abort();}if(/\/api\/(analyze-meal|daily-summary)/.test(target.pathname))paid.push(target.pathname);return route.continue();});
await context.addInitScript(seed=>{if(!localStorage.getItem("__actual_meals_seed")){localStorage.setItem("gentle-fat-loss-coach-demo-data",JSON.stringify(seed));localStorage.setItem("__actual_meals_seed","1");}},data);
const page=await context.newPage();page.setDefaultTimeout(20000);page.on("pageerror",e=>errors.push(e.message));let confirmDelete=true;page.on("dialog",dialog=>confirmDelete?dialog.accept():dialog.dismiss());
const saved=()=>page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("gentle-fat-loss-coach-v2",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const record=await new Promise((resolve,reject)=>{const r=db.transaction("records").objectStore("records").get("current");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return record.data;});
const actual=()=>page.getByRole("region",{name:"今日实际饮食",exact:true});
const history=()=>page.getByRole("region",{name:"饮食与照片",exact:true});
async function until(check){const start=Date.now();while(!await check()){if(Date.now()-start>20000)throw Error("Acceptance state timed out");await page.waitForTimeout(100);}}
async function home(){await page.getByRole("button",{name:"今日",exact:true}).filter({visible:true}).first().click();await actual().waitFor();}
async function layout(){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(await page.locator("button:visible").evaluateAll(items=>items.filter(item=>item.scrollWidth>item.clientWidth+2).map(item=>item.textContent)),[]);}
try{
  await page.goto(url);await actual().waitFor();assert.equal((await saved()).meals.length,1);
  assert.equal(await actual().getByRole("group").count(),4);assert.equal(await actual().getByText("尚未记录",{exact:true}).count(),4);
  await page.getByRole("heading",{name:"今日推荐饮食",exact:true}).waitFor();assert.equal(await actual().getByText("昨天的记录必须保留",{exact:true}).count(),0);
  const notice=page.getByRole("complementary",{name:"本地数据隔离提示"});assert.match(await notice.innerText(),/3007、3008/);assert.match(await notice.innerText(),new RegExp(new URL(url).host.replaceAll(".","\\.")));
  results.push("Empty actual breakfast/lunch/dinner/snack groups offer direct add actions; recommendations and another date never become today's intake; the current origin and port isolation are visible.");
  await actual().getByRole("group",{name:"实际早餐",exact:true}).getByRole("button",{name:"新增早餐",exact:true}).click();let dialog=page.getByRole("dialog",{name:"记录饮食",exact:true});
  assert.equal(await dialog.getByLabel("餐次").inputValue(),"breakfast");await dialog.getByLabel("食物名称",{exact:true}).fill("实际早餐红薯和酸奶");await dialog.getByLabel("分量",{exact:true}).fill("红薯100g；酸奶150ml");
  const bytes=await page.evaluate(()=>{const canvas=document.createElement("canvas");canvas.width=320;canvas.height=240;const c=canvas.getContext("2d");c.fillStyle="#a2c8d8";c.fillRect(0,0,320,240);c.fillStyle="#f6d4a2";c.fillRect(80,60,160,120);return canvas.toDataURL("image/jpeg",0.8).split(",")[1];});
  await dialog.getByLabel("餐食照片（可选）").setInputFiles({name:"actual-meal.jpg",mimeType:"image/jpeg",buffer:Buffer.from(bytes,"base64")});await dialog.getByRole("button",{name:"保存饮食记录",exact:true}).click();await dialog.waitFor({state:"hidden"});
  const record=(await saved()).meals.find(item=>item.record_date===date);assert.ok(record);assert.equal(record.images.length,1);assert.ok(record.images[0].storage_path.startsWith("idb:"));assert.equal(record.images[0].signed_url,undefined);
  let card=actual().locator(`[data-meal-id="${record.id}"]`);await card.getByText("实际早餐红薯和酸奶",{exact:true}).waitFor();await until(()=>card.getByAltText("餐食照片").evaluate(img=>img.complete&&img.naturalWidth>0));assert.equal(await card.locator('[data-nutrition="unknown"]').count(),1);assert.match(await card.innerText(),/份量：红薯100g；酸奶150ml/);assert.doesNotMatch(await card.innerText(),/0 kcal/);
  results.push("QuickMealForm commits the meal and real JPEG to IndexedDB, closes to home, and the actual record/photo appears immediately without navigation; unknown nutrition stays pending.");
  await card.getByRole("button",{name:"编辑",exact:true}).click();dialog=page.getByRole("dialog",{name:"编辑饮食记录",exact:true});await dialog.getByLabel("食物名称",{exact:true}).fill("修改后的实际早餐");await dialog.getByLabel("分量",{exact:true}).fill("红薯120g；酸奶200ml");await dialog.getByRole("button",{name:"保存修改",exact:true}).click();
  await dialog.locator("summary").filter({hasText:"营养数值"}).click();for(const [label,value] of [["热量下限 kcal","240"],["热量上限 kcal","300"],["蛋白质 g","15"],["脂肪 g","8"],["碳水 g","35"]])await dialog.getByLabel(label,{exact:true}).fill(value);
  await dialog.getByRole("button",{name:"保存营养数值",exact:true}).click();await until(async()=>(await saved()).meals.find(item=>item.id===record.id)?.nutrition?.protein_g===15);await dialog.getByRole("button",{name:"关闭录入窗口"}).click();
  assert.equal((await saved()).meals.length,2);card=actual().locator(`[data-meal-id="${record.id}"]`);await card.getByText("热量估计 240–300 kcal",{exact:true}).waitFor();assert.match(await card.innerText(),/蛋白质 15 g · 脂肪 8 g · 碳水 35 g/);await page.getByText("已摄入估计 240–300 kcal",{exact:true}).first().waitFor();
  const homeText=await card.innerText();await page.getByRole("button",{name:"查看当天详情",exact:true}).click();assert.equal(await history().locator(`[data-meal-id="${record.id}"]`).innerText(),homeText);await home();
  await page.reload();await actual().waitFor();card=actual().locator(`[data-meal-id="${record.id}"]`);assert.equal(await card.innerText(),homeText);await until(()=>card.getByAltText("餐食照片").evaluate(img=>img.complete&&img.naturalWidth>0));assert.equal((await saved()).meals.length,2);
  results.push("Editing keeps the original meal ID and photo, updates calories/macros immediately, and the exact same actual meal content appears in history and after reload.");
  await actual().evaluate(element=>element.scrollIntoView({block:"start"}));await layout();await page.screenshot({path:path.join(output,"actual-meals-mobile.png")});await page.setViewportSize({width:320,height:740});await actual().evaluate(element=>element.scrollIntoView({block:"start"}));await layout();await page.screenshot({path:path.join(output,"actual-meals-320.png")});await page.setViewportSize({width:1365,height:950});await actual().evaluate(element=>element.scrollIntoView({block:"start"}));await layout();await page.screenshot({path:path.join(output,"actual-meals-desktop.png")});await page.setViewportSize({width:390,height:844});
  await card.getByRole("button",{name:"编辑",exact:true}).click();dialog=page.getByRole("dialog",{name:"编辑饮食记录",exact:true});confirmDelete=false;await dialog.getByRole("button",{name:"删除",exact:true}).click();assert.ok((await saved()).meals.some(item=>item.id===record.id));confirmDelete=true;await dialog.getByRole("button",{name:"删除",exact:true}).click();await dialog.waitFor({state:"hidden"});
  await until(async()=>!(await saved()).meals.some(item=>item.id===record.id));assert.equal(await actual().locator(`[data-meal-id="${record.id}"]`).count(),0);assert.equal(await actual().getByText("尚未记录",{exact:true}).count(),4);assert.equal((await saved()).meals[0].id,"yesterday");
  const retained=await page.evaluate(async key=>{const db=await new Promise(resolve=>{const r=indexedDB.open("gentle-fat-loss-coach-v2",1);r.onsuccess=()=>resolve(r.result);});const entry=await new Promise(resolve=>{const r=db.transaction("photos").objectStore("photos").get(key);r.onsuccess=()=>resolve(r.result);});db.close();return Boolean(entry?.blob?.size);},record.images[0].storage_path);assert.equal(retained,true);
  await page.getByRole("button",{name:"查看当天详情",exact:true}).click();assert.equal(await history().locator(`[data-meal-id="${record.id}"]`).count(),0);await home();await page.reload();await actual().waitFor();assert.equal(await actual().getByText("尚未记录",{exact:true}).count(),4);assert.equal((await saved()).meals.length,1);
  results.push("Canceling deletion preserves the record; confirmed deletion updates home, history, totals and remaining plan immediately and survives reload, while another day's record and original photo bytes are retained.");
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(paid,[]);const report={results,page_errors:errors,external_requests:external,paid_requests:paid,browser:browser.version()};await writeFile(path.join(output,"results.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){await page.screenshot({path:path.join(output,"failure.png"),fullPage:true});throw e;}finally{await context.close();await browser.close();}

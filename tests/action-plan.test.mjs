import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { addDays,buildDefaultData } from "../lib/fat-loss.ts";
import { adjustPlanAfterActuals,generateWeekPlan,mondayOf,taskState,tasksForDate,effectiveTask,nextActionAdvice,weeklyReview } from "../lib/action-plan.ts";
import { planningPreferencesSchema,taskUpdateSchema,weekPlanSchema } from "../lib/plan-types.ts";
import { appDataSchema,createDataBackup,parseDataBackup,mergeBackupData } from "../lib/schemas.ts";
import { exportZipBackup,inspectBackup } from "../lib/zip-backup.ts";
import { calculateNutritionTargets } from "../lib/nutrition.ts";

const date = "2026-10-20";
function fixture() { const data=buildDefaultData("local-user"); data.profile.age=30; data.profile.challenge_end_date="2027-03-01"; data.profile.planning=planningPreferencesSchema.parse({}); data.plans=[generateWeekPlan(data,date)]; data.task_updates=[]; return data; }
const update=(data,task,patch)=>taskUpdateSchema.parse({ id:task.id,user_id:data.profile.user_id,record_date:task.date,updated_at:new Date().toISOString(),...patch });

test("first week has seven calendar days, complete concrete meals, tutorials and recovery",()=>{
  const data=fixture(),week=data.plans[0]; assert.equal(week.week_start,"2026-10-19"); assert.equal(mondayOf("2026-11-01"),"2026-10-26");
  assert.equal(weekPlanSchema.safeParse(week).success,true); assert.equal(week.days.length,7);
  assert.equal(new Set(week.days.flatMap(day=>day.tasks.map(task=>task.id))).size,49);
  const goal=calculateNutritionTargets(data.profile).targets.calories;
  for(const day of week.days) {
    assert.equal(day.tasks.filter(task=>task.kind==="meal").length,4);
    assert.ok(day.tasks.every(task=>task.time && task.amount && task.steps.length>=3 && task.criteria && task.why && task.resources.length));
    const meals=day.tasks.filter(task=>task.kind==="meal");
    const kcal=meals.reduce((sum,task)=>sum+(task.meals[0].calories_min+task.meals[0].calories_max)/2,0);
    assert.ok(Math.abs(kcal-goal)<goal*0.1,`${kcal} vs ${goal}`);
  }
  const strength=week.days.filter(day=>day.tasks.some(task=>task.exercise_type==="力量训练")).map(day=>day.date);
  assert.equal(strength.length,2); assert.ok(strength[1]>addDays(strength[0],1));
  assert.ok(week.days.filter(day=>day.tasks.some(task=>task.id.endsWith(":movement") && task.kind==="habit")).length>=2);
});

test("vegan, allergens, equipment and physical limitations constrain all alternatives",()=>{
  const data=fixture(); data.profile.planning={ ...data.profile.planning,diet:"vegan",allergies:"大豆 小麦",equipment:"none",available_minutes:10 };
  const week=generateWeekPlan(data,date);
  const ingredients=week.days.flatMap(day=>day.tasks.flatMap(task=>task.meals.flatMap(meal=>meal.ingredients))).join(" ");
  assert.doesNotMatch(ingredients,/鸡肉|鸡蛋|牛奶|清蒸鱼|豆腐|豆浆|全麦面包/);
  assert.ok(week.days.flatMap(day=>day.tasks).filter(task=>task.kind==="exercise").every(task=>task.duration_min<=10 && !task.steps.join("").includes("椅子")));
  data.profile.planning.limitations="膝盖不适，待评估";
  assert.equal(generateWeekPlan(data,date).days.flatMap(day=>day.tasks).filter(task=>task.kind==="exercise").length,0);
});

test("missing age and short target dates do not trigger crash dieting or paid AI",()=>{
  const data=fixture(); data.profile.age=null; data.profile.challenge_end_date=addDays(date,2); data.profile.target_weight_kg=40;
  const week=generateWeekPlan(data,date); assert.ok(week.notes.some(note=>note.includes("年龄"))); assert.ok(week.notes.some(note=>note.includes("偏紧")));
  assert.equal(week.days.every(day=>day.tasks.filter(task=>task.kind==="meal").length===4),true);
  data.profile.age=16; assert.equal(generateWeekPlan(data,date).days.flatMap(day=>day.tasks).some(task=>task.kind==="exercise"),false);
});

test("skip, reschedule, meal replacement and manual recovery persist without touching records",()=>{
  const data=fixture(); const task=data.plans[0].days[1].tasks[0];
  data.task_updates=[update(data,task,{ status:"later",scheduled_date:addDays(task.date,1),scheduled_time:"09:15",meal_choice:1 })];
  assert.equal(tasksForDate(data,task.date).some(item=>item.id===task.id),false);
  const moved=tasksForDate(data,addDays(task.date,1)).find(item=>item.id===task.id);
  assert.equal(moved.time,"09:15"); assert.equal(moved.amount,task.meals[1].portion); assert.equal(taskState(data,moved),"later"); assert.equal(data.meals.length,0);
  const movement=data.plans[0].days.filter(day=>day.date>=date).flatMap(day=>day.tasks).find(task=>task.kind==="exercise");
  data.task_updates.push(update(data,movement,{ recovery:true }));
  assert.equal(effectiveTask(data,movement).kind,"habit"); assert.equal(data.exercises.length,0);
});

test("actual meals and training update tasks; fatigue adjusts only uncompleted exercise",()=>{
  const data=fixture(); const meal=data.plans[0].days[0].tasks[0];
  data.meals=[{ id:"meal",record_date:meal.date,meal_type:meal.meal_type,plan_task_id:meal.id,food_name:"待识别餐食",images:[] }];
  assert.equal(taskState(data,meal),"pending"); data.meals[0].food_name="实际午餐"; assert.equal(taskState(data,meal),"completed");
  const movement=data.plans[0].days.filter(day=>day.date>=date).flatMap(day=>day.tasks).find(task=>task.kind==="exercise");
  data.checkins=[{ record_date:movement.date,fatigue_level:8,sleep_hours:5,body_feeling:"" }];
  assert.equal(effectiveTask(data,movement).kind,"habit");
  data.task_updates=[update(data,movement,{ status:"completed" })]; assert.equal(effectiveTask(data,movement).kind,"exercise");
});

test("actual intake produces concrete next-meal options, never punishment or skipped meals",()=>{
  const data=fixture(); data.meals=[{ record_date:date,meal_type:"breakfast",food_name:"实际早餐",images:[],nutrition:{ calories_min:2500,calories_max:3000,protein_g:10,fat_g:100,carbohydrate_g:200 } }];
  const advice=nextActionAdvice(data,date); assert.match(advice.food,/g|ml/); assert.match(advice.reason,/不跳餐/); assert.match(advice.reason,/蛋白质/);
  data.task_updates=data.plans[0].days[1].tasks.filter(task=>task.kind==="meal").map(task=>update(data,task,{ amount:"自选正常餐，待确认份量" }));
  const custom=nextActionAdvice(data,date); assert.equal(custom.food,"自选正常餐，待确认份量"); assert.match(custom.reason,/不沿用原份量/);
});

test("weight, meals and recovery adjust only pending non-manual future tasks",()=>{
  const data=fixture();
  data.weights=Array.from({length:8},(_,index)=>({ id:`w${index}`,user_id:data.profile.user_id,record_date:addDays(date,index-7),weight_kg:56-index*0.1,note:"",high_salt:false,late_dinner:false,menstrual_period:false,bowel_movement:false,poor_sleep:false,hard_training_previous_day:false }));
  data.checkins=[{ record_date:date,fatigue_level:8,sleep_hours:5,body_feeling:"疲劳" }];
  const completed=data.plans[0].days[1].tasks[0]; const manual=data.plans[0].days[1].tasks[1];
  data.task_updates=[update(data,completed,{ status:"completed" }),update(data,manual,{ status:"later",amount:"用户自己安排的正常餐" })];
  const afterWeight=adjustPlanAfterActuals(data,date,"weight",date);
  assert.equal(afterWeight.task_updates.find(item=>item.id===completed.id).status,"completed");
  assert.equal(afterWeight.task_updates.find(item=>item.id===manual.id).amount,"用户自己安排的正常餐");
  assert.ok(afterWeight.task_updates.some(item=>item.source==="system" && /7 日趋势|记录仍少/.test(item.note)));
  const movement=data.plans[0].days.filter(day=>day.date>=date).flatMap(day=>day.tasks).find(task=>task.kind==="exercise");
  const afterRecovery=adjustPlanAfterActuals(data,date,"recovery",date);
  assert.equal(afterRecovery.task_updates.find(item=>item.id===movement.id)?.recovery,true);
  const mealData=fixture(); mealData.meals=[{ record_date:date,meal_type:"breakfast",food_name:"粥",images:[],nutrition:{ calories_min:200,calories_max:250,protein_g:2,fat_g:1,carbohydrate_g:45 } }];
  const afterMeal=adjustPlanAfterActuals(mealData,date,"meal",date);
  assert.ok(afterMeal.task_updates.some(item=>item.source==="system" && /蛋白质/.test(item.note)));
});

test("weekly review simplifies the next week without reducing food or overwriting history",()=>{
  const data=fixture(); const first=data.plans[0]; data.task_updates=[update(data,first.days[0].tasks[0],{ status:"skipped" })];
  assert.equal(weeklyReview(data,first.week_start).simplify,true);
  const next=generateWeekPlan(data,addDays(first.week_start,7),first.week_start);
  assert.equal(next.week_start,"2026-10-26"); assert.match(next.review_note,/不降低热量/);
  assert.ok(next.days.flatMap(day=>day.tasks).filter(task=>task.kind==="exercise").every(task=>task.duration_min<=15));
  assert.equal(data.plans.length,1); assert.equal(data.plans[0],first);
});

test("ZIP and old JSON keep complete plans and updates with idempotent merge",async()=>{
  const data=fixture(); const task=data.plans[0].days[0].tasks[0]; data.task_updates=[update(data,task,{ status:"skipped" })];
  const blob=await exportZipBackup(data,async()=>{ throw Error("No photos expected"); });
  const backup=await inspectBackup(blob,"plan.zip"); assert.equal(backup.manifest.counts.plans,1); assert.equal(backup.manifest.counts.task_updates,1);
  assert.deepEqual(backup.data.plans,data.plans); assert.deepEqual(backup.data.task_updates,data.task_updates);
  const restored=mergeBackupData(buildDefaultData("new-owner"),backup.data); const again=mergeBackupData(restored,backup.data);
  assert.deepEqual(again,restored); assert.equal(restored.task_updates[0].user_id,"new-owner");
  const legacy=createDataBackup(buildDefaultData("legacy")); delete legacy.data.plans; delete legacy.data.task_updates;
  assert.equal(parseDataBackup(legacy).plans.length,0);
  const bad=structuredClone(data); bad.plans[0].days[0].date="2026-10-22"; assert.equal(appDataSchema.safeParse(bad).success,false);
});

test("self-hosted schema is Supabase-independent and enforces separate owners and revisions",async()=>{
  const db=new PGlite();
  try {
    const ddl=await readFile(new URL("../server/selfhost/schema.sql",import.meta.url),"utf8");
    await db.exec(ddl); await db.exec(ddl);
    const alice="11111111-1111-4111-8111-111111111111",bob="22222222-2222-4222-8222-222222222222";
    await db.exec(`insert into shiguang.accounts(id,email,password_hash) values('${alice}','alice@test.invalid','scrypt-test-only'),('${bob}','bob@test.invalid','scrypt-test-only'); insert into shiguang.snapshots(owner_id,payload) values('${alice}','{}'),('${bob}','{}'); create role shiguang_app_test nologin; grant usage on schema shiguang to shiguang_app_test; grant select,insert,update on shiguang.snapshots,shiguang.photos to shiguang_app_test; set role shiguang_app_test; set app.owner_id='${alice}';`);
    assert.equal((await db.query("select count(*)::int n from shiguang.snapshots")).rows[0].n,1);
    assert.equal((await db.query("update shiguang.snapshots set revision=revision+1 where owner_id=$1 and revision=0 returning revision",[bob])).rows.length,0);
    assert.equal((await db.query("update shiguang.snapshots set revision=revision+1 where owner_id=$1 and revision=0 returning revision",[alice])).rows.length,1);
    assert.equal((await db.query("update shiguang.snapshots set revision=revision+1 where owner_id=$1 and revision=0 returning revision",[alice])).rows.length,0);
    await assert.rejects(db.query("insert into shiguang.photos(owner_id,id,relative_path,sha256,bytes,mime_type) values($1,'photo','../escape',$2,10,'image/jpeg')",[alice,"a".repeat(64)]),/check constraint/);
  } finally { await db.close(); }
});

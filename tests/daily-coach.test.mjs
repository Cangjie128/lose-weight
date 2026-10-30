import assert from "node:assert/strict";
import test from "node:test";
import { addDays,buildDefaultData,emptyTasks,todayString } from "../lib/fat-loss.ts";
import { appDataSchema,createDataBackup,mergeBackupData,parseDataBackup } from "../lib/schemas.ts";
import { dailyCoachSnapshot,primaryWeightRecords,primaryWeightTrend,weightConditionLabel } from "../lib/daily-coach.ts";
import { adjustPlanAfterActuals,generateWeekPlan } from "../lib/action-plan.ts";
import { calculateNutritionTargets,dailyNutritionTargets } from "../lib/nutrition.ts";
import { exportZipBackup,inspectBackup } from "../lib/zip-backup.ts";

const baseWeight=(id,date,kg,period,time)=>({ id,user_id:"local-user",record_date:date,weight_kg:kg,note:"",high_salt:false,late_dinner:false,menstrual_period:false,bowel_movement:false,poor_sleep:false,hard_training_previous_day:false,...(period ? { weighing_period:period } : {}),...(time ? { weighed_at:time } : {}) });

test("primary trend uses only morning fasting records and keeps multiple same-day measurements",()=>{
  const weights=[
    baseWeight("m1","2026-10-20",55.1,"morning_fasting","07:10"),
    baseWeight("e1","2026-10-20",56.2,"evening_after_meal","21:00"),
    baseWeight("m2","2026-10-21",55.0,"morning_fasting","07:05"),
    baseWeight("m3","2026-10-21",55.2,"morning_fasting","08:00"),
  ];
  const selected=primaryWeightRecords(weights);
  assert.equal(selected.condition,"晨起空腹");
  assert.deepEqual(selected.records.map((item)=>item.id),["m1","m2"]);
  assert.deepEqual(primaryWeightTrend(weights).trend.map((item)=>item.weight_kg),[55.1,55]);
});

test("legacy weights remain unspecified and old backups still parse",()=>{
  const data=buildDefaultData("local-user");
  data.weights=[baseWeight("legacy","2026-10-20",55)];
  const parsed=parseDataBackup(createDataBackup(data));
  assert.equal(parsed.weights[0].weighing_period,undefined);
  assert.equal(weightConditionLabel(parsed.weights[0]),"时段未注明 · 时间未注明");
  assert.equal(appDataSchema.safeParse(parsed).success,true);
});

test("same record ID edits while another same-day weight remains",()=>{
  const current=buildDefaultData("local-user");
  current.weights=[baseWeight("morning","2026-10-20",55,"morning_fasting","07:00"),baseWeight("evening","2026-10-20",56,"evening_after_meal","20:00")];
  const incoming=structuredClone(current); incoming.weights=[{ ...incoming.weights[0],weight_kg:54.9 }];
  const merged=mergeBackupData(current,incoming);
  assert.equal(merged.weights.length,2);
  assert.equal(merged.weights.find((item)=>item.id==="morning").weight_kg,54.9);
  assert.equal(merged.weights.find((item)=>item.id==="evening").weight_kg,56);
});

test("daily coach withholds targets until profile and real weight are confirmed",()=>{
  const data=buildDefaultData("local-user"); data.profile.age=30;
  assert.equal(dailyCoachSnapshot(data,todayString()).ready,false);
  assert.equal(dailyCoachSnapshot(data,todayString()).targets,null);
  data.profile.profile_confirmed_at="2026-10-20T00:00:00.000Z";
  data.weights=[baseWeight("morning","2026-10-20",55,"morning_fasting","07:00")];
  data.checkins=[{ id:"checkin",user_id:"local-user",record_date:"2026-10-20",tasks:emptyTasks(),water_ml:0,sleep_hours:5,body_feeling:"疲劳",bowel_movement:false,menstrual_period:false,completion_score:0,fatigue_level:7 }];
  const snapshot=dailyCoachSnapshot(data,todayString());
  assert.equal(snapshot.ready,true); assert.ok(snapshot.targets.calories>=1500);
  assert.ok(snapshot.reminders.every((item)=>!item.includes("AI")));
});

test("food and bowel conditions stay separate and contradictory post-meal records never enter morning trend",()=>{
  const morning={...baseWeight("a","2026-10-20",55,"morning_fasting","07:00"),food_state:"fasting",bowel_state:"after"};
  const weights=[morning,{...morning,id:"b",record_date:"2026-10-21",weight_kg:54.9},{...morning,id:"c",record_date:"2026-10-22",weight_kg:57,food_state:"after_meal"},{...morning,id:"d",weight_kg:56,bowel_state:"before"}];
  const primary=primaryWeightRecords(weights);
  assert.deepEqual(primary.records.map(record=>record.id),["a","b"]);
  assert.match(primary.condition,/空腹.*排便后/);
});

test("daily calorie targets use seven calendar days of comparable weights instead of a single spike",()=>{
  const data=buildDefaultData("local-user");data.profile.age=30;
  const date=todayString();data.weights=Array.from({length:7},(_,i)=>baseWeight(`m${i}`,addDays(date,i-6),i===6?57:55,"morning_fasting","07:00"));
  data.weights.push(baseWeight("evening",date,60,"evening_after_meal","21:00"));
  const calculated=dailyNutritionTargets(data,date);
  const expected=calculateNutritionTargets({...data.profile,current_weight_kg:55.29});
  assert.deepEqual(calculated.targets,expected.targets);
  assert.match(calculated.explanation,/7 日移动平均 55.3 kg/);
});

test("historical corrections append an event without rewriting a completed plan or historical targets",()=>{
  const data=buildDefaultData("local-user");data.profile.age=30;data.profile.profile_confirmed_at=new Date().toISOString();
  const past=addDays(todayString(),-3);data.plans=[generateWeekPlan(data,past)];
  const task=data.plans[0].days.flatMap(day=>day.tasks)[0];
  data.task_updates=[{id:task.id,user_id:"local-user",record_date:task.date,status:"completed",source:"user",note:"历史确认",updated_at:new Date().toISOString()}];
  const historicalTargets={calories:1800,protein_g:80,fat_g:60,carbohydrate_g:235};
  data.coach_events=[{id:"original",record_date:past,created_at:new Date().toISOString(),cause:"meal",message:"已保存",targets:historicalTargets}];
  const snapshot=structuredClone(data);
  const updated=adjustPlanAfterActuals(data,past,"meal");
  assert.deepEqual(updated.plans,snapshot.plans);assert.deepEqual(updated.task_updates,snapshot.task_updates);
  assert.equal(updated.coach_events.length,2);assert.deepEqual(updated.coach_events.at(-1).targets,historicalTargets);
  assert.deepEqual(dailyCoachSnapshot(updated,past).targets,historicalTargets);
  assert.equal(dailyCoachSnapshot(updated,addDays(past,-1)).targets,null);
});

test("unknown meals and fatigue produce free local reminders without false zero totals",()=>{
  const data=buildDefaultData("local-user"),date=todayString();data.profile.age=30;data.profile.profile_confirmed_at=new Date().toISOString();
  data.weights=[baseWeight("weight",date,55,"morning_fasting","07:00")];
  data.meals=[{id:"meal",user_id:"local-user",record_date:date,meal_type:"lunch",food_name:"待确认餐食",portion:"",notes:"",ai_analysis:null,nutrition:null,images:[]}];
  data.checkins=[{id:"state",user_id:"local-user",record_date:date,tasks:emptyTasks(),water_ml:500,sleep_hours:5,body_feeling:"疲劳",bowel_movement:false,menstrual_period:false,completion_score:0,fatigue_level:7}];
  const snapshot=dailyCoachSnapshot(data,date);
  assert.equal(snapshot.nutrition.recorded,0);assert.equal(snapshot.nutrition.unknown,1);
  assert.ok(snapshot.reminders.some(item=>item.includes("未知值没有按零")));
  assert.ok(snapshot.reminders.some(item=>item.includes("恢复")));
});

test("ZIP and legacy JSON preserve weigh-in context and append-only coaching events",async()=>{
  const data=buildDefaultData("local-user"),date=todayString();data.profile.age=30;data.profile.profile_confirmed_at=new Date().toISOString();
  data.weights=[baseWeight("morning",date,55,"morning_fasting","07:00"),baseWeight("evening",date,56,"evening_after_meal","21:00")];
  const logged=adjustPlanAfterActuals(data,date,"weight");
  const inspected=await inspectBackup(await exportZipBackup(logged,async()=>{throw Error("No photo references expected");}),"v2-1.zip");
  assert.equal(inspected.data.weights.length,2);assert.deepEqual(inspected.data.coach_events,logged.coach_events);
  const parsed=parseDataBackup(createDataBackup(logged));
  assert.deepEqual(parsed.weights.map(item=>item.weighed_at),["07:00","21:00"]);
  assert.equal(mergeBackupData(inspected.data,parsed).coach_events.length,1);
});

test("invalid weigh-in times and contexts are rejected without altering existing data",()=>{
  const data=buildDefaultData("local-user");data.weights=[baseWeight("a",todayString(),55)];
  const previous=structuredClone(data);
  assert.equal(appDataSchema.safeParse({...data,weights:[{...data.weights[0],weighed_at:"25:90"}]}).success,false);
  assert.equal(appDataSchema.safeParse({...data,weights:[{...data.weights[0],weighing_period:"assumed_morning"}]}).success,false);
  assert.deepEqual(data,previous);
  const outsideSupportedRange={...data.profile,age:30,height_cm:230,current_weight_kg:200,activity_level:"active"};
  assert.equal(calculateNutritionTargets(outsideSupportedRange).targets,null);
});

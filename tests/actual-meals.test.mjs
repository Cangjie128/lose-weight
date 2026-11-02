import assert from "node:assert/strict";
import test from "node:test";
import { addDays,buildDefaultData,todayString } from "../lib/fat-loss.ts";
import { dailyCoachSnapshot } from "../lib/daily-coach.ts";
import { adjustPlanAfterActuals,generateWeekPlan,nextActionAdvice,tasksForDate } from "../lib/action-plan.ts";

const date=addDays(todayString(),1);
function fixture(){const data=buildDefaultData("test-local");data.profile.age=30;data.plans=[generateWeekPlan(data,date)];return data;}
const meal=(id,type,recordDate=date,nutrition=null)=>({id,user_id:"test-local",record_date:recordDate,meal_type:type,food_name:"实际食物",portion:"真实份量",notes:"",nutrition,ai_analysis:null,images:[]});
const known={calories_min:180,calories_max:220,protein_g:15,fat_g:8,carbohydrate_g:18,portion_g:null,source:"manual"};

test("recommended menus never become actual meals or intake just by rendering a daily snapshot",()=>{
  const data=fixture(),before=structuredClone(data);
  const snapshot=dailyCoachSnapshot(data,date);
  assert.ok(snapshot.mealTasks.length>=3);assert.deepEqual(snapshot.meals,[]);
  assert.equal(snapshot.nutrition.recorded,0);assert.equal(snapshot.nutrition.calories_max,0);
  assert.deepEqual(data,before);
});

test("actual meals and totals use only the selected day and keep unknown meals explicitly pending",()=>{
  const data=fixture();data.meals=[meal("known","breakfast",date,known),meal("pending","snack"),meal("old","dinner",addDays(date,-1),{...known,calories_min:1000,calories_max:1200})];
  const snapshot=dailyCoachSnapshot(data,date);
  assert.deepEqual(snapshot.meals.map(item=>item.id),["known","pending"]);
  assert.equal(snapshot.nutrition.calories_min,180);assert.equal(snapshot.nutrition.calories_max,220);assert.equal(snapshot.nutrition.protein_g,15);
  assert.equal(snapshot.nutrition.recorded,1);assert.equal(snapshot.nutrition.unknown,1);
  assert.ok(snapshot.reminders.some(message=>message.includes("未知值没有按零")));
});

test("a confirmed actual breakfast is skipped when selecting the next recommended meal",()=>{
  const data=fixture();const tasks=tasksForDate(data,date);
  assert.equal(nextActionAdvice(data,date).title,`下一餐 · ${tasks.find(task=>task.meal_type==="breakfast").time}`);
  data.meals=[meal("actual-breakfast","breakfast")];
  assert.equal(nextActionAdvice(data,date).title,`下一餐 · ${tasks.find(task=>task.meal_type==="lunch").time}`);
  assert.equal(data.meals.length,1);
});

test("deleting actual intake resets stale automatic meal choices without overwriting confirmed tasks",()=>{
  const data=fixture(),tasks=tasksForDate(data,date),lunch=tasks.find(task=>task.meal_type==="lunch"),breakfast=tasks.find(task=>task.meal_type==="breakfast");
  const stamp=new Date().toISOString();
  data.task_updates=[{id:lunch.id,user_id:"test-local",record_date:date,source:"system",status:"pending",meal_choice:2,note:"旧营养建议",updated_at:stamp},{id:breakfast.id,user_id:"test-local",record_date:date,source:"user",status:"completed",meal_choice:0,note:"用户确认已完成",updated_at:stamp}];
  const completed=structuredClone(data.task_updates[1]);
  const updated=adjustPlanAfterActuals(data,date,"meal",date);
  assert.equal(updated.task_updates.find(item=>item.id===lunch.id).meal_choice,0);
  assert.deepEqual(updated.task_updates.find(item=>item.id===breakfast.id),completed);
  assert.deepEqual(updated.meals,[]);assert.equal(dailyCoachSnapshot(updated,date).nutrition.unknown,0);
});

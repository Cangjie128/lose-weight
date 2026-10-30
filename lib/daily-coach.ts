import { addDays,todayString,type AppData } from "./fat-loss.ts";
import { nextActionAdvice,selectedPlanMeal,taskState,tasksForDate } from "./action-plan.ts";
import { dailyNutritionTargets,dailyNutrition,exerciseSuggestion } from "./nutrition.ts";
import { primaryWeightTrend } from "./weight-trend.ts";
export { bowelStateLabels,foodStateLabels,latestPrimaryWeight,primaryWeightRecords,primaryWeightTrend,weighingPeriodLabels,weightConditionLabel } from "./weight-trend.ts";

export function isProfileReady(data: AppData) {
  const profile=data.profile;
  return Boolean(profile.profile_confirmed_at && profile.age && profile.age>=18 && profile.height_cm>=100 && profile.current_weight_kg>=30 && profile.target_weight_kg>=30 && profile.activity_level && data.weights.some((record) => record.record_date<=todayString()));
}

export function dailyCoachSnapshot(data: AppData,date: string) {
  const meals=data.meals.filter((record) => record.record_date===date);
  const exercises=data.exercises.filter((record) => record.record_date===date);
  const checkin=data.checkins.find((record) => record.record_date===date);
  const nutrition=dailyNutrition(meals);
  const ready=isProfileReady(data);
  const historical=date<todayString();
  const targetResult=dailyNutritionTargets(data,date);
  const savedTargets=(data.coach_events || []).filter((event) => event.record_date===date).at(-1)?.targets;
  const targets=historical ? savedTargets ?? null : ready ? targetResult.targets : null;
  const exercise=exerciseSuggestion(data,date);
  const tasks=tasksForDate(data,date);
  const completed=tasks.filter((task) => taskState(data,task)==="completed").length;
  const mealTasks=tasks.filter((task) => task.kind==="meal").map((task) => ({ task,meal:selectedPlanMeal(data,task) }));
  const weightTrend=primaryWeightTrend(data.weights.filter((record) => record.record_date<=date));
  const latest=weightTrend.trend.at(-1);
  const earlier=latest ? weightTrend.trend.findLast((record) => record.record_date<=addDays(latest.record_date,-7)) : undefined;
  const change=latest && earlier ? Number((latest.moving_average-earlier.moving_average).toFixed(2)) : null;
  const reminders: string[]=[];
  if (nutrition.unknown) reminders.push(`${nutrition.unknown} 餐营养信息不完整，请补充分量；未知值没有按零摄入计算。`);
  if (targets && nutrition.recorded && nutrition.protein_g<targets.protein_g*0.45) reminders.push("当前蛋白质摄入偏少，下一餐优先补充蛋、奶、豆制品、鱼或瘦肉，同时保留主食和蔬菜。");
  if ((checkin?.fatigue_level || 0)>=6 || (checkin?.sleep_hours!=null && checkin.sleep_hours<6) || exercise.activity.includes("休息")) reminders.push("近期疲劳、睡眠或身体状态需要恢复，今天不追加高强度训练。");
  if (!data.weights.some((record) => record.record_date===date && record.weighing_period==="morning_fasting")) reminders.push("这一天没有晨起空腹体重；其他时段仍可记录，但不会与晨起趋势混算。");
  if (!reminders.length) reminders.push("按计划正常进食和活动即可，不需要追求满分。");
  const advice=nextActionAdvice(data,date);
  return {
    ready,meals,exercises,checkin,nutrition,targets,exercise,tasks,completed,mealTasks,reminders,
    targetExplanation:historical ? (savedTargets ? "使用该日已保存的目标快照，不以当前资料重写历史目标。" : "该日没有保存目标快照，显示为未知，不用当前目标代替。") : ready ? targetResult.explanation : "确认真实个人资料并记录体重后生成个人目标，不使用示例值。",
    nextMeal:advice.food,nextMealReason:advice.reason,
    weightCondition:weightTrend.condition,sevenDayChange:change,
  };
}

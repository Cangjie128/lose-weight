import { addDays, type AppData, type MealRecord, type NutritionTargets, type Profile } from "./fat-loss.ts";
import { primaryWeightTrend } from "./weight-trend.ts";

export const activityLabels = { sedentary: "久坐，日常活动较少", light: "轻度活动，每周运动 1–3 次", moderate: "中度活动，每周运动 3–5 次", active: "较多活动或体力工作" };

export function dailyNutritionTargets(data:AppData,date:string) {
  const selected=primaryWeightTrend(data.weights.filter((item) => item.record_date<=date));
  const average=selected.trend.at(-1)?.moving_average;
  const result=calculateNutritionTargets({ ...data.profile,current_weight_kg:average ?? data.profile.current_weight_kg });
  return { ...result,explanation:`${result.explanation}${average ? ` 计算体重采用${selected.condition}的 7 日移动平均 ${average.toFixed(1)} kg。` : " 暂以用户明确确认的资料体重计算。"}` };
}

export function calculateNutritionTargets(profile: Profile): { targets: NutritionTargets | null; explanation: string } {
  if (profile.nutrition_targets) return { targets: profile.nutrition_targets, explanation: "使用你保存的手动目标" };
  if (!profile.age) return { targets: null, explanation: "在设置中填写年龄后生成目标，也可以手动设置。" };
  if (profile.age < 18 || profile.needs_professional_guidance || /孕|哺乳|进食障碍/.test(profile.health_notes)) return { targets: null, explanation: "当前身体情况需要专业人员制定营养目标，不自动生成减脂热量。" };
  const weight = profile.current_weight_kg;
  const sexOffset = profile.gender === "男性" ? 5 : profile.gender === "女性" ? -161 : -78;
  const resting = 10 * weight + 6.25 * profile.height_cm - 5 * profile.age + sexOffset;
  const factors = { sedentary: 1.4, light: 1.6, moderate: 1.8, active: 2.0 };
  const maintenance = resting * factors[profile.activity_level || "light"];
  const bmi = weight / (profile.height_cm / 100) ** 2;
  const targetBmi = profile.target_weight_kg / (profile.height_cm / 100) ** 2;
  const deficit = bmi < 20 || targetBmi < 18.5 ? 0 : Math.min(250, maintenance * 0.1);
  const calories = Math.round(Math.max(1500, resting, maintenance - deficit) / 10) * 10;
  const protein_g = Math.round(weight * 1.3);
  const fat_g = Math.round(calories * 0.3 / 9);
  const carbohydrate_g = Math.round((calories - protein_g * 4 - fat_g * 9) / 4);
  if (calories>5000 || protein_g>250 || carbohydrate_g<100 || carbohydrate_g>700 || fat_g>200) return { targets:null,explanation:"体型或活动量超出当前通用目标计算范围，请由专业人员确认，不自动设置减脂热量。" };
  return { targets: { calories, protein_g, fat_g, carbohydrate_g }, explanation: `按 Mifflin–St Jeor 公式估算静息能量 ${Math.round(resting)} kcal × 活动系数 ${factors[profile.activity_level || "light"]}，维持量约 ${Math.round(maintenance)} kcal；${deficit ? `温和缺口约 ${Math.round(deficit)} kcal（不超过维持量的 10% 或 250 kcal），目标取整为 ${calories} kcal。` : "当前优先维持和规律进食，不自动设置热量缺口。"} 目标日期不用于扩大缺口。` };
}

export function dailyNutrition(meals: MealRecord[]) {
  const resolved = meals.map((meal) => meal.nutrition || (meal.ai_analysis?.estimated_calories_min !== null && meal.ai_analysis?.estimated_calories_min !== undefined && meal.ai_analysis.estimated_calories_max !== null
    && meal.ai_analysis.protein_g !== null && meal.ai_analysis.fat_g !== null && meal.ai_analysis.carbohydrate_g !== null ? {
    calories_min: meal.ai_analysis.estimated_calories_min, calories_max: meal.ai_analysis.estimated_calories_max,
    protein_g: meal.ai_analysis.protein_g, fat_g: meal.ai_analysis.fat_g, carbohydrate_g: meal.ai_analysis.carbohydrate_g,
  } : null));
  const known = resolved.filter((nutrition) => nutrition !== null);
  const total = known.reduce((sum, nutrition) => ({
    calories_min: sum.calories_min + nutrition.calories_min,
    calories_max: sum.calories_max + nutrition.calories_max,
    protein_g: sum.protein_g + nutrition.protein_g,
    fat_g: sum.fat_g + nutrition.fat_g,
    carbohydrate_g: sum.carbohydrate_g + nutrition.carbohydrate_g,
  }), { calories_min: 0, calories_max: 0, protein_g: 0, fat_g: 0, carbohydrate_g: 0 });
  return { ...total, recorded: known.length, unknown: resolved.filter((nutrition) => nutrition === null).length };
}

export function nextMealSuggestion(meals: MealRecord[], targets: NutritionTargets | null) {
  const total = dailyNutrition(meals);
  if (!meals.length) return "按日常节奏安排一餐：主食、蛋白质食物和蔬菜，吃到舒适饱足。";
  if (total.unknown) return `还有 ${total.unknown} 餐未填写营养，先补充分量信息；下一餐继续规律吃，不据此跳餐。`;
  if (targets && total.protein_g < targets.protein_g * 0.6) return "下一餐可优先选择蛋、豆制品、鱼或瘦肉，配主食和蔬菜。";
  return "下一餐保持正常份量和多样食物；不需要少吃一餐或加练来抵消上一餐。";
}

export function exerciseSuggestion(data: AppData, date: string) {
  if (data.profile.needs_professional_guidance) return { activity: "专业指导与恢复", duration: "按专业建议安排", intensity: "个体化", reason: "结合身体情况再制定训练，不自动增加运动强度。" };
  const start = addDays(date, -6);
  const recent = data.exercises.filter((record) => record.record_date >= start && record.record_date <= date);
  const checkins = data.checkins.filter((record) => record.record_date >= addDays(date, -2) && record.record_date <= date);
  const discomfort = recent.filter((record) => record.record_date >= addDays(date, -2)).some((record) => record.has_discomfort || /疼|痛|头晕|胸闷|抽筋/.test(`${record.discomfort_detail} ${record.feeling}`)) || checkins.some((record) => /疼|痛|头晕|胸闷|不适/.test(record.body_feeling));
  const fatigue = Math.max(0, ...checkins.map((record) => record.fatigue_level || 0));
  const shortSleep = checkins.some((record) => record.sleep_hours !== null && record.sleep_hours < 6);
  const hardDays = new Set(recent.filter((record) => record.intensity === "高" || record.exercise_type === "力量训练").map((record) => record.record_date));
  if (discomfort) return { activity: "恢复与休息", duration: "不安排正式训练", intensity: "休息", reason: "最近记录了身体不适。先观察恢复，明显或持续症状需专业评估。" };
  if (fatigue >= 6 || shortSleep || recent.some((record) => /疲劳|疲惫|过累/.test(record.feeling)) || hardDays.has(addDays(date, -1)) || recent.length >= data.profile.weekly_exercise_goal) return { activity: "轻松步行或休息", duration: "10–20 分钟，可完全休息", intensity: "低", reason: "结合近七天训练、睡眠和疲劳，今天以恢复为主。" };
  const preferred = data.profile.exercise_preferences?.[0] || "步行";
  return { activity: preferred === "其他" ? "步行与温和拉伸" : preferred, duration: preferred === "力量训练" ? "20–30 分钟" : "20–35 分钟", intensity: "低至中，能自然说话", reason: "按运动偏好安排，出现不适随时停止；不根据进食量追加运动。" };
}

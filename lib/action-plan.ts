import { addDays,daysBetween,todayString,type AppData,type MealNutrition } from "./fat-loss.ts";
import { dailyNutrition,calculateNutritionTargets,exerciseSuggestion } from "./nutrition.ts";
import { planningPreferencesSchema,type PlanMeal,type PlanTask,type TaskUpdate,type WeekPlan } from "./plan-types.ts";

const resources = {
  food: { title: "WHO 多样化健康饮食",url: "https://www.who.int/news-room/fact-sheets/detail/healthy-diet" },
  strength: { title: "NHS 力量动作图解（英文）",url: "https://www.nhs.uk/live-well/exercise/strength-exercises/" },
  walk: { title: "NHS 步行与强度教程（英文）",url: "https://www.nhs.uk/live-well/exercise/walking-for-health/" },
  habits: { title: "CDC 可持续生活计划（英文）",url: "https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html" },
};
export function mondayOf(date: string) { const day = new Date(`${date}T12:00:00`).getDay(); return addDays(date,-((day+6)%7)); }

// Approximate generic-food values per 100g/ml, not product labels or an AI estimate.
type Food = { name: string; unit: string; group: string; tags: string[]; kcal: number; p: number; f: number; c: number };
const foods: Record<string,Food> = {
  oats: { name: "燕麦（干重）",unit: "g",group: "grain",tags: ["燕麦","谷物","麸质"],kcal: 380,p: 13,f: 7,c: 68 },
  rice: { name: "米饭（熟重）",unit: "g",group: "grain",tags: ["米饭"],kcal: 130,p: 3,f: 0.3,c: 28 },
  potato: { name: "蒸土豆（熟重）",unit: "g",group: "grain",tags: ["土豆"],kcal: 85,p: 2,f: 0.1,c: 19 },
  bread: { name: "全麦面包",unit: "g",group: "grain",tags: ["小麦","麸质","面包"],kcal: 250,p: 10,f: 4,c: 44 },
  tofu: { name: "豆腐",unit: "g",group: "protein",tags: ["豆","大豆","豆腐"],kcal: 85,p: 9,f: 5,c: 2 },
  lentil: { name: "熟扁豆",unit: "g",group: "protein",tags: ["豆","扁豆"],kcal: 115,p: 9,f: 0.5,c: 20 },
  egg: { name: "鸡蛋（去壳约每个50g）",unit: "g",group: "protein",tags: ["蛋","鸡蛋","animal"],kcal: 145,p: 13,f: 10,c: 1 },
  chicken: { name: "去皮鸡肉（熟重）",unit: "g",group: "protein",tags: ["肉","鸡肉","animal","meat"],kcal: 165,p: 30,f: 4,c: 0 },
  fish: { name: "清蒸鱼（熟重）",unit: "g",group: "protein",tags: ["鱼","海鲜","animal","meat"],kcal: 130,p: 23,f: 4,c: 0 },
  milk: { name: "牛奶",unit: "ml",group: "drink",tags: ["奶","乳","animal"],kcal: 60,p: 3,f: 3,c: 5 },
  soy: { name: "无糖豆浆",unit: "ml",group: "drink",tags: ["豆","大豆","豆浆"],kcal: 35,p: 3,f: 2,c: 2 },
  veg: { name: "时令蔬菜（熟重）",unit: "g",group: "veg",tags: ["蔬菜"],kcal: 30,p: 2,f: 0.5,c: 5 },
  apple: { name: "苹果（可食部分）",unit: "g",group: "fruit",tags: ["苹果","水果"],kcal: 55,p: 0.3,f: 0.2,c: 14 },
  orange: { name: "橙子（可食部分）",unit: "g",group: "fruit",tags: ["橙","柑橘","水果"],kcal: 47,p: 1,f: 0.1,c: 12 },
  oil: { name: "烹调植物油",unit: "g",group: "oil",tags: ["油"],kcal: 900,p: 0,f: 100,c: 0 },
};
function eligible(data: AppData,key: string) {
  const pref = planningPreferencesSchema.parse(data.profile.planning || {});
  const food = foods[key];
  const diet = /纯素|全素/.test(data.profile.diet_preferences) ? "vegan" : /素食/.test(data.profile.diet_preferences) && pref.diet === "balanced" ? "vegetarian" : pref.diet;
  if (diet === "vegan" && food.tags.includes("animal") || diet === "vegetarian" && food.tags.includes("meat")) return false;
  const excluded = `${data.profile.disliked_foods} ${pref.allergies}`.split(/[，,、;；\s]+/).filter(Boolean);
  return !excluded.some((word) => food.tags.some((tag) => tag !== "animal" && tag !== "meat" && (tag.includes(word) || word.includes(tag))) || food.name.includes(word));
}
function mealOption(data: AppData,day: number,slot: number,variant: number): PlanMeal {
  const targets = calculateNutritionTargets(data.profile).targets;
  const pick = (keys: string[]) => { const allowed = keys.filter((key) => eligible(data,key)); return allowed[(day+variant)%Math.max(1,allowed.length)]; };
  const grain = pick(slot === 0 ? ["oats","bread","potato","rice"] : ["rice","potato","bread","oats"]);
  const protein = pick(["chicken","tofu","fish","egg","lentil"]);
  const drink = pick(["milk","soy"]);
  const fruit = pick(["apple","orange"]);
  const components: [string|undefined,number][] = slot === 0
    ? [[grain,grain === "oats" ? 60 : grain === "bread" ? 90 : 200],[protein,protein === "egg" ? 100 : 90],[drink,200],[fruit,100]]
    : slot === 3 ? [[fruit,180],[drink,200]] : [[grain,grain === "oats" ? 80 : grain === "bread" ? 100 : 200],[protein,150],["veg",250],["oil",10]];
  const requiredMissing = slot === 3 ? !fruit && !drink : !grain || !protein;
  const fixed = components.reduce((sum,[key,grams]) => sum+(key && eligible(data,key) && ["fruit","veg"].includes(foods[key].group) ? foods[key].kcal*grams/100 : 0),0);
  const adjustable = components.reduce((sum,[key,grams]) => sum+(key && eligible(data,key) && !["fruit","veg"].includes(foods[key].group) ? foods[key].kcal*grams/100 : 0),0);
  const scale = Math.max(0.5,Math.min(3.5,((targets?.calories || 1800)*[0.26,0.32,0.32,0.1][slot]-fixed)/Math.max(1,adjustable)));
  const result = { kcal: 0,p: 0,f: 0,c: 0 };
  const ingredients: string[] = [];
  for (const [key,base] of components) {
    if (!key || !eligible(data,key)) continue;
    const food = foods[key]; const grams = Math.round((food.group === "veg" || food.group === "fruit" ? base : base*scale)/5)*5;
    ingredients.push(`${food.name} ${grams}${food.unit}`);
    result.kcal += food.kcal*grams/100; result.p += food.p*grams/100; result.f += food.f*grams/100; result.c += food.c*grams/100;
  }
  return { title: requiredMissing ? "请先确认安全的食物替换" : ingredients.slice(0,2).map((food) => food.split(" ")[0]).join(" + "),portion: ingredients.join("；"),ingredients,
    calories_min: requiredMissing ? 0 : Math.round(result.kcal*0.85/10)*10,calories_max: requiredMissing ? 0 : Math.round(result.kcal*1.15/10)*10,
    protein_g: Math.round(result.p),fat_g: Math.round(result.f),carbohydrate_g: Math.round(result.c),needs_confirmation: requiredMissing };
}

export function safetyNotes(data: AppData,date: string) {
  const notes: string[] = [];
  const profile = data.profile;
  const bmi = profile.current_weight_kg/(profile.height_cm/100)**2;
  const targetBmi = profile.target_weight_kg/(profile.height_cm/100)**2;
  const weeks = Math.max(1,daysBetween(date,profile.challenge_end_date)/7);
  if ((profile.current_weight_kg-profile.target_weight_kg)/weeks > 0.5) notes.push("目标日期偏紧，计划不会通过少吃、脱水或加练追赶。建议延长日期，与专业人员确认目标。");
  if (bmi < 20 || targetBmi < 18.5) notes.push("目前优先规律进食、维持能量与恢复，不按目标日期自动扩大热量缺口。");
  if (!profile.age) notes.push("年龄尚未填写：先提供参考餐盘和轻量活动，不自动设定减脂热量。完善个人资料后再调整计划。");
  if (profile.needs_professional_guidance || (profile.age && profile.age < 18) || /孕|哺乳|进食障碍/.test(profile.health_notes)) notes.push("当前需要专业指导。以下仅作规律饮食和休息参考，不提供个体减脂处方或正式训练。");
  if (planningPreferencesSchema.parse(profile.planning || {}).allergies) notes.push("已按填写的食物词筛选；包装配料、交叉接触和餐馆用料仍须自行核实。严重过敏先咨询专业人员。");
  return notes;
}

export function weeklyReview(data: AppData,weekStart: string) {
  const end = addDays(weekStart,6);
  const tasks = tasksForRange(data,weekStart,end);
  const done = tasks.filter((task) => taskState(data,task) === "completed").length;
  const skipped = tasks.filter((task) => taskState(data,task) === "skipped").length;
  const workouts = data.exercises.filter((record) => record.record_date >= weekStart && record.record_date <= end);
  const fatigue = data.checkins.filter((record) => record.record_date >= weekStart && record.record_date <= end).some((record) => (record.fatigue_level || 0)>=6 || record.sleep_hours !== null && record.sleep_hours<6);
  const pain = workouts.some((record) => record.has_discomfort);
  const observations = done+skipped;
  const simplify = fatigue || pain || observations > 0 && done/observations<0.6;
  return { done,skipped,total: tasks.length,workouts: workouts.length,fatigue,pain,simplify,
    feedback: pain ? "记录了不适，下周先恢复，不增加运动负荷。" : fatigue ? "疲劳或睡眠不足，下周缩短训练并保留恢复日。" : observations === 0 ? "还没有足够执行反馈，先维持轻量安排，不因为空白记录减少饮食。" : simplify ? "下周把任务做得更容易：缩短运动、使用易准备餐食，不降低热量目标。" : "规律执行比满分重要，下周维持当前负荷，不自动升级强度。" };
}

export function generateWeekPlan(data: AppData,date: string,previousWeek?: string): WeekPlan {
  const start = mondayOf(date); const prefs = planningPreferencesSchema.parse(data.profile.planning || {});
  const review = previousWeek ? weeklyReview(data,previousWeek) : null;
  const minutes = Math.min(prefs.available_minutes,review?.simplify ? 15 : 25);
  const weeklyGoal = Math.max(0,Math.min(5,data.profile.weekly_exercise_goal));
  const training = [0,3,1,4,5].slice(0,weeklyGoal);
  const restricted = data.profile.needs_professional_guidance || !!data.profile.age && data.profile.age<18 || /孕|哺乳|进食障碍/.test(data.profile.health_notes) || !!prefs.limitations.trim() || review?.pain;
  const days = Array.from({ length: 7 },(_,index) => {
    const date = addDays(start,index); const tasks: PlanTask[] = [];
    for (const [slot,mealType,time] of [[0,"breakfast","08:00"],[1,"lunch","12:30"],[2,"dinner","18:30"],[3,"snack","15:30"]] as const) {
      const options = Array.from({ length: 3 },(_,variant) => mealOption(data,index,slot,variant));
      tasks.push({ id: `${date}:${mealType}`,date,kind: "meal",meal_type: mealType,time,title: { breakfast: "好好吃早餐",lunch: "午餐：主食、蛋白质和蔬菜",dinner: "晚餐：正常吃，不补偿",snack: "按饥饿感安排加餐" }[mealType],amount: options[0].portion,
        duration_min: prefs.cooking === "canteen" ? 15 : 20,intensity: "规律进食",meals: options,
        steps: prefs.cooking === "canteen" ? ["查看可选菜品和过敏原信息，先确认安全食材。","参照份量选择主食、蛋白质和蔬菜，少油并不是不放油。","坐下慢慢吃，按舒适饱足调整；不确定用料时拍照并补充描述。"] : ["按下列重量准备食材，留意干重、熟重和可食部分。","洗净蔬菜；主食蒸煮，蛋白质食材充分煮熟，油适量分配。","坐下进食到舒适饱足，份量可调整；若不饿，加餐可跳过。"],
        why: "把规律三餐和多样食物放在前面，减少临时决定的负担；份量与营养只是粗估。",criteria: "实际吃过并确认份量，或拍照留下这餐；不要求与菜单完全相同。",resources: [resources.food] });
    }
    const isTraining = training.includes(index) && !restricted && prefs.environment !== "seated";
    const strength = isTraining && [0,3].includes(index) && data.profile.exercise_preferences?.includes("力量训练") && prefs.available_minutes >= 10;
    const kind = !isTraining ? "habit" as const : "exercise" as const;
    const duration = !isTraining ? 5 : minutes;
    tasks.push({ id: `${date}:movement`,date,kind,...(isTraining ? { exercise_type: strength ? "力量训练" as const : "步行" as const } : {}),time: "17:30",
      title: restricted ? "恢复日：先确认身体状态" : !isTraining ? "恢复日：轻松活动或休息" : strength ? "基础力量：稳稳完成一轮" : prefs.environment === "home" ? "室内步行，保持能交谈" : "轻快步行，选择平坦路线",
      amount: !isTraining ? "休息优先；舒适时做肩部小幅活动" : strength ? `${duration} 分钟以内；墙壁推起${prefs.equipment === "chair" ? " + 坐站" : ""}` : `${duration} 分钟，可分成两段`,duration_min: duration,intensity: isTraining ? "低至中，不憋气，能自然说话" : "休息或低强度",meals: [],
      steps: !isTraining ? ["先检查睡眠、疲劳和有无疼痛。","不适时不做训练，坐稳后自然呼吸；无不适时肩部轻轻转动，不强行拉伸。","疼痛、头晕或胸闷时停止活动；明显或持续症状及时寻求医疗帮助。"] : strength
        ? ["先轻松走动3分钟热身；确认墙面和地面稳固、不打滑。","离墙约一臂，双手放在胸高，身体保持直线，屈肘靠近墙再缓慢推回，先做5次。",prefs.equipment === "chair" ? "椅子靠墙固定，双脚平放；从椅边缓慢站起再坐回，先做5次，可用手辅助。" : "休息60–90秒，舒适时再做一组墙壁推起，不追求力竭。",`在${duration}分钟内结束，留出2分钟放松；出现不适立即停止。`]
        : [`穿合脚鞋，选室内通道或安全平坦路线，先慢走${duration<=5 ? 2 : 3}分钟。`,`以能自然交谈的速度步行${duration<=5 ? 2 : duration-5}分钟；时间不足可分成两段。`,`最后${duration<=5 ? 1 : 2}分钟放慢；记录实际分钟数，不额外加练来抵消饮食。`],
      why: !isTraining ? "给肌肉、关节和精神留恢复空间，休息也是计划的一部分。" : "从可完成的小剂量开始，并在力量日之间留出恢复时间；没有合适场地的项目不会硬塞进计划。",
      criteria: !isTraining ? "确认身体状态并选择休息或舒适活动即可。" : "按舒适强度执行，填写实际分钟；不适提前停止也应如实记录。",resources: [strength ? resources.strength : resources.walk] });
    tasks.push({ id: `${date}:water`,date,kind: "habit",time: "10:30",title: "白天分次喝水",amount: `参考个人设置约 ${data.profile.water_goal_ml}ml/日，按医嘱和口渴调整`,duration_min: 2,intensity: "分散进行",meals: [],steps: ["早餐后备好水杯。","上午、午餐后和下午按口渴小口饮水，不一次灌完。","有医生限水要求时遵医嘱，不追求杯数；不靠少喝水降体重。"],why: "将饮水融入日常节奏，不将体重短期波动当作需要脱水的信号。",criteria: "今天按口渴及适用的个人医嘱饮水，确认后标记。",resources: [resources.habits] });
    tasks.push({ id: `${date}:sleep`,date,kind: "habit",time: "22:00",title: "为睡眠留出收尾时间",amount: "预留30分钟安静收尾；尽量规律就寝",duration_min: 10,intensity: "放松",meals: [],steps: ["提前处理明早要用的物品，降低睡前匆忙。","调暗灯光，把刺激性的工作和消息放到明天。","若今天很累，明天优先恢复，不因计划未满而晚睡加练。"],why: "作息和恢复支持长期执行；健康习惯不只是体重数字。",criteria: "完成安静收尾并为规律睡眠留出时间，不要求立即入睡。",resources: [resources.habits] });
    return { date,focus: isTraining ? strength ? "力量与规律三餐" : "轻量有氧与日常节奏" : "恢复与规律进食",tasks };
  });
  return { id: `week:${start}`,week_start: start,version: 1,generated_at: new Date().toISOString(),days,notes: safetyNotes(data,date),review_note: review?.feedback || "第一周从轻量、能执行的安排开始，不需要满分。" };
}

export function effectiveTask(data: AppData,task: PlanTask): PlanTask {
  const change = data.task_updates?.find((update) => update.id === task.id);
  const choice = task.meals[change?.meal_choice || 0] || task.meals[0];
  const result = { ...task,date: change?.scheduled_date || task.date,time: change?.scheduled_time || task.time,title: change?.title || task.title,amount: change?.amount || choice?.portion || task.amount,duration_min: change?.duration_min || task.duration_min };
  if (task.id.endsWith(":movement") && change?.recovery) return { ...result,kind: "habit",exercise_type: undefined,title: "今天改为恢复",duration_min: 5,amount: "完全休息，或无不适时做舒适的日常活动",intensity: "休息",steps: ["先确认身体状态，暂停原训练。","优先休息；不适时不做动作，持续或明显不适需专业评估。","不把休息当作欠下的训练，不补做。"],criteria: "确认身体情况并采取恢复安排。" };
  if (task.kind==="exercise" && result.duration_min!==task.duration_min) result.steps = [...task.steps.slice(0,-1),`按调整后的总时长${result.duration_min}分钟安排，始终保留热身与放松；时间不足时减少训练部分，不额外加速。`];
  const recommendation = exerciseSuggestion(data,result.date);
  if (result.kind === "exercise" && taskState(data,result)!=="completed" && /休息|恢复/.test(recommendation.activity)) return { ...result,kind: "habit",exercise_type: undefined,title: "状态变化：今天优先恢复",amount: recommendation.duration,duration_min: 5,intensity: "休息或低强度",why: recommendation.reason,steps: ["暂停原定训练，先确认有无不适。","疲劳时可以完全休息；无不适时才考虑轻松活动。","明显或持续不适及时求助专业人员，不补做训练。"],criteria: "如实确认身体情况并采取恢复安排即可。" };
  return result;
}
function tasksForRange(data: AppData,start: string,end: string) { return (data.plans || []).flatMap((week) => week.days.flatMap((day) => day.tasks)).map((task) => effectiveTask(data,task)).filter((task) => task.date >= start && task.date <= end); }
export function tasksForDate(data: AppData,date: string) { return tasksForRange(data,date,date).sort((a,b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id)); }
export function selectedPlanMeal(data: AppData,task: PlanTask) { return task.meals[data.task_updates?.find((update) => update.id === task.id)?.meal_choice || 0] || task.meals[0]; }
export function taskState(data: AppData,task: PlanTask): TaskUpdate["status"] {
  if (task.kind === "meal" && data.meals.some((record) => (record.plan_task_id === task.id || record.record_date === task.date && record.meal_type === task.meal_type) && (record.food_name!=="待识别餐食" || record.images.length>0))) return "completed";
  if (task.kind === "exercise" && data.exercises.filter((record) => record.record_date === task.date && (record.plan_task_id === task.id || record.exercise_type === task.exercise_type)).reduce((sum,record) => sum+record.duration_min,0)>=task.duration_min) return "completed";
  return data.task_updates?.find((update) => update.id === task.id)?.status || "pending";
}
export function taskMealNutrition(meal: PlanMeal): MealNutrition { return { calories_min: meal.calories_min,calories_max: meal.calories_max,protein_g: meal.protein_g,fat_g: meal.fat_g,carbohydrate_g: meal.carbohydrate_g,portion_g: null,source: "manual" }; }
export function nextActionAdvice(data: AppData,date: string) {
  const meals = data.meals.filter((record) => record.record_date === date);
  const total = dailyNutrition(meals); const targets = calculateNutritionTargets(data.profile).targets;
  const candidates = tasksForDate(data,date).filter((task) => task.kind === "meal" && taskState(data,task)!=="completed" && taskState(data,task)!=="skipped");
  const now = new Date(); const time = date===todayString() ? `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}` : "00:00";
  const next = candidates.find((task) => task.time>=time) || candidates.at(-1);
  const customAmount = data.task_updates?.find((update) => update.id===next?.id)?.amount;
  let suggestion = next ? selectedPlanMeal(data,next) : null;
  let adjustment = "";
  if (next && !customAmount && !total.unknown && total.recorded>0 && targets) {
    const options = next.meals.filter((meal) => !meal.needs_confirmation);
    if (total.protein_g<targets.protein_g*0.6 && options.length) { suggestion = [...options].sort((a,b) => b.protein_g-a.protein_g)[0]; adjustment = "蛋白质摄入估算还偏少，下一餐优先以下组合，主食和蔬菜照常保留。"; }
    else if (total.fat_g>targets.fat_g*0.8 && options.length) { suggestion = [...options].sort((a,b) => a.fat_g-b.fat_g)[0]; adjustment = "下一餐可选较清淡的烹调组合，不删除主食或整餐。"; }
  }
  const reasons = total.unknown ? `还有${total.unknown}餐营养不完整，先确认份量，不把空白当成没吃。` : targets && total.calories_max > targets.calories ? "今天的估算可能高于目标，下一餐仍正常吃，不跳餐、不额外加练。" : "按饥饿感正常吃，食物可替换，优先规律。";
  return { title: next ? `下一餐 · ${next.time}` : "今天的饮食安排已处理",food: customAmount || suggestion?.portion || "如果仍饿，可以安排正常加餐；无需为了完成度额外吃一餐。",reason: `${reasons}${customAmount ? "已按手动调整显示，请确认实际营养，不沿用原份量估计。" : adjustment}`,exercise: exerciseSuggestion(data,date) };
}

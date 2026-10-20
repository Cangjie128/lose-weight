import { z } from "zod";
import { addDays, type AppData } from "./fat-loss.ts";
import { calculateNutritionTargets, dailyNutrition } from "./nutrition.ts";

export const summaryColumns = ["date", "weight_kg", "meals", "calories_min", "calories_max", "protein_g", "fat_g", "carbohydrate_g", "unknown_meals", "exercise_minutes", "exercise_sessions", "calorie_target", "protein_target_g", "fat_target_g", "carbohydrate_target_g"];

// External data is an allowlist, never a serialized copy of the health records.
export function dailyDigest(data: AppData, date: string) {
  const meals = data.meals.filter((record) => record.record_date === date);
  const exercises = data.exercises.filter((record) => record.record_date === date);
  const weight = data.weights.find((record) => record.record_date === date)?.weight_kg ?? null;
  const historicalWeight = [...data.weights].filter((record) => record.record_date <= date).sort((a,b) => b.record_date.localeCompare(a.record_date))[0]?.weight_kg;
  const targets = calculateNutritionTargets({ ...data.profile, current_weight_kg: historicalWeight ?? data.profile.current_weight_kg }).targets;
  return {
    date, weight_kg: weight, meals: meals.length, ...dailyNutrition(meals),
    exercise_minutes: exercises.reduce((sum,record) => sum + record.duration_min,0), exercise_sessions: exercises.length,
    targets,
  };
}

export function summaryRows(data: AppData) {
  const dates = [...new Set([...data.weights,...data.meals,...data.exercises].map((record) => record.record_date))].sort();
  if (dates.length > 10000) throw new Error("摘要超过 10000 天，未截断或写入 Google Sheets。");
  return [summaryColumns, ...dates.map((date) => {
    const day = dailyDigest(data,date);
    return [date,day.weight_kg ?? "",day.meals,day.calories_min,day.calories_max,day.protein_g,day.fat_g,day.carbohydrate_g,day.unknown,day.exercise_minutes,day.exercise_sessions,
      day.targets?.calories ?? "",day.targets?.protein_g ?? "",day.targets?.fat_g ?? "",day.targets?.carbohydrate_g ?? ""];
  })];
}

export const readToolSchemas = {
  daily_records: z.object({ date: z.iso.date() }).strict(),
  seven_day_nutrition: z.object({ end_date: z.iso.date() }).strict(),
  weight_trend: z.object({ end_date: z.iso.date(), days: z.number().int().min(1).max(365).default(30) }).strict(),
  exercise_history: z.object({ end_date: z.iso.date(), days: z.number().int().min(1).max(90).default(7) }).strict(),
};
export type ReadTool = keyof typeof readToolSchemas;
export function queryReadTool(data: AppData, name: ReadTool, args: unknown) {
  if (!(name in readToolSchemas)) throw new Error("不支持此只读查询，不允许修改或删除数据。");
  const parsed = readToolSchemas[name].parse(args);
  if (name === "daily_records" && "date" in parsed) return dailyDigest(data,parsed.date);
  if (!("end_date" in parsed)) throw new Error("查询日期无效。");
  const end = parsed.end_date;
  const days = "days" in parsed && typeof parsed.days === "number" ? parsed.days : 7;
  const start = addDays(end,1-days);
  if (name === "seven_day_nutrition") return Array.from({ length: 7 },(_,index) => dailyDigest(data,addDays(start,index)));
  if (name === "weight_trend") return data.weights.filter((record) => record.record_date >= start && record.record_date <= end)
    .map((record) => ({ date: record.record_date, weight_kg: record.weight_kg })).sort((a,b) => a.date.localeCompare(b.date));
  return data.exercises.filter((record) => record.record_date >= start && record.record_date <= end)
    .map((record) => ({ date: record.record_date, activity: record.exercise_type, duration_min: record.duration_min, intensity: record.intensity }))
    .sort((a,b) => a.date.localeCompare(b.date));
}

"use client";
import { useState } from "react";
import { Activity, Save, Utensils } from "lucide-react";
import type { AppData, MealNutrition } from "@/lib/fat-loss";
import { calculateNutritionTargets, dailyNutrition, exerciseSuggestion, nextMealSuggestion } from "@/lib/nutrition";
import { mealNutritionSchema } from "@/lib/schemas";

export function NutritionOverview({ data, date }: { data: AppData; date: string }) {
  const meals = data.meals.filter((meal) => meal.record_date === date);
  const intake = dailyNutrition(meals);
  const { targets, explanation } = calculateNutritionTargets(data.profile);
  const exercise = exerciseSuggestion(data, date);
  return (
    <section className="border-y border-[#eadfcf] bg-white/70 px-4 py-5">
      <h3 className="flex items-center gap-2 text-lg font-bold"><Utensils className="h-5 w-5 text-[#4f8d5f]" />每日营养与恢复</h3>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-[#667165]">热量目标 <strong className="text-[#25342f]">{targets ? `${targets.calories} kcal` : "未设置"}</strong></p>
        <p className="font-semibold">已摄入估计 {Math.round(intake.calories_min)}–{Math.round(intake.calories_max)} kcal</p>
      </div>
      <p className="mt-1 text-xs text-[#667165]">{explanation}{intake.unknown > 0 ? ` 还有 ${intake.unknown} 餐营养未完整填写，当前合计不代表全天摄入。` : ""}</p>
      <p className="mt-1 text-xs text-[#667165]">营养累计只基于已确认的饮食记录；任务打勾不会虚构摄入，空白不代表没有吃。</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {[
          { label: "蛋白质", value: intake.protein_g, goal: targets?.protein_g, color: "#438e74" },
          { label: "脂肪", value: intake.fat_g, goal: targets?.fat_g, color: "#c98548" },
          { label: "碳水", value: intake.carbohydrate_g, goal: targets?.carbohydrate_g, color: "#548db4" },
        ].map((item) => <div key={item.label}>
          <div className="mb-2 flex justify-between gap-2 text-sm"><span>{item.label}</span><span>{item.value.toFixed(1)} / {item.goal ?? "未设置"} g</span></div>
          <progress aria-label={`${item.label}摄入进度`} value={item.value} max={item.goal || 1} className="h-2 w-full" style={{ accentColor: item.color }} />
        </div>)}
      </div>
      <div className="mt-5 grid gap-4 border-t border-[#eadfcf] pt-4 md:grid-cols-2">
        <div><h4 className="text-sm font-bold">下一餐建议</h4><p className="mt-2 text-sm leading-6 text-[#667165]">{nextMealSuggestion(meals, targets)}</p></div>
        <div><h4 className="flex items-center gap-1 text-sm font-bold"><Activity className="h-4 w-4" />当天运动建议</h4><p className="mt-2 text-sm font-medium">{exercise.activity} · {exercise.duration}</p><p className="mt-1 text-sm leading-6 text-[#667165]">强度：{exercise.intensity}。{exercise.reason}</p></div>
      </div>
    </section>
  );
}

type Draft = Record<"calories_min" | "calories_max" | "protein_g" | "fat_g" | "carbohydrate_g" | "portion_g", number | null>;
const emptyDraft: Draft = { calories_min: null, calories_max: null, protein_g: null, fat_g: null, carbohydrate_g: null, portion_g: null };
export function MealNutritionEditor({ nutrition, onSave }: { nutrition?: MealNutrition | null; onSave: (value: MealNutrition) => Promise<boolean> }) {
  const [draft, setDraft] = useState<Draft>(nutrition || emptyDraft);
  const [error, setError] = useState("");
  const [source,setSource] = useState(nutrition);
  if (source !== nutrition) { setSource(nutrition); setDraft(nutrition || emptyDraft); }
  async function save() {
    const result = mealNutritionSchema.safeParse({ ...draft, source: "manual" });
    if (!result.success) { setError("请填写热量范围、蛋白质、脂肪和碳水；上限应不低于下限，重量可留空。"); return; }
    if (await onSave(result.data)) setError("");
  }
  return (
    <details className="mt-4 border-t border-[#eadfcf] pt-3" open={Boolean(nutrition)}>
      <summary className="cursor-pointer text-sm font-bold">营养数值与食物重量{nutrition ? ` · ${nutrition.calories_min}–${nutrition.calories_max} kcal` : " · 未填写"}</summary>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {([
          ["portion_g", "食物重量 g（可选）"], ["calories_min", "热量下限 kcal"], ["calories_max", "热量上限 kcal"],
          ["protein_g", "蛋白质 g"], ["fat_g", "脂肪 g"], ["carbohydrate_g", "碳水 g"],
        ] as const).map(([key,label]) => <label key={key} className="text-sm">{label}<input type="number" min="0" step="0.1" value={draft[key] ?? ""} onChange={(event) => setDraft({ ...draft, [key]: event.target.value === "" ? null : Number(event.target.value) })} className="mt-1 w-full rounded-md border border-[#ded2be] bg-white px-3 py-2" /></label>)}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
      <button onClick={() => void save()} className="mt-3 flex min-h-10 items-center gap-2 rounded-md bg-[#4f8d5f] px-3 py-2 text-sm font-semibold text-white"><Save className="h-4 w-4" />保存营养数值</button>
    </details>
  );
}

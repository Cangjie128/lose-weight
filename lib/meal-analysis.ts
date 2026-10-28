import type { MealNutrition } from "./fat-loss.ts";
import type { MealAnalysis, MealFoodItem } from "./schemas.ts";

const numericKeys = ["calories_min", "calories_max", "protein_g", "fat_g", "carbohydrate_g"] as const;

function itemIsComplete(item: MealFoodItem) {
  return item.portion_status === "estimated"
    && item.portion_description.trim().length > 0
    && numericKeys.every((key) => item[key] !== null)
    && item.calories_max! >= item.calories_min!;
}

export function nutritionFromAnalysis(analysis: MealAnalysis): MealNutrition | null {
  if (analysis.recognition_status !== "recognized") return null;
  const values = [analysis.estimated_calories_min, analysis.estimated_calories_max, analysis.protein_g, analysis.fat_g, analysis.carbohydrate_g];
  if (values.some((value) => value === null) || analysis.estimated_calories_max! < analysis.estimated_calories_min!) return null;
  return {
    calories_min: analysis.estimated_calories_min!,
    calories_max: analysis.estimated_calories_max!,
    protein_g: analysis.protein_g!,
    fat_g: analysis.fat_g!,
    carbohydrate_g: analysis.carbohydrate_g!,
    portion_g: analysis.estimated_portion_g,
    source: "ai",
  };
}

export function recalculateMealAnalysis(analysis: MealAnalysis): MealAnalysis {
  const items = analysis.food_items;
  if (!items.length || items.some((item) => !itemIsComplete(item))) {
    return {
      ...analysis,
      foods: items.length ? items.map((item) => item.name) : analysis.foods,
      recognition_status: "needs_info",
      estimated_calories_min: null,
      estimated_calories_max: null,
      estimated_portion_g: null,
      protein_g: null,
      fat_g: null,
      carbohydrate_g: null,
      uncertainty_note: "部分食物或份量仍待确认，整餐营养暂不累计；请补充份量或重新分析。",
    };
  }
  const total = items.reduce((sum, item) => ({
    calories_min: sum.calories_min + item.calories_min!,
    calories_max: sum.calories_max + item.calories_max!,
    protein_g: sum.protein_g + item.protein_g!,
    fat_g: sum.fat_g + item.fat_g!,
    carbohydrate_g: sum.carbohydrate_g + item.carbohydrate_g!,
    portion_g: sum.portion_g + (item.estimated_portion_g ?? 0),
  }), { calories_min: 0, calories_max: 0, protein_g: 0, fat_g: 0, carbohydrate_g: 0, portion_g: 0 });
  return {
    ...analysis,
    foods: items.map((item) => item.name),
    recognition_status: "recognized",
    estimated_calories_min: Number(total.calories_min.toFixed(1)),
    estimated_calories_max: Number(total.calories_max.toFixed(1)),
    estimated_portion_g: items.every((item) => item.estimated_portion_g !== null) ? Number(total.portion_g.toFixed(1)) : null,
    protein_g: Number(total.protein_g.toFixed(1)),
    fat_g: Number(total.fat_g.toFixed(1)),
    carbohydrate_g: Number(total.carbohydrate_g.toFixed(1)),
  };
}

export function invalidateChangedAnalysis(analysis: MealAnalysis | null) {
  if (!analysis) return null;
  return {
    ...analysis,
    recognition_status: "needs_info" as const,
    estimated_calories_min: null,
    estimated_calories_max: null,
    estimated_portion_g: null,
    protein_g: null,
    fat_g: null,
    carbohydrate_g: null,
    uncertainty_note: "食物名称或份量已修改，原 AI 估算已失效；请重新分析或手动填写整餐营养。",
  };
}

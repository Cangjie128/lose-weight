import { z } from "zod";

export const mealAnalysisSchema = z.object({
  foods: z.array(z.string()).default([]),
  estimated_calories_min: z.number().min(0),
  estimated_calories_max: z.number().min(0),
  protein_level: z.enum(["偏低", "基本够", "较充足"]),
  carbohydrate_level: z.enum(["偏低", "适中", "偏高"]),
  fat_level: z.enum(["偏低", "适中", "偏高"]),
  vegetable_level: z.enum(["不足", "基本够", "充足"]),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  next_meal_suggestion: z.string(),
  uncertainty_note: z.string(),
});

export const dailySummarySchema = z.object({
  weight_interpretation: z.string(),
  nutrition_summary: z.string(),
  exercise_summary: z.string(),
  positive_feedback: z.string(),
  priority_improvement: z.string(),
  tomorrow_meal_plan: z.string(),
  tomorrow_training_plan: z.string(),
  encouragement: z.string(),
  safety_warning: z.string(),
});

export type MealAnalysis = z.infer<typeof mealAnalysisSchema>;
export type DailySummary = z.infer<typeof dailySummarySchema>;

export const mealAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "foods",
    "estimated_calories_min",
    "estimated_calories_max",
    "protein_level",
    "carbohydrate_level",
    "fat_level",
    "vegetable_level",
    "strengths",
    "improvements",
    "next_meal_suggestion",
    "uncertainty_note",
  ],
  properties: {
    foods: { type: "array", items: { type: "string" } },
    estimated_calories_min: { type: "number", minimum: 0 },
    estimated_calories_max: { type: "number", minimum: 0 },
    protein_level: { type: "string", enum: ["偏低", "基本够", "较充足"] },
    carbohydrate_level: { type: "string", enum: ["偏低", "适中", "偏高"] },
    fat_level: { type: "string", enum: ["偏低", "适中", "偏高"] },
    vegetable_level: { type: "string", enum: ["不足", "基本够", "充足"] },
    strengths: { type: "array", items: { type: "string" } },
    improvements: { type: "array", items: { type: "string" } },
    next_meal_suggestion: { type: "string" },
    uncertainty_note: { type: "string" },
  },
} as const;

export const dailySummaryJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "weight_interpretation",
    "nutrition_summary",
    "exercise_summary",
    "positive_feedback",
    "priority_improvement",
    "tomorrow_meal_plan",
    "tomorrow_training_plan",
    "encouragement",
    "safety_warning",
  ],
  properties: {
    weight_interpretation: { type: "string" },
    nutrition_summary: { type: "string" },
    exercise_summary: { type: "string" },
    positive_feedback: { type: "string" },
    priority_improvement: { type: "string" },
    tomorrow_meal_plan: { type: "string" },
    tomorrow_training_plan: { type: "string" },
    encouragement: { type: "string" },
    safety_warning: { type: "string" },
  },
} as const;

export function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as {
    output_text?: string;
    output?: Array<{
      content?: Array<{ text?: string; type?: string }>;
    }>;
  };

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const parts: string[] = [];
  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

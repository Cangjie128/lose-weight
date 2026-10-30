import { z } from "zod";
import type { AppData } from "./fat-loss";
import { planningPreferencesSchema, taskUpdateSchema, weekPlanSchema } from "./plan-types.ts";

export const mealFoodItemSchema = z.object({
  name: z.string().min(1).max(200),
  portion_description: z.string().max(300),
  estimated_portion_g: z.number().nonnegative().nullable(),
  portion_status: z.enum(["estimated", "needs_confirmation"]),
  calories_min: z.number().nonnegative().nullable(),
  calories_max: z.number().nonnegative().nullable(),
  protein_g: z.number().nonnegative().nullable(),
  fat_g: z.number().nonnegative().nullable(),
  carbohydrate_g: z.number().nonnegative().nullable(),
});

export const mealAnalysisSchema = z.object({
  foods: z.array(z.string()).default([]),
  food_items: z.array(mealFoodItemSchema).default([]),
  estimated_calories_min: z.number().min(0).nullable(),
  estimated_calories_max: z.number().min(0).nullable(),
  estimated_portion_g: z.number().nonnegative().nullable().default(null),
  protein_g: z.number().nonnegative().nullable().default(null),
  fat_g: z.number().nonnegative().nullable().default(null),
  carbohydrate_g: z.number().nonnegative().nullable().default(null),
  recognition_status: z.enum(["recognized", "needs_info"]).default("recognized"),
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
export type MealFoodItem = z.infer<typeof mealFoodItemSchema>;
export type DailySummary = z.infer<typeof dailySummarySchema>;

export const nutritionTargetsSchema = z.object({
  calories: z.number().min(1500).max(5000),
  protein_g: z.number().min(30).max(250),
  fat_g: z.number().min(25).max(200),
  carbohydrate_g: z.number().min(100).max(700),
});

export const mealNutritionSchema = z.object({
  calories_min: z.number().nonnegative().max(10000),
  calories_max: z.number().nonnegative().max(10000),
  protein_g: z.number().nonnegative().max(1000),
  fat_g: z.number().nonnegative().max(1000),
  carbohydrate_g: z.number().nonnegative().max(2000),
  portion_g: z.number().positive().max(10000).nullable(),
  source: z.enum(["manual", "ai"]),
}).refine((value) => value.calories_max >= value.calories_min, "热量上限不能低于下限。");

const recordSchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  record_date: z.iso.date(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

const tasksSchema = z.object({
  weighed: z.boolean().default(false),
  breakfast: z.boolean().default(false),
  lunch: z.boolean().default(false),
  dinner: z.boolean().default(false),
  exercise: z.boolean().default(false),
  protein: z.boolean().default(false),
  vegetables: z.boolean().default(false),
  water: z.boolean().default(false),
  summary: z.boolean().default(false),
});

export const appDataSchema = z.object({
  profile: recordSchema.extend({
    gender: z.string(),
    height_cm: z.number(),
    current_weight_kg: z.number(),
    starting_weight_kg: z.number(),
    target_weight_kg: z.number(),
    challenge_start_date: z.iso.date(),
    challenge_end_date: z.iso.date(),
    weekly_exercise_goal: z.number(),
    water_goal_ml: z.number(),
    diet_preferences: z.string(),
    disliked_foods: z.string(),
    health_notes: z.string(),
    is_menstrual_period: z.boolean(),
    ai_enabled: z.boolean(),
    ai_model: z.string(),
    age: z.number().int().min(1).max(120).nullable().default(null),
    activity_level: z.enum(["sedentary", "light", "moderate", "active"]).default("light"),
    exercise_preferences: z.array(z.enum(["跑步", "游泳", "步行", "羽毛球", "力量训练", "其他"])).default(["步行", "力量训练"]),
    nutrition_targets: nutritionTargetsSchema.nullable().default(null),
    needs_professional_guidance: z.boolean().default(false),
    planning: planningPreferencesSchema.default(() => planningPreferencesSchema.parse({})),
    profile_confirmed_at: z.iso.datetime().optional(),
  }),
  challenge: recordSchema.extend({
    start_date: z.iso.date(),
    end_date: z.iso.date(),
    start_weight_kg: z.number(),
    target_weight_kg: z.number(),
    weekly_exercise_goal: z.number(),
    water_goal_ml: z.number(),
    status: z.enum(["active", "archived"]),
  }),
  weights: z.array(recordSchema.extend({
    weight_kg: z.number().positive(),
    note: z.string(),
    high_salt: z.boolean(),
    late_dinner: z.boolean(),
    menstrual_period: z.boolean(),
    bowel_movement: z.boolean(),
    poor_sleep: z.boolean(),
    hard_training_previous_day: z.boolean(),
    weighing_period: z.enum(["morning_fasting", "daytime", "evening_after_meal", "other"]).optional(),
    weighed_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    food_state: z.enum(["fasting", "before_meal", "after_meal", "unspecified"]).optional(),
    bowel_state: z.enum(["before", "after", "unspecified"]).optional(),
  })),
  meals: z.array(recordSchema.extend({
    meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    food_name: z.string(),
    portion: z.string(),
    notes: z.string(),
    ai_analysis: mealAnalysisSchema.nullable(),
    nutrition: mealNutritionSchema.nullable().default(null),
    plan_task_id: z.string().optional(),
    images: z.array(recordSchema.extend({
      meal_record_id: z.string().min(1),
      storage_path: z.string().min(1),
      signed_url: z.string().optional(),
      file_name: z.string().optional(),
      size_bytes: z.number().nonnegative().optional(),
      mime_type: z.string().optional(),
      sha256: z.string().optional(),
    })),
  })),
  exercises: z.array(recordSchema.extend({
    plan_task_id: z.string().optional(),
    exercise_type: z.enum(["跑步", "游泳", "步行", "羽毛球", "力量训练", "其他"]),
    duration_min: z.number().nonnegative(),
    distance_km: z.number().nonnegative().nullable(),
    intensity: z.enum(["低", "中", "高"]),
    calories_burned: z.number().nonnegative().nullable(),
    feeling: z.string(),
    has_discomfort: z.boolean(),
    discomfort_detail: z.string(),
  })),
  checkins: z.array(recordSchema.extend({
    tasks: tasksSchema,
    water_ml: z.number().nonnegative(),
    sleep_hours: z.number().nonnegative().nullable(),
    body_feeling: z.string(),
    bowel_movement: z.boolean(),
    menstrual_period: z.boolean(),
    completion_score: z.number(),
    fatigue_level: z.number().min(0).max(10).default(0),
  }).transform((checkin) => ({
    ...checkin,
    completion_score: Math.round(
      Object.values(checkin.tasks).filter(Boolean).length / 9 * 100,
    ),
  }))),
  summaries: z.array(recordSchema.extend({
    summary: dailySummarySchema,
    source_snapshot: z.unknown(),
  })),
  plans: z.array(weekPlanSchema).default([]),
  task_updates: z.array(taskUpdateSchema).default([]),
  coach_events: z.array(z.object({ id:z.string(),record_date:z.iso.date(),created_at:z.iso.datetime(),cause:z.enum(["weight","meal","recovery","profile"]),message:z.string(),targets:nutritionTargetsSchema.nullable() })).default([]),
});

const backupSchema = z.object({
  app: z.literal("gentle-fat-loss-coach"),
  version: z.literal(1),
  exported_at: z.iso.datetime(),
  data: appDataSchema,
});

export function createDataBackup(data: AppData) {
  const validated = appDataSchema.parse(data);
  return {
    app: "gentle-fat-loss-coach" as const,
    version: 1 as const,
    exported_at: new Date().toISOString(),
    data: {
      ...validated,
      meals: validated.meals.map((meal) => ({
        ...meal,
        images: meal.images.map((image) => ({ ...image, signed_url: undefined })),
      })),
    },
  };
}

export function parseDataBackup(value: unknown): AppData {
  const result = backupSchema.safeParse(value);
  if (!result.success) {
    throw new Error("备份文件格式或版本不正确，原有记录未修改。");
  }
  return result.data.data;
}

export function mergeBackupData(current: AppData, incoming: AppData): AppData {
  const userId = current.profile.user_id;
  function merge<T extends { id: string; user_id: string; record_date: string }>(
    existing: T[],
    restored: T[],
    byDate = false,
  ): T[] {
    const records = new Map<string, T>();
    for (const record of [...existing, ...restored]) {
      records.set(byDate ? record.record_date : record.id, { ...record, user_id: userId });
    }
    return [...records.values()].sort((a, b) => a.record_date.localeCompare(b.record_date));
  }
  const meals = merge(current.meals, incoming.meals).map((meal) => {
    const previous = current.meals.find((item) => item.id === meal.id);
    return {
      ...meal,
      images: merge(previous?.images ?? [], meal.images).map((image) => ({
        ...image,
        meal_record_id: meal.id,
        signed_url: image.storage_path.startsWith("data:image/")
          ? image.storage_path
          : undefined,
      })),
    };
  });
  return {
    profile: { ...incoming.profile, id: current.profile.id, user_id: userId },
    challenge: { ...incoming.challenge, id: current.challenge.id, user_id: userId },
    weights: merge(current.weights, incoming.weights),
    meals,
    exercises: merge(current.exercises, incoming.exercises),
    checkins: merge(current.checkins, incoming.checkins, true),
    summaries: merge(current.summaries, incoming.summaries, true),
    plans: [...new Map([...(current.plans || []),...(incoming.plans || [])].map((plan) => [plan.id,plan])).values()].sort((a,b) => a.week_start.localeCompare(b.week_start)),
    task_updates: merge(current.task_updates || [],incoming.task_updates || []),
    coach_events: [...new Map([...(current.coach_events || []),...(incoming.coach_events || [])].map((event) => [event.id,event])).values()].sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
  };
}

export const mealAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "foods",
    "food_items",
    "estimated_calories_min",
    "estimated_calories_max",
    "estimated_portion_g", "protein_g", "fat_g", "carbohydrate_g", "recognition_status",
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
    food_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "portion_description", "estimated_portion_g", "portion_status", "calories_min", "calories_max", "protein_g", "fat_g", "carbohydrate_g"],
        properties: {
          name: { type: "string" },
          portion_description: { type: "string" },
          estimated_portion_g: { type: ["number", "null"], minimum: 0 },
          portion_status: { type: "string", enum: ["estimated", "needs_confirmation"] },
          calories_min: { type: ["number", "null"], minimum: 0 },
          calories_max: { type: ["number", "null"], minimum: 0 },
          protein_g: { type: ["number", "null"], minimum: 0 },
          fat_g: { type: ["number", "null"], minimum: 0 },
          carbohydrate_g: { type: ["number", "null"], minimum: 0 },
        },
      },
    },
    estimated_calories_min: { type: ["number", "null"], minimum: 0 },
    estimated_calories_max: { type: ["number", "null"], minimum: 0 },
    estimated_portion_g: { type: ["number", "null"], minimum: 0 },
    protein_g: { type: ["number", "null"], minimum: 0 },
    fat_g: { type: ["number", "null"], minimum: 0 },
    carbohydrate_g: { type: ["number", "null"], minimum: 0 },
    recognition_status: { type: "string", enum: ["recognized", "needs_info"] },
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

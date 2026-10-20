import { z } from "zod";
import { addDays } from "./fat-loss.ts";

export const planningPreferencesSchema = z.object({
  diet: z.enum(["balanced","vegetarian","vegan"]).default("balanced"),
  cooking: z.enum(["home","canteen"]).default("home"),
  environment: z.enum(["home","outdoor","gym","seated"]).default("home"),
  equipment: z.enum(["none","chair","dumbbells"]).default("chair"),
  available_minutes: z.number().int().min(5).max(90).default(25),
  allergies: z.string().max(1000).default(""),
  limitations: z.string().max(1000).default(""),
});
export const planMealSchema = z.object({
  title: z.string(),portion: z.string(),ingredients: z.array(z.string()),
  calories_min: z.number().nonnegative(),calories_max: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),fat_g: z.number().nonnegative(),carbohydrate_g: z.number().nonnegative(),
  needs_confirmation: z.boolean().default(false),
});
export const planTaskSchema = z.object({
  id: z.string(),date: z.iso.date(),kind: z.enum(["meal","exercise","habit"]),
  meal_type: z.enum(["breakfast","lunch","dinner","snack"]).optional(),
  exercise_type: z.enum(["步行","力量训练","其他"]).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),title: z.string().min(1).max(200),
  amount: z.string().max(1000),duration_min: z.number().int().min(0).max(120),
  intensity: z.string(),steps: z.array(z.string()).min(1),why: z.string(),criteria: z.string(),
  resources: z.array(z.object({ title: z.string(),url: z.url().refine((value) => new URL(value).protocol === "https:") })).min(1),
  meals: z.array(planMealSchema).default([]),
});
export const weekPlanSchema = z.object({
  id: z.string(),week_start: z.iso.date(),generated_at: z.string(),version: z.literal(1),
  notes: z.array(z.string()),review_note: z.string().default(""),
  days: z.array(z.object({ date: z.iso.date(),focus: z.string(),tasks: z.array(planTaskSchema).min(1) })).length(7),
}).refine((week) => new Date(`${week.week_start}T12:00:00`).getDay()===1 && week.days.every((day,index) => day.date===addDays(week.week_start,index) && day.tasks.every((task) => task.date===day.date)) && new Set(week.days.flatMap((day) => day.tasks.map((task) => task.id))).size===week.days.reduce((sum,day) => sum+day.tasks.length,0),"周计划日期或任务 ID 无效。");
export const taskUpdateSchema = z.object({
  id: z.string(),user_id: z.string(),record_date: z.iso.date(),
  status: z.enum(["pending","completed","skipped","later"]).default("pending"),
  scheduled_date: z.iso.date().optional(),scheduled_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  title: z.string().min(1).max(200).optional(),amount: z.string().min(1).max(1000).optional(),
  duration_min: z.number().int().min(1).max(90).optional(),
  meal_choice: z.number().int().min(0).max(2).default(0),
  recovery: z.boolean().default(false),
  note: z.string().max(1000).default(""),updated_at: z.string(),
});
export type PlanningPreferences = z.infer<typeof planningPreferencesSchema>;
export type WeekPlan = z.infer<typeof weekPlanSchema>;
export type PlanTask = z.infer<typeof planTaskSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
export type PlanMeal = z.infer<typeof planMealSchema>;

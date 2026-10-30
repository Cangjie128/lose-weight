import type { DailySummary, MealAnalysis } from "./schemas";
import type { PlanningPreferences, TaskUpdate, WeekPlan } from "./plan-types";
import { addDays as shiftDays, differenceInCalendarDays, format, parseISO } from "date-fns";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type ExerciseType =
  | "跑步"
  | "游泳"
  | "步行"
  | "羽毛球"
  | "力量训练"
  | "其他";

export type TaskKey =
  | "weighed"
  | "breakfast"
  | "lunch"
  | "dinner"
  | "exercise"
  | "protein"
  | "vegetables"
  | "water"
  | "summary";

export const mealTypeLabels: Record<MealType, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};

export const taskLabels: Record<TaskKey, string> = {
  weighed: "已称体重",
  breakfast: "已记录早餐",
  lunch: "已记录午餐",
  dinner: "已记录晚餐",
  exercise: "已记录运动",
  protein: "蛋白质基本达标",
  vegetables: "蔬菜基本达标",
  water: "今日饮水达标",
  summary: "完成今日总结",
};

export const taskKeys = Object.keys(taskLabels) as TaskKey[];

export const exerciseTypes: ExerciseType[] = [
  "跑步",
  "游泳",
  "步行",
  "羽毛球",
  "力量训练",
  "其他",
];

export type DailyTasks = Record<TaskKey, boolean>;

export type Profile = {
  id: string;
  user_id: string;
  record_date: string;
  gender: string;
  height_cm: number;
  current_weight_kg: number;
  starting_weight_kg: number;
  target_weight_kg: number;
  challenge_start_date: string;
  challenge_end_date: string;
  weekly_exercise_goal: number;
  water_goal_ml: number;
  diet_preferences: string;
  disliked_foods: string;
  health_notes: string;
  is_menstrual_period: boolean;
  ai_enabled: boolean;
  ai_model: string;
  age?: number | null;
  activity_level?: "sedentary" | "light" | "moderate" | "active";
  exercise_preferences?: ExerciseType[];
  nutrition_targets?: NutritionTargets | null;
  needs_professional_guidance?: boolean;
  planning?: PlanningPreferences;
  profile_confirmed_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type NutritionTargets = { calories: number; protein_g: number; fat_g: number; carbohydrate_g: number };
export type MealNutrition = {
  calories_min: number;
  calories_max: number;
  protein_g: number;
  fat_g: number;
  carbohydrate_g: number;
  portion_g: number | null;
  source: "manual" | "ai";
};

export type Challenge = {
  id: string;
  user_id: string;
  record_date: string;
  start_date: string;
  end_date: string;
  start_weight_kg: number;
  target_weight_kg: number;
  weekly_exercise_goal: number;
  water_goal_ml: number;
  status: "active" | "archived";
  created_at?: string;
  updated_at?: string;
};

export type WeightRecord = {
  id: string;
  user_id: string;
  record_date: string;
  weight_kg: number;
  note: string;
  high_salt: boolean;
  late_dinner: boolean;
  menstrual_period: boolean;
  bowel_movement: boolean;
  poor_sleep: boolean;
  hard_training_previous_day: boolean;
  weighing_period?: "morning_fasting" | "daytime" | "evening_after_meal" | "other";
  weighed_at?: string;
  food_state?: "fasting" | "before_meal" | "after_meal" | "unspecified";
  bowel_state?: "before" | "after" | "unspecified";
  created_at?: string;
  updated_at?: string;
};

export type MealImage = {
  id: string;
  user_id: string;
  record_date: string;
  meal_record_id: string;
  storage_path: string;
  signed_url?: string;
  file_name?: string;
  size_bytes?: number;
  mime_type?: string;
  sha256?: string;
  created_at?: string;
  updated_at?: string;
};

export type MealRecord = {
  id: string;
  user_id: string;
  record_date: string;
  meal_type: MealType;
  food_name: string;
  portion: string;
  notes: string;
  ai_analysis: MealAnalysis | null;
  nutrition?: MealNutrition | null;
  plan_task_id?: string;
  images: MealImage[];
  created_at?: string;
  updated_at?: string;
};

export type ExerciseRecord = {
  plan_task_id?: string;
  id: string;
  user_id: string;
  record_date: string;
  exercise_type: ExerciseType;
  duration_min: number;
  distance_km: number | null;
  intensity: "低" | "中" | "高";
  calories_burned: number | null;
  feeling: string;
  has_discomfort: boolean;
  discomfort_detail: string;
  created_at?: string;
  updated_at?: string;
};

export type DailyCheckin = {
  id: string;
  user_id: string;
  record_date: string;
  tasks: DailyTasks;
  water_ml: number;
  sleep_hours: number | null;
  body_feeling: string;
  bowel_movement: boolean;
  menstrual_period: boolean;
  completion_score: number;
  fatigue_level?: number;
  created_at?: string;
  updated_at?: string;
};

export type DailyAiSummaryRecord = {
  id: string;
  user_id: string;
  record_date: string;
  summary: DailySummary;
  source_snapshot: unknown;
  created_at?: string;
  updated_at?: string;
};

export type AppData = {
  profile: Profile;
  challenge: Challenge;
  weights: WeightRecord[];
  meals: MealRecord[];
  exercises: ExerciseRecord[];
  checkins: DailyCheckin[];
  summaries: DailyAiSummaryRecord[];
  plans?: WeekPlan[];
  task_updates?: TaskUpdate[];
  coach_events?: { id:string;record_date:string;created_at:string;cause:"weight"|"meal"|"recovery"|"profile";message:string;targets:NutritionTargets|null }[];
};

export function formatDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function todayString(date = new Date()) {
  return formatDate(date);
}

export function addDays(dateString: string, days: number) {
  return formatDate(shiftDays(parseISO(dateString), days));
}

export function formatChineseDate(dateString: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${dateString}T00:00:00`));
}

export function uid(prefix = "id") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function emptyTasks(): DailyTasks {
  return taskKeys.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as DailyTasks);
}

export function completionFromTasks(tasks: DailyTasks) {
  const done = taskKeys.filter((key) => tasks[key]).length;
  return Math.round((done / taskKeys.length) * 100);
}

export function buildDefaultProfile(userId: string): Profile {
  const start = todayString();
  const end = addDays(start, 55);
  return {
    id: uid("profile"),
    user_id: userId,
    record_date: start,
    gender: "女性",
    height_cm: 156,
    current_weight_kg: 56,
    starting_weight_kg: 56,
    target_weight_kg: 51,
    challenge_start_date: start,
    challenge_end_date: end,
    weekly_exercise_goal: 4,
    water_goal_ml: 1800,
    diet_preferences: "家常菜，尽量规律三餐",
    disliked_foods: "",
    health_notes: "小基数减脂，不鼓励节食或过度运动",
    is_menstrual_period: false,
    ai_enabled: true,
    ai_model: "由服务端 OPENAI_MODEL 控制",
    age: null,
    activity_level: "light",
    exercise_preferences: ["步行", "力量训练"],
    nutrition_targets: null,
    needs_professional_guidance: false,
  };
}

export function buildDefaultChallenge(profile: Profile): Challenge {
  return {
    id: uid("challenge"),
    user_id: profile.user_id,
    record_date: profile.challenge_start_date,
    start_date: profile.challenge_start_date,
    end_date: profile.challenge_end_date,
    start_weight_kg: profile.starting_weight_kg,
    target_weight_kg: profile.target_weight_kg,
    weekly_exercise_goal: profile.weekly_exercise_goal,
    water_goal_ml: profile.water_goal_ml,
    status: "active",
  };
}

export function buildDefaultData(userId: string): AppData {
  const profile = buildDefaultProfile(userId);
  return {
    profile,
    challenge: buildDefaultChallenge(profile),
    weights: [],
    meals: [],
    exercises: [],
    checkins: [],
    summaries: [],
  };
}

export function normalizeTasks(value: unknown): DailyTasks {
  const base = emptyTasks();
  if (!value || typeof value !== "object") return base;
  for (const key of taskKeys) {
    base[key] = Boolean((value as Record<string, unknown>)[key]);
  }
  return base;
}

export function getRecordForDate<T extends { record_date: string }>(
  records: T[],
  date: string,
) {
  return records.find((record) => record.record_date === date);
}

export function sortedWeights(weights: WeightRecord[]) {
  return [...weights].sort((a, b) => a.record_date.localeCompare(b.record_date));
}

export function movingAverage(weights: WeightRecord[], windowSize = 7) {
  const sorted = sortedWeights(weights);
  return sorted.map((record, index) => {
    const startDate = addDays(record.record_date, 1 - windowSize);
    const slice = sorted.slice(0, index + 1).filter((item) => item.record_date >= startDate);
    const average =
      slice.reduce((sum, item) => sum + item.weight_kg, 0) / slice.length;
    return {
      record_date: record.record_date,
      weight_kg: record.weight_kg,
      moving_average: Number(average.toFixed(2)),
    };
  });
}

export function calculateStreak(checkins: DailyCheckin[], fromDate = todayString()) {
  const completedDates = new Set(
    checkins
      .filter((checkin) => checkin.completion_score >= 60)
      .map((checkin) => checkin.record_date),
  );
  let cursor = fromDate;
  let streak = 0;
  while (completedDates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function daysBetween(start: string, end: string) {
  return differenceInCalendarDays(parseISO(end), parseISO(start));
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

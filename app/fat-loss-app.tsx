"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Camera,
  Check,
  Circle,
  Droplets,
  Dumbbell,
  Home,
  LineChart as LineChartIcon,
  Loader2,
  LogOut,
  Plus,
  Save,
  Scale,
  Settings,
  Sparkles,
  Trash2,
  Utensils,
  Waves,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { createBrowserSupabaseClient, hasSupabaseConfig } from "@/lib/supabase";
import { mealAnalysisSchema, type MealAnalysis } from "@/lib/schemas";
import {
  addDays,
  buildDefaultChallenge,
  buildDefaultData,
  buildDefaultProfile,
  calculateStreak,
  clampNumber,
  completionFromTasks,
  daysBetween,
  emptyTasks,
  exerciseTypes,
  formatChineseDate,
  getRecordForDate,
  mealTypeLabels,
  movingAverage,
  normalizeTasks,
  taskKeys,
  taskLabels,
  todayString,
  uid,
  type AppData,
  type DailyAiSummaryRecord,
  type DailyCheckin,
  type ExerciseRecord,
  type ExerciseType,
  type MealImage,
  type MealRecord,
  type MealType,
  type Profile,
  type WeightRecord,
} from "@/lib/fat-loss";

type TabKey =
  | "today"
  | "meals"
  | "exercise"
  | "trends"
  | "calendar"
  | "coach"
  | "settings";

type Toast = { type: "success" | "error" | "info"; message: string } | null;

const demoUserId = "demo-local-user";
const demoStorageKey = "gentle-fat-loss-coach-demo-data";

const tabs: Array<{ key: TabKey; label: string; icon: typeof Home }> = [
  { key: "today", label: "今日", icon: Home },
  { key: "meals", label: "饮食", icon: Utensils },
  { key: "exercise", label: "运动", icon: Dumbbell },
  { key: "trends", label: "趋势", icon: LineChartIcon },
  { key: "calendar", label: "日历", icon: CalendarDays },
  { key: "coach", label: "AI教练", icon: Sparkles },
  { key: "settings", label: "设置", icon: Settings },
];

function omitRuntimeFields<T extends Record<string, unknown>>(record: T) {
  const dbRecord = { ...record };
  delete dbRecord.created_at;
  delete dbRecord.updated_at;
  delete dbRecord.signed_url;
  delete dbRecord.images;
  return dbRecord;
}

function readDemoData(): AppData {
  if (typeof window === "undefined") return buildDefaultData(demoUserId);
  const raw = window.localStorage.getItem(demoStorageKey);
  if (!raw) return seedDemoData();
  try {
    const parsed = JSON.parse(raw) as AppData;
    parsed.checkins = parsed.checkins.map((item) => ({
      ...item,
      tasks: normalizeTasks(item.tasks),
    }));
    return parsed;
  } catch {
    return seedDemoData();
  }
}

function writeDemoData(data: AppData) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(demoStorageKey, JSON.stringify(data));
}

function seedDemoData() {
  const data = buildDefaultData(demoUserId);
  const start = addDays(todayString(), -8);
  const weights = [56, 55.8, 55.9, 55.5, 55.4, 55.6, 55.1, 55.0, 54.9];
  data.weights = weights.map((weight, index) => ({
    id: uid("weight"),
    user_id: demoUserId,
    record_date: addDays(start, index),
    weight_kg: weight,
    note: index === 5 ? "前一天吃了偏咸外食，睡眠一般" : "",
    high_salt: index === 5,
    late_dinner: false,
    menstrual_period: false,
    bowel_movement: index % 2 === 0,
    poor_sleep: index === 5,
    hard_training_previous_day: index === 4,
  }));
  data.checkins = weights.map((_, index) => {
    const tasks = emptyTasks();
    for (const key of taskKeys) tasks[key] = index % 4 !== 0;
    return {
      id: uid("checkin"),
      user_id: demoUserId,
      record_date: addDays(start, index),
      tasks,
      water_ml: 1700 + index * 30,
      sleep_hours: 7,
      body_feeling: index === 5 ? "有点水肿，但精神还可以" : "状态平稳",
      bowel_movement: index % 2 === 0,
      menstrual_period: false,
      completion_score: completionFromTasks(tasks),
    };
  });
  writeDemoData(data);
  return data;
}

function buildDefaultCheckin(userId: string, recordDate: string): DailyCheckin {
  return {
    id: uid("checkin"),
    user_id: userId,
    record_date: recordDate,
    tasks: emptyTasks(),
    water_ml: 0,
    sleep_hours: null,
    body_feeling: "",
    bowel_movement: false,
    menstrual_period: false,
    completion_score: 0,
  };
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function asNumber(value: string | number | null | undefined, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getLatestWeight(data: AppData) {
  const sorted = [...data.weights].sort((a, b) =>
    b.record_date.localeCompare(a.record_date),
  );
  return sorted[0]?.weight_kg ?? data.profile.current_weight_kg;
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function compressImage(file: File) {
  const imageCompression = (await import("browser-image-compression")).default;
  return imageCompression(file, {
    maxSizeMB: 0.7,
    maxWidthOrHeight: 1600,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.78,
  });
}

export default function FatLossApp() {
  const supabaseConfigured = hasSupabaseConfig();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [aiPendingId, setAiPendingId] = useState<string | null>(null);
  const [summaryPending, setSummaryPending] = useState(false);
  const [trendRange, setTrendRange] = useState<7 | 30>(30);

  const isDemo = !supabaseConfigured || !supabase;
  const userId = user?.id ?? demoUserId;

  function showToast(nextToast: Toast) {
    setToast(nextToast);
    if (nextToast) {
      window.setTimeout(() => setToast(null), 3200);
    }
  }

  function updateLocal(updater: (current: AppData) => AppData) {
    setData((current) => {
      if (!current) return current;
      const next = updater(current);
      if (isDemo) writeDemoData(next);
      return next;
    });
  }

  async function loadRemoteData(client: SupabaseClient, id: string) {
    setLoading(true);
    try {
      let profile: Profile;
      const profileResult = await client
        .from("profiles")
        .select("*")
        .eq("user_id", id)
        .maybeSingle();

      if (profileResult.error) throw profileResult.error;
      if (profileResult.data) {
        profile = profileResult.data as Profile;
      } else {
        const defaultProfile = buildDefaultProfile(id);
        const inserted = await client
          .from("profiles")
          .insert(defaultProfile)
          .select()
          .single();
        if (inserted.error) throw inserted.error;
        profile = inserted.data as Profile;
      }

      const [
        challengeResult,
        weightsResult,
        mealsResult,
        imagesResult,
        exercisesResult,
        checkinsResult,
        summariesResult,
      ] = await Promise.all([
        client
          .from("challenges")
          .select("*")
          .eq("user_id", id)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        client
          .from("weight_records")
          .select("*")
          .eq("user_id", id)
          .order("record_date", { ascending: true }),
        client
          .from("meal_records")
          .select("*")
          .eq("user_id", id)
          .order("created_at", { ascending: true }),
        client
          .from("meal_images")
          .select("*")
          .eq("user_id", id)
          .order("created_at", { ascending: true }),
        client
          .from("exercise_records")
          .select("*")
          .eq("user_id", id)
          .order("created_at", { ascending: true }),
        client
          .from("daily_checkins")
          .select("*")
          .eq("user_id", id)
          .order("record_date", { ascending: true }),
        client
          .from("daily_ai_summaries")
          .select("*")
          .eq("user_id", id)
          .order("record_date", { ascending: true }),
      ]);

      for (const result of [
        challengeResult,
        weightsResult,
        mealsResult,
        imagesResult,
        exercisesResult,
        checkinsResult,
        summariesResult,
      ]) {
        if (result.error) throw result.error;
      }

      let challenge = challengeResult.data as AppData["challenge"] | null;
      if (!challenge) {
        const defaultChallenge = buildDefaultChallenge(profile);
        const inserted = await client
          .from("challenges")
          .insert(defaultChallenge)
          .select()
          .single();
        if (inserted.error) throw inserted.error;
        challenge = inserted.data as AppData["challenge"];
      }

      const imageRows = ((imagesResult.data ?? []) as MealImage[]).map(
        (image) => ({ ...image }),
      );
      const signedImages = await Promise.all(
        imageRows.map(async (image) => {
          const signed = await client.storage
            .from("meal-images")
            .createSignedUrl(image.storage_path, 60 * 60);
          return {
            ...image,
            signed_url: signed.data?.signedUrl ?? undefined,
          };
        }),
      );

      const meals = ((mealsResult.data ?? []) as MealRecord[]).map((meal) => ({
        ...meal,
        ai_analysis: meal.ai_analysis
          ? mealAnalysisSchema.safeParse(meal.ai_analysis).success
            ? (meal.ai_analysis as MealAnalysis)
            : null
          : null,
        images: signedImages.filter((image) => image.meal_record_id === meal.id),
      }));

      setData({
        profile,
        challenge,
        weights: (weightsResult.data ?? []) as WeightRecord[],
        meals,
        exercises: (exercisesResult.data ?? []) as ExerciseRecord[],
        checkins: ((checkinsResult.data ?? []) as DailyCheckin[]).map((item) => ({
          ...item,
          tasks: normalizeTasks(item.tasks),
          completion_score: item.completion_score ?? completionFromTasks(normalizeTasks(item.tasks)),
        })),
        summaries: (summariesResult.data ?? []) as DailyAiSummaryRecord[],
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "读取 Supabase 数据失败，请检查数据库表和 RLS。";
      showToast({ type: "error", message });
      setData(buildDefaultData(id));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (isDemo) {
        if (!cancelled) {
          setData(readDemoData());
          setLoading(false);
        }
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      setUser(sessionData.session?.user ?? null);
      if (sessionData.session?.user) {
        await loadRemoteData(supabase, sessionData.session.user.id);
      } else {
        setLoading(false);
      }
    }

    boot();
    if (!isDemo) {
      const { data: listener } = supabase.auth.onAuthStateChange(
        async (_event, session) => {
          setUser(session?.user ?? null);
          if (session?.user) {
            await loadRemoteData(supabase, session.user.id);
          } else {
            setData(null);
          }
        },
      );
      return () => listener.subscription.unsubscribe();
    }

    return () => {
      cancelled = true;
    };
    // loadRemoteData is intentionally captured from this render; adding it would
    // restart auth bootstrapping on every state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, supabase]);

  async function handleAuth() {
    if (!supabase) return;
    if (!authEmail.includes("@") || authPassword.length < 6) {
      showToast({ type: "error", message: "请输入有效邮箱，密码至少 6 位。" });
      return;
    }
    setSaving(true);
    const result =
      authMode === "signup"
        ? await supabase.auth.signUp({
            email: authEmail.trim(),
            password: authPassword,
          })
        : await supabase.auth.signInWithPassword({
            email: authEmail.trim(),
            password: authPassword,
          });
    setSaving(false);
    if (result.error) {
      showToast({ type: "error", message: result.error.message });
      return;
    }
    showToast({
      type: "success",
      message:
        authMode === "signup"
          ? "注册成功。如果项目启用了邮箱验证，请先完成验证。"
          : "登录成功，数据已同步。",
    });
  }

  async function signOut() {
    if (isDemo || !supabase) {
      showToast({ type: "info", message: "当前是本地演示模式，无需退出登录。" });
      return;
    }
    await supabase.auth.signOut();
  }

  async function upsertRemote(table: string, record: Record<string, unknown>) {
    if (isDemo || !supabase) return;
    const result = await supabase.from(table).upsert(record).select().single();
    if (result.error) throw result.error;
  }

  async function updateCheckin(patch: Partial<DailyCheckin>) {
    if (!data) return;
    const existing =
      getRecordForDate(data.checkins, selectedDate) ??
      buildDefaultCheckin(userId, selectedDate);
    const tasks = normalizeTasks(patch.tasks ?? existing.tasks);
    const next: DailyCheckin = {
      ...existing,
      ...patch,
      user_id: userId,
      record_date: selectedDate,
      tasks,
      completion_score: completionFromTasks(tasks),
    };

    updateLocal((current) => ({
      ...current,
      checkins: [
        ...current.checkins.filter((item) => item.id !== next.id),
        next,
      ].sort((a, b) => a.record_date.localeCompare(b.record_date)),
    }));

    try {
      await upsertRemote("daily_checkins", omitRuntimeFields(next));
      showToast({ type: "success", message: "打卡已保存。" });
    } catch (error) {
      showToast({
        type: "error",
        message: error instanceof Error ? error.message : "保存打卡失败。",
      });
    }
  }

  async function setTask(task: keyof DailyCheckin["tasks"], value: boolean) {
    if (!data) return;
    const existing =
      getRecordForDate(data.checkins, selectedDate) ??
      buildDefaultCheckin(userId, selectedDate);
    await updateCheckin({ tasks: { ...existing.tasks, [task]: value } });
  }

  async function saveProfile(nextProfile: Profile) {
    const height = asNumber(nextProfile.height_cm);
    const startWeight = asNumber(nextProfile.starting_weight_kg);
    const targetWeight = asNumber(nextProfile.target_weight_kg);
    if (height < 100 || height > 230) {
      showToast({ type: "error", message: "身高请输入 100-230 cm 之间。" });
      return;
    }
    if (startWeight <= targetWeight) {
      showToast({ type: "error", message: "目标体重需要低于起始体重。" });
      return;
    }
    const challenge = buildDefaultChallenge(nextProfile);
    updateLocal((current) => ({ ...current, profile: nextProfile, challenge }));
    try {
      await upsertRemote("profiles", omitRuntimeFields(nextProfile));
      await upsertRemote("challenges", omitRuntimeFields(challenge));
      showToast({ type: "success", message: "个人设置已保存。" });
    } catch (error) {
      showToast({
        type: "error",
        message: error instanceof Error ? error.message : "保存设置失败。",
      });
    }
  }

  async function saveWeight(record: WeightRecord) {
    if (record.weight_kg < 30 || record.weight_kg > 200) {
      showToast({ type: "error", message: "体重请输入 30-200 kg 之间。" });
      return;
    }
    updateLocal((current) => {
      const profile =
        record.record_date >= todayString()
          ? { ...current.profile, current_weight_kg: record.weight_kg }
          : current.profile;
      return {
        ...current,
        profile,
        weights: [
          ...current.weights.filter((item) => item.id !== record.id),
          record,
        ].sort((a, b) => a.record_date.localeCompare(b.record_date)),
      };
    });
    try {
      await upsertRemote("weight_records", omitRuntimeFields(record));
      if (record.record_date === selectedDate) await setTask("weighed", true);
      showToast({ type: "success", message: "体重记录已保存。" });
    } catch (error) {
      showToast({
        type: "error",
        message: error instanceof Error ? error.message : "保存体重失败。",
      });
    }
  }

  async function deleteWeight(record: WeightRecord) {
    updateLocal((current) => ({
      ...current,
      weights: current.weights.filter((item) => item.id !== record.id),
    }));
    if (!isDemo && supabase) {
      const result = await supabase
        .from("weight_records")
        .delete()
        .eq("id", record.id)
        .eq("user_id", userId);
      if (result.error) showToast({ type: "error", message: result.error.message });
    }
  }

  async function saveMeal(record: MealRecord) {
    if (!record.food_name.trim()) {
      showToast({ type: "error", message: "请填写食物名称。" });
      return;
    }
    updateLocal((current) => ({
      ...current,
      meals: [
        ...current.meals.filter((item) => item.id !== record.id),
        record,
      ].sort((a, b) => a.created_at?.localeCompare(b.created_at ?? "") ?? 0),
    }));
    try {
      await upsertRemote("meal_records", omitRuntimeFields(record));
      if (record.meal_type !== "snack") await setTask(record.meal_type, true);
      showToast({ type: "success", message: "饮食记录已保存。" });
    } catch (error) {
      showToast({
        type: "error",
        message: error instanceof Error ? error.message : "保存饮食失败。",
      });
    }
  }

  async function deleteMeal(record: MealRecord) {
    updateLocal((current) => ({
      ...current,
      meals: current.meals.filter((item) => item.id !== record.id),
    }));
    if (!isDemo && supabase) {
      const paths = record.images
        .filter((image) => image.storage_path && !image.storage_path.startsWith("data:"))
        .map((image) => image.storage_path);
      if (paths.length) await supabase.storage.from("meal-images").remove(paths);
      const result = await supabase
        .from("meal_records")
        .delete()
        .eq("id", record.id)
        .eq("user_id", userId);
      if (result.error) showToast({ type: "error", message: result.error.message });
    }
    showToast({ type: "success", message: "饮食记录已删除。" });
  }

  async function uploadMealImages(record: MealRecord, files: FileList | null) {
    if (!files?.length) return;
    setSaving(true);
    try {
      const images: MealImage[] = [];
      for (const file of Array.from(files).slice(0, 6)) {
        const compressed = await compressImage(file);
        if (isDemo || !supabase) {
          const dataUrl = await fileToDataUrl(compressed);
          images.push({
            id: uid("image"),
            user_id: userId,
            record_date: record.record_date,
            meal_record_id: record.id,
            storage_path: dataUrl,
            signed_url: dataUrl,
            file_name: file.name,
          });
        } else {
          const imageId = uid("image");
          const path = `${userId}/${record.record_date}/${record.id}/${imageId}.jpg`;
          const upload = await supabase.storage
            .from("meal-images")
            .upload(path, compressed, {
              contentType: "image/jpeg",
              upsert: false,
            });
          if (upload.error) throw upload.error;
          const image: MealImage = {
            id: imageId,
            user_id: userId,
            record_date: record.record_date,
            meal_record_id: record.id,
            storage_path: path,
            file_name: file.name,
          };
          const inserted = await supabase
            .from("meal_images")
            .insert(omitRuntimeFields(image))
            .select()
            .single();
          if (inserted.error) throw inserted.error;
          const signed = await supabase.storage
            .from("meal-images")
            .createSignedUrl(path, 60 * 60);
          images.push({
            ...(inserted.data as MealImage),
            signed_url: signed.data?.signedUrl,
          });
        }
      }
      updateLocal((current) => ({
        ...current,
        meals: current.meals.map((meal) =>
          meal.id === record.id
            ? { ...meal, images: [...meal.images, ...images] }
            : meal,
        ),
      }));
      showToast({ type: "success", message: "照片已压缩并上传。" });
    } catch (error) {
      showToast({
        type: "error",
        message: error instanceof Error ? error.message : "上传照片失败。",
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteMealImage(record: MealRecord, image: MealImage) {
    updateLocal((current) => ({
      ...current,
      meals: current.meals.map((meal) =>
        meal.id === record.id
          ? { ...meal, images: meal.images.filter((item) => item.id !== image.id) }
          : meal,
      ),
    }));
    if (!isDemo && supabase) {
      if (image.storage_path && !image.storage_path.startsWith("data:")) {
        await supabase.storage.from("meal-images").remove([image.storage_path]);
      }
      const result = await supabase
        .from("meal_images")
        .delete()
        .eq("id", image.id)
        .eq("user_id", userId);
      if (result.error) showToast({ type: "error", message: result.error.message });
    }
  }

  async function analyzeMeal(record: MealRecord) {
    setAiPendingId(record.id);
    try {
      const response = await fetch("/api/analyze-meal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meal_type: mealTypeLabels[record.meal_type],
          food_name: record.food_name,
          portion: record.portion,
          notes: record.notes,
          profile: data?.profile,
          image_urls: record.images
            .map((image) => image.signed_url || image.storage_path)
            .filter(Boolean),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "AI 分析失败。");
      const analysis = mealAnalysisSchema.parse(payload.analysis);
      const next = { ...record, ai_analysis: analysis };
      await saveMeal(next);
      showToast({ type: "success", message: "AI 分析已生成，可继续手动修改。" });
    } catch (error) {
      showToast({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "AI 分析失败，记录已保留，可手动填写。",
      });
    } finally {
      setAiPendingId(null);
    }
  }

  async function saveExercise(record: ExerciseRecord) {
    if (!record.duration_min || record.duration_min <= 0) {
      showToast({ type: "error", message: "请填写有效运动时长。" });
      return;
    }
    updateLocal((current) => ({
      ...current,
      exercises: [
        ...current.exercises.filter((item) => item.id !== record.id),
        record,
      ].sort((a, b) => a.created_at?.localeCompare(b.created_at ?? "") ?? 0),
    }));
    try {
      await upsertRemote("exercise_records", omitRuntimeFields(record));
      await setTask("exercise", true);
      showToast({ type: "success", message: "运动记录已保存。" });
    } catch (error) {
      showToast({
        type: "error",
        message: error instanceof Error ? error.message : "保存运动失败。",
      });
    }
  }

  async function deleteExercise(record: ExerciseRecord) {
    updateLocal((current) => ({
      ...current,
      exercises: current.exercises.filter((item) => item.id !== record.id),
    }));
    if (!isDemo && supabase) {
      const result = await supabase
        .from("exercise_records")
        .delete()
        .eq("id", record.id)
        .eq("user_id", userId);
      if (result.error) showToast({ type: "error", message: result.error.message });
    }
  }

  async function generateSummary() {
    if (!data) return;
    setSummaryPending(true);
    const trendData = movingAverage(data.weights, 7);
    const snapshot = {
      selectedDate,
      profile: data.profile,
      trend: trendData.slice(-14),
      meals: data.meals.filter((meal) => meal.record_date === selectedDate),
      exercises: data.exercises.filter(
        (exercise) => exercise.record_date === selectedDate,
      ),
      checkin: getRecordForDate(data.checkins, selectedDate),
    };
    try {
      const response = await fetch("/api/daily-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: data.profile,
          record_date: selectedDate,
          weight_records: data.weights.slice(-21),
          meals: snapshot.meals,
          exercises: snapshot.exercises,
          checkin: snapshot.checkin,
          trend: snapshot.trend,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "生成总结失败。");
      const record: DailyAiSummaryRecord = {
        id: getRecordForDate(data.summaries, selectedDate)?.id ?? uid("summary"),
        user_id: userId,
        record_date: selectedDate,
        summary: payload.summary,
        source_snapshot: snapshot,
      };
      updateLocal((current) => ({
        ...current,
        summaries: [
          ...current.summaries.filter((item) => item.id !== record.id),
          record,
        ].sort((a, b) => a.record_date.localeCompare(b.record_date)),
      }));
      await upsertRemote("daily_ai_summaries", omitRuntimeFields(record));
      await setTask("summary", true);
      showToast({ type: "success", message: "今日总结已生成。" });
    } catch (error) {
      showToast({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "生成失败，仍可继续手动记录。",
      });
    } finally {
      setSummaryPending(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#faf7ef] text-[#25342f]">
        <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6">
          <div className="rounded-lg border border-[#e9ddc8] bg-white p-6 shadow-sm">
            <Loader2 className="mb-4 h-8 w-8 animate-spin text-[#5f8d6a]" />
            <p className="text-lg font-semibold">正在准备你的减脂记录本</p>
            <p className="mt-2 text-sm text-[#6f776f]">加载登录状态和本地数据...</p>
          </div>
        </div>
      </main>
    );
  }

  if (!isDemo && !user) {
    return (
      <AuthScreen
        authMode={authMode}
        setAuthMode={setAuthMode}
        email={authEmail}
        setEmail={setAuthEmail}
        password={authPassword}
        setPassword={setAuthPassword}
        saving={saving}
        onSubmit={handleAuth}
        toast={toast}
      />
    );
  }

  if (!data) return null;

  const selectedCheckin =
    getRecordForDate(data.checkins, selectedDate) ??
    buildDefaultCheckin(userId, selectedDate);
  const completionScore = selectedCheckin.completion_score;
  const latestWeight = getLatestWeight(data);
  const daysLeft = Math.max(0, daysBetween(todayString(), data.challenge.end_date));
  const lost = Number((data.profile.starting_weight_kg - latestWeight).toFixed(1));
  const streak = calculateStreak(data.checkins);
  const todayWeight = getRecordForDate(data.weights, selectedDate);
  const selectedSummary = getRecordForDate(data.summaries, selectedDate);

  return (
    <main className="min-h-screen bg-[#faf7ef] text-[#25342f]">
      <div className="mx-auto flex max-w-7xl gap-5 px-3 py-4 sm:px-5 lg:px-8">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-56 shrink-0 rounded-lg border border-[#eadfcf] bg-white/90 p-3 shadow-sm lg:block">
          <div className="px-2 py-3">
            <p className="text-xs font-semibold text-[#e48945]">温和减脂教练</p>
            <h1 className="mt-1 text-xl font-bold">每日记录</h1>
          </div>
          <nav className="mt-4 space-y-1">
            {tabs.map((tab) => (
              <NavButton
                key={tab.key}
                tab={tab}
                active={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
              />
            ))}
          </nav>
          <div className="mt-5 rounded-md bg-[#f4fbf1] p-3 text-sm text-[#516052]">
            <p className="font-medium text-[#315a3c]">
              {isDemo ? "本地演示模式" : user?.email}
            </p>
            <p className="mt-1">API Key 只在服务端环境变量中读取。</p>
          </div>
          <button
            onClick={signOut}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-[#e2d6c2] px-3 py-2 text-sm font-medium text-[#506158] transition hover:bg-[#f6efe2]"
          >
            <LogOut className="h-4 w-4" />
            退出
          </button>
        </aside>

        <section className="min-w-0 flex-1 pb-24 lg:pb-4">
          <TopBar
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            isDemo={isDemo}
          />

          {toast && <ToastMessage toast={toast} />}

          {activeTab === "today" && (
            <TodayPage
              key={`today-${selectedDate}-${todayWeight?.id ?? "new"}`}
              data={data}
              selectedDate={selectedDate}
              completionScore={completionScore}
              daysLeft={daysLeft}
              lost={lost}
              streak={streak}
              todayWeight={todayWeight}
              selectedCheckin={selectedCheckin}
              onSaveWeight={saveWeight}
              onDeleteWeight={deleteWeight}
              onSetTask={setTask}
              onUpdateCheckin={updateCheckin}
            />
          )}

          {activeTab === "meals" && (
            <MealsPage
              data={data}
              selectedDate={selectedDate}
              userId={userId}
              onSaveMeal={saveMeal}
              onDeleteMeal={deleteMeal}
              onUploadImages={uploadMealImages}
              onDeleteImage={deleteMealImage}
              onAnalyzeMeal={analyzeMeal}
              aiPendingId={aiPendingId}
              saving={saving}
            />
          )}

          {activeTab === "exercise" && (
            <ExercisePage
              key={`exercise-${selectedDate}`}
              data={data}
              selectedDate={selectedDate}
              userId={userId}
              onSaveExercise={saveExercise}
              onDeleteExercise={deleteExercise}
            />
          )}

          {activeTab === "trends" && (
            <TrendsPage
              data={data}
              range={trendRange}
              setRange={setTrendRange}
            />
          )}

          {activeTab === "calendar" && (
            <CalendarPage
              data={data}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              setActiveTab={setActiveTab}
            />
          )}

          {activeTab === "coach" && (
            <CoachPage
              data={data}
              selectedDate={selectedDate}
              summary={selectedSummary}
              pending={summaryPending}
              onGenerate={generateSummary}
            />
          )}

          {activeTab === "settings" && (
            <SettingsPage
              key={`settings-${data.profile.id}-${data.profile.updated_at ?? "draft"}`}
              data={data}
              onSaveProfile={saveProfile}
            />
          )}
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-[#eadfcf] bg-white/95 px-2 py-2 shadow-[0_-8px_20px_rgba(58,47,34,0.08)] lg:hidden">
        <div className="mx-auto grid max-w-3xl grid-cols-7 gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={classNames(
                  "flex min-h-14 flex-col items-center justify-center rounded-md text-xs font-medium transition",
                  activeTab === tab.key
                    ? "bg-[#e9f5e4] text-[#2f6b3f]"
                    : "text-[#748077] hover:bg-[#f6efe2]",
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="mt-1 leading-none">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </main>
  );
}

function AuthScreen({
  authMode,
  setAuthMode,
  email,
  setEmail,
  password,
  setPassword,
  saving,
  onSubmit,
  toast,
}: {
  authMode: "login" | "signup";
  setAuthMode: (mode: "login" | "signup") => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  saving: boolean;
  onSubmit: () => void;
  toast: Toast;
}) {
  return (
    <main className="min-h-screen bg-[#faf7ef] px-4 py-8 text-[#25342f]">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl items-center gap-6 md:grid-cols-[1.05fr_0.95fr]">
        <section>
          <p className="text-sm font-semibold text-[#e48945]">温和但理性的减脂陪伴</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">
            记录今天，理解趋势，明天更稳一点。
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-[#667165]">
            用体重、饮食照片、运动和身体感受串起每日反馈。它不会因为一顿外卖就判定失败，也不会鼓励节食或过度训练。
          </p>
        </section>
        <section className="rounded-lg border border-[#eadfcf] bg-white p-5 shadow-sm">
          <div className="mb-4 grid grid-cols-2 rounded-md bg-[#f6efe2] p-1">
            <button
              className={classNames(
                "rounded px-3 py-2 text-sm font-semibold",
                authMode === "login" && "bg-white text-[#315a3c] shadow-sm",
              )}
              onClick={() => setAuthMode("login")}
            >
              登录
            </button>
            <button
              className={classNames(
                "rounded px-3 py-2 text-sm font-semibold",
                authMode === "signup" && "bg-white text-[#315a3c] shadow-sm",
              )}
              onClick={() => setAuthMode("signup")}
            >
              注册
            </button>
          </div>
          <label className="text-sm font-medium">邮箱</label>
          <input
            className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3 outline-none focus:border-[#78a477]"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
          <label className="mt-4 block text-sm font-medium">密码</label>
          <input
            className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3 outline-none focus:border-[#78a477]"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 6 位"
          />
          <button
            onClick={onSubmit}
            disabled={saving}
            className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[#4f8d5f] px-4 py-3 font-semibold text-white transition hover:bg-[#41794f] disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {authMode === "login" ? "登录并同步记录" : "创建账号"}
          </button>
          {toast && <ToastMessage toast={toast} />}
        </section>
      </div>
    </main>
  );
}

function NavButton({
  tab,
  active,
  onClick,
}: {
  tab: (typeof tabs)[number];
  active: boolean;
  onClick: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      onClick={onClick}
      className={classNames(
        "flex w-full items-center gap-3 rounded-md px-3 py-3 text-sm font-semibold transition",
        active
          ? "bg-[#e9f5e4] text-[#2f6b3f]"
          : "text-[#637065] hover:bg-[#f6efe2]",
      )}
    >
      <Icon className="h-5 w-5" />
      {tab.label}
    </button>
  );
}

function TopBar({
  selectedDate,
  setSelectedDate,
  isDemo,
}: {
  selectedDate: string;
  setSelectedDate: (value: string) => void;
  isDemo: boolean;
}) {
  return (
    <header className="mb-4 rounded-lg border border-[#eadfcf] bg-white px-4 py-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#e48945]">
            {isDemo ? "本地演示数据，可配置 Supabase 切换真实账号" : "已连接 Supabase"}
          </p>
          <h2 className="mt-1 text-2xl font-bold">{formatChineseDate(selectedDate)}</h2>
        </div>
        <label className="flex items-center gap-2 rounded-md bg-[#f6efe2] px-3 py-2 text-sm font-medium">
          补录日期
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="rounded border border-[#ddcfba] bg-white px-2 py-2"
          />
        </label>
      </div>
    </header>
  );
}

function ToastMessage({ toast }: { toast: Exclude<Toast, null> }) {
  return (
    <div
      className={classNames(
        "mb-4 rounded-md border px-4 py-3 text-sm font-medium shadow-sm",
        toast.type === "success" && "border-[#b7d7b6] bg-[#eef9ea] text-[#315a3c]",
        toast.type === "error" && "border-[#efc6aa] bg-[#fff2e9] text-[#8a4a20]",
        toast.type === "info" && "border-[#d7ccb6] bg-white text-[#5f665d]",
      )}
    >
      {toast.message}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  note,
}: {
  label: string;
  value: string;
  icon: typeof Scale;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[#667165]">{label}</p>
          <p className="mt-2 text-2xl font-bold">{value}</p>
          {note && <p className="mt-2 text-xs leading-5 text-[#7c857c]">{note}</p>}
        </div>
        <div className="rounded-md bg-[#e9f5e4] p-2 text-[#477b55]">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function TodayPage({
  data,
  selectedDate,
  completionScore,
  daysLeft,
  lost,
  streak,
  todayWeight,
  selectedCheckin,
  onSaveWeight,
  onDeleteWeight,
  onSetTask,
  onUpdateCheckin,
}: {
  data: AppData;
  selectedDate: string;
  completionScore: number;
  daysLeft: number;
  lost: number;
  streak: number;
  todayWeight?: WeightRecord;
  selectedCheckin: DailyCheckin;
  onSaveWeight: (record: WeightRecord) => Promise<void>;
  onDeleteWeight: (record: WeightRecord) => Promise<void>;
  onSetTask: (task: keyof DailyCheckin["tasks"], value: boolean) => Promise<void>;
  onUpdateCheckin: (patch: Partial<DailyCheckin>) => Promise<void>;
}) {
  const [weightDraft, setWeightDraft] = useState<WeightRecord>(
    todayWeight ?? {
      id: uid("weight"),
      user_id: data.profile.user_id,
      record_date: selectedDate,
      weight_kg: data.profile.current_weight_kg,
      note: "",
      high_salt: false,
      late_dinner: false,
      menstrual_period: data.profile.is_menstrual_period,
      bowel_movement: false,
      poor_sleep: false,
      hard_training_previous_day: false,
    },
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="今日体重"
          value={todayWeight ? `${todayWeight.weight_kg.toFixed(1)} kg` : "未记录"}
          icon={Scale}
          note="单日体重只是一帧画面，趋势更重要。"
        />
        <MetricCard label="距离目标" value={`${daysLeft} 天`} icon={CalendarDays} />
        <MetricCard
          label="累计减重"
          value={`${lost >= 0 ? lost : 0} kg`}
          icon={Waves}
          note="以起始体重到近期体重估算。"
        />
        <MetricCard label="连续打卡" value={`${streak} 天`} icon={Check} />
        <div className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
          <p className="text-sm text-[#667165]">今日完成度</p>
          <div className="mt-3 flex items-center gap-4">
            <div
              className="grid h-20 w-20 place-items-center rounded-full"
              style={{
                background: `conic-gradient(#67a56f ${completionScore * 3.6}deg, #efe4d2 0)`,
              }}
            >
              <div className="grid h-14 w-14 place-items-center rounded-full bg-white text-lg font-bold">
                {completionScore}%
              </div>
            </div>
            <p className="text-sm leading-6 text-[#667165]">
              不是追求满分，而是让可持续的小动作多一点。
            </p>
          </div>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Scale className="h-5 w-5 text-[#5f8d6a]" />
            早晨空腹体重
          </h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">
              体重 kg
              <input
                type="number"
                min="30"
                max="200"
                step="0.1"
                value={weightDraft.weight_kg}
                onChange={(event) =>
                  setWeightDraft({
                    ...weightDraft,
                    weight_kg: asNumber(event.target.value),
                  })
                }
                className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
              />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              备注
              <textarea
                value={weightDraft.note}
                onChange={(event) =>
                  setWeightDraft({ ...weightDraft, note: event.target.value })
                }
                className="mt-1 min-h-20 w-full rounded-md border border-[#ded2be] px-3 py-3"
                placeholder="例如：昨晚外食偏咸、睡得晚、刚做完力量训练..."
              />
            </label>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[
              ["high_salt", "前一天盐分偏高"],
              ["late_dinner", "晚餐较晚"],
              ["menstrual_period", "处于月经期"],
              ["bowel_movement", "今日已排便"],
              ["poor_sleep", "睡眠不佳"],
              ["hard_training_previous_day", "前一天训练较累"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(weightDraft[key as keyof WeightRecord])}
                  onChange={(event) =>
                    setWeightDraft({
                      ...weightDraft,
                      [key]: event.target.checked,
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => onSaveWeight(weightDraft)}
              className="flex min-h-11 items-center gap-2 rounded-md bg-[#4f8d5f] px-4 py-2 font-semibold text-white"
            >
              <Save className="h-4 w-4" />
              保存体重
            </button>
            {todayWeight && (
              <button
                onClick={() => onDeleteWeight(todayWeight)}
                className="flex min-h-11 items-center gap-2 rounded-md border border-[#e3d3bc] px-4 py-2 font-semibold text-[#7b5b3b]"
              >
                <Trash2 className="h-4 w-4" />
                删除
              </button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
          <h3 className="text-lg font-bold">今日任务</h3>
          <div className="mt-3 grid gap-2">
            {taskKeys.map((key) => (
              <button
                key={key}
                onClick={() => onSetTask(key, !selectedCheckin.tasks[key])}
                className="flex min-h-11 items-center justify-between rounded-md border border-[#eadfcf] px-3 py-2 text-left text-sm transition hover:bg-[#f8f3e9]"
              >
                <span>{taskLabels[key]}</span>
                {selectedCheckin.tasks[key] ? (
                  <Check className="h-5 w-5 text-[#4f8d5f]" />
                ) : (
                  <Circle className="h-5 w-5 text-[#c6b89f]" />
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold">饮水、睡眠和身体感受</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-sm font-medium">
            饮水 ml
            <input
              type="number"
              min="0"
              value={selectedCheckin.water_ml}
              onChange={(event) =>
                onUpdateCheckin({ water_ml: asNumber(event.target.value) })
              }
              className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium">
            睡眠小时
            <input
              type="number"
              min="0"
              max="16"
              step="0.5"
              value={selectedCheckin.sleep_hours ?? ""}
              onChange={(event) =>
                onUpdateCheckin({
                  sleep_hours: event.target.value
                    ? asNumber(event.target.value)
                    : null,
                })
              }
              className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
            />
          </label>
          <div className="grid gap-2 pt-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedCheckin.bowel_movement}
                onChange={(event) =>
                  onUpdateCheckin({ bowel_movement: event.target.checked })
                }
              />
              今日已排便
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedCheckin.menstrual_period}
                onChange={(event) =>
                  onUpdateCheckin({ menstrual_period: event.target.checked })
                }
              />
              处于月经期
            </label>
          </div>
          <label className="text-sm font-medium md:col-span-3">
            身体感受
            <textarea
              value={selectedCheckin.body_feeling}
              onChange={(event) =>
                onUpdateCheckin({ body_feeling: event.target.value })
              }
              className="mt-1 min-h-24 w-full rounded-md border border-[#ded2be] px-3 py-3"
              placeholder="例如：胃口、精神、酸痛、水肿、压力、饥饿感..."
            />
          </label>
        </div>
      </section>
    </div>
  );
}

function MealsPage({
  data,
  selectedDate,
  userId,
  onSaveMeal,
  onDeleteMeal,
  onUploadImages,
  onDeleteImage,
  onAnalyzeMeal,
  aiPendingId,
  saving,
}: {
  data: AppData;
  selectedDate: string;
  userId: string;
  onSaveMeal: (record: MealRecord) => Promise<void>;
  onDeleteMeal: (record: MealRecord) => Promise<void>;
  onUploadImages: (record: MealRecord, files: FileList | null) => Promise<void>;
  onDeleteImage: (record: MealRecord, image: MealImage) => Promise<void>;
  onAnalyzeMeal: (record: MealRecord) => Promise<void>;
  aiPendingId: string | null;
  saving: boolean;
}) {
  const mealsForDate = data.meals.filter((meal) => meal.record_date === selectedDate);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold">饮食记录</h3>
        <p className="mt-2 text-sm leading-6 text-[#667165]">
          热量和营养判断只做粗略参考。照片、光线、遮挡和描述都会影响估算，所以请按真实情况修改 AI 结果。
        </p>
      </section>

      {(Object.keys(mealTypeLabels) as MealType[]).map((type) => (
        <MealGroup
          key={`${type}-${selectedDate}`}
          type={type}
          meals={mealsForDate.filter((meal) => meal.meal_type === type)}
          selectedDate={selectedDate}
          userId={userId}
          onSaveMeal={onSaveMeal}
          onDeleteMeal={onDeleteMeal}
          onUploadImages={onUploadImages}
          onDeleteImage={onDeleteImage}
          onAnalyzeMeal={onAnalyzeMeal}
          aiPendingId={aiPendingId}
          saving={saving}
        />
      ))}
    </div>
  );
}

function MealGroup({
  type,
  meals,
  selectedDate,
  userId,
  onSaveMeal,
  onDeleteMeal,
  onUploadImages,
  onDeleteImage,
  onAnalyzeMeal,
  aiPendingId,
  saving,
}: {
  type: MealType;
  meals: MealRecord[];
  selectedDate: string;
  userId: string;
  onSaveMeal: (record: MealRecord) => Promise<void>;
  onDeleteMeal: (record: MealRecord) => Promise<void>;
  onUploadImages: (record: MealRecord, files: FileList | null) => Promise<void>;
  onDeleteImage: (record: MealRecord, image: MealImage) => Promise<void>;
  onAnalyzeMeal: (record: MealRecord) => Promise<void>;
  aiPendingId: string | null;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<MealRecord>({
    id: uid("meal"),
    user_id: userId,
    record_date: selectedDate,
    meal_type: type,
    food_name: "",
    portion: "",
    notes: "",
    ai_analysis: null,
    images: [],
  });

  async function addMeal() {
    await onSaveMeal({ ...draft, created_at: new Date().toISOString() });
    setDraft({
      ...draft,
      id: uid("meal"),
      food_name: "",
      portion: "",
      notes: "",
      ai_analysis: null,
      images: [],
    });
  }

  return (
    <section className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="flex items-center gap-2 text-lg font-bold">
          <Utensils className="h-5 w-5 text-[#5f8d6a]" />
          {mealTypeLabels[type]}
        </h3>
        <span className="text-sm text-[#667165]">{meals.length} 条记录</span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1.1fr_0.8fr]">
        <label className="text-sm font-medium">
          食物名称
          <input
            value={draft.food_name}
            onChange={(event) => setDraft({ ...draft, food_name: event.target.value })}
            className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
            placeholder="例如：鸡蛋、燕麦、青菜、牛肉饭"
          />
        </label>
        <label className="text-sm font-medium">
          分量
          <input
            value={draft.portion}
            onChange={(event) => setDraft({ ...draft, portion: event.target.value })}
            className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
            placeholder="例如：一碗、半份、约 150g"
          />
        </label>
        <label className="text-sm font-medium md:col-span-2">
          备注
          <textarea
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            className="mt-1 min-h-20 w-full rounded-md border border-[#ded2be] px-3 py-3"
            placeholder="口味、烹饪方式、饱腹感、外食情况..."
          />
        </label>
      </div>
      <button
        onClick={addMeal}
        className="mt-3 flex min-h-11 items-center gap-2 rounded-md bg-[#4f8d5f] px-4 py-2 font-semibold text-white"
      >
        <Plus className="h-4 w-4" />
        新增{mealTypeLabels[type]}
      </button>

      <div className="mt-5 space-y-4">
        {meals.length === 0 && (
          <EmptyState text={`还没有记录${mealTypeLabels[type]}，可以先从食物名称和大致分量开始。`} />
        )}
        {meals.map((meal) => (
          <MealCard
            key={`${meal.id}-${meal.images.length}-${meal.ai_analysis ? "ai" : "manual"}`}
            meal={meal}
            onSaveMeal={onSaveMeal}
            onDeleteMeal={onDeleteMeal}
            onUploadImages={onUploadImages}
            onDeleteImage={onDeleteImage}
            onAnalyzeMeal={onAnalyzeMeal}
            aiPending={aiPendingId === meal.id}
            saving={saving}
          />
        ))}
      </div>
    </section>
  );
}

function MealCard({
  meal,
  onSaveMeal,
  onDeleteMeal,
  onUploadImages,
  onDeleteImage,
  onAnalyzeMeal,
  aiPending,
  saving,
}: {
  meal: MealRecord;
  onSaveMeal: (record: MealRecord) => Promise<void>;
  onDeleteMeal: (record: MealRecord) => Promise<void>;
  onUploadImages: (record: MealRecord, files: FileList | null) => Promise<void>;
  onDeleteImage: (record: MealRecord, image: MealImage) => Promise<void>;
  onAnalyzeMeal: (record: MealRecord) => Promise<void>;
  aiPending: boolean;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(meal);

  return (
    <article className="rounded-md border border-[#eadfcf] bg-[#fffdf8] p-3">
      <div className="grid gap-3 md:grid-cols-[1fr_0.75fr]">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            食物名称
            <input
              value={draft.food_name}
              onChange={(event) => setDraft({ ...draft, food_name: event.target.value })}
              className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium">
            分量
            <input
              value={draft.portion}
              onChange={(event) => setDraft({ ...draft, portion: event.target.value })}
              className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            备注
            <textarea
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              className="mt-1 min-h-20 w-full rounded-md border border-[#ded2be] px-3 py-3"
            />
          </label>
        </div>
        <div>
          <div className="grid grid-cols-2 gap-2">
            {draft.images.map((image) => (
              <div key={image.id} className="relative overflow-hidden rounded-md border border-[#eadfcf] bg-white">
                {image.signed_url ? (
                  <img
                    src={image.signed_url}
                    alt="餐食照片"
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="grid aspect-square place-items-center text-xs text-[#7a8279]">
                    图片待加载
                  </div>
                )}
                <button
                  onClick={() => onDeleteImage(meal, image)}
                  className="absolute right-1 top-1 rounded bg-white/90 p-1 text-[#8a4a20]"
                  aria-label="删除照片"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {draft.images.length === 0 && (
              <div className="grid aspect-square place-items-center rounded-md border border-dashed border-[#d8c9b0] text-center text-sm text-[#7a8279]">
                暂无照片
              </div>
            )}
          </div>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-[#d9ccb8] px-3 py-2 text-sm font-semibold text-[#506158]">
            <Camera className="h-4 w-4" />
            拍照/上传
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(event) => onUploadImages(meal, event.target.files)}
              disabled={saving}
            />
          </label>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onSaveMeal(draft)}
          className="flex min-h-10 items-center gap-2 rounded-md bg-[#4f8d5f] px-3 py-2 text-sm font-semibold text-white"
        >
          <Save className="h-4 w-4" />
          保存修改
        </button>
        <button
          onClick={() => onAnalyzeMeal(draft)}
          disabled={aiPending}
          className="flex min-h-10 items-center gap-2 rounded-md bg-[#f09a4a] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {aiPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          AI分析
        </button>
        <button
          onClick={() => onDeleteMeal(meal)}
          className="flex min-h-10 items-center gap-2 rounded-md border border-[#e3d3bc] px-3 py-2 text-sm font-semibold text-[#7b5b3b]"
        >
          <Trash2 className="h-4 w-4" />
          删除
        </button>
      </div>

      {draft.ai_analysis ? (
        <AnalysisEditor
          analysis={draft.ai_analysis}
          onChange={(analysis) => setDraft({ ...draft, ai_analysis: analysis })}
          onSave={() => onSaveMeal({ ...draft, ai_analysis: draft.ai_analysis })}
        />
      ) : (
        <p className="mt-3 rounded-md bg-[#f6efe2] px-3 py-2 text-sm text-[#6f6658]">
          可点击 AI分析 获取粗略判断，也可以完全手动记录。
        </p>
      )}
    </article>
  );
}

function AnalysisEditor({
  analysis,
  onChange,
  onSave,
}: {
  analysis: MealAnalysis;
  onChange: (analysis: MealAnalysis) => void;
  onSave: () => void;
}) {
  function update<K extends keyof MealAnalysis>(key: K, value: MealAnalysis[K]) {
    onChange({ ...analysis, [key]: value });
  }

  return (
    <div className="mt-4 rounded-md border border-[#d8e5d1] bg-[#f4fbf1] p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="font-bold text-[#315a3c]">AI 粗略分析，可修改</h4>
        <button
          onClick={onSave}
          className="flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#4f8d5f] px-3 py-2 text-sm font-semibold text-white"
        >
          <Save className="h-4 w-4" />
          保存分析
        </button>
      </div>
      <p className="mt-2 text-sm leading-6 text-[#5f6e60]">{analysis.uncertainty_note}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium">
          识别出的食物
          <input
            value={analysis.foods.join("、")}
            onChange={(event) =>
              update(
                "foods",
                event.target.value
                  .split(/[、,，]/)
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
            className="mt-1 w-full rounded-md border border-[#c9d8c2] px-3 py-2"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm font-medium">
            热量下限
            <input
              type="number"
              value={analysis.estimated_calories_min}
              onChange={(event) =>
                update("estimated_calories_min", asNumber(event.target.value))
              }
              className="mt-1 w-full rounded-md border border-[#c9d8c2] px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium">
            热量上限
            <input
              type="number"
              value={analysis.estimated_calories_max}
              onChange={(event) =>
                update("estimated_calories_max", asNumber(event.target.value))
              }
              className="mt-1 w-full rounded-md border border-[#c9d8c2] px-3 py-2"
            />
          </label>
        </div>
        {[
          ["protein_level", "蛋白质", ["偏低", "基本够", "较充足"]],
          ["carbohydrate_level", "碳水", ["偏低", "适中", "偏高"]],
          ["fat_level", "脂肪", ["偏低", "适中", "偏高"]],
          ["vegetable_level", "蔬果", ["不足", "基本够", "充足"]],
        ].map(([key, label, options]) => (
          <label key={String(key)} className="text-sm font-medium">
            {label}
            <select
              value={String(analysis[key as keyof MealAnalysis])}
              onChange={(event) =>
                update(key as keyof MealAnalysis, event.target.value as never)
              }
              className="mt-1 w-full rounded-md border border-[#c9d8c2] px-3 py-2"
            >
              {(options as string[]).map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
        ))}
        <TextArrayEditor
          label="这顿饭的优点"
          value={analysis.strengths}
          onChange={(value) => update("strengths", value)}
        />
        <TextArrayEditor
          label="可以调整的地方"
          value={analysis.improvements}
          onChange={(value) => update("improvements", value)}
        />
        <label className="text-sm font-medium md:col-span-2">
          下一餐建议
          <textarea
            value={analysis.next_meal_suggestion}
            onChange={(event) => update("next_meal_suggestion", event.target.value)}
            className="mt-1 min-h-20 w-full rounded-md border border-[#c9d8c2] px-3 py-2"
          />
        </label>
      </div>
    </div>
  );
}

function TextArrayEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <textarea
        value={value.join("\n")}
        onChange={(event) =>
          onChange(
            event.target.value
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
        className="mt-1 min-h-20 w-full rounded-md border border-[#c9d8c2] px-3 py-2"
      />
    </label>
  );
}

function ExercisePage({
  data,
  selectedDate,
  userId,
  onSaveExercise,
  onDeleteExercise,
}: {
  data: AppData;
  selectedDate: string;
  userId: string;
  onSaveExercise: (record: ExerciseRecord) => Promise<void>;
  onDeleteExercise: (record: ExerciseRecord) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ExerciseRecord>({
    id: uid("exercise"),
    user_id: userId,
    record_date: selectedDate,
    exercise_type: "跑步",
    duration_min: 30,
    distance_km: null,
    intensity: "中",
    calories_burned: null,
    feeling: "",
    has_discomfort: false,
    discomfort_detail: "",
  });
  const exercises = data.exercises.filter(
    (exercise) => exercise.record_date === selectedDate,
  );

  async function addExercise() {
    await onSaveExercise({ ...draft, created_at: new Date().toISOString() });
    setDraft({ ...draft, id: uid("exercise"), feeling: "", discomfort_detail: "" });
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
        <h3 className="flex items-center gap-2 text-lg font-bold">
          <Dumbbell className="h-5 w-5 text-[#5f8d6a]" />
          运动记录
        </h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-sm font-medium">
            运动类型
            <select
              value={draft.exercise_type}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  exercise_type: event.target.value as ExerciseType,
                })
              }
              className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
            >
              {exerciseTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            时长 分钟
            <input
              type="number"
              min="1"
              value={draft.duration_min}
              onChange={(event) =>
                setDraft({ ...draft, duration_min: asNumber(event.target.value) })
              }
              className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium">
            距离 km
            <input
              type="number"
              min="0"
              step="0.1"
              value={draft.distance_km ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  distance_km: event.target.value
                    ? asNumber(event.target.value)
                    : null,
                })
              }
              className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium">
            强度
            <select
              value={draft.intensity}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  intensity: event.target.value as ExerciseRecord["intensity"],
                })
              }
              className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
            >
              <option>低</option>
              <option>中</option>
              <option>高</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            消耗热量 可选
            <input
              type="number"
              min="0"
              value={draft.calories_burned ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  calories_burned: event.target.value
                    ? asNumber(event.target.value)
                    : null,
                })
              }
              className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
            />
          </label>
          <label className="flex items-center gap-2 pt-7 text-sm font-medium">
            <input
              type="checkbox"
              checked={draft.has_discomfort}
              onChange={(event) =>
                setDraft({ ...draft, has_discomfort: event.target.checked })
              }
            />
            疼痛、抽筋或不适
          </label>
          <label className="text-sm font-medium md:col-span-3">
            运动后的感受
            <textarea
              value={draft.feeling}
              onChange={(event) => setDraft({ ...draft, feeling: event.target.value })}
              className="mt-1 min-h-20 w-full rounded-md border border-[#ded2be] px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium md:col-span-3">
            不适说明
            <textarea
              value={draft.discomfort_detail}
              onChange={(event) =>
                setDraft({ ...draft, discomfort_detail: event.target.value })
              }
              className="mt-1 min-h-20 w-full rounded-md border border-[#ded2be] px-3 py-3"
              placeholder="如果有头晕、胸闷、疼痛或过度疲劳，请具体记录。"
            />
          </label>
        </div>
        {draft.has_discomfort && (
          <SafetyNotice text="出现疼痛、明显不适、头晕或过度疲劳时，今天不建议继续高强度训练。优先休息、补水、观察状态，必要时寻求专业意见。" />
        )}
        <button
          onClick={addExercise}
          className="mt-4 flex min-h-11 items-center gap-2 rounded-md bg-[#4f8d5f] px-4 py-2 font-semibold text-white"
        >
          <Plus className="h-4 w-4" />
          新增运动
        </button>
      </section>

      <section className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold">当天运动</h3>
        <div className="mt-4 space-y-3">
          {exercises.length === 0 && <EmptyState text="今天还没有运动记录。" />}
          {exercises.map((exercise) => (
            <div key={exercise.id} className="rounded-md border border-[#eadfcf] bg-[#fffdf8] p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-bold">
                    {exercise.exercise_type} · {exercise.duration_min} 分钟 · {exercise.intensity}强度
                  </p>
                  <p className="mt-1 text-sm text-[#667165]">
                    {exercise.distance_km ? `${exercise.distance_km} km · ` : ""}
                    {exercise.calories_burned ? `${exercise.calories_burned} kcal · ` : ""}
                    {exercise.feeling || "未填写运动感受"}
                  </p>
                </div>
                <button
                  onClick={() => onDeleteExercise(exercise)}
                  className="flex min-h-10 items-center gap-2 rounded-md border border-[#e3d3bc] px-3 py-2 text-sm font-semibold text-[#7b5b3b]"
                >
                  <Trash2 className="h-4 w-4" />
                  删除
                </button>
              </div>
              {(exercise.has_discomfort || exercise.discomfort_detail) && (
                <SafetyNotice text={`已记录不适：${exercise.discomfort_detail || "未详细说明"}。下一次训练建议降低强度或休息观察。`} />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TrendsPage({
  data,
  range,
  setRange,
}: {
  data: AppData;
  range: 7 | 30;
  setRange: (range: 7 | 30) => void;
}) {
  const allTrend = movingAverage(data.weights, 7);
  const trend = allTrend.slice(-range).map((item) => ({
    date: item.record_date.slice(5),
    单日体重: item.weight_kg,
    "7日移动平均": item.moving_average,
    目标体重: data.profile.target_weight_kg,
  }));
  const weeklyChange = calculateWeeklyChange(data.weights);
  const exerciseCount = data.exercises.filter(
    (exercise) => daysBetween(exercise.record_date, todayString()) < 30,
  ).length;
  const avgCompletion =
    data.checkins.length > 0
      ? Math.round(
          data.checkins.reduce((sum, item) => sum + item.completion_score, 0) /
            data.checkins.length,
        )
      : 0;
  const latest = allTrend[allTrend.length - 1];
  const progress =
    latest && data.profile.starting_weight_kg !== data.profile.target_weight_kg
      ? clampNumber(
          ((data.profile.starting_weight_kg - latest.moving_average) /
            (data.profile.starting_weight_kg - data.profile.target_weight_kg)) *
            100,
          0,
          100,
        )
      : 0;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-bold">体重趋势</h3>
            <p className="mt-1 text-sm text-[#667165]">
              单日体重是原始记录，趋势体重是 7 日移动平均。突然上涨不等于长脂肪。
            </p>
          </div>
          <div className="grid grid-cols-2 rounded-md bg-[#f6efe2] p-1">
            {[7, 30].map((item) => (
              <button
                key={item}
                onClick={() => setRange(item as 7 | 30)}
                className={classNames(
                  "rounded px-4 py-2 text-sm font-semibold",
                  range === item && "bg-white text-[#315a3c] shadow-sm",
                )}
              >
                {item}日
              </button>
            ))}
          </div>
        </div>
        <div className="mt-5 h-80 w-full">
          {trend.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#efe4d2" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#788178" />
                <YAxis domain={["dataMin - 0.6", "dataMax + 0.6"]} stroke="#788178" />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="单日体重"
                  stroke="#e58b42"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="7日移动平均"
                  stroke="#4f8d5f"
                  strokeWidth={3}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="目标体重"
                  stroke="#87917f"
                  strokeDasharray="5 5"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text="记录至少两天体重后，就能看到趋势线。" />
          )}
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="每周平均变化" value={`${weeklyChange} kg`} icon={LineChartIcon} />
        <MetricCard label="饮食完成度" value={`${avgCompletion}%`} icon={Utensils} />
        <MetricCard label="近30天运动次数" value={`${exerciseCount} 次`} icon={Dumbbell} />
        <MetricCard label="预计目标进度" value={`${Math.round(progress)}%`} icon={Activity} />
      </div>

      <section className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold">波动解释</h3>
        <p className="mt-2 text-sm leading-7 text-[#667165]">
          如果单日体重突然上涨，先检查最近是否高盐外食、月经期、晚餐较晚、排便减少、力量训练后酸痛或睡眠不足。
          这些情况常让身体暂时保留水分。判断减脂进展时，请优先看 7 日移动平均和每周平均体重变化。
        </p>
      </section>
    </div>
  );
}

function CalendarPage({
  data,
  selectedDate,
  setSelectedDate,
  setActiveTab,
}: {
  data: AppData;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  setActiveTab: (tab: TabKey) => void;
}) {
  const current = new Date(`${selectedDate}T00:00:00`);
  const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
  const startOffset = monthStart.getDay();
  const firstCell = new Date(monthStart);
  firstCell.setDate(monthStart.getDate() - startOffset);
  const cells = Array.from({ length: 42 }, (_, index) => {
    const cell = new Date(firstCell);
    cell.setDate(firstCell.getDate() + index);
    return cell.toISOString().slice(0, 10);
  });
  const trend = movingAverage(data.weights, 7);

  function statusFor(date: string) {
    const checkin = getRecordForDate(data.checkins, date);
    if (!checkin) return "none";
    if (checkin.completion_score >= 80) return "done";
    if (checkin.completion_score > 0) return "partial";
    return "none";
  }

  function hasWeightWave(date: string) {
    const index = trend.findIndex((item) => item.record_date === date);
    if (index <= 0) return false;
    return trend[index].weight_kg - trend[index - 1].weight_kg >= 0.6;
  }

  return (
    <section className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
      <h3 className="text-lg font-bold">
        {current.getFullYear()}年 {current.getMonth() + 1}月
      </h3>
      <div className="mt-4 grid grid-cols-7 gap-2 text-center text-xs font-semibold text-[#7b847b]">
        {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-2">
        {cells.map((date) => {
          const status = statusFor(date);
          const inMonth = new Date(`${date}T00:00:00`).getMonth() === current.getMonth();
          return (
            <button
              key={date}
              onClick={() => {
                setSelectedDate(date);
                setActiveTab("today");
              }}
              className={classNames(
                "relative flex aspect-square min-h-12 flex-col items-center justify-center rounded-md border text-sm font-semibold transition",
                !inMonth && "opacity-40",
                selectedDate === date && "border-[#4f8d5f] ring-2 ring-[#cde6c8]",
                status === "done" && "bg-[#e5f4df] text-[#315a3c]",
                status === "partial" && "bg-[#fff2ca] text-[#80632a]",
                status === "none" && "bg-[#f1eee8] text-[#737b73]",
              )}
            >
              {Number(date.slice(-2))}
              {hasWeightWave(date) && (
                <Waves className="absolute bottom-1 right-1 h-3.5 w-3.5 text-[#78947d]" />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm text-[#667165]">
        <span>绿色：已完成</span>
        <span>黄色：部分完成</span>
        <span>灰色：未记录</span>
        <span className="flex items-center gap-1">
          <Waves className="h-4 w-4" /> 体重明显波动提示
        </span>
      </div>
    </section>
  );
}

function CoachPage({
  data,
  selectedDate,
  summary,
  pending,
  onGenerate,
}: {
  data: AppData;
  selectedDate: string;
  summary?: DailyAiSummaryRecord;
  pending: boolean;
  onGenerate: () => Promise<void>;
}) {
  const meals = data.meals.filter((meal) => meal.record_date === selectedDate);
  const exercises = data.exercises.filter(
    (exercise) => exercise.record_date === selectedDate,
  );

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold">
              <Sparkles className="h-5 w-5 text-[#e48945]" />
              AI教练
            </h3>
            <p className="mt-1 text-sm text-[#667165]">
              根据当天记录和近期趋势生成，不替代医疗或营养专业意见。
            </p>
          </div>
          <button
            onClick={onGenerate}
            disabled={pending}
            className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#f09a4a] px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            生成当天总结
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <MetricCard label="当天饮食记录" value={`${meals.length} 条`} icon={Utensils} />
          <MetricCard label="当天运动记录" value={`${exercises.length} 条`} icon={Dumbbell} />
        </div>
      </section>

      {summary ? (
        <section className="grid gap-3 md:grid-cols-2">
          {[
            ["体重解释", summary.summary.weight_interpretation, Scale],
            ["饮食总结", summary.summary.nutrition_summary, Utensils],
            ["运动总结", summary.summary.exercise_summary, Dumbbell],
            ["做得好的地方", summary.summary.positive_feedback, Check],
            ["最需要改善的一件事", summary.summary.priority_improvement, Activity],
            ["明天饮食建议", summary.summary.tomorrow_meal_plan, Droplets],
            ["明天训练建议", summary.summary.tomorrow_training_plan, CalendarDays],
            ["一句鼓励", summary.summary.encouragement, Sparkles],
          ].map(([title, body, Icon]) => (
            <article key={String(title)} className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
              <h4 className="flex items-center gap-2 font-bold">
                {typeof Icon !== "string" && <Icon className="h-5 w-5 text-[#5f8d6a]" />}
                {String(title)}
              </h4>
              <p className="mt-2 text-sm leading-7 text-[#667165]">{String(body)}</p>
            </article>
          ))}
          {summary.summary.safety_warning && (
            <div className="md:col-span-2">
              <SafetyNotice text={summary.summary.safety_warning} />
            </div>
          )}
        </section>
      ) : (
        <EmptyState text="还没有生成当天总结。先记录饮食、运动和身体感受，再让 AI 给出更具体的建议。" />
      )}
    </div>
  );
}

function SettingsPage({
  data,
  onSaveProfile,
}: {
  data: AppData;
  onSaveProfile: (profile: Profile) => Promise<void>;
}) {
  const [draft, setDraft] = useState(data.profile);

  return (
    <section className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
      <h3 className="text-lg font-bold">个人设置</h3>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium">
          性别
          <input
            value={draft.gender}
            onChange={(event) => setDraft({ ...draft, gender: event.target.value })}
            className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
          />
        </label>
        <label className="text-sm font-medium">
          身高 cm
          <input
            type="number"
            min="100"
            max="230"
            value={draft.height_cm}
            onChange={(event) =>
              setDraft({ ...draft, height_cm: asNumber(event.target.value) })
            }
            className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
          />
        </label>
        <label className="text-sm font-medium">
          当前体重 kg
          <input
            type="number"
            step="0.1"
            value={draft.current_weight_kg}
            onChange={(event) =>
              setDraft({
                ...draft,
                current_weight_kg: asNumber(event.target.value),
              })
            }
            className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
          />
        </label>
        <label className="text-sm font-medium">
          起始体重 kg
          <input
            type="number"
            step="0.1"
            value={draft.starting_weight_kg}
            onChange={(event) =>
              setDraft({
                ...draft,
                starting_weight_kg: asNumber(event.target.value),
              })
            }
            className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
          />
        </label>
        <label className="text-sm font-medium">
          目标体重 kg
          <input
            type="number"
            step="0.1"
            value={draft.target_weight_kg}
            onChange={(event) =>
              setDraft({
                ...draft,
                target_weight_kg: asNumber(event.target.value),
              })
            }
            className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
          />
        </label>
        <label className="text-sm font-medium">
          每周运动目标 次
          <input
            type="number"
            min="0"
            max="14"
            value={draft.weekly_exercise_goal}
            onChange={(event) =>
              setDraft({
                ...draft,
                weekly_exercise_goal: asNumber(event.target.value),
              })
            }
            className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
          />
        </label>
        <label className="text-sm font-medium">
          饮水目标 ml
          <input
            type="number"
            min="0"
            value={draft.water_goal_ml}
            onChange={(event) =>
              setDraft({ ...draft, water_goal_ml: asNumber(event.target.value) })
            }
            className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
          />
        </label>
        <label className="text-sm font-medium">
          挑战开始日期
          <input
            type="date"
            value={draft.challenge_start_date}
            onChange={(event) =>
              setDraft({ ...draft, challenge_start_date: event.target.value })
            }
            className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
          />
        </label>
        <label className="text-sm font-medium">
          挑战结束日期
          <input
            type="date"
            value={draft.challenge_end_date}
            onChange={(event) =>
              setDraft({ ...draft, challenge_end_date: event.target.value })
            }
            className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
          />
        </label>
        <label className="flex items-center gap-2 pt-8 text-sm font-medium">
          <input
            type="checkbox"
            checked={draft.is_menstrual_period}
            onChange={(event) =>
              setDraft({ ...draft, is_menstrual_period: event.target.checked })
            }
          />
          当前处于月经期
        </label>
        <label className="text-sm font-medium md:col-span-2">
          饮食偏好
          <textarea
            value={draft.diet_preferences}
            onChange={(event) =>
              setDraft({ ...draft, diet_preferences: event.target.value })
            }
            className="mt-1 min-h-20 w-full rounded-md border border-[#ded2be] px-3 py-3"
          />
        </label>
        <label className="text-sm font-medium md:col-span-2">
          不喜欢的食物
          <textarea
            value={draft.disliked_foods}
            onChange={(event) =>
              setDraft({ ...draft, disliked_foods: event.target.value })
            }
            className="mt-1 min-h-20 w-full rounded-md border border-[#ded2be] px-3 py-3"
          />
        </label>
        <label className="text-sm font-medium md:col-span-2">
          身体状况备注
          <textarea
            value={draft.health_notes}
            onChange={(event) =>
              setDraft({ ...draft, health_notes: event.target.value })
            }
            className="mt-1 min-h-20 w-full rounded-md border border-[#ded2be] px-3 py-3"
          />
        </label>
      </div>
      <section className="mt-5 rounded-md bg-[#f6efe2] p-4 text-sm leading-6 text-[#665f55]">
        <h4 className="font-bold text-[#25342f]">AI API设置</h4>
        <p className="mt-1">
          OpenAI API Key 只能配置在服务端环境变量 <code>OPENAI_API_KEY</code>。
          前端不会显示或保存密钥。模型可通过 <code>OPENAI_MODEL</code> 调整。
        </p>
      </section>
      <button
        onClick={() => onSaveProfile(draft)}
        className="mt-5 flex min-h-11 items-center gap-2 rounded-md bg-[#4f8d5f] px-4 py-2 font-semibold text-white"
      >
        <Save className="h-4 w-4" />
        保存设置
      </button>
    </section>
  );
}

function calculateWeeklyChange(weights: WeightRecord[]) {
  const trend = movingAverage(weights, 7);
  if (trend.length < 8) return "0.0";
  const latest = trend[trend.length - 1].moving_average;
  const previous = trend[Math.max(0, trend.length - 8)].moving_average;
  return (latest - previous).toFixed(1);
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-[#dacbb2] bg-[#fffdf8] px-4 py-6 text-center text-sm text-[#747d74]">
      {text}
    </div>
  );
}

function SafetyNotice({ text }: { text: string }) {
  return (
    <div className="mt-3 flex gap-2 rounded-md border border-[#efc6aa] bg-[#fff2e9] px-3 py-3 text-sm leading-6 text-[#7d4a25]">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <p>{text}</p>
    </div>
  );
}

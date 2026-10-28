"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  Download,
  Droplets,
  Dumbbell,
  Home,
  LineChart as LineChartIcon,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Scale,
  Settings,
  Sparkles,
  Trash2,
  Utensils,
  Upload,
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
import {
  appDataSchema,
  mealAnalysisSchema,
  mealNutritionSchema,
  mergeBackupData,
  nutritionTargetsSchema,
  type MealAnalysis,
  type MealFoodItem,
} from "@/lib/schemas";
import {
  addDays,
  buildDefaultChallenge,
  buildDefaultData,
  buildDefaultProfile,
  clampNumber,
  completionFromTasks,
  daysBetween,
  emptyTasks,
  exerciseTypes,
  formatDate,
  getRecordForDate,
  mealTypeLabels,
  movingAverage,
  normalizeTasks,
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
import DataStoragePanel from "./data-storage-panel";
import ActionPlan from "./action-plan";
import PlanningPreferencesEditor from "./planning-preferences-editor";
import { adjustPlanAfterActuals,generateWeekPlan,mondayOf,selectedPlanMeal,taskMealNutrition,taskState } from "@/lib/action-plan";
import { planningPreferencesSchema,taskUpdateSchema,type PlanTask,type TaskUpdate } from "@/lib/plan-types";
import ChatgptConnectionPanel from "./chatgpt-connection-panel";
import { summaryRows } from "@/lib/chatgpt-data";
import { scheduleSummarySync } from "@/lib/summary-sync-client";
import AiStatusPanel, { FallbackAnalysisAction } from "./ai-status-panel";
import { MealNutritionEditor, NutritionOverview } from "./nutrition-panels";
import { legacyStorageKey, loadLocalData, localRetainedPhotos, readLocalPhoto, restoreLocalAtomically, saveLocalData, scrubRuntime, sha256, storePhoto } from "@/lib/photo-storage";
import { exportZipBackup, type PreparedBackup } from "@/lib/zip-backup";
import { cloudRetainedPhotos, cloudStorageUsage, fetchAllRows, readCloudPhoto, restoreCloudBackup } from "@/lib/cloud-storage";
import { activityLabels, calculateNutritionTargets } from "@/lib/nutrition";
import { invalidateChangedAnalysis,nutritionFromAnalysis,recalculateMealAnalysis } from "@/lib/meal-analysis";

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
const demoStorageKey = legacyStorageKey;

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

async function readDemoData(): Promise<AppData> {
  return loadLocalData(seedDemoData);
}

function seedDemoData() {
  return buildDefaultData(demoUserId);
}
function downloadJson(content: string, filename: string) {
  downloadBlob(new Blob([content], { type: "application/json" }), filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    maxSizeMB: 0.28,
    maxWidthOrHeight: 1200,
    useWebWorker: false,
    fileType: "image/jpeg",
    initialQuality: 0.85,
  });
}

export default function FatLossApp() {
  const supabaseConfigured = hasSupabaseConfig();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const dataRef = useRef<AppData | null>(null);
  const storageBlocked = useRef(false);
  const storageUnsaved = useRef(false);
  const rawRecoveryData = useRef<string | null>(null);
  const [storageIssue, setStorageIssue] = useState<string | null>(null);
  const [remoteLoadError, setRemoteLoadError] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupProgress, setBackupProgress] = useState("");
  const loadGeneration = useRef(0);
  const remoteSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<number | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [aiPendingId, setAiPendingId] = useState<string | null>(null);
  const [summaryPending, setSummaryPending] = useState(false);
  const [trendRange, setTrendRange] = useState<7 | 30>(30);

  const isDemo = !supabaseConfigured || !supabase;
  const userId = user?.id ?? demoUserId;

  useEffect(() => {
    if (!isDemo || !data || loading || data.plans?.length) return;
    const current = dataRef.current;
    if (!current || current.plans?.length) return;
    void updateLocal((value) => ({ ...value,plans: [generateWeekPlan(value,todayString())] }));
  },[data,isDemo,loading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isDemo || !user || !data || loading || backupBusy) return;
    return scheduleSummarySync({ getHeaders: aiHeaders,waitForSaves: () => remoteSaveQueue.current,
      onError: (message) => setToast({ type: "error",message }) });
  },[data,isDemo,user,loading,backupBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("google_connection");
    if (!outcome) return;
    const timer = window.setTimeout(() => {
      setActiveTab("settings");
      showToast(outcome === "authorized" ? { type: "info",message: "Google 授权已完成；摘要同步仍关闭，请确认后开启。" }
        : { type: "error",message: "Google 授权未完成或已过期，原始记录未修改。请在设置中重新授权。" },false);
      url.searchParams.delete("google_connection"); window.history.replaceState(null,"",url);
    },0);
    return () => window.clearTimeout(timer);
  },[]); // eslint-disable-line react-hooks/exhaustive-deps

  function showToast(nextToast: Toast, requiresPersistence = true) {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast(nextToast?.type === "success" && requiresPersistence && isDemo && storageUnsaved.current
      ? { type: "error", message: "改动尚未保存到浏览器，请先导出备份。" }
      : nextToast);
    if (nextToast) {
      toastTimer.current = window.setTimeout(() => setToast(null), 5000);
    }
  }

  function replaceData(next: AppData | null) {
    dataRef.current = next;
    setData(next);
  }

  async function updateLocal(updater: (current: AppData) => AppData) {
    const current = dataRef.current;
    if (!current) return;
    const next = updater(current);
    replaceData(next);
    if (isDemo && !storageBlocked.current) {
      try {
        await saveLocalData(next);
        storageUnsaved.current = false;
        setStorageIssue(null);
      } catch (error) {
        storageUnsaved.current = true;
        setStorageIssue(error instanceof Error ? `${error.message} 最新改动尚未写入设备，请先导出备份。` : "浏览器存储空间不足或无法写入，最新改动仅保留在当前页面。请先导出备份，再刷新或关闭页面。");
      }
    }
  }

  async function readPhoto(image: MealImage): Promise<Blob> {
    if (isDemo) return readLocalPhoto(image);
    if (!supabase) throw new Error("请重新登录后导出照片。");
    return readCloudPhoto(supabase, image);
  }

  async function generatePlan(date: string,previous?: string,replace = false) {
    if (!isDemo) throw new Error("本轮行动计划仅在隔离本地模式验收；旧云端适配器不支持新计划，请先导出备份。");
    await updateLocal((current) => {
      const existing = current.plans?.find((plan) => plan.week_start===mondayOf(date));
      if (existing && !replace) return current;
      const next = generateWeekPlan(current,date,previous);
      if (existing) for (const day of next.days) day.tasks = day.tasks.map((task) => {
        const old = existing.days.flatMap((value) => value.tasks).find((value) => value.id===task.id);
        return old && (taskState(current,old)!=="pending" || current.task_updates?.some((update) => update.id===old.id)) ? old : task;
      });
      return { ...current,plans: [...(current.plans || []).filter((plan) => plan.id!==next.id),next] };
    });
    if (storageUnsaved.current) throw new Error("计划尚未写入设备，请导出备份后检查空间。");
  }

  async function updatePlanTask(task: PlanTask,patch: Partial<TaskUpdate>) {
    if (!isDemo) throw new Error("行动计划当前只支持本地验收，未连接正式数据库。");
    const existing = dataRef.current?.task_updates?.find((update) => update.id===task.id);
    const parsed = taskUpdateSchema.safeParse({ status: "pending",note: "",...existing,...patch,id: task.id,user_id: userId,record_date: task.date,source: "user",updated_at: new Date().toISOString() });
    if (!parsed.success) throw new Error("任务时间、份量或用时无效，请检查填写内容。");
    await updateLocal((current) => ({ ...current,task_updates: [...(current.task_updates || []).filter((update) => update.id!==task.id),parsed.data] }));
    if (storageUnsaved.current) throw new Error("执行状态尚未保存，请先导出备份。");
  }

  async function completePlanTask(task: PlanTask,minutes: number,atePlanned: boolean) {
    if (!isDemo) throw new Error("行动计划当前仅在本地验收。");
    if (task.kind === "meal" && atePlanned) {
      const choice = selectedPlanMeal(dataRef.current!,task);
      if (!choice || choice.needs_confirmation || dataRef.current?.task_updates?.find((update) => update.id===task.id)?.amount) throw new Error("请先确认实际食物和营养，不沿用修改前的份量估计。");
      const success = await saveMeal({ id: uid("meal"),user_id: userId,record_date: task.date,meal_type: task.meal_type!,food_name: choice.title,portion: choice.portion,notes: "用户确认按计划用餐；营养为通用食物粗估，并非照片识别。",nutrition: taskMealNutrition(choice),ai_analysis: null,images: [],plan_task_id: task.id,created_at: new Date().toISOString() });
      if (!success || storageUnsaved.current) throw new Error("实际餐食尚未保存，请先检查存储状态。");
    }
    if (task.kind === "exercise") {
      if (!Number.isFinite(minutes) || minutes<1 || minutes>180) throw new Error("请填写 1–180 分钟的实际运动时长。");
      await saveExercise({ id: uid("exercise"),user_id: userId,record_date: task.date,exercise_type: task.exercise_type || "其他",duration_min: minutes,distance_km: null,intensity: "低",calories_burned: null,feeling: "用户从计划确认实际执行",has_discomfort: false,discomfort_detail: "",plan_task_id: task.id,created_at: new Date().toISOString() });
      if (storageUnsaved.current) throw new Error("实际运动尚未保存，请先导出备份。");
    }
    await updatePlanTask(task,{ status: "completed" });
  }

  async function photographPlanMeal(task: PlanTask,files: FileList) {
    const transfer = new DataTransfer(); for (const file of Array.from(files)) transfer.items.add(file);
    const current = dataRef.current!;
    const old = current.meals.find((meal) => meal.plan_task_id===task.id);
    const record: MealRecord = old || { id: uid("meal"),user_id: userId,record_date: task.date,meal_type: task.meal_type!,food_name: "待识别餐食",portion: "",notes: "从每日行动计划拍照记录；等待确认食物和份量。",nutrition: null,ai_analysis: null,images: [],plan_task_id: task.id,created_at: new Date().toISOString() };
    if (!await saveMeal(record)) throw new Error("未能保存餐食，未执行识别调用。");
    if (!await uploadMealImages(record,transfer.files)) throw new Error("照片未能保存，已有餐食记录保留，请检查空间后重试。");
    if (storageUnsaved.current) throw new Error("照片尚未保存，请导出备份并检查空间。");
    setActiveTab("meals");
    showToast({ type: "info",message: "照片已加入这一天的饮食记录。识别需主动点击，不会自动产生付费调用。" },false);
  }

  async function exportBackup() {
    const current = dataRef.current;
    if (!current) return;
    setBackupBusy(true);
    try {
      setBackupProgress("正在导出记录与真实照片");
      const retained = isDemo ? await localRetainedPhotos(current) : await cloudRetainedPhotos(supabase!,current);
      const blob = await exportZipBackup(current, readPhoto, (done, total) => setBackupProgress(`正在导出照片 ${done}/${total}`),retained);
      downloadBlob(blob, `减脂完整备份-${todayString()}.zip`);
      showToast({ type: "success", message: "完整 ZIP 备份已导出。" }, false);
    } catch (error) {
      showToast({ type: "error", message: error instanceof Error ? error.message : "备份导出失败，原有记录未修改。" });
    } finally {
      setBackupBusy(false);
      setBackupProgress("");
    }
  }

  async function restoreBackup(backup: PreparedBackup, recordsOnly: boolean) {
    const current = dataRef.current;
    if (!current || backupBusy) return false;
    setBackupBusy(true);
    try {
      if (backup.missingImageIds.length && !recordsOnly) throw new Error("此备份缺少照片文件，请先确认是否仅恢复记录。");
      if (rawRecoveryData.current) downloadJson(rawRecoveryData.current, `减脂原始恢复快照-${todayString()}.json`);
      setBackupProgress("正在生成恢复前的完整备份");
      const retained = isDemo ? await localRetainedPhotos(current) : await cloudRetainedPhotos(supabase!,current);
      const before = await exportZipBackup(current, readPhoto, (done, total) => setBackupProgress(`恢复前备份照片 ${done}/${total}`),retained);
      downloadBlob(before, `减脂恢复前备份-${todayString()}.zip`);
      const incoming = structuredClone(backup.data);
      if (recordsOnly) for (const meal of incoming.meals) {
        const available = meal.images.filter((image) => !backup.missingImageIds.includes(image.id));
        const existing = current.meals.find((record) => record.id === meal.id)?.images || [];
        meal.images = [...available,...existing.filter((image) => !available.some((photo) => photo.id === image.id))];
      }
      setBackupProgress("正在合并恢复记录与照片，请保持页面打开");
      if (isDemo) {
        const next = mergeBackupData(current, incoming);
        const photos = incoming.meals.flatMap((meal) => meal.images).filter((image) => backup.photos.has(image.id)).map((image) => ({ image, blob: backup.photos.get(image.id)! }));
        replaceData(await restoreLocalAtomically(next, photos, current,backup.retainedPhotos?.values()));
      } else {
        if (!supabase) throw new Error("登录已失效，请重新登录。");
        const merged = await restoreCloudBackup(supabase, current, { ...backup, data: incoming }, recordsOnly, (done, total) => setBackupProgress(`恢复云端照片 ${done}/${total}`));
        replaceData(merged);
        await loadRemoteData(supabase, userId);
      }
      storageBlocked.current = false;
      storageUnsaved.current = false;
      rawRecoveryData.current = null;
      setStorageIssue(null);
      showToast({ type: "success", message: "完整备份已合并恢复，恢复前 ZIP 已导出。" });
      return true;
    } catch (error) {
      showToast({ type: "error", message: error instanceof Error ? error.message : "恢复事务未完成，原有记录和恢复快照已保留。请检查存储容量与网络后重试。" });
      return false;
    } finally {
      setBackupBusy(false);
      setBackupProgress("");
    }
  }

  async function loadRemoteData(client: SupabaseClient, id: string) {
    const generation = ++loadGeneration.current;
    setLoading(!dataRef.current);
    setRemoteLoadError(null);
    try {
      let profileResult = await client.from("profiles").select("*").eq("user_id", id).maybeSingle();
      if (profileResult.error) throw profileResult.error;
      if (!profileResult.data) {
        const created = await client.from("profiles").upsert(buildDefaultProfile(id), { onConflict: "user_id", ignoreDuplicates: true });
        if (created.error) throw created.error;
        profileResult = await client.from("profiles").select("*").eq("user_id", id).single();
        if (profileResult.error) throw profileResult.error;
      }
      const profile = profileResult.data as Profile;
      const [challengeResult, weights, meals, images, exercises, checkins, summaries] = await Promise.all([
        client.from("challenges").select("*").eq("user_id", id).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        fetchAllRows(client, "weight_records", id),
        fetchAllRows(client, "meal_records", id),
        fetchAllRows(client, "meal_images", id),
        fetchAllRows(client, "exercise_records", id),
        fetchAllRows(client, "daily_checkins", id),
        fetchAllRows(client, "daily_ai_summaries", id),
      ]);
      if (challengeResult.error) throw challengeResult.error;
      let challenge = challengeResult.data;
      if (!challenge) {
        const inserted = await client.from("challenges").insert(buildDefaultChallenge(profile)).select().single();
        if (inserted.error) throw inserted.error;
        challenge = inserted.data;
      }
      const paths = images.map((image) => String(image.storage_path));
      const signed = paths.length ? await client.storage.from("meal-images").createSignedUrls(paths, 3600) : null;
      const signedUrls = new Map((signed?.data || []).map((image) => [image.path, image.signedUrl]));
      const next = appDataSchema.parse({
        profile, challenge, weights, exercises, checkins, summaries,
        meals: meals.map((meal) => ({
          ...meal,
          ai_analysis: meal.ai_analysis ? mealAnalysisSchema.safeParse(meal.ai_analysis).data ?? null : null,
          images: images.filter((image) => image.meal_record_id === meal.id).map((image) => ({ ...image, signed_url: signedUrls.get(String(image.storage_path)) })),
        })),
      });
      const latest = [...next.weights].filter((record) => record.record_date <= todayString()).sort((a,b) => b.record_date.localeCompare(a.record_date))[0];
      if (latest) next.profile.current_weight_kg = latest.weight_kg;
      if (generation !== loadGeneration.current) return false;
      replaceData(next);
      return true;
    } catch (error) {
      if (generation !== loadGeneration.current) return false;
      const message = error instanceof Error ? error.message : "读取云端失败，请检查登录、网络和 V2 数据库迁移。";
      setRemoteLoadError(message);
      showToast({ type: "error", message });
      return false;
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (isDemo) {
        if (!cancelled) {
          try {
            const local = await readDemoData();
            if (!cancelled) replaceData(local);
          } catch {
            storageBlocked.current = true;
            storageUnsaved.current = true;
            try {
              rawRecoveryData.current = window.localStorage.getItem(demoStorageKey);
            } catch {
              rawRecoveryData.current = null;
            }
            setStorageIssue("原有本地记录无法读取，已保留原始数据。当前改动仅保留在页面中；请导出原始记录，或从备份恢复。");
            replaceData(buildDefaultData(demoUserId));
          }
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
        (_event, session) => {
          setUser(session?.user ?? null);
          if (session?.user) {
            if (dataRef.current?.profile.user_id !== session.user.id) replaceData(null);
            window.setTimeout(() => { if (!cancelled) void loadRemoteData(supabase, session.user.id); }, 0);
          } else {
            loadGeneration.current += 1;
            setLoading(false);
            setRemoteLoadError(null);
            replaceData(null);
          }
        },
      );
      return () => { cancelled = true; listener.subscription.unsubscribe(); };
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
    const conflict = table === "profiles" ? "user_id" : ["weight_records", "daily_checkins", "daily_ai_summaries"].includes(table) ? "user_id,record_date" : "id";
    const safeRecord = record.source_snapshot === undefined ? record : { ...record, source_snapshot: scrubRuntime(record.source_snapshot) };
    const pending = remoteSaveQueue.current.catch(() => undefined).then(() => supabase.from(table).upsert(safeRecord, { onConflict: conflict }).select().single());
    remoteSaveQueue.current = pending;
    const result = await pending;
    if (result.error) { storageUnsaved.current = true; setStorageIssue("云端保存未完成，请保留当前页面并导出备份后重试。已有云端记录未清空。"); throw result.error; }
    storageUnsaved.current = false;
    setStorageIssue(null);
  }

  async function updateCheckin(patch: Partial<DailyCheckin>) {
    if (!dataRef.current) return;
    const existing =
      getRecordForDate(dataRef.current.checkins, selectedDate) ??
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

    await updateLocal((current) => adjustPlanAfterActuals({
      ...current,
      checkins: [
        ...current.checkins.filter((item) => item.id !== next.id),
        next,
      ].sort((a, b) => a.record_date.localeCompare(b.record_date)),
    }, selectedDate, "recovery"));

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
    if (!dataRef.current) return;
    const existing =
      getRecordForDate(dataRef.current.checkins, selectedDate) ??
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
    if (nextProfile.age !== null && nextProfile.age !== undefined && (nextProfile.age < 18 || nextProfile.age > 100)) { showToast({ type: "error", message: "年龄请填写 18–100 岁；此减脂目标工具仅面向成年人。" }); return; }
    if (!planningPreferencesSchema.safeParse(nextProfile.planning || {}).success) { showToast({ type: "error",message: "每天运动时间请填写 5–90 分钟，并检查计划偏好。" }); return; }
    if (nextProfile.nutrition_targets && !nutritionTargetsSchema.safeParse(nextProfile.nutrition_targets).success) { showToast({ type: "error", message: "营养目标超出温和调整范围，请检查热量和宏量营养素。" }); return; }
    if (!nextProfile.challenge_start_date || !nextProfile.challenge_end_date || nextProfile.challenge_end_date < nextProfile.challenge_start_date) { showToast({ type: "error", message: "挑战结束日期不能早于开始日期。" }); return; }
    const challenge = { ...buildDefaultChallenge(nextProfile), id: dataRef.current?.challenge.id || uid() };
    await updateLocal((current) => ({ ...current, profile: nextProfile, challenge }));
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
    const roundedWeight = Number(record.weight_kg.toFixed(1));
    if (!Number.isFinite(roundedWeight) || roundedWeight < 30 || roundedWeight > 200) {
      showToast({ type: "error", message: "体重请输入 30-200 kg 之间。" });
      return;
    }
    let savedRecord = { ...record,weight_kg: roundedWeight };
    await updateLocal((current) => {
      const existing = current.weights.find((item) => item.record_date === record.record_date);
      savedRecord = { ...record,id:existing?.id || record.id,weight_kg:roundedWeight,updated_at:new Date().toISOString() };
      const weights = [
        ...current.weights.filter((item) => item.record_date !== record.record_date),
        savedRecord,
      ].sort((a,b) => a.record_date.localeCompare(b.record_date));
      const latest = [...weights].filter((item) => item.record_date <= todayString()).at(-1);
      return adjustPlanAfterActuals({
        ...current,
        profile: latest ? { ...current.profile,current_weight_kg:latest.weight_kg,updated_at:new Date().toISOString() } : current.profile,
        weights,
      },record.record_date,"weight");
    });
    try {
      await upsertRemote("weight_records", omitRuntimeFields(savedRecord));
      if (!isDemo && dataRef.current) await upsertRemote("profiles",omitRuntimeFields(dataRef.current.profile));
      if (record.record_date === selectedDate) await setTask("weighed", true);
      showToast({ type: "success", message: "体重已保存，趋势、营养目标和未完成计划已更新。" });
    } catch (error) {
      showToast({
        type: "error",
        message: error instanceof Error ? error.message : "保存体重失败。",
      });
    }
  }

  async function deleteWeight(record: WeightRecord) {
    if (!window.confirm("确认删除这条体重记录？其他日期记录会保留。")) return;
    if (!isDemo && supabase) {
      const result = await supabase.from("weight_records").delete().eq("id", record.id).eq("user_id", userId);
      if (result.error) { showToast({ type: "error", message: "云端删除失败，记录已保留。" }); return; }
    }
    await updateLocal((current) => {
      const weights = current.weights.filter((item) => item.id !== record.id);
      const latest = [...weights].filter((item) => item.record_date <= todayString()).sort((a,b) => a.record_date.localeCompare(b.record_date)).at(-1);
      return { ...current,weights,profile:{ ...current.profile,current_weight_kg:latest?.weight_kg ?? current.profile.starting_weight_kg } };
    });
    if (record.record_date === selectedDate) await setTask("weighed", false);
  }

  async function saveMeal(record: MealRecord) {
    if (!record.food_name.trim()) {
      showToast({ type: "error", message: "请填写食物名称。" });
      return false;
    }
    if (record.nutrition && !mealNutritionSchema.safeParse(record.nutrition).success) { showToast({ type: "error", message: "营养数值无效，请检查热量范围和宏量营养素。" }); return false; }
    await updateLocal((current) => adjustPlanAfterActuals({
      ...current,
      meals: [
        ...current.meals.filter((item) => item.id !== record.id),
        record,
      ].sort((a, b) => a.created_at?.localeCompare(b.created_at ?? "") ?? 0),
    },record.record_date,"meal"));
    try {
      await upsertRemote("meal_records", omitRuntimeFields(record));
      if (record.meal_type !== "snack") await setTask(record.meal_type, true);
      showToast({ type: "success", message: "饮食记录已保存，已根据实际饮食更新计划。" });
      return true;
    } catch (error) {
      showToast({
        type: "error",
        message: error instanceof Error ? error.message : "保存饮食失败。",
      });
      return false;
    }
  }

  async function deleteMeal(record: MealRecord) {
    if (!window.confirm("确认删除这条饮食记录？照片文件仍会保留在存储中，不会自动清理。")) return;
    if (!isDemo && supabase) {
      const result = await supabase.from("meal_records").delete().eq("id", record.id).eq("user_id", userId);
      if (result.error) { showToast({ type: "error", message: "云端删除失败，原有记录已保留。" }); return; }
    }
    await updateLocal((current) => ({
      ...current,
      meals: current.meals.filter((item) => item.id !== record.id),
    }));
    if (record.meal_type !== "snack" && !dataRef.current?.meals.some((meal) => meal.record_date === selectedDate && meal.meal_type === record.meal_type)) await setTask(record.meal_type, false);
    showToast({ type: "success", message: "饮食记录已删除。" });
  }

  async function uploadMealImages(record: MealRecord, files: FileList | null) {
    if (!files?.length) return false;
    if (files.length > 6) { showToast({ type: "error",message: "单次最多上传 6 张照片，请分批添加。未丢弃任何现有照片。" }); return false; }
    setSaving(true);
    try {
      const images: MealImage[] = [];
      for (const file of Array.from(files)) {
        const compressed = await compressImage(file);
        if (isDemo || !supabase) {
          const photo = await storePhoto(compressed);
          images.push({
            id: uid("image"),
            user_id: userId,
            record_date: record.record_date,
            meal_record_id: record.id,
            ...photo,
            signed_url: URL.createObjectURL(compressed),
            file_name: file.name,
            size_bytes: compressed.size,
            mime_type: compressed.type,
            sha256: await sha256(compressed),
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
            size_bytes: compressed.size,
            mime_type: compressed.type,
            sha256: await sha256(compressed),
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
      await updateLocal((current) => ({
        ...current,
        meals: current.meals.map((meal) =>
          meal.id === record.id
            ? { ...meal, images: [...meal.images, ...images] }
            : meal,
        ),
      }));
      showToast({ type: "success", message: "照片已压缩并上传。" });
      return !storageUnsaved.current;
    } catch (error) {
      showToast({
        type: "error",
        message: error instanceof Error ? error.message : "上传照片失败。",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function deleteMealImage(record: MealRecord, image: MealImage) {
    if (!window.confirm("确认移除此餐食的照片关联？原始照片文件仍保留。")) return;
    if (!isDemo && supabase) {
      const result = await supabase.from("meal_images").delete().eq("id", image.id).eq("user_id", userId);
      if (result.error) { showToast({ type: "error", message: "云端删除关联失败，照片仍保留。" }); return; }
    }
    await updateLocal((current) => ({
      ...current,
      meals: current.meals.map((meal) =>
        meal.id === record.id
          ? { ...meal, images: meal.images.filter((item) => item.id !== image.id) }
          : meal,
      ),
    }));
  }

  async function aiHeaders(): Promise<Record<string,string>> {
    const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  async function analyzeMeal(record: MealRecord, useFallback = false) {
    if (useFallback && !window.confirm("确认使用 OpenAI 备用付费模型分析这一餐？这会单独产生调用费用。")) return;
    if (record.ai_analysis && !window.confirm("已有保存的识别结果。确认根据当前照片和描述重新识别，并替换这一餐的估算？这会产生一次新的模型调用费用。")) return;
    const hasText = [record.food_name === "待识别餐食" ? "" : record.food_name,record.portion,record.notes].some((value) => value.trim());
    if (!record.images.length && !hasText) { showToast({ type:"error",message:"请添加餐食照片，或填写食物名称、份量或文字描述。" },false); return; }
    setAiPendingId(record.id);
    try {
      const response = await fetch("/api/analyze-meal", {
        method: "POST",
        headers: await aiHeaders(),
        body: JSON.stringify({
          meal_record_id: record.id,
          reanalyze_confirmed: Boolean(record.ai_analysis),
          meal_type: mealTypeLabels[record.meal_type],
          food_name: record.food_name,
          portion: record.portion,
          notes: record.notes,
          use_fallback: useFallback,
          fallback_confirmed: useFallback,
          image_urls: await Promise.all(record.images.slice(0,4).map(async (image) => fileToDataUrl(await compressImage(new File([await readPhoto(image)], image.file_name || "meal.jpg", { type: image.mime_type || "image/jpeg" }))))),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "AI 分析失败。");
      const analysis = mealAnalysisSchema.parse(payload.analysis);
      const nutrition = nutritionFromAnalysis(analysis);
      const next = { ...record, ai_analysis: analysis, nutrition: record.nutrition?.source === "manual" ? record.nutrition : nutrition,
        food_name: record.food_name === "待识别餐食" && analysis.foods.length ? analysis.foods.join("、") : record.food_name };
      if (!await saveMeal(next)) throw new Error("分析完成，但本地记录未能保存；不会自动再次调用 AI。");
      showToast({ type: analysis.recognition_status === "needs_info" ? "info" : "success", message: analysis.recognition_status === "needs_info" ? "分析已保存；部分食物或份量待确认，暂未计入营养累计。" : "AI 分析已保存并计入当日营养，计划已根据实际饮食更新。" },false);
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
    await updateLocal((current) => adjustPlanAfterActuals({
      ...current,
      exercises: [
        ...current.exercises.filter((item) => item.id !== record.id),
        record,
      ].sort((a, b) => a.created_at?.localeCompare(b.created_at ?? "") ?? 0),
    },record.record_date,"recovery"));
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
    if (!window.confirm("确认删除这条运动记录？其他历史记录会保留。")) return;
    if (!isDemo && supabase) {
      const result = await supabase.from("exercise_records").delete().eq("id", record.id).eq("user_id", userId);
      if (result.error) { showToast({ type: "error", message: "云端删除失败，记录已保留。" }); return; }
    }
    await updateLocal((current) => ({
      ...current,
      exercises: current.exercises.filter((item) => item.id !== record.id),
    }));
    if (!dataRef.current?.exercises.some((item) => item.record_date === selectedDate)) await setTask("exercise", false);
  }

  async function exportSummary() {
    if (!data) return;
    setSummaryPending(true);
    try {
      downloadJson(JSON.stringify({ format: "lose-weight-chatgpt-summary-v1", exported_at: new Date().toISOString(), rows: summaryRows(data) }, null, 2), "lose-weight-chatgpt-summary.json");
      showToast({ type: "success", message: "ChatGPT 摘要已导出，不含照片、健康备注和身份信息。" }, false);
    } finally { setSummaryPending(false); }
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

  if (!data && remoteLoadError) return <main className="mx-auto max-w-xl p-6"><p role="alert" className="text-red-800">云端记录暂时无法读取：{remoteLoadError}</p><button onClick={() => { if (supabase && user) void loadRemoteData(supabase, user.id); }} className="mt-4 flex items-center gap-2 rounded border px-4 py-2"><RefreshCw className="h-4 w-4" />重新读取</button><button onClick={signOut} className="mt-4 px-4 py-2">退出登录</button></main>;
  if (!data) return null;

  const selectedCheckin =
    getRecordForDate(data.checkins, selectedDate) ??
    buildDefaultCheckin(userId, selectedDate);
  const todayWeight = getRecordForDate(data.weights, selectedDate);
  const selectedSummary = getRecordForDate(data.summaries, selectedDate);

  return (
    <main className="min-h-screen bg-[#faf7ef] text-[#25342f]">
      <div className="mx-auto flex max-w-7xl gap-5 px-3 py-4 sm:px-5 lg:px-8">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-56 shrink-0 rounded-lg border border-[#eadfcf] bg-white/90 p-3 shadow-sm lg:block">
          <div className="px-2 py-3">
            <p className="text-xs font-semibold text-[#4f8d5f]">每日行动教练</p>
            <p className="mt-1 text-xl font-bold">我的减肥计划</p>
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
            <p className="mt-1">数据保存在本机；自托管服务尚未接入。</p>
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
            onRefresh={() => { if (supabase && user) void loadRemoteData(supabase, user.id); }}
          />

          {toast && <ToastMessage toast={toast} />}

          {storageIssue && (
            <div role="alert" className="mb-4 border-l-4 border-red-600 bg-red-50 p-4 text-sm text-red-900">
              <p>{storageIssue}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button onClick={exportBackup} className="flex min-h-10 items-center gap-2 font-semibold">
                  <Download className="h-4 w-4" />导出当前记录
                </button>
                {rawRecoveryData.current && (
                  <button
                    onClick={() => downloadJson(rawRecoveryData.current!, `减脂原始记录-${todayString()}.json`)}
                    className="flex min-h-10 items-center gap-2 font-semibold"
                  >
                    <Download className="h-4 w-4" />导出原始记录
                  </button>
                )}
              </div>
            </div>
          )}

          {activeTab === "today" && (
            <div className="space-y-5">
            <WeightEntryCard key={`home-weight-${selectedDate}-${todayWeight?.id ?? "new"}`} data={data} selectedDate={selectedDate} record={todayWeight} onDate={setSelectedDate} onSave={saveWeight} onDelete={deleteWeight} />
            <ActionPlan data={data} date={selectedDate} busy={backupBusy || saving} onDate={setSelectedDate} onGenerate={generatePlan} onUpdate={updatePlanTask} onComplete={completePlanTask} onPhoto={photographPlanMeal} onRecords={() => setActiveTab("meals")} onSettings={() => setActiveTab("settings")} />
            <details className="plan-records"><summary>饮水与身体状态 <ChevronDown className="h-4 w-4" /></summary>
            <TodayPage
              key={`today-${selectedDate}-${todayWeight?.id ?? "new"}`}
              data={data}
              selectedDate={selectedDate}
              selectedCheckin={selectedCheckin}
              onSetTask={setTask}
              onUpdateCheckin={updateCheckin}
            />
            </details>
            </div>
          )}

          {activeTab === "meals" && (
            <MealsPage
              data={data}
              selectedDate={selectedDate}
              userId={userId}
              onSaveMeal={saveMeal}
              onDeleteMeal={deleteMeal}
              onUploadImages={async (record,files) => { await uploadMealImages(record,files); }}
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
              selectedDate={selectedDate}
              onDate={setSelectedDate}
              onSaveWeight={saveWeight}
              onDeleteWeight={deleteWeight}
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
              onGenerate={exportSummary}
              isDemo={isDemo}
              getHeaders={aiHeaders}
            />
          )}

          {activeTab === "settings" && (
            <SettingsPage
              key={`settings-${data.profile.id}-${data.profile.updated_at ?? "draft"}`}
              data={data}
              onSaveProfile={saveProfile}
              isDemo={isDemo}
              onExportBackup={exportBackup}
              onRestoreBackup={restoreBackup}
              backupBusy={backupBusy}
              backupProgress={backupProgress}
              getAiHeaders={aiHeaders}
              getCloudUsage={async () => cloudStorageUsage(supabase!,data)}
              onBackupError={(message) => showToast({ type: "error", message })}
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
  onRefresh,
}: {
  selectedDate: string;
  setSelectedDate: (value: string) => void;
  isDemo: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="mb-4 rounded-lg border border-[#dce5df] bg-white px-3 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold text-[#5b7b69]">
            {isDemo ? "本地独立试用" : "旧版云端适配器"}
          </p>
          <h2 className="mt-1 text-xl font-bold">我的减肥计划</h2>
          {!isDemo && <button onClick={onRefresh} className="mt-2 flex items-center gap-1 text-sm text-[#315a3c]"><RefreshCw className="h-4 w-4" />同步最新云端记录</button>}
        </div>
        <label className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="sr-only sm:not-sr-only">补录日期</span>
          <input
            type="date"
            aria-label="补录日期"
            value={selectedDate}
            onChange={(event) => {
              if (event.target.value) setSelectedDate(event.target.value);
            }}
            className="max-w-[145px] rounded border border-[#d7e1db] bg-white px-1 py-2 text-sm"
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

function WeightEntryCard({ data,selectedDate,record,onDate,onSave,onDelete }: { data: AppData;selectedDate:string;record?:WeightRecord;onDate:(date:string)=>void;onSave:(record:WeightRecord)=>Promise<void>;onDelete:(record:WeightRecord)=>Promise<void> }) {
  const [weight,setWeight] = useState(record ? record.weight_kg.toFixed(1) : "");
  const [draft,setDraft] = useState<WeightRecord>(record ?? {
    id:uid("weight"),user_id:data.profile.user_id,record_date:selectedDate,weight_kg:Number.NaN,note:"",
    high_salt:false,late_dinner:false,menstrual_period:data.profile.is_menstrual_period,bowel_movement:false,poor_sleep:false,hard_training_previous_day:false,
  });
  return <section className="rounded-lg border-2 border-[#9fc7a5] bg-white p-4 shadow-sm" aria-label="记录今日体重">
          <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Scale className="h-5 w-5 text-[#5f8d6a]" />
            记录今日体重
          </h3>
          {!record && <span className="text-sm text-[#667165]">尚未记录，输入框保持空白</span>}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">日期<input type="date" value={selectedDate} onChange={(event) => { if (event.target.value) onDate(event.target.value); }} className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3" /></label>
            <label className="text-sm font-medium">
              体重 kg
              <input
                type="number"
                min="30"
                max="200"
                step="0.1"
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
                className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
                placeholder="例如 55.8"
              />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              备注
              <textarea
                value={draft.note}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
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
                  checked={Boolean(draft[key as keyof WeightRecord])}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
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
              onClick={() => void onSave({ ...draft,record_date:selectedDate,weight_kg:Number(weight) })}
              disabled={!weight || !Number.isFinite(Number(weight))}
              className="flex min-h-11 items-center gap-2 rounded-md bg-[#4f8d5f] px-4 py-2 font-semibold text-white"
            >
              <Save className="h-4 w-4" />
              保存体重
            </button>
            {record && (
              <button
                onClick={() => void onDelete(record)}
                className="flex min-h-11 items-center gap-2 rounded-md border border-[#e3d3bc] px-4 py-2 font-semibold text-[#7b5b3b]"
              >
                <Trash2 className="h-4 w-4" />
                删除
              </button>
            )}
          </div>
          <p className="mt-3 text-xs leading-5 text-[#667165]">保存后会更新趋势、7 日移动平均与未完成计划；不会因单日波动自动削减热量或追加运动。</p>
      </section>;
}

function TodayPage({ selectedCheckin,onUpdateCheckin }: { data:AppData;selectedDate:string;selectedCheckin:DailyCheckin;onSetTask:(task:keyof DailyCheckin["tasks"],value:boolean)=>Promise<void>;onUpdateCheckin:(patch:Partial<DailyCheckin>)=>Promise<void> }) {
  return (
    <div className="space-y-4">

      <section className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold">饮水、睡眠和身体感受</h3>
        <label className="mt-4 block text-sm font-medium">疲劳程度：{selectedCheckin.fatigue_level || 0} / 10
          <input type="range" min="0" max="10" step="1" value={selectedCheckin.fatigue_level || 0} onChange={(event) => void onUpdateCheckin({ fatigue_level: Number(event.target.value) })} className="mt-2 w-full accent-[#4f8d5f]" />
        </label>
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
  onSaveMeal: (record: MealRecord) => Promise<boolean>;
  onDeleteMeal: (record: MealRecord) => Promise<void>;
  onUploadImages: (record: MealRecord, files: FileList | null) => Promise<void>;
  onDeleteImage: (record: MealRecord, image: MealImage) => Promise<void>;
  onAnalyzeMeal: (record: MealRecord, useFallback?: boolean) => Promise<void>;
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
  onSaveMeal: (record: MealRecord) => Promise<boolean>;
  onDeleteMeal: (record: MealRecord) => Promise<void>;
  onUploadImages: (record: MealRecord, files: FileList | null) => Promise<void>;
  onDeleteImage: (record: MealRecord, image: MealImage) => Promise<void>;
  onAnalyzeMeal: (record: MealRecord, useFallback?: boolean) => Promise<void>;
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
    if (!await onSaveMeal({ ...draft, created_at: new Date().toISOString() })) return;
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
      <div className="mt-3 flex flex-wrap gap-3">
        {([true, false] as const).map((camera) => <label key={String(camera)} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-[#d9ccb8] px-3 py-2 text-sm font-semibold">
          {camera ? <Camera className="h-4 w-4" /> : <Upload className="h-4 w-4" />}{camera ? "拍照记录" : "上传照片记录"}
          <input aria-label={`${mealTypeLabels[type]}${camera ? "拍照记录" : "上传照片记录"}`} type="file" accept="image/*" capture={camera ? "environment" : undefined} multiple={!camera} className="sr-only" disabled={saving} onChange={async (event) => {
            const input = event.currentTarget;
            const files = input.files;
            if (!files?.length) return;
            const record = { ...draft, food_name: draft.food_name.trim() || "待识别餐食", created_at: new Date().toISOString() };
            if (await onSaveMeal(record)) {
              await onUploadImages(record, files);
              setDraft({ ...draft, id: uid("meal"), food_name: "", portion: "", notes: "", images: [], ai_analysis: null });
            }
            input.value = "";
          }} />
        </label>)}
      </div>

      <div className="mt-5 space-y-4">
        {meals.length === 0 && (
          <EmptyState text={`还没有记录${mealTypeLabels[type]}，可以先从食物名称和大致分量开始。`} />
        )}
        {meals.map((meal) => (
          <MealCard
            key={meal.id}
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
  onSaveMeal: (record: MealRecord) => Promise<boolean>;
  onDeleteMeal: (record: MealRecord) => Promise<void>;
  onUploadImages: (record: MealRecord, files: FileList | null) => Promise<void>;
  onDeleteImage: (record: MealRecord, image: MealImage) => Promise<void>;
  onAnalyzeMeal: (record: MealRecord, useFallback?: boolean) => Promise<void>;
  aiPending: boolean;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(meal);
  const [source,setSource] = useState(meal);
  const [estimateNotice,setEstimateNotice] = useState("");
  if (source !== meal) {
    setSource(meal);
    setDraft((current) => ({ ...current,images: meal.images,ai_analysis: meal.ai_analysis,nutrition: meal.nutrition,food_name: current.food_name === "待识别餐食" ? meal.food_name : current.food_name }));
  }
  function updateMealText(key:"food_name"|"portion"|"notes",value:string) {
    const hadEstimate = Boolean(draft.ai_analysis || draft.nutrition?.source === "ai");
    setDraft({ ...draft,[key]:value,ai_analysis:invalidateChangedAnalysis(draft.ai_analysis),nutrition:draft.nutrition?.source === "ai" ? null : draft.nutrition });
    if (hadEstimate) setEstimateNotice("食物或份量已变化，旧 AI 营养已清除；请重新分析或手动填写整餐营养。");
  }

  return (
    <article className="rounded-md border border-[#eadfcf] bg-[#fffdf8] p-3">
      <div className="grid gap-3 md:grid-cols-[1fr_0.75fr]">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            食物名称
            <input
              value={draft.food_name}
              onChange={(event) => updateMealText("food_name",event.target.value)}
              className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium">
            分量
            <input
              value={draft.portion}
              onChange={(event) => updateMealText("portion",event.target.value)}
              className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            备注
            <textarea
              value={draft.notes}
              onChange={(event) => updateMealText("notes",event.target.value)}
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

      {estimateNotice && <p role="status" className="mt-3 rounded-md bg-[#fff2e9] px-3 py-2 text-sm text-[#8a4a20]">{estimateNotice}</p>}

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
          {aiPending ? "正在分析" : "AI分析"}
        </button>
        <FallbackAnalysisAction disabled={aiPending} onUse={() => void onAnalyzeMeal(draft, true)} />
        <button
          onClick={() => onDeleteMeal(meal)}
          className="flex min-h-10 items-center gap-2 rounded-md border border-[#e3d3bc] px-3 py-2 text-sm font-semibold text-[#7b5b3b]"
        >
          <Trash2 className="h-4 w-4" />
          删除
        </button>
      </div>

      <MealNutritionEditor nutrition={draft.nutrition} onSave={async (nutrition) => {
        setDraft({ ...draft, nutrition });
        return onSaveMeal({ ...draft, nutrition });
      }} />

      {draft.ai_analysis ? (
        <AnalysisEditor
          analysis={draft.ai_analysis}
          onChange={(analysis) => setDraft({ ...draft, ai_analysis: analysis,nutrition:nutritionFromAnalysis(analysis) })}
          onSave={() => {
            const analysis = recalculateMealAnalysis(draft.ai_analysis!);
            setDraft({ ...draft,ai_analysis:analysis,nutrition:nutritionFromAnalysis(analysis) });
            void onSaveMeal({ ...draft,ai_analysis:analysis,nutrition:nutritionFromAnalysis(analysis) });
          }}
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
  const blankItem = (name = ""):MealFoodItem => ({ name:name || "待确认食物",portion_description:"",estimated_portion_g:null,portion_status:"needs_confirmation",calories_min:null,calories_max:null,protein_g:null,fat_g:null,carbohydrate_g:null });
  const items = analysis.food_items.length ? analysis.food_items : analysis.foods.map((name) => blankItem(name));
  function replaceItems(nextItems: MealFoodItem[]) { onChange(recalculateMealAnalysis({ ...analysis,food_items:nextItems,foods:nextItems.map((item) => item.name) })); }
  function updateItem(index:number,key:keyof MealFoodItem,value:MealFoodItem[keyof MealFoodItem]) {
    const next = items.map((item,itemIndex) => itemIndex===index ? { ...item,[key]:value } : item);
    if (["name","portion_description","estimated_portion_g"].includes(key)) {
      next[index] = { ...next[index],portion_status:"needs_confirmation",calories_min:null,calories_max:null,protein_g:null,fat_g:null,carbohydrate_g:null };
    }
    replaceItems(next);
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
      <div className="mt-3 space-y-3">
        {items.map((item,index) => <div key={index} className="border-l-4 border-[#9fc7a5] bg-white p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">食物名称<input value={item.name} onChange={(event) => updateItem(index,"name",event.target.value)} className="mt-1 w-full rounded-md border border-[#c9d8c2] px-3 py-2" /></label>
            <label className="text-sm font-medium">估计份量<input value={item.portion_description} onChange={(event) => updateItem(index,"portion_description",event.target.value)} placeholder="例如 1 个（约 50g 可食部分）" className="mt-1 w-full rounded-md border border-[#c9d8c2] px-3 py-2" /></label>
            <label className="text-sm font-medium">估计重量 g（可空）<input type="number" min="0" step="0.1" value={item.estimated_portion_g ?? ""} onChange={(event) => updateItem(index,"estimated_portion_g",event.target.value==="" ? null : Number(event.target.value))} className="mt-1 w-full rounded-md border border-[#c9d8c2] px-3 py-2" /></label>
            <label className="text-sm font-medium">份量状态<select value={item.portion_status} onChange={(event) => updateItem(index,"portion_status",event.target.value as MealFoodItem["portion_status"])} className="mt-1 w-full rounded-md border border-[#c9d8c2] px-3 py-2"><option value="estimated">已粗估</option><option value="needs_confirmation">待确认</option></select></label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {([ ["calories_min","热量下限"],["calories_max","热量上限"],["protein_g","蛋白质 g"],["fat_g","脂肪 g"],["carbohydrate_g","碳水 g"] ] as const).map(([key,label]) => <label key={key} className="text-xs font-medium">{label}<input type="number" min="0" step="0.1" value={item[key] ?? ""} onChange={(event) => updateItem(index,key,event.target.value==="" ? null : Number(event.target.value))} className="mt-1 w-full rounded-md border border-[#c9d8c2] px-2 py-2" /></label>)}
          </div>
          <button onClick={() => replaceItems(items.filter((_,itemIndex) => itemIndex!==index))} className="mt-3 text-sm font-semibold text-[#8a4a20]">移除此项</button>
        </div>)}
        <button onClick={() => replaceItems([...items,blankItem()])} className="flex min-h-10 items-center gap-2 text-sm font-semibold text-[#315a3c]"><Plus className="h-4 w-4" />添加一种食物</button>
        <p className="rounded-md bg-white px-3 py-2 text-sm font-semibold">整餐合计：{analysis.estimated_calories_min === null ? "待确认" : `${analysis.estimated_calories_min}–${analysis.estimated_calories_max} kcal · 蛋白质 ${analysis.protein_g}g · 脂肪 ${analysis.fat_g}g · 碳水 ${analysis.carbohydrate_g}g`}</p>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
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
  selectedDate,
  onDate,
  onSaveWeight,
  onDeleteWeight,
}: {
  data: AppData;
  range: 7 | 30;
  setRange: (range: 7 | 30) => void;
  selectedDate: string;
  onDate: (date:string) => void;
  onSaveWeight: (record:WeightRecord) => Promise<void>;
  onDeleteWeight: (record:WeightRecord) => Promise<void>;
}) {
  const [showWeight,setShowWeight] = useState(false);
  const allTrend = movingAverage(data.weights, 7);
  const rangeStart = addDays(todayString(), 1 - range);
  const trend = allTrend.filter((item) => item.record_date >= rangeStart && item.record_date <= todayString()).map((item) => ({
    date: item.record_date.slice(5),
    单日体重: item.weight_kg,
    "7日移动平均": item.moving_average,
    目标体重: data.profile.target_weight_kg,
  }));
  const weeklyChange = calculateWeeklyChange(data.weights);
  const exerciseCount = data.exercises.filter(
    (exercise) => daysBetween(exercise.record_date, todayString()) >= 0 && daysBetween(exercise.record_date, todayString()) < 30,
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
      <div className="flex justify-end"><button onClick={() => setShowWeight((value) => !value)} className="flex min-h-11 items-center gap-2 rounded-md bg-[#4f8d5f] px-4 py-2 font-semibold text-white"><Scale className="h-4 w-4" />记录体重</button></div>
      {showWeight && <WeightEntryCard key={`trend-weight-${selectedDate}-${data.weights.find((item) => item.record_date===selectedDate)?.id || "new"}`} data={data} selectedDate={selectedDate} record={data.weights.find((item) => item.record_date===selectedDate)} onDate={onDate} onSave={onSaveWeight} onDelete={onDeleteWeight} />}
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
                <YAxis domain={["dataMin - 0.6", "dataMax + 0.6"]} tickFormatter={(value) => Number(value).toFixed(1)} width={45} stroke="#788178" />
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
    return formatDate(cell);
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
  isDemo,
  getHeaders,
}: {
  data: AppData;
  selectedDate: string;
  summary?: DailyAiSummaryRecord;
  pending: boolean;
  onGenerate: () => Promise<void>;
  isDemo: boolean;
  getHeaders: () => Promise<Record<string,string>>;
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
              长期分析交给 ChatGPT。统计为程序计算，餐食识别结果为估算，不替代专业意见。
            </p>
          </div>
          <button
            onClick={onGenerate}
            disabled={pending}
            className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#f09a4a] px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            导出 ChatGPT 摘要
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
        <NutritionOverview data={data} date={selectedDate} />
      )}
      <ChatgptConnectionPanel data={data} isDemo={isDemo} getHeaders={getHeaders} />
    </div>
  );
}

function SettingsPage({
  data,
  onSaveProfile,
  isDemo,
  onExportBackup,
  onRestoreBackup,
  onBackupError,
  backupBusy,
  backupProgress,
  getAiHeaders,
  getCloudUsage,
}: {
  data: AppData;
  onSaveProfile: (profile: Profile) => Promise<void>;
  isDemo: boolean;
  onExportBackup: () => Promise<void>;
  onRestoreBackup: (backup: PreparedBackup, recordsOnly: boolean) => Promise<boolean>;
  onBackupError: (message: string) => void;
  backupBusy: boolean;
  backupProgress: string;
  getAiHeaders: () => Promise<Record<string,string>>;
  getCloudUsage: () => Promise<Awaited<ReturnType<typeof cloudStorageUsage>>>;
}) {
  const [draft, setDraft] = useState(data.profile);
  return (
    <div className="space-y-5">
    <section className="rounded-lg border border-[#eadfcf] bg-white p-4 shadow-sm">
      <h3 className="text-lg font-bold">个人设置</h3>
      <PlanningPreferencesEditor value={draft.planning || planningPreferencesSchema.parse({})} onChange={(planning) => setDraft({ ...draft,planning })} />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium">年龄（岁）<input type="number" min="18" max="100" value={draft.age ?? ""} onChange={(event) => setDraft({ ...draft, age: event.target.value === "" ? null : Number(event.target.value) })} className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3" /></label>
        <label className="text-sm font-medium">活动水平<select value={draft.activity_level || "light"} onChange={(event) => setDraft({ ...draft, activity_level: event.target.value as Profile["activity_level"] })} className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-3">{Object.entries(activityLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
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
      <fieldset className="mt-5 border-t border-[#eadfcf] pt-4"><legend className="text-sm font-bold">运动偏好</legend><div className="mt-3 flex flex-wrap gap-4">{exerciseTypes.map((type) => <label key={type} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(draft.exercise_preferences || []).includes(type)} onChange={(event) => setDraft({ ...draft, exercise_preferences: event.target.checked ? [...(draft.exercise_preferences || []),type] : (draft.exercise_preferences || []).filter((item) => item !== type) })} />{type}</label>)}</div></fieldset>
      <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={draft.needs_professional_guidance || false} onChange={(event) => setDraft({ ...draft, needs_professional_guidance: event.target.checked, nutrition_targets: event.target.checked ? null : draft.nutrition_targets })} className="mt-1" />妊娠、哺乳或有需要专业指导的营养情况；暂停自动减脂目标</label>
      <section className="mt-5 border-t border-[#eadfcf] pt-4">
        <h4 className="text-sm font-bold">每日营养目标</h4>
        <p className="mt-2 text-sm text-[#667165]">{calculateNutritionTargets(draft).explanation}</p>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(draft.nutrition_targets)} onChange={(event) => setDraft({ ...draft, nutrition_targets: event.target.checked ? calculateNutritionTargets({ ...draft, nutrition_targets: null }).targets || { calories: 1700, protein_g: 75, fat_g: 55, carbohydrate_g: 225 } : null })} disabled={draft.needs_professional_guidance} />手动调整每日目标</label>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{([
          ["calories", "能量 kcal"], ["protein_g", "蛋白质 g"], ["fat_g", "脂肪 g"], ["carbohydrate_g", "碳水 g"],
        ] as const).map(([key,label]) => <label key={key} className="text-sm">{label}<input type="number" min={key === "calories" ? 1500 : 0} value={(draft.nutrition_targets || calculateNutritionTargets(draft).targets)?.[key] ?? ""} disabled={!draft.nutrition_targets} onChange={(event) => { if (draft.nutrition_targets) setDraft({ ...draft, nutrition_targets: { ...draft.nutrition_targets, [key]: Number(event.target.value) } }); }} className="mt-1 w-full rounded-md border border-[#ded2be] px-3 py-2 disabled:bg-[#f6f5f1]" /></label>)}</div>
      </section>
      <AiStatusPanel getHeaders={getAiHeaders} />
      <button
        onClick={() => onSaveProfile(draft)}
        className="mt-5 flex min-h-11 items-center gap-2 rounded-md bg-[#4f8d5f] px-4 py-2 font-semibold text-white"
      >
        <Save className="h-4 w-4" />
        保存设置
      </button>
    </section>
    <DataStoragePanel data={data} isDemo={isDemo} busy={backupBusy} progress={backupProgress} onExport={onExportBackup} onRestore={onRestoreBackup} onError={onBackupError} getCloudUsage={getCloudUsage} />
    <ChatgptConnectionPanel data={data} isDemo={isDemo} getHeaders={getAiHeaders} />
    </div>
  );
}


function calculateWeeklyChange(weights: WeightRecord[]) {
  const trend = movingAverage(weights, 7);
  const latest = trend.at(-1);
  if (!latest) return "0.0";
  const previousDate = addDays(latest.record_date, -7);
  const previous = trend.findLast((record) => record.record_date <= previousDate);
  return previous ? (latest.moving_average - previous.moving_average).toFixed(1) : "0.0";
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

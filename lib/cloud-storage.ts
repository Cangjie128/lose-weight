import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppData, MealImage } from "./fat-loss";
import type { PreparedBackup } from "./zip-backup";
import { persistedData, sha256, type RetainedPhoto } from "./photo-storage.ts";
import { mergeBackupData } from "./schemas.ts";

export async function readCloudPhoto(client: SupabaseClient, image: MealImage): Promise<Blob> {
  const result = await client.storage.from("meal-images").download(image.storage_path);
  if (result.error || !result.data) throw new Error(`无法下载照片 ${image.file_name || image.id}，请确认登录有效及网络正常，完整备份未生成。`);
  return result.data;
}

export async function fetchAllRows(client: SupabaseClient, table: string, userId: string) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await client.from(table).select("*").eq("user_id", userId).order("record_date", { ascending: true }).order("id", { ascending: true }).range(offset, offset + 499);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < 500) return rows;
  }
}

export async function cloudRetainedPhotos(client: SupabaseClient, data: AppData): Promise<RetainedPhoto[]> {
  const linked = new Set(data.meals.flatMap((meal) => meal.images).map((image) => image.storage_path));
  const retained: RetainedPhoto[] = [];
  let visited = 0;
  async function visit(prefix: string, depth: number) {
    if (depth > 8 || ++visited > 10000) throw new Error("照片目录超过备份处理上限，请检查 Storage 目录结构。");
    for (let offset = 0; ; offset += 100) {
      const result = await client.storage.from("meal-images").list(prefix,{ limit: 100, offset, sortBy: { column: "name", order: "asc" } });
      if (result.error) throw new Error("无法枚举私有照片，完整备份已停止。请重新登录并检查 Storage 权限。");
      for (const item of result.data || []) {
        if (item.name.includes("/") || item.name === "..") throw new Error("照片目录含无效路径。");
        const key = `${prefix}/${item.name}`;
        if (!item.id && !item.metadata) await visit(key,depth+1);
        else if (!linked.has(key)) retained.push({ key, size_bytes: Number(item.metadata?.size) || 0, read: () => readCloudPhoto(client,{ id: key, user_id: data.profile.user_id, record_date: data.profile.record_date, meal_record_id: "retained", storage_path: key, file_name: item.name }) });
      }
      if (!result.data || result.data.length < 100) break;
    }
  }
  await visit(data.profile.user_id,0);
  return retained;
}

export async function cloudStorageUsage(client: SupabaseClient,data: AppData) {
  const images = data.meals.flatMap((meal) => meal.images);
  const retained = await cloudRetainedPhotos(client,data);
  return {
    records: data.weights.length+data.meals.length+data.exercises.length+data.checkins.length+data.summaries.length,
    photoCount: images.length,storedPhotoCount: images.length+retained.length,
    photoBytes: images.reduce((bytes,image) => bytes+(image.size_bytes || 0),0)+retained.reduce((bytes,photo) => bytes+(photo.size_bytes || 0),0),
    recordBytes: new Blob([JSON.stringify(persistedData(data))]).size,usage: null,quota: null,
  };
}

async function ownedId(userId: string, originalOwner: string, kind: string, id: string) {
  if (userId === originalOwner && /^[a-f0-9-]{36}$/i.test(id)) return id;
  const hash = await sha256(new TextEncoder().encode(`${userId}:${originalOwner}:${kind}:${id}`));
  const chars = hash.slice(0, 32).split(""); chars[12] = "8"; chars[16] = ((parseInt(chars[16], 16) & 3) | 8).toString(16);
  const value = chars.join("");
  return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}

export async function restoreCloudBackup(client: SupabaseClient, current: AppData, backup: PreparedBackup, recordsOnly: boolean, onProgress?: (done: number, total: number) => void) {
  const userId = current.profile.user_id;
  const incoming = structuredClone(backup.data);
  const originalOwner = incoming.profile.user_id;
  for (const key of ["weights", "meals", "exercises", "checkins", "summaries"] as const) {
    for (const record of incoming[key]) {
      const previous = key === "weights" || key === "checkins" || key === "summaries"
        ? current[key].find((item) => item.record_date === record.record_date) : undefined;
      record.id = previous?.id ?? await ownedId(userId, originalOwner, key, record.id);
      record.user_id = userId;
    }
  }
  let done = 0;
  for (const meal of incoming.meals) {
    const kept: MealImage[] = [];
    for (const image of meal.images) {
      const blob = backup.photos.get(image.id);
      if (!blob) {
        if (recordsOnly) continue;
        throw new Error("备份缺失照片，未恢复结构化记录。");
      }
      const originalId = image.id;
      const id = await ownedId(userId, originalOwner, "photo", originalId);
      const hash = await sha256(blob);
      const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
      const storagePath = `${userId}/${meal.record_date}/${meal.id}/${id}_${hash}.${ext}`;
      const uploaded = await client.storage.from("meal-images").upload(storagePath, blob, { contentType: blob.type, upsert: false });
      if (uploaded.error && /quota|capacity|storage.*limit|maximum.*size/i.test(uploaded.error.message)) throw new Error("云端照片存储容量不足，原有记录未修改。请先导出完整备份并检查 Supabase 配额，不会自动删除历史照片。");
      if (uploaded.error && !["409", "Duplicate"].includes(String(uploaded.error.statusCode)) && !/already exists|duplicate/i.test(uploaded.error.message)) throw new Error("照片上传中断，原有记录未修改。已上传的照片会保留，可重试恢复。");
      if (uploaded.error) {
        const existing = await readCloudPhoto(client, { ...image, storage_path: storagePath });
        if (await sha256(existing) !== hash) throw new Error("云端照片校验失败，已停止恢复。");
      }
      kept.push({ ...image, id, user_id: userId, meal_record_id: meal.id, storage_path: storagePath, size_bytes: blob.size, mime_type: blob.type, sha256: hash, signed_url: undefined });
      done += 1;
      onProgress?.(done, backup.photos.size);
    }
    meal.images = kept;
  }
  for (const [key,blob] of backup.retainedPhotos || []) {
    const hash = await sha256(blob);
    const path = `${userId}/retained/${hash}.${blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg"}`;
    const result = await client.storage.from("meal-images").upload(path,blob,{ contentType: blob.type, upsert: false });
    if (result.error && !/already exists|duplicate/i.test(result.error.message)) throw new Error("保留照片上传中断，原有记录未修改，可重试。");
    if (result.error && await sha256(await readCloudPhoto(client,{ id: key, user_id: userId, record_date: current.profile.record_date, meal_record_id: "retained", storage_path: path })) !== hash) throw new Error("保留照片云端校验失败。");
  }
  incoming.profile = { ...incoming.profile, id: current.profile.id, user_id: userId };
  incoming.challenge = { ...incoming.challenge, id: current.challenge.id, user_id: userId };
  const merged = persistedData(mergeBackupData(current, incoming));
  const result = await client.rpc("restore_v2_backup", { p_data: merged });
  if (result.error) throw new Error("云端恢复事务未提交，原有记录未修改。请确认 V2 数据库迁移已执行、账号权限和网络正常；可重试。已上传的照片不会自动删除。");
  return merged;
}

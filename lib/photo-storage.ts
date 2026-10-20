import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AppData, MealImage } from "./fat-loss";
import { appDataSchema } from "./schemas.ts";

export const legacyStorageKey = "gentle-fat-loss-coach-demo-data";
type PhotoEntry = { key: string; blob: Blob; sha256: string; created_at: string };
export type RetainedPhoto = { key: string; size_bytes?: number; read: () => Promise<Blob> };
interface PhotoDatabase extends DBSchema {
  photos: { key: string; value: PhotoEntry };
  records: { key: string; value: { key: string; data: AppData; revision?: number } };
  recovery: { key: string; value: { key: string; data: AppData | string; created_at: string } };
}
let loadedRevision = 0;

let databasePromise: Promise<IDBPDatabase<PhotoDatabase>> | undefined;
let databaseFactory: IDBFactory | undefined;
function database() {
  if (databasePromise && databaseFactory === indexedDB) return databasePromise;
  databaseFactory = indexedDB;
  databasePromise = openDB<PhotoDatabase>("gentle-fat-loss-coach-v2", 1, {
    upgrade(db) {
      db.createObjectStore("photos", { keyPath: "key" });
      db.createObjectStore("records", { keyPath: "key" });
      db.createObjectStore("recovery", { keyPath: "key" });
    },
  });
  return databasePromise;
}

export async function sha256(bytes: Uint8Array | Blob) {
  const buffer = bytes instanceof Blob ? await bytes.arrayBuffer() : new Uint8Array(bytes).buffer;
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function scrubRuntime(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubRuntime);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/signed_url|api.?key|password|authorization|access_token|refresh_token/i.test(key))
    .map(([key, item]) => [key, key === "storage_path" && typeof item === "string" && item.startsWith("data:")
      ? "legacy-photo-reference" : scrubRuntime(item)]));
}

export function persistedData(data: AppData): AppData {
  return {
    ...data,
    meals: data.meals.map((meal) => ({
      ...meal,
      images: meal.images.map((image) => { const copy = { ...image }; delete copy.signed_url; return copy; }),
    })),
    summaries: data.summaries.map((record) => ({ ...record, source_snapshot: scrubRuntime(record.source_snapshot) })),
  };
}

export async function dataUrlBlob(url: string) {
  if (!/^data:image\/(jpeg|png|webp);base64,/i.test(url)) throw new Error("旧照片格式不受支持，原始记录已保留。");
  const response = await fetch(url);
  return response.blob();
}

export async function photoEntry(blob: Blob): Promise<PhotoEntry> {
  const hash = await sha256(blob);
  return { key: `idb:${hash}`, blob, sha256: hash, created_at: new Date().toISOString() };
}

export async function storePhoto(blob: Blob): Promise<{ storage_path: string; size_bytes: number; mime_type: string; sha256: string }> {
  await ensureSpace(blob.size);
  const entry = await photoEntry(blob);
  const db = await database();
  await db.put("photos", entry);
  return { storage_path: entry.key, size_bytes: blob.size, mime_type: blob.type, sha256: entry.sha256 };
}

export async function readLocalPhoto(image: MealImage): Promise<Blob> {
  if (image.storage_path.startsWith("data:image/")) return dataUrlBlob(image.storage_path);
  if (!image.storage_path.startsWith("idb:")) throw new Error(`照片 ${image.file_name || image.id} 未保存在本地，请从云端导出完整 ZIP。`);
  const db = await database();
  const entry = await db.get("photos", image.storage_path);
  if (!entry) throw new Error(`缺失照片 ${image.file_name || image.id}，无法完成完整备份。`);
  return entry.blob;
}

const objectUrls = new Map<string, string>();
export async function hydrateLocalPhotos(data: AppData): Promise<AppData> {
  const meals = await Promise.all(data.meals.map(async (meal) => ({
    ...meal,
    images: await Promise.all(meal.images.map(async (image) => {
      if (!image.storage_path.startsWith("idb:")) return image;
      try {
        if (!objectUrls.has(image.storage_path)) objectUrls.set(image.storage_path, URL.createObjectURL(await readLocalPhoto(image)));
        return { ...image, signed_url: objectUrls.get(image.storage_path) };
      } catch {
        return { ...image, signed_url: undefined };
      }
    })),
  })));
  return { ...data, meals };
}

export async function ensureSpace(additionalBytes: number) {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate();
  if (estimate.quota && estimate.quota - (estimate.usage || 0) < additionalBytes + 512 * 1024) {
    throw new Error("设备存储空间不足，请先导出完整 ZIP 备份并释放空间。现有照片和记录未删除。");
  }
}

export async function migrateLegacyPhotos(data: AppData): Promise<{ data: AppData; entries: PhotoEntry[] }> {
  const next = structuredClone(data);
  const entries = new Map<string, PhotoEntry>();
  for (const meal of next.meals) {
    for (let index = 0; index < meal.images.length; index += 1) {
      const image = meal.images[index];
      delete image.signed_url;
      if (!image.storage_path.startsWith("data:image/")) continue;
      const entry = await photoEntry(await dataUrlBlob(image.storage_path));
      entries.set(entry.key, entry);
      meal.images[index] = { ...image, storage_path: entry.key, size_bytes: entry.blob.size, mime_type: entry.blob.type, sha256: entry.sha256 };
    }
  }
  async function migrateSnapshot(value: unknown): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map(migrateSnapshot));
    if (!value || typeof value !== "object") return value;
    const pairs: Array<[string, unknown]> = [];
    for (const [key,item] of Object.entries(value as Record<string,unknown>)) {
      if (/signed_url|api.?key|password|authorization|access_token|refresh_token/i.test(key)) continue;
      if (key === "storage_path" && typeof item === "string" && item.startsWith("data:image/")) {
        const entry = await photoEntry(await dataUrlBlob(item)); entries.set(entry.key,entry); pairs.push([key,entry.key]);
      } else pairs.push([key,await migrateSnapshot(item)]);
    }
    return Object.fromEntries(pairs);
  }
  for (const summary of next.summaries) summary.source_snapshot = await migrateSnapshot(summary.source_snapshot);
  return { data: next, entries: [...entries.values()] };
}

export async function localRetainedPhotos(data: AppData): Promise<RetainedPhoto[]> {
  const linked = new Set(data.meals.flatMap((meal) => meal.images).map((image) => image.storage_path));
  const db = await database();
  const keys = await db.getAllKeys("photos");
  return keys.filter((key) => !linked.has(key)).map((key) => ({ key, read: async () => {
    const entry = await db.get("photos",key);
    if (!entry) throw new Error("保留照片内容缺失，无法完成完整 ZIP 备份。");
    return entry.blob;
  } }));
}

export async function restoreLocalAtomically(data: AppData, photos: Array<{ image: MealImage; blob: Blob }>, previous: AppData, retained: Iterable<Blob> = []) {
  await saveQueue.catch(() => undefined);
  const next = structuredClone(persistedData(data));
  const entries = new Map<string, PhotoEntry>();
  for (const photo of photos) {
    const entry = await photoEntry(photo.blob);
    entries.set(entry.key, entry);
    for (const meal of next.meals) {
      const index = meal.images.findIndex((image) => image.id === photo.image.id);
      if (index >= 0) meal.images[index] = { ...meal.images[index], storage_path: entry.key, size_bytes: entry.blob.size, mime_type: entry.blob.type, sha256: entry.sha256, signed_url: undefined };
    }
  }
  for (const blob of retained) {
    const entry = await photoEntry(blob);
    entries.set(entry.key, entry);
  }
  await ensureSpace([...entries.values()].reduce((size, entry) => size + entry.blob.size, 0) + new Blob([JSON.stringify(next)]).size);
  const committed = await commitSnapshot(next, [...entries.values()], { key: `restore-${crypto.randomUUID()}`, data: persistedData(previous) });
  return hydrateLocalPhotos(committed);
}

async function commitSnapshot(data: AppData, photos: PhotoEntry[], recovery?: { key: string; data: AppData | string }, initializing = false): Promise<AppData> {
  const db = await database();
  const tx = db.transaction(["photos", "records", "recovery"], "readwrite");
  const writes: Promise<unknown>[] = [];
  const done = tx.done;
  try {
    const previous = await tx.objectStore("records").get("current");
    if (initializing && previous) { await done; loadedRevision = previous.revision || 0; return previous.data; }
    if ((previous?.revision || 0) !== loadedRevision) throw new Error("另一个页面已保存新记录。请导出当前改动后重新加载，避免覆盖其他页面的数据。");
    const revision = loadedRevision + 1;
    for (const photo of photos) writes.push(tx.objectStore("photos").put(photo));
    if (recovery) writes.push(tx.objectStore("recovery").put({ ...recovery, data: !initializing && previous ? previous.data : recovery.data, created_at: new Date().toISOString() }));
    writes.push(tx.objectStore("records").put({ key: "current", data, revision }));
    await Promise.all([...writes, done]);
    loadedRevision = revision;
    return data;
  } catch (error) {
    try { tx.abort(); } catch { /* A quota error may have already aborted the transaction. */ }
    await Promise.allSettled([...writes, done]);
    throw error instanceof Error ? error : new Error("本地存储事务未提交，原有记录和照片已保留。");
  }
}

export async function loadLocalData(seed: () => AppData): Promise<AppData> {
  const db = await database();
  const saved = await db.get("records", "current");
  if (saved) { loadedRevision = saved.revision || 0; return hydrateLocalPhotos(appDataSchema.parse(saved.data)); }
  loadedRevision = 0;
  const raw = localStorage.getItem(legacyStorageKey);
  const original = raw ? appDataSchema.parse(JSON.parse(raw)) : seed();
  const migrated = await migrateLegacyPhotos(original);
  await ensureSpace(migrated.entries.reduce((bytes, entry) => bytes + entry.blob.size, 0) + (raw?.length || 0) * 2);
  const committed = await commitSnapshot(migrated.data, migrated.entries, raw ? { key: "legacy-v1", data: raw } : undefined, true);
  if (raw) {
    try { localStorage.setItem(legacyStorageKey, JSON.stringify(committed)); } catch { /* The IndexedDB copy and original recovery snapshot remain durable. */ }
  }
  return hydrateLocalPhotos(committed);
}

let saveQueue = Promise.resolve();
export function saveLocalData(data: AppData): Promise<void> {
  const snapshot = persistedData(data);
  const save = saveQueue.catch(() => undefined).then(async () => {
    await ensureSpace(new Blob([JSON.stringify(snapshot)]).size);
    await commitSnapshot(snapshot, []);
  });
  saveQueue = save;
  return save;
}

export async function localStorageUsage(data: AppData) {
  const db = await database();
  const photos = await db.getAll("photos");
  const linked = data.meals.flatMap((meal) => meal.images);
  const estimate = typeof navigator !== "undefined" ? await navigator.storage?.estimate?.() : undefined;
  return {
    records: data.weights.length + data.meals.length + data.exercises.length + data.checkins.length + data.summaries.length,
    photoCount: linked.length,
    storedPhotoCount: photos.length,
    photoBytes: photos.reduce((bytes, photo) => bytes + photo.blob.size, 0),
    recordBytes: new Blob([JSON.stringify(persistedData(data))]).size,
    usage: estimate?.usage ?? null,
    quota: estimate?.quota ?? null,
  };
}

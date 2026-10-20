import { strFromU8, strToU8, unzip, zip, type Zippable } from "fflate";
import { z } from "zod";
import type { AppData, MealImage } from "./fat-loss";
import { appDataSchema, parseDataBackup } from "./schemas.ts";
import { dataUrlBlob, persistedData, sha256, type RetainedPhoto } from "./photo-storage.ts";

const maxExpandedBytes = 200 * 1024 * 1024;
const maxPhotoBytes = 10 * 1024 * 1024;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const fileSchema = z.object({ path: z.string(), bytes: z.number().int().nonnegative(), sha256: hashSchema });
const manifestSchema = z.object({
  app: z.literal("gentle-fat-loss-coach"),
  backup_version: z.literal(2),
  exported_at: z.iso.datetime(),
  files: z.array(fileSchema).max(10001),
  images: z.array(z.object({ id: z.string(), meal_record_id: z.string(), path: z.string(), mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]), bytes: z.number().int().nonnegative(), sha256: hashSchema })).max(10000),
  retained_images: z.array(z.object({ key: z.string().max(1000), path: z.string(), mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]), bytes: z.number().int().nonnegative(), sha256: hashSchema })).max(10000).default([]),
  counts: z.object({ weights: z.number().int(), meals: z.number().int(), exercises: z.number().int(), checkins: z.number().int(), summaries: z.number().int(), photos: z.number().int() }),
});
export type BackupManifest = z.infer<typeof manifestSchema>;
export type PreparedBackup = { format: "zip" | "json"; data: AppData; photos: Map<string, Blob>; retainedPhotos?: Map<string, Blob>; manifest?: BackupManifest; warnings: string[]; missingImageIds: string[] };
export type PhotoReader = (image: MealImage) => Promise<Blob>;

function parseJson(text: string, name: string): unknown {
  try { return JSON.parse(text); } catch { throw new Error(`${name} JSON 格式损坏，现有记录未修改。`); }
}

export function backupCounts(data: AppData) {
  return { weights: data.weights.length, meals: data.meals.length, exercises: data.exercises.length, checkins: data.checkins.length, summaries: data.summaries.length, photos: data.meals.reduce((count, meal) => count + meal.images.length, 0) };
}

export async function detectPhotoType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (strFromU8(bytes.subarray(0, 4)) === "RIFF" && strFromU8(bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  throw new Error("照片文件内容不是支持的 JPEG、PNG 或 WebP 图片。");
}

export async function exportZipBackup(data: AppData, readPhoto: PhotoReader, onProgress?: (done: number, total: number) => void, retained: RetainedPhoto[] = []): Promise<Blob> {
  const records = structuredClone(persistedData(appDataSchema.parse(data)));
  const manifest: BackupManifest = { app: "gentle-fat-loss-coach", backup_version: 2, exported_at: new Date().toISOString(), files: [], images: [], retained_images: [], counts: backupCounts(records) };
  if (manifest.counts.photos + retained.length > 10000) throw new Error("照片总数超过此版本 10000 张的备份上限。");
  const files: Zippable = {};
  let bytesTotal = 0;
  let done = 0;
  const ids = new Set<string>();
  for (const meal of records.meals) {
    for (let index = 0; index < meal.images.length; index += 1) {
      const image = meal.images[index];
      if (ids.has(image.id) || image.meal_record_id !== meal.id) throw new Error("照片编号重复或餐食关联无效，导出已停止。");
      ids.add(image.id);
      const blob = await readPhoto(image);
      if (blob.size > maxPhotoBytes) throw new Error("单张照片超过 10 MB，请先压缩后再备份。");
      bytesTotal += blob.size;
      if (bytesTotal > maxExpandedBytes) throw new Error("完整备份超过 200 MB，此版本无法安全导出。");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const mime = await detectPhotoType(bytes);
      const hash = await sha256(bytes);
      const filePath = `images/${done}_${hash}.${mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png"}`;
      files[filePath] = [bytes, { level: 0 }];
      const info = { path: filePath, bytes: bytes.length, sha256: hash };
      manifest.files.push(info);
      manifest.images.push({ ...info, id: image.id, meal_record_id: meal.id, mime_type: mime });
      meal.images[index] = { ...image, storage_path: filePath, size_bytes: bytes.length, mime_type: mime, sha256: hash, signed_url: undefined };
      done += 1;
      onProgress?.(done, manifest.counts.photos + retained.length);
    }
  }
  for (const photo of retained) {
    const blob = await photo.read();
    bytesTotal += blob.size;
    if (blob.size > maxPhotoBytes || bytesTotal > maxExpandedBytes) throw new Error("保留照片超过完整备份容量限制。");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mime = await detectPhotoType(bytes);
    const hash = await sha256(bytes);
    const filePath = `images/${done}_${hash}.${mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png"}`;
    files[filePath] = [bytes, { level: 0 }];
    const info = { path: filePath, bytes: bytes.length, sha256: hash };
    manifest.files.push(info); manifest.retained_images.push({ ...info, key: photo.key, mime_type: mime });
    done += 1; onProgress?.(done, manifest.counts.photos + retained.length);
  }
  const recordBytes = strToU8(JSON.stringify(records));
  if (recordBytes.length > 20 * 1024 * 1024 || bytesTotal + recordBytes.length > maxExpandedBytes) throw new Error("记录数据超过备份容量限制，原有数据未修改。");
  files["records.json"] = [recordBytes, { level: 6 }];
  manifest.files.unshift({ path: "records.json", bytes: recordBytes.length, sha256: await sha256(recordBytes) });
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  const compressed = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 1 }, (error, result) => error ? reject(error) : resolve(result)));
  return new Blob([new Uint8Array(compressed).buffer], { type: "application/zip" });
}

// Inspect ZIP central-directory sizes before decompression to bound ZIP bombs.
function validateZipDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let cursor = bytes.length - 22; cursor >= Math.max(0, bytes.length - 65557); cursor -= 1) {
    if (view.getUint32(cursor, true) === 0x06054b50 && cursor + 22 + view.getUint16(cursor + 20, true) === bytes.length) { end = cursor; break; }
  }
  if (end < 0) throw new Error("ZIP 文件损坏或下载未完成，请重新选择完整备份。");
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let cursor = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 || count > 10002 || cursor + directorySize > end) throw new Error("ZIP 文件格式或大小不受支持。");
  const names = new Set<string>();
  let expanded = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("ZIP 文件目录损坏。");
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const length = 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    if (cursor + length > end || view.getUint16(cursor + 8, true) & 1 || ![0, 8].includes(view.getUint16(cursor + 10, true))) throw new Error("不支持加密或异常压缩格式的 ZIP。");
    const name = strFromU8(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (names.has(name) || !(name === "records.json" || name === "manifest.json" || name === "images/" || /^images\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(name))) throw new Error("ZIP 包含重复、异常路径或不支持的文件。");
    names.add(name);
    expanded += size;
    const limit = name === "records.json" ? 20 * 1024 * 1024 : name === "manifest.json" ? 2 * 1024 * 1024 : maxPhotoBytes;
    if (size > limit || expanded > maxExpandedBytes) throw new Error("ZIP 解压后超过安全容量限制，未写入任何数据。");
    cursor += length;
  }
  if (cursor !== view.getUint32(end + 16, true) + directorySize) throw new Error("ZIP 目录长度校验失败。");
}

export async function inspectBackup(blob: Blob, filename: string): Promise<PreparedBackup> {
  if (blob.size > maxExpandedBytes) throw new Error("备份文件不能超过 200 MB。");
  if (/\.json$/i.test(filename)) {
    const data = parseDataBackup(parseJson(await blob.text(), "备份"));
    const photos = new Map<string, Blob>();
    const missingImageIds: string[] = [];
    for (const meal of data.meals) for (const image of meal.images) {
      if (image.storage_path.startsWith("data:image/")) photos.set(image.id, await dataUrlBlob(image.storage_path));
      else missingImageIds.push(image.id);
    }
    return { format: "json", data, photos, missingImageIds, warnings: missingImageIds.length ? [`旧 JSON 中有 ${missingImageIds.length} 张照片仅包含路径。需要完整 ZIP 才能完整恢复；可明确选择仅合并记录，现有照片仍保留。`] : [] };
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  validateZipDirectory(bytes);
  let files: Record<string, Uint8Array>;
  try { files = await new Promise((resolve, reject) => unzip(bytes, (error, result) => error ? reject(error) : resolve(result))); }
  catch { throw new Error("ZIP 解压失败，文件可能损坏。原有记录未修改。"); }
  if (!files["manifest.json"] || !files["records.json"]) throw new Error("ZIP 缺失 manifest.json 或 records.json。");
  const result = manifestSchema.safeParse(parseJson(strFromU8(files["manifest.json"]), "manifest"));
  if (!result.success) throw new Error("备份 manifest 格式或版本不受支持。");
  const manifest = result.data;
  if (manifest.images.length + manifest.retained_images.length > 10000) throw new Error("备份照片总数超过 10000 张上限。");
  const listed = new Set<string>();
  for (const file of manifest.files) {
    if (listed.has(file.path) || file.path === "manifest.json") throw new Error("备份文件清单重复或无效。");
    listed.add(file.path);
    const content = files[file.path];
    if (!content) throw new Error(`备份缺失照片或文件：${file.path}。未恢复任何数据。`);
    if (content.length !== file.bytes || await sha256(content) !== file.sha256) throw new Error(`文件校验失败：${file.path}，备份可能损坏。`);
  }
  if (!listed.has("records.json") || Object.keys(files).some((file) => file !== "manifest.json" && file !== "images/" && !listed.has(file))) throw new Error("备份文件与 manifest 清单不一致。");
  const parsedRecords = appDataSchema.safeParse(parseJson(strFromU8(files["records.json"]), "records"));
  if (!parsedRecords.success) throw new Error("备份中的记录格式或营养数值不受支持，未写入数据。");
  const data = parsedRecords.data;
  const counts = backupCounts(data);
  if (Object.keys(counts).some((key) => counts[key as keyof typeof counts] !== manifest.counts[key as keyof typeof counts]) || counts.photos !== manifest.images.length) throw new Error("备份记录数量或照片数量校验失败。");
  const photos = new Map<string, Blob>();
  const retainedPhotos = new Map<string, Blob>();
  const imageIds = new Set<string>();
  for (const meal of data.meals) for (const image of meal.images) {
    if (imageIds.has(image.id)) throw new Error("备份中照片 ID 重复。");
    imageIds.add(image.id);
    const file = manifest.images.find((item) => item.id === image.id && item.meal_record_id === meal.id && item.path === image.storage_path);
    if (!file || image.meal_record_id !== meal.id || !listed.has(file.path) || !files[file.path]) throw new Error("照片和餐食记录关联校验失败。");
    const content = files[file.path];
    if (file.bytes !== content.length || file.sha256 !== await sha256(content) || file.mime_type !== await detectPhotoType(content)) throw new Error("照片校验信息不匹配。");
    photos.set(image.id, new Blob([new Uint8Array(content).buffer], { type: file.mime_type }));
  }
  const usedPaths = new Set(manifest.images.map((image) => image.path));
  for (const retained of manifest.retained_images) {
    const content = files[retained.path];
    if (!listed.has(retained.path) || !content || usedPaths.has(retained.path) || retainedPhotos.has(retained.key)) throw new Error("保留照片清单重复或缺失。");
    usedPaths.add(retained.path);
    if (retained.bytes !== content.length || retained.sha256 !== await sha256(content) || retained.mime_type !== await detectPhotoType(content)) throw new Error("保留照片校验失败。");
    retainedPhotos.set(retained.key,new Blob([new Uint8Array(content).buffer],{ type: retained.mime_type }));
  }
  if (manifest.files.filter((file) => file.path.startsWith("images/")).length !== usedPaths.size) throw new Error("照片文件清单与关联信息不一致。");
  return { format: "zip", data, photos, retainedPhotos, manifest, warnings: [], missingImageIds: [] };
}

import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory as FDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { randomBytes } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { addDays, buildDefaultData, todayString } from "../lib/fat-loss.ts";
import { createDataBackup, mergeBackupData } from "../lib/schemas.ts";
import { legacyStorageKey, loadLocalData, localRetainedPhotos, localStorageUsage, readLocalPhoto, restoreLocalAtomically, saveLocalData, storePhoto } from "../lib/photo-storage.ts";
import { exportZipBackup, inspectBackup } from "../lib/zip-backup.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2WQAAAAASUVORK5CYII=", "base64");

test("unassociated retained photos are included in ZIP and survive atomic restore",async () => {
  isolate();
  const data = await loadLocalData(() => buildDefaultData("demo-local-user"));
  await storePhoto(new Blob([png],{ type: "image/png" }));
  const archive = await exportZipBackup(data,readLocalPhoto,undefined,await localRetainedPhotos(data));
  const backup = await inspectBackup(archive,"retained.zip");
  assert.equal(backup.photos.size,0); assert.equal(backup.retainedPhotos.size,1);
  isolate();
  const previous = await loadLocalData(() => buildDefaultData("demo-local-user"));
  const restored = await restoreLocalAtomically(backup.data,[],previous,backup.retainedPhotos.values());
  assert.equal((await localStorageUsage(restored)).storedPhotoCount,1);
});
function isolate() {
  globalThis.indexedDB = new FDBFactory();
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,String(value)) };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }) } } });
  return storage;
}
function meal(id, images = []) { return { id, user_id: "demo-local-user", record_date: todayString(), meal_type: "lunch", food_name: "测试午餐", portion: "一份", notes: "", ai_analysis: null, nutrition: null, images }; }
function image(id, mealId, storagePath) { return { id, user_id: "demo-local-user", record_date: todayString(), meal_record_id: mealId, storage_path: storagePath, signed_url: storagePath }; }

test("legacy Base64 photos migrate safely with a durable original snapshot", async () => {
  const storage = isolate();
  const original = buildDefaultData("demo-local-user");
  const photo = `data:image/png;base64,${png.toString("base64")}`;
  original.meals = [meal("legacy-meal", [image("legacy-photo", "legacy-meal", photo)])];
  const raw = JSON.stringify(original);
  storage.set(legacyStorageKey, raw);
  const migrated = await loadLocalData(() => { throw Error("must not seed existing data"); });
  assert.match(migrated.meals[0].images[0].storage_path, /^idb:/);
  assert.deepEqual(Buffer.from(await (await readLocalPhoto(migrated.meals[0].images[0])).arrayBuffer()), png);
  assert.equal(storage.get(legacyStorageKey).includes("base64"), false);
  const db = await openDB("gentle-fat-loss-coach-v2", 1);
  assert.equal((await db.get("recovery", "legacy-v1")).data, raw);
  assert.equal((await loadLocalData(() => original)).meals.length, 1);
});

test("migration quota failure never replaces old photos or records", async () => {
  const storage = isolate();
  const original = buildDefaultData("demo-local-user");
  original.meals = [meal("old-meal", [image("old-photo", "old-meal", `data:image/png;base64,${png.toString("base64")}`)])];
  const raw = JSON.stringify(original);
  storage.set(legacyStorageKey, raw);
  navigator.storage.estimate = async () => ({ usage: 1000, quota: 1001 });
  await assert.rejects(loadLocalData(() => original), /空间不足/);
  assert.equal(storage.get(legacyStorageKey), raw);
  const db = await openDB("gentle-fat-loss-coach-v2", 1);
  assert.equal(await db.get("records", "current"), undefined);
});

test("30 days and 100 photos survive ZIP restore and a second ZIP export", async () => {
  isolate();
  const original = await loadLocalData(() => buildDefaultData("demo-local-user"));
  original.profile.age = 30;
  original.weights = Array.from({ length: 30 }, (_,index) => ({ id: `weight-${index}`, user_id: "demo-local-user", record_date: addDays(todayString(), index - 29), weight_kg: 56 - index * 0.02, note: "测试", high_salt: false, late_dinner: false, menstrual_period: false, bowel_movement: true, poor_sleep: false, hard_training_previous_day: false }));
  for (let index = 0; index < 100; index += 1) {
    const bytes = Buffer.concat([png, randomBytes(200 * 1024)]);
    const photo = await storePhoto(new Blob([bytes], { type: "image/png" }));
    original.meals.push(meal(`meal-${index}`, [{ ...image(`photo-${index}`, `meal-${index}`, photo.storage_path), ...photo, signed_url: undefined }]));
  }
  await saveLocalData(original);
  const loaded = await loadLocalData(() => { throw Error("must not reset"); });
  assert.equal(loaded.weights.length, 30);
  assert.equal((await localStorageUsage(loaded)).photoCount, 100);
  const firstZip = await exportZipBackup(loaded, readLocalPhoto);
  const prepared = await inspectBackup(firstZip, "first.zip");
  assert.equal(prepared.photos.size, 100);
  assert.equal(prepared.manifest.files.length, 101);
  const parsedFiles = unzipSync(new Uint8Array(await firstZip.arrayBuffer()));
  assert.equal(strFromU8(parsedFiles["records.json"]).includes("signed_url"), false);
  const restored = await restoreLocalAtomically(mergeBackupData(loaded, prepared.data), prepared.data.meals.flatMap((item) => item.images).map((item) => ({ image: item, blob: prepared.photos.get(item.id) })), loaded);
  const secondZip = await exportZipBackup(restored, readLocalPhoto);
  const second = await inspectBackup(secondZip, "second.zip");
  assert.deepEqual(second.manifest.images.map((item) => item.sha256), prepared.manifest.images.map((item) => item.sha256));
  assert.deepEqual(second.data, prepared.data);
  assert.equal((await localStorageUsage(restored)).storedPhotoCount, 100);
  await saveLocalData(restored);
  assert.equal((await loadLocalData(() => original)).meals.length, 100);
});

test("damaged ZIP, missing images, altered records and future versions are rejected", async () => {
  isolate();
  const data = await loadLocalData(() => buildDefaultData("demo-local-user"));
  const photo = await storePhoto(new Blob([png], { type: "image/png" }));
  data.meals = [meal("meal", [{ ...image("photo", "meal", photo.storage_path), ...photo }])];
  const blob = await exportZipBackup(data, readLocalPhoto);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await assert.rejects(inspectBackup(new Blob([bytes.slice(0,-12)]), "broken.zip"), /损坏|未完成/);
  const files = unzipSync(bytes);
  const missing = { ...files }; delete missing[Object.keys(missing).find((key) => key.startsWith("images/"))];
  await assert.rejects(inspectBackup(new Blob([zipSync(missing)]), "missing.zip"), /缺失照片/);
  const tampered = { ...files, "records.json": strToU8("{}") };
  await assert.rejects(inspectBackup(new Blob([zipSync(tampered)]), "tampered.zip"), /校验失败/);
  const manifest = JSON.parse(strFromU8(files["manifest.json"])); manifest.backup_version = 999;
  await assert.rejects(inspectBackup(new Blob([zipSync({ ...files, "manifest.json": strToU8(JSON.stringify(manifest)) })]), "future.zip"), /版本/);
});

test("old JSON backups keep Base64 photos and clearly report link-only images", async () => {
  const data = buildDefaultData("demo-local-user");
  data.meals = [meal("meal", [image("photo", "meal", `data:image/png;base64,${png.toString("base64")}`), image("link", "meal", "old-user/cloud.jpg")])];
  const prepared = await inspectBackup(new Blob([JSON.stringify(createDataBackup(data))]), "old.json");
  assert.equal(prepared.photos.size, 1);
  assert.deepEqual(prepared.missingImageIds, ["link"]);
  assert.match(prepared.warnings[0], /仅包含路径/);
});

test("interrupted local restore aborts the entire transaction and retains the old snapshot", async () => {
  isolate();
  const previous = await loadLocalData(() => buildDefaultData("demo-local-user"));
  const incoming = structuredClone(previous); incoming.profile.diet_preferences = "不应提交";
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value,...args) {
    if (this.name === "records") throw new DOMException("Injected interruption", "AbortError");
    return originalPut.call(this,value,...args);
  };
  try { await assert.rejects(restoreLocalAtomically(incoming, [{ image: image("p","m","placeholder"), blob: new Blob([png], { type: "image/png" }) }], previous), /interruption/); }
  finally { IDBObjectStore.prototype.put = originalPut; }
  const db = await openDB("gentle-fat-loss-coach-v2",1);
  assert.equal((await db.get("records","current")).data.profile.diet_preferences, previous.profile.diet_preferences);
  assert.equal(await db.count("photos"), 0);
});

test("another tab cannot silently overwrite a newer revision", async () => {
  isolate();
  const previous = await loadLocalData(() => buildDefaultData("demo-local-user"));
  const db = await openDB("gentle-fat-loss-coach-v2",1);
  const latest = await db.get("records","current");
  latest.data.profile.diet_preferences = "另一个页面的数据"; latest.revision += 1;
  await db.put("records",latest);
  await assert.rejects(saveLocalData(previous), /另一个页面/);
  assert.equal((await db.get("records","current")).data.profile.diet_preferences, "另一个页面的数据");
});

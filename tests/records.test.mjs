import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { addDays, buildDefaultData, emptyTasks, movingAverage } from "../lib/fat-loss.ts";
import { appDataSchema, createDataBackup, mergeBackupData, parseDataBackup } from "../lib/schemas.ts";

function weight(date, value, id = date) {
  return {
    id, user_id: "local-user", record_date: date, weight_kg: value,
    note: "", high_salt: false, late_dinner: false, menstrual_period: false,
    bowel_movement: false, poor_sleep: false, hard_training_previous_day: false,
  };
}

test("calendar dates survive Shanghai midnight, month boundaries and DST", () => {
  const moduleUrl = new URL("../lib/fat-loss.ts", import.meta.url).href;
  for (const timezone of ["Asia/Shanghai", "America/New_York"]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { todayString, addDays, daysBetween } from ${JSON.stringify(moduleUrl)};
      assert.equal(todayString(new Date(2026, 9, 12, 0, 5)), "2026-10-12");
      assert.equal(addDays("2026-10-01", -1), "2026-09-30");
      assert.equal(addDays("2028-02-28", 1), "2028-02-29");
      assert.equal(addDays("2026-03-08", 1), "2026-03-09");
      assert.equal(daysBetween("2026-11-01", "2026-11-02"), 1);
    `], { env: { ...process.env, TZ: timezone }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(addDays("2026-10-12", -8), "2026-10-04");
});

test("seven-day weight averages exclude older records when days are missing", () => {
  const records = [weight("2026-10-12", 54), weight("2026-10-01", 60), weight("2026-10-06", 56)];
  assert.deepEqual(movingAverage(records).map((record) => record.moving_average), [60, 58, 55]);
  assert.equal(records[0].record_date, "2026-10-12");
});

test("backup round trips records and embedded photos without signed cloud URLs", () => {
  const original = buildDefaultData("local-user");
  original.weights = [weight("2026-10-12", 54)];
  original.meals = [{
    id: "meal-one", user_id: "local-user", record_date: "2026-10-12",
    meal_type: "lunch", food_name: "午餐", portion: "一份", notes: "", ai_analysis: null,
    images: [
      { id: "image-one", user_id: "local-user", record_date: "2026-10-12", meal_record_id: "meal-one", storage_path: "data:image/jpeg;base64,YQ==", signed_url: "data:image/jpeg;base64,YQ==" },
      { id: "image-two", user_id: "local-user", record_date: "2026-10-12", meal_record_id: "meal-one", storage_path: "user/photo.jpg", signed_url: "https://example.com/photo?token=temporary" },
    ],
  }];
  const backup = JSON.parse(JSON.stringify(createDataBackup(original)));
  const restored = mergeBackupData(buildDefaultData("new-user"), parseDataBackup(backup));
  assert.deepEqual(restored.weights.map((record) => record.weight_kg), [54]);
  assert.equal(restored.meals[0].images[0].signed_url, "data:image/jpeg;base64,YQ==");
  assert.equal(restored.meals[0].images[1].signed_url, undefined);
  assert.equal(restored.meals[0].images[0].user_id, "new-user");
  assert.equal(original.meals[0].images[1].signed_url, "https://example.com/photo?token=temporary");
  assert.equal(JSON.stringify(backup).includes("token=temporary"), false);
});

test("restore merges records by date and ID, keeps photos and is idempotent", () => {
  const current = buildDefaultData("local-user");
  current.weights = [weight("2026-10-10", 56), weight("2026-10-12", 55, "old-id")];
  const incoming = buildDefaultData("another-user");
  incoming.weights = [weight("2026-10-12", 54, "backup-id")];
  incoming.profile.diet_preferences = "恢复的偏好";
  const meal = {
    id: "meal-one", user_id: "local-user", record_date: "2026-10-12",
    meal_type: "dinner", food_name: "晚餐", portion: "一份", notes: "", ai_analysis: null,
    images: [{ id: "old-photo", user_id: "local-user", record_date: "2026-10-12", meal_record_id: "meal-one", storage_path: "data:image/jpeg;base64,YQ==" }],
  };
  current.meals = [meal];
  incoming.meals = [{ ...meal, images: [{ ...meal.images[0], id: "restored-photo" }] }];
  incoming.checkins = [{
    id: "checkin", user_id: "another-user", record_date: "2026-10-12",
    tasks: { ...emptyTasks(), weighed: true }, water_ml: 0, sleep_hours: null,
    body_feeling: "", bowel_movement: false, menstrual_period: false, completion_score: 100,
  }];
  const restored = mergeBackupData(current, parseDataBackup(createDataBackup(incoming)));
  assert.equal(restored.weights.length, 2);
  assert.equal(restored.weights[1].weight_kg, 54);
  assert.equal(restored.checkins[0].completion_score, 11);
  assert.equal(restored.profile.id, current.profile.id);
  assert.equal(restored.profile.user_id, "local-user");
  assert.equal(restored.profile.diet_preferences, "恢复的偏好");
  assert.equal(restored.meals[0].images.length, 2);
  assert.equal(current.weights[1].weight_kg, 55);
  assert.deepEqual(mergeBackupData(restored, parseDataBackup(createDataBackup(incoming))), restored);
});

test("invalid or unsupported backups are rejected without touching records", () => {
  const current = buildDefaultData("local-user");
  const original = structuredClone(current);
  const backup = createDataBackup(current);
  assert.throws(() => parseDataBackup({ ...backup, version: 2 }), /版本/);
  assert.throws(() => parseDataBackup({ ...backup, data: { ...backup.data, weights: [weight("2026-02-30", 55)] } }), /格式/);
  assert.throws(() => parseDataBackup({ ...backup, data: { ...backup.data, meals: null } }), /格式/);
  assert.equal(appDataSchema.safeParse({ profile: {} }).success, false);
  assert.deepEqual(current, original);
});

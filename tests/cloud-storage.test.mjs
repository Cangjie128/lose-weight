import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultData, todayString } from "../lib/fat-loss.ts";
import { cloudRetainedPhotos,fetchAllRows, restoreCloudBackup } from "../lib/cloud-storage.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const source = buildDefaultData("demo-local-user");
source.meals = [{ id: "old-meal-id", user_id: "demo-local-user", record_date: todayString(), meal_type: "lunch", food_name: "测试午餐", portion: "200g", notes: "", ai_analysis: null, images: [{ id: "old-photo-id", user_id: "demo-local-user", record_date: todayString(), meal_record_id: "old-meal-id", storage_path: "images/photo.png" }] }];
const backup = { format: "zip", data: source, photos: new Map([["old-photo-id",new Blob(["test-photo-bytes"],{ type: "image/png" })]]), warnings: [], missingImageIds: [] };

function cloudClient() {
  const files = new Map();
  const commits = [];
  return { files, commits, client: {
    storage: { from: () => ({
      upload: async (path,blob) => {
        if (files.has(path)) return { error: { statusCode: "409", message: "already exists" } };
        files.set(path,blob); return { error: null };
      },
      download: async (path) => ({ data: files.get(path), error: files.has(path) ? null : { message: "missing" } }),
    }) },
    rpc: async (name,payload) => { assert.equal(name,"restore_v2_backup"); commits.push(payload.p_data); return { error: null }; },
  } };
}

test("cloud restore maps local IDs, keeps private photo associations and avoids duplicates", async () => {
  const mock = cloudClient();
  const current = buildDefaultData(owner);
  const first = await restoreCloudBackup(mock.client,current,backup,false);
  const second = await restoreCloudBackup(mock.client,first,backup,false);
  assert.equal(mock.files.size,1);
  assert.equal(second.meals.length,1);
  assert.equal(second.meals[0].images.length,1);
  assert.match(second.meals[0].id,/^[a-f0-9-]{36}$/);
  assert.equal(second.meals[0].images[0].meal_record_id,second.meals[0].id);
  assert.equal(second.meals[0].images[0].user_id,owner);
  assert.match(second.meals[0].images[0].storage_path,new RegExp(`^${owner}/`));
  assert.equal(JSON.stringify(mock.commits).includes("signed_url"),false);
  assert.deepEqual(second,first);
});

test("cloud upload interruption never submits the record transaction", async () => {
  const mock = cloudClient();
  mock.client.storage.from = () => ({ upload: async () => ({ error: { statusCode: "500", message: "network lost" } }) });
  await assert.rejects(restoreCloudBackup(mock.client,buildDefaultData(owner),backup,false),/中断/);
  assert.equal(mock.commits.length,0);
});

test("cloud quota errors keep records, and private retained photos are scoped to the owner",async () => {
  const mock = cloudClient();
  mock.client.storage.from = () => ({ upload: async () => ({ error: { message: "storage quota exceeded" } }) });
  await assert.rejects(restoreCloudBackup(mock.client,buildDefaultData(owner),backup,false),/容量不足/);
  assert.equal(mock.commits.length,0);
  const scopes = [];
  mock.client.storage.from = () => ({ list: async (prefix) => {
    scopes.push(prefix);
    return { data: prefix === owner ? [{ name: "retained",id: null,metadata: null }] : [{ name: "one.jpg",id: "photo-id",metadata: { size: 200000 } }],error: null };
  } });
  const retained = await cloudRetainedPhotos(mock.client,buildDefaultData(owner));
  assert.equal(retained.length,1); assert.equal(retained[0].size_bytes,200000);
  assert.ok(scopes.every((prefix) => prefix === owner || prefix.startsWith(`${owner}/`)));
});

test("cloud rows are paginated and every query stays scoped to the signed-in user", async () => {
  const records = Array.from({ length: 1201 },(_,index) => ({ id: `${index}`, user_id: owner }));
  const scopes = [];
  const mock = { from: () => ({ select() { return this; }, eq(column,value) { scopes.push([column,value]); return this; }, order() { return this; }, async range(start,end) { return { data: records.slice(start,end+1), error: null }; } }) };
  const rows = await fetchAllRows(mock,"weight_records",owner);
  assert.equal(rows.length,1201);
  assert.deepEqual(scopes,[ ["user_id",owner], ["user_id",owner], ["user_id",owner] ]);
});

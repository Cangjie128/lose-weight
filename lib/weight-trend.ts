import { movingAverage, type WeightRecord } from "./fat-loss.ts";

export const weighingPeriodLabels = { morning_fasting:"晨起空腹",daytime:"白天",evening_after_meal:"晚上饭后",other:"其他" } as const;
export const foodStateLabels = { fasting:"空腹",before_meal:"进食前",after_meal:"进食后",unspecified:"未注明" } as const;
export const bowelStateLabels = { before:"排便前",after:"排便后",unspecified:"未注明" } as const;

export function weightConditionLabel(record: WeightRecord) {
  const parts: string[] = [record.weighing_period ? weighingPeriodLabels[record.weighing_period] : "时段未注明"];
  parts.push(record.weighed_at || "时间未注明");
  if (record.food_state && record.food_state !== "unspecified") parts.push(foodStateLabels[record.food_state]);
  if (record.bowel_state && record.bowel_state !== "unspecified") parts.push(bowelStateLabels[record.bowel_state]);
  return parts.join(" · ");
}

function conditionKey(record: WeightRecord) {
  return `${record.weighing_period || "legacy"}:${record.food_state || "unspecified"}:${record.bowel_state || "unspecified"}`;
}

export function primaryWeightRecords(weights: WeightRecord[]) {
  const morning = weights.filter((record) => record.weighing_period === "morning_fasting" && record.food_state !== "after_meal");
  const legacy = weights.filter((record) => !record.weighing_period);
  let source = morning.length ? morning : legacy.length ? legacy : weights;
  // Keep food and bowel conditions comparable, then select the earliest measurement per calendar day.
  const groups = new Map<string,WeightRecord[]>();
  for (const record of source) { const key=conditionKey(record); groups.set(key,[...(groups.get(key) || []),record]); }
  source = [...groups.entries()].sort((a,b) => new Set(b[1].map((item) => item.record_date)).size-new Set(a[1].map((item) => item.record_date)).size || a[0].localeCompare(b[0]))[0]?.[1] || [];
  source = [...source].sort((a,b) => a.record_date.localeCompare(b.record_date) || (a.weighed_at || "99:99").localeCompare(b.weighed_at || "99:99") || (a.created_at || "").localeCompare(b.created_at || ""));
  const perDay = new Map<string,WeightRecord>();
  for (const record of source) if (!perDay.has(record.record_date)) perDay.set(record.record_date,record);
  const sample=source[0];
  const condition=sample ? [sample.weighing_period ? weighingPeriodLabels[sample.weighing_period] : "旧记录（时段未注明）",sample.food_state && sample.food_state!=="unspecified" ? foodStateLabels[sample.food_state] : "",sample.bowel_state && sample.bowel_state!=="unspecified" ? bowelStateLabels[sample.bowel_state] : ""].filter(Boolean).join(" · ") : "尚无同条件记录";
  return { condition,records:[...perDay.values()] };
}

export function primaryWeightTrend(weights: WeightRecord[],windowSize=7) {
  const selected=primaryWeightRecords(weights);
  return { ...selected,trend:movingAverage(selected.records,windowSize) };
}

export function latestPrimaryWeight(weights: WeightRecord[]) { return primaryWeightRecords(weights).records.at(-1); }

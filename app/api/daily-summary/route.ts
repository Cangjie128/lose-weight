import {
  dailySummaryJsonSchema,
  dailySummarySchema,
  extractResponseText,
} from "@/lib/schemas";

export const runtime = "edge";

type DailySummaryPayload = {
  profile?: unknown;
  record_date?: string;
  weight_records?: unknown[];
  meals?: unknown[];
  exercises?: unknown[];
  checkin?: unknown;
  trend?: unknown;
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "服务端尚未配置 OPENAI_API_KEY，暂时无法生成 AI 总结。" },
      { status: 503 },
    );
  }

  let payload: DailySummaryPayload;
  try {
    payload = (await request.json()) as DailySummaryPayload;
  } catch {
    return Response.json({ error: "请求格式无效。" }, { status: 400 });
  }

  const hasDiscomfort = JSON.stringify(payload.exercises ?? []).match(
    /疼|痛|头晕|眩晕|抽筋|不适|过度疲劳|恶心|胸闷/,
  );

  const prompt = [
    `日期：${payload.record_date ?? "未填写"}`,
    `用户资料：${JSON.stringify(payload.profile ?? {})}`,
    `近期体重：${JSON.stringify(payload.weight_records ?? [])}`,
    `趋势信息：${JSON.stringify(payload.trend ?? {})}`,
    `当日饮食：${JSON.stringify(payload.meals ?? [])}`,
    `当日运动：${JSON.stringify(payload.exercises ?? [])}`,
    `打卡和身体状态：${JSON.stringify(payload.checkin ?? {})}`,
    hasDiscomfort
      ? "注意：用户记录过疼痛、不适、头晕、抽筋或过度疲劳，请优先建议休息、降低强度或必要时寻求专业意见。"
      : "",
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6",
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "你是一名温和但理性的中文小基数减脂教练。不要羞辱、不要鸡汤化、不要鼓励节食、不吃晚饭、过度运动或用运动惩罚饮食。体重上涨时先解释水分、盐分、月经期、排便、晚餐时间、训练后炎症和睡眠等波动因素，再给小调整。",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "请生成当天总结和明天建议。必须返回简体中文 JSON。优先给出可以马上执行的小调整。若运动记录包含明显不适，safety_warning 必须提醒休息或专业意见。\n\n" +
                  prompt,
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "daily_fat_loss_summary",
            strict: true,
            schema: dailySummaryJsonSchema,
          },
        },
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      return Response.json(
        { error: result?.error?.message || "AI 总结请求失败。" },
        { status: response.status },
      );
    }

    const text = extractResponseText(result);
    const parsed = dailySummarySchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return Response.json(
        { error: "AI 返回格式未通过校验，请稍后重试。" },
        { status: 422 },
      );
    }

    return Response.json({ summary: parsed.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 总结异常。";
    return Response.json({ error: message }, { status: 500 });
  }
}

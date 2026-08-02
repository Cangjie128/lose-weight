import {
  extractResponseText,
  mealAnalysisJsonSchema,
  mealAnalysisSchema,
} from "@/lib/schemas";

export const runtime = "edge";

type MealAnalyzePayload = {
  meal_type?: string;
  food_name?: string;
  portion?: string;
  notes?: string;
  profile?: unknown;
  image_urls?: string[];
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "服务端尚未配置 OPENAI_API_KEY，已保留手动记录能力。" },
      { status: 503 },
    );
  }

  let payload: MealAnalyzePayload;
  try {
    payload = (await request.json()) as MealAnalyzePayload;
  } catch {
    return Response.json({ error: "请求格式无效。" }, { status: 400 });
  }

  const mealText = [
    `餐次：${payload.meal_type ?? "未填写"}`,
    `食物描述：${payload.food_name || "未填写"}`,
    `分量：${payload.portion || "未填写"}`,
    `备注：${payload.notes || "无"}`,
    `用户资料：${JSON.stringify(payload.profile ?? {})}`,
  ].join("\n");

  const imageParts = (payload.image_urls ?? [])
    .filter(
      (url) =>
        typeof url === "string" &&
        (url.startsWith("http") || url.startsWith("data:image")),
    )
    .slice(0, 4)
    .map((image_url) => ({
      type: "input_image",
      image_url,
      detail: "low",
    }));

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
                  "你是一名温和、理性、反节食的中文减脂教练。你只做粗略估算，不把热量说成精确值，不羞辱用户，不鼓励不吃饭或用运动惩罚饮食。",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "请根据照片和文字描述分析这一餐。必须用简体中文返回结构化 JSON。热量必须是范围，uncertainty_note 必须明确包含“根据照片和描述估算，存在误差”。\n\n" +
                  mealText,
              },
              ...imageParts,
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "meal_analysis",
            strict: true,
            schema: mealAnalysisJsonSchema,
          },
        },
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      return Response.json(
        { error: result?.error?.message || "AI 分析请求失败。" },
        { status: response.status },
      );
    }

    const text = extractResponseText(result);
    const parsed = mealAnalysisSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return Response.json(
        { error: "AI 返回格式未通过校验，请稍后重试或手动填写。" },
        { status: 422 },
      );
    }

    return Response.json({ analysis: parsed.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 分析异常。";
    return Response.json({ error: message }, { status: 500 });
  }
}

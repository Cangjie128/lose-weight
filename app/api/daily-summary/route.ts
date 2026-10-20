import { handleAiRequest } from "@/lib/ai-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleAiRequest(request, "summary");
}

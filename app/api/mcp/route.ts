import { handleReadMcp } from "@/lib/mcp-read";
export const runtime = "nodejs";
export function POST(request: Request) { return handleReadMcp(request); }
export function GET() { return new Response(null,{ status: 405,headers: { Allow: "POST" } }); }
export function DELETE() { return new Response(null,{ status: 405,headers: { Allow: "POST" } }); }

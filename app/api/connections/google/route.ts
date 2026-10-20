import { googleConnectionStatus, changeGoogleConnection } from "@/lib/google-summary";
export const runtime = "nodejs";
export const GET = googleConnectionStatus;
export const PATCH = changeGoogleConnection;

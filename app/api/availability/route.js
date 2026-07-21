import { NextResponse } from "next/server";
import { getAvailability } from "@/lib/store";

export const dynamic = "force-dynamic";

/** GET /api/availability?date=YYYY-MM-DD returns per-date stock and slot capacity */
export async function GET(req) {
  const date = new URL(req.url).searchParams.get("date") || undefined;
  const result = await getAvailability(date);
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
}

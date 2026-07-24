import { listReviewsForModeration, moderateReview } from "@/lib/reviews";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

const STATUSES = ["pending", "published", "rejected"];

/** GET /api/admin/reviews?status=pending|published|rejected (default pending). */
export async function GET(request) {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending";
  if (!STATUSES.includes(status)) {
    return Response.json({ error: "bad_status" }, { status: 400 });
  }

  return Response.json({ reviews: await listReviewsForModeration(status) });
}

/** PATCH: { id, publish } */
export async function PATCH(request) {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  if (!body?.id) return Response.json({ error: "missing_fields" }, { status: 400 });

  const res = await moderateReview(body.id, !!body.publish);
  if (res.error) {
    return Response.json(res, { status: res.error === "not_found" ? 404 : 409 });
  }
  return Response.json(res);
}

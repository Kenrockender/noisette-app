import { currentCustomer } from "@/lib/session";
import { createReview, publishedReviews, myReviews, reviewableItems, allProductStats } from "@/lib/reviews";

export const dynamic = "force-dynamic";

/**
 * GET /api/reviews?product=piscok   published reviews and stats, public
 * GET /api/reviews?mine=1           my reviews and what I could still review
 * GET /api/reviews?all=1            rating stats for every product, public (catalog cards)
 */
export async function GET(request) {
  const url = new URL(request.url);

  if (url.searchParams.get("mine")) {
    const c = await currentCustomer();
    if (!c) return Response.json({ error: "not_signed_in" }, { status: 401 });
    return Response.json({
      reviews: myReviews(c.id),
      reviewable: await reviewableItems(c.id),
    });
  }

  if (url.searchParams.get("all")) {
    return Response.json({ stats: allProductStats() });
  }

  const productId = url.searchParams.get("product");
  if (!productId) return Response.json({ error: "missing_product" }, { status: 400 });
  return Response.json(await publishedReviews(productId));
}

/**
 * POST /api/reviews  { orderId, productId, rating, body }
 *
 * The author is the session, never the payload. Everything else about who may
 * review what is enforced in lib/reviews.js, one place.
 */
export async function POST(request) {
  const c = await currentCustomer();
  if (!c) return Response.json({ error: "not_signed_in" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const res = await createReview({
    customerId: c.id,
    orderId: body?.orderId,
    productId: body?.productId,
    rating: body?.rating,
    body: body?.body,
  });

  if (res.error) {
    const status =
      res.error === "not_found" ? 404
      : res.error === "not_your_order" ? 403
      : ["not_collected", "already_reviewed"].includes(res.error) ? 409
      : 400;
    return Response.json(res, { status });
  }
  return Response.json(res, { status: 201 });
}

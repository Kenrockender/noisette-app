import { getAdminDay } from "@/lib/store";
import { requireStaff } from "@/lib/staff";
import { subscribeAdminDay } from "@/lib/adminEvents";

export const dynamic = "force-dynamic";

// Safety net for writes that land on a different server instance than this
// connection (see lib/adminEvents.js) — much longer than the 15-second poll
// it replaces, because it is a backstop for a rare case, not the update path.
const HEARTBEAT_MS = 30_000;

/**
 * GET /api/admin/day/stream?date=YYYY-MM-DD — the fulfillment tab's live feed.
 *
 * Sends a full `getAdminDay` snapshot immediately, then again every time
 * notifyAdminDay(date) fires (an order, a walk-in sale, a fulfillment advance,
 * an allocation or slot change — see the call sites of notifyAdminDay), plus
 * a periodic heartbeat as a cross-instance backstop. One SSE connection per
 * open tablet, `text/event-stream`, closed cleanly when the client disconnects.
 */
export async function GET(request) {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  const requestedDate = new URL(request.url).searchParams.get("date") || undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let subscribedDate = null;
      let unsubscribe = () => {};
      let heartbeat = null;

      const send = async () => {
        if (closed) return;
        try {
          const data = await getAdminDay(subscribedDate ?? requestedDate);
          // getAdminDay resolves an omitted date itself; lock onto whatever it
          // picked so a client that connects without ?date= still gets pushes.
          if (!subscribedDate && data.date) {
            subscribedDate = data.date;
            unsubscribe = subscribeAdminDay(subscribedDate, send);
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // A transient store error should not kill the connection; the next
          // push or heartbeat tries again.
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed from the other end; nothing to do.
        }
      };

      request.signal.addEventListener("abort", cleanup);
      heartbeat = setInterval(send, HEARTBEAT_MS);
      await send();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

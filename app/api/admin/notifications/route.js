import { drainQueue, listNotifications, notificationCounts, retryNotification } from "@/lib/notifications";
import { enqueueDailyReminders } from "@/lib/reminders";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/**
 * GET: sweep tomorrow's reminders, drain the queue, then show the outbox.
 *
 * Draining on read is the demo stand-in for the production worker. It means
 * "open the outbox" doubles as "run the worker once", which makes the queue
 * behaviour visible without pretending a message broker exists here. The
 * reminder sweep rides the same read (deduped, so it cannot double-send); in
 * production it is its own morning cron.
 */
export async function GET() {
  const guard = await requireStaff();
  if (guard.res) return guard.res;

  await enqueueDailyReminders();
  await drainQueue();
  return Response.json({
    notifications: listNotifications(),
    counts: notificationCounts(),
  });
}

/** PATCH: { id } re-queues one failed message, then drains again. */
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

  const res = retryNotification(body.id);
  if (res.error) {
    return Response.json(res, { status: res.error === "not_found" ? 404 : 409 });
  }
  await drainQueue();
  return Response.json({ ok: true });
}

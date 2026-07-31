import { EventEmitter } from "node:events";

/**
 * In-process notify hub for the counter's live day view (plan.md #5, README's
 * "From demo to production" #1).
 *
 * `/api/admin/day/stream` used to mean every open tablet polling
 * `/api/admin/day` every 15 seconds regardless of whether anything changed —
 * fine against the in-memory store, wasteful once that is Postgres. This is
 * the push side: any write that could change what a trading day's admin view
 * shows calls `notifyAdminDay(date)`, and every SSE connection subscribed to
 * that date re-sends a fresh snapshot immediately instead of waiting for its
 * next poll.
 *
 * Deliberately just an EventEmitter on globalThis, not Redis pub/sub: it only
 * reaches connections held open on the SAME server process. A single-instance
 * deployment (what this shop actually runs) gets instant updates for free;
 * a multi-instance one falls back to the stream's own periodic heartbeat
 * (see app/api/admin/day/stream/route.js) for writes that land on a different
 * instance than a given tablet's connection. Upstash's REST-based Redis has
 * no long-lived subscribe primitive to do this properly across instances —
 * that would need a persistent connection (ioredis) or a queue (QStash),
 * both bigger changes than this counter currently needs.
 */
const g = globalThis;
if (!g.__noisetteAdminEvents) {
  g.__noisetteAdminEvents = new EventEmitter();
  // Every open tablet subscribes to whichever date it is viewing; that can
  // legitimately exceed Node's default listener cap of 10 on a busy counter.
  g.__noisetteAdminEvents.setMaxListeners(0);
}
const bus = g.__noisetteAdminEvents;

const topic = (date) => `day:${date}`;

/** Call after any write that could change the admin day view for `date`. */
export function notifyAdminDay(date) {
  if (date) bus.emit(topic(date), date);
}

/** Returns an unsubscribe function. */
export function subscribeAdminDay(date, handler) {
  bus.on(topic(date), handler);
  return () => bus.off(topic(date), handler);
}

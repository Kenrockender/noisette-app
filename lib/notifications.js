/**
 * Notifications dispatcher (plan.md #5).
 *
 * One public interface, two backends, exactly like lib/store.js: when
 * Postgres is configured every call routes to ./notifications/pg.js;
 * otherwise it runs ./notifications/memory.js. Every export here is async so
 * `await` handles both backends uniformly.
 *
 * Outbound WhatsApp is queued rather than sent inline. The rule this file
 * exists to enforce: a failed send must never fail an order that has already
 * taken the customer's money. So `enqueueNotification` only writes a row and
 * cannot throw past its caller, and delivery happens later in `drainQueue`,
 * which in production is a worker (BullMQ per the PRD) and here runs
 * whenever staff open the outbox.
 *
 * Mirrors the `notifications` table in db/schema.sql.
 */

import { hasPostgres } from "./db/backend.js";
import * as mem from "./notifications/memory.js";
import * as pg from "./notifications/pg.js";

const dispatch = (name) => (...args) => (hasPostgres() ? pg[name] : mem[name])(...args);

export const enqueueNotification = dispatch("enqueueNotification");
export const drainQueue = dispatch("drainQueue");
export const retryNotification = dispatch("retryNotification");
export const listNotifications = dispatch("listNotifications");
export const notificationCounts = dispatch("notificationCounts");

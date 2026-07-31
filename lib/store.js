/**
 * Store dispatcher (plan.md #5).
 *
 * One public interface, two backends. When Postgres is configured every data
 * call routes to the SQL adapter in ./store/pg.js; otherwise it runs the
 * in-memory adapter in ./store/memory.js. The choice is made per call by
 * environment, so `node --test` and a bare dev server never touch a database.
 *
 * Every dispatched function is async: the Postgres path returns a promise and
 * the in-memory path returns a value, and `await` handles both. The only
 * exceptions are the static catalog exports (HOUSES, FULFILLMENT_STAGES,
 * getProducts), which are code-defined constants and stay synchronous so their
 * many read-only callers do not have to change.
 */

import { hasPostgres } from "./db/backend.js";
import * as mem from "./store/memory.js";
import * as pg from "./store/pg.js";
import { HOUSES, FULFILLMENT_STAGES, products } from "./store/catalog.js";

export { HOUSES, FULFILLMENT_STAGES };

/** The catalog is code-defined; both backends read the same static list. */
export const getProducts = () => products;

/** Route one call to whichever backend is live. */
const dispatch = (name) => (...args) => (hasPostgres() ? pg[name] : mem[name])(...args);

export const listInventoryLog = dispatch("listInventoryLog");
export const expireHolds = dispatch("expireHolds");
export const getAvailability = dispatch("getAvailability");
export const createOrder = dispatch("createOrder");
export const createWalkinSale = dispatch("createWalkinSale");
export const upsertCustomer = dispatch("upsertCustomer");
export const getCustomer = dispatch("getCustomer");
export const claimGuestOrders = dispatch("claimGuestOrders");
export const getCustomerOrders = dispatch("getCustomerOrders");
export const markPaid = dispatch("markPaid");
export const getOrder = dispatch("getOrder");
export const _testExpireHoldNow = dispatch("_testExpireHoldNow");
export const cancelOrder = dispatch("cancelOrder");
export const wholesaleCommitted = dispatch("wholesaleCommitted");
export const subscriptionCommitted = dispatch("subscriptionCommitted");
export const wholesaleFree = dispatch("wholesaleFree");
export const saveStandingOrder = dispatch("saveStandingOrder");
export const listStandingOrders = dispatch("listStandingOrders");
export const setStandingOrderActive = dispatch("setStandingOrderActive");
export const deleteStandingOrder = dispatch("deleteStandingOrder");
export const wholesaleSchedule = dispatch("wholesaleSchedule");
export const subscriptionSchedule = dispatch("subscriptionSchedule");
export const subscriptionsOn = dispatch("subscriptionsOn");
export const applyForWholesale = dispatch("applyForWholesale");
export const listWholesaleApplications = dispatch("listWholesaleApplications");
export const decideWholesaleApplication = dispatch("decideWholesaleApplication");
export const updateWholesaleProfile = dispatch("updateWholesaleProfile");
export const listOrders = dispatch("listOrders");
export const advanceOrder = dispatch("advanceOrder");
export const setAllocation = dispatch("setAllocation");
export const setSlotCapacity = dispatch("setSlotCapacity");
export const getAdminDay = dispatch("getAdminDay");

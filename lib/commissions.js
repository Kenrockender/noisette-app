import { hasPostgres } from "./db/backend.js";
import * as mem from "./commissions/memory.js";
import * as pg from "./commissions/pg.js";

const dispatch = (name) => (...args) => (hasPostgres() ? pg[name] : mem[name])(...args);

export const weekStartOf = mem.weekStartOf;
export const COMMISSION_STAGES = mem.COMMISSION_STAGES;

export const weekCapacity = dispatch("weekCapacity");
export const bookedCakes = dispatch("bookedCakes");
export const submitCommission = dispatch("submitCommission");
export const quoteCommission = dispatch("quoteCommission");
export const advanceCommission = dispatch("advanceCommission");
export const declineCommission = dispatch("declineCommission");
export const setWeekCapacity = dispatch("setWeekCapacity");
export const getCommission = dispatch("getCommission");
export const listCommissions = dispatch("listCommissions");
export const commissionsFor = dispatch("commissionsFor");
export const commissionWeeks = dispatch("commissionWeeks");

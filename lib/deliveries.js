import { hasPostgres } from "./db/backend.js";
import * as mem from "./deliveries/memory.js";
import * as pg from "./deliveries/pg.js";

const dispatch = (name) => (...args) => (hasPostgres() ? pg[name] : mem[name])(...args);

export const deliveriesFor = dispatch("deliveriesFor");
export const deliveriesOn = dispatch("deliveriesOn");
export const setDeliverySkipped = dispatch("setDeliverySkipped");
export const advanceDelivery = dispatch("advanceDelivery");
export const invoicesFor = dispatch("invoicesFor");

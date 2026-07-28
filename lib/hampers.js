import { hasPostgres } from "./db/backend.js";
import * as mem from "./hampers/memory.js";
import * as pg from "./hampers/pg.js";

const dispatch = (name) => (...args) => (hasPostgres() ? pg[name] : mem[name])(...args);

export const submitHamper = dispatch("submitHamper");
export const getHamper = dispatch("getHamper");
export const listHampers = dispatch("listHampers");
export const setHamperPaid = dispatch("setHamperPaid");
export const updateHamper = dispatch("updateHamper");
export const deleteHamper = dispatch("deleteHamper");

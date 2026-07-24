import { hasPostgres } from "./db/backend.js";
import * as mem from "./reminders/memory.js";
import * as pg from "./reminders/pg.js";

const dispatch = (name) => (...args) => (hasPostgres() ? pg[name] : mem[name])(...args);

export const enqueueDailyReminders = dispatch("enqueueDailyReminders");

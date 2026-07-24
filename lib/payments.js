import { hasPostgres } from "./db/backend.js";
import * as mem from "./payments/memory.js";
import * as pg from "./payments/pg.js";

// Pure functions (no state) exported directly
export * from "./payments/crypto.js";

const dispatch = (name) => (...args) => (hasPostgres() ? pg[name] : mem[name])(...args);

export const createInvoice = dispatch("createInvoice");
export const invoiceForOrder = dispatch("invoiceForOrder");
export const createCommissionDepositInvoice = dispatch("createCommissionDepositInvoice");
export const refundOrderInvoice = dispatch("refundOrderInvoice");
export const cancelAndRefundOrder = dispatch("cancelAndRefundOrder");
export const handlePaymentCallback = dispatch("handlePaymentCallback");
export const simulateProviderPayment = dispatch("simulateProviderPayment");
export const simulateCommissionDeposit = dispatch("simulateCommissionDeposit");

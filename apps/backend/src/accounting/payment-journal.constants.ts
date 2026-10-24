// ── Phase 2 auto-journal constants (lazy system accounts + the COD classifier).
//
// This codebase has NO seeded chart of accounts: every account is created
// manually through the admin UI or lazily on first use by the module that owns
// the convention (marketing.constants.ts, courier-settlement.constants.ts).
// These two leaves are added through that same lazy path.

/** Salary / compensation EXPENSE leaf. Did NOT exist before Phase 2. */
export const SALARY_EXPENSE_ACCOUNT_CODE = 'salary-expense';
export const SALARY_EXPENSE_ACCOUNT_NAME = 'Salaries & Compensation Expense';

/** Supplier payable leaf. Did NOT exist before Phase 2. */
export const SUPPLIER_PAYABLE_ACCOUNT_CODE = 'supplier-payable';
export const SUPPLIER_PAYABLE_ACCOUNT_NAME = 'Supplier Payable';

/**
 * The ONE classification that makes a receipt "COD". Mirrors the courier
 * settlement's own classifier (courier-settlement/economics.ts:89).
 */
export const COD_PAYMENT_OPTION_TYPE = 'CASH_ON_DELIVERY';

/** Reason recorded when the COD guard suppresses a posting. */
export const COD_SKIP_REASON = 'cod_receipt_posted_by_settlement';

/**
 * The gateway code of the doorstep/courier cash channel. Storefront COD
 * orders stamp it on their cash payment rows (orders.service.ts) and POS
 * counter sales use it too — which is why it can only ever be HALF of the
 * journal guard's signal (see `isCourierSettledCodReceipt`).
 */
export const CASH_GATEWAY_CODE = 'cash';

/** Reference-number prefixes (entryNo itself stays JE-<yyMMdd>-<seq>). */
export const ORDER_PAYMENT_REFERENCE_PREFIX = 'PAY';
export const PAYROLL_PAYMENT_REFERENCE_PREFIX = 'PRL';
export const SUPPLIER_PAYMENT_REFERENCE_PREFIX = 'SUP';
export const REVERSAL_REFERENCE_SUFFIX = 'REV';
export const REFUND_REFERENCE_SUFFIX = 'REF';

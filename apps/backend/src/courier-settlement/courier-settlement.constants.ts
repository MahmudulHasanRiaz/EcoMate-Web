// ── Courier Settlement constants (accounts, settings, limits, prefixes) ──

/** System account codes created lazily (mirrors the marketing lazy-account pattern). */
export const COURIER_EXPENSE_ACCOUNT_CODE = 'courier-expense';
export const COURIER_EXPENSE_ACCOUNT_NAME = 'Courier & Fulfillment Expense';
export const COURIER_CLEARING_ACCOUNT_CODE = 'courier-cod-clearing';
export const COURIER_CLEARING_ACCOUNT_NAME = 'COD Cash Clearing';
export const COURIER_VARIANCE_ACCOUNT_CODE = 'courier-settlement-variance';
export const COURIER_VARIANCE_ACCOUNT_NAME = 'Courier Settlement Variance';
export const COURIER_CASH_ACCOUNT_CODE = 'courier-cash';
export const COURIER_CASH_ACCOUNT_NAME = 'Cash & Bank';

export const COURIER_SYSTEM_ACCOUNT_CODES = [
  COURIER_EXPENSE_ACCOUNT_CODE,
  COURIER_CLEARING_ACCOUNT_CODE,
  COURIER_VARIANCE_ACCOUNT_CODE,
] as const;

/** Settings keys (read via SystemSetting, same as accounting_enabled). */
export const SETTING_ACCOUNTING_ENABLED = 'accounting_enabled';
export const SETTING_REQUIRE_WARNING_ACK = 'courier_settlement_require_warning_ack';
export const SETTING_RESIDUAL_THRESHOLD = 'courier_settlement_residual_threshold';
export const SETTING_ARITHMETIC_TOLERANCE = 'courier_settlement_arithmetic_tolerance';
export const SETTING_DEFAULT_CASH_ACCOUNT = 'courier_settlement_cash_account_id';

export const DEFAULT_REQUIRE_WARNING_ACK = true;
export const DEFAULT_RESIDUAL_THRESHOLD = 100;
export const DEFAULT_ARITHMETIC_TOLERANCE = 1;

/** Ingestion caps (§13). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_DATA_ROWS = 100_000;
export const MAX_COLUMNS = 200;
export const MAX_SHEETS = 10;
export const MAX_XLSX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;
export const MAX_COMPRESSION_RATIO = 200;
export const PARSE_BUDGET_MS = 60_000;
export const INSERT_BATCH_SIZE = 500;

/** §17: at/above this many rows the confirm-import runs in the background. */
export const ASYNC_COMMIT_MIN_ROWS = 5_000;

/** Cache prefixes invalidated on adjustment/revision (§8.3). */
export const COURIER_SETTLEMENT_CACHE_PREFIX = 'courier-settlement:';

/** Stale FINALIZING reclaim window (§6). */
export const FINALIZING_STALE_MS = 15 * 60 * 1000;

/** displayId format. */
export const INVOICE_DISPLAY_PREFIX = 'CS';
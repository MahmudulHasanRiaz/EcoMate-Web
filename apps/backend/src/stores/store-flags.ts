/**
 * Store runtime flags — P0 foundation for central-commerce §12 (BR-25).
 *
 * Every new surface is double-gated: license feature AND a fail-closed
 * runtime flag. Missing ⇒ off. The string 'true' ⇒ on; anything else ⇒ off.
 * Pure functions over an explicit env record so they are unit-testable
 * without a database.
 */

export const STORE_RUNTIME_FLAGS = [
  'THIRD_PARTY_STORES_ENABLED',
  'store_sync_enabled',
  'store_product_sync_enabled',
  'store_order_sync_enabled',
  'store_stock_sync_enabled',
  'store_order_push_enabled',
  'store_reconcile_enabled',
  'store_reconcile_widening_enabled',
  'store_stock_audit_enabled',
  'tracking_send_external_store_orders',
] as const;

export type StoreRuntimeFlag = (typeof STORE_RUNTIME_FLAGS)[number];

export const STORE_WEBHOOK_MAX_BODY_BYTES_KEY =
  'store_webhook_max_body_bytes';
export const STORE_WEBHOOK_MAX_BODY_BYTES_DEFAULT = 256 * 1024;

export function isFlagOn(
  env: Record<string, string | undefined>,
  flag: StoreRuntimeFlag,
): boolean {
  return env[flag] === 'true';
}

/** Master kill-switch: no store sync work of any kind runs when off. */
export function storesEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    isFlagOn(env, 'THIRD_PARTY_STORES_ENABLED') &&
    isFlagOn(env, 'store_sync_enabled')
  );
}

export function productSyncEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return storesEnabled(env) && isFlagOn(env, 'store_product_sync_enabled');
}

export function orderSyncEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return storesEnabled(env) && isFlagOn(env, 'store_order_sync_enabled');
}

/**
 * P7 (§8.6): order-status push kill-switch. Nested under orderSyncEnabled —
 * push is part of order sync, so a disabled order sync disables push too.
 * Fail-closed (default off). The worker AND the notify path both check it.
 */
export function orderPushEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return orderSyncEnabled(env) && isFlagOn(env, 'store_order_push_enabled');
}

export function stockSyncEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return storesEnabled(env) && isFlagOn(env, 'store_stock_sync_enabled');
}

export function reconcileEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return storesEnabled(env) && isFlagOn(env, 'store_reconcile_enabled');
}

export function reconcileWideningEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    reconcileEnabled(env) &&
    isFlagOn(env, 'store_reconcile_widening_enabled')
  );
}

export function stockAuditEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return storesEnabled(env) && isFlagOn(env, 'store_stock_audit_enabled');
}

/** BR-24: external-store tracking dispatch, fail-closed (default off). */
export function externalStoreTrackingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env['tracking_send_external_store_orders'] === 'true';
}

export function storeWebhookMaxBodyBytes(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[STORE_WEBHOOK_MAX_BODY_BYTES_KEY];
  const n = raw !== undefined ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return STORE_WEBHOOK_MAX_BODY_BYTES_DEFAULT;
  return Math.floor(n);
}

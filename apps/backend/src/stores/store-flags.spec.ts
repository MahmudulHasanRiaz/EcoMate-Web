import {
  storesEnabled,
  productSyncEnabled,
  orderSyncEnabled,
  stockSyncEnabled,
  reconcileEnabled,
  reconcileWideningEnabled,
  stockAuditEnabled,
  externalStoreTrackingEnabled,
  storeWebhookMaxBodyBytes,
  STORE_WEBHOOK_MAX_BODY_BYTES_DEFAULT,
} from './store-flags';

describe('store runtime flags (P0, fail-closed)', () => {
  it('everything is off when env is empty', () => {
    const env = {};
    expect(storesEnabled(env)).toBe(false);
    expect(productSyncEnabled(env)).toBe(false);
    expect(orderSyncEnabled(env)).toBe(false);
    expect(stockSyncEnabled(env)).toBe(false);
    expect(reconcileEnabled(env)).toBe(false);
    expect(reconcileWideningEnabled(env)).toBe(false);
    expect(stockAuditEnabled(env)).toBe(false);
    expect(externalStoreTrackingEnabled(env)).toBe(false);
  });

  it('master switch requires BOTH top-level flags', () => {
    expect(
      storesEnabled({
        THIRD_PARTY_STORES_ENABLED: 'true',
        store_sync_enabled: 'true',
      }),
    ).toBe(true);
    expect(
      storesEnabled({
        THIRD_PARTY_STORES_ENABLED: 'true',
        store_sync_enabled: 'false',
      }),
    ).toBe(false);
    expect(storesEnabled({ THIRD_PARTY_STORES_ENABLED: 'true' })).toBe(false);
  });

  it('child flags cannot bypass a disabled master', () => {
    const env = {
      store_product_sync_enabled: 'true',
      store_order_sync_enabled: 'true',
      store_stock_sync_enabled: 'true',
      store_reconcile_enabled: 'true',
      store_stock_audit_enabled: 'true',
    };
    expect(productSyncEnabled(env)).toBe(false);
    expect(orderSyncEnabled(env)).toBe(false);
    expect(stockSyncEnabled(env)).toBe(false);
    expect(reconcileEnabled(env)).toBe(false);
    expect(stockAuditEnabled(env)).toBe(false);
  });

  it('child flags turn on individually under an enabled master', () => {
    const master = {
      THIRD_PARTY_STORES_ENABLED: 'true',
      store_sync_enabled: 'true',
    };
    expect(productSyncEnabled({ ...master })).toBe(false);
    expect(
      productSyncEnabled({ ...master, store_product_sync_enabled: 'true' }),
    ).toBe(true);
    expect(
      reconcileWideningEnabled({
        ...master,
        store_reconcile_enabled: 'true',
        store_reconcile_widening_enabled: 'true',
      }),
    ).toBe(true);
    expect(
      reconcileWideningEnabled({
        ...master,
        store_reconcile_widening_enabled: 'true',
      }),
    ).toBe(false);
  });

  it('only the exact string "true" enables (fail-closed on garbage)', () => {
    expect(
      storesEnabled({
        THIRD_PARTY_STORES_ENABLED: 'TRUE',
        store_sync_enabled: '1',
      }),
    ).toBe(false);
    expect(externalStoreTrackingEnabled({ tracking_send_external_store_orders: 'yes' })).toBe(
      false,
    );
  });

  it('webhook body cap defaults to 256 KiB and rejects garbage', () => {
    expect(storeWebhookMaxBodyBytes({})).toBe(
      STORE_WEBHOOK_MAX_BODY_BYTES_DEFAULT,
    );
    expect(storeWebhookMaxBodyBytes({ store_webhook_max_body_bytes: '0' })).toBe(
      STORE_WEBHOOK_MAX_BODY_BYTES_DEFAULT,
    );
    expect(
      storeWebhookMaxBodyBytes({ store_webhook_max_body_bytes: 'nope' }),
    ).toBe(STORE_WEBHOOK_MAX_BODY_BYTES_DEFAULT);
    expect(
      storeWebhookMaxBodyBytes({ store_webhook_max_body_bytes: '131072' }),
    ).toBe(131072);
  });
});

import {
  storesEnabled,
  productSyncEnabled,
  orderSyncEnabled,
  orderPushEnabled,
  stockSyncEnabled,
  reconcileEnabled,
  reconcileWideningEnabled,
  stockAuditEnabled,
  externalStoreTrackingEnabled,
  storeWebhookMaxBodyBytes,
  STORE_WEBHOOK_MAX_BODY_BYTES_DEFAULT,
} from './store-flags';

describe('store runtime flags (kill-switch: only explicit false disables)', () => {
  it('everything is ON when env is empty (licensed install works out of the box)', () => {
    const env = {};
    expect(storesEnabled(env)).toBe(true);
    expect(productSyncEnabled(env)).toBe(true);
    expect(orderSyncEnabled(env)).toBe(true);
    expect(orderPushEnabled(env)).toBe(true);
    expect(stockSyncEnabled(env)).toBe(true);
    expect(reconcileEnabled(env)).toBe(true);
    expect(reconcileWideningEnabled(env)).toBe(true);
    expect(stockAuditEnabled(env)).toBe(true);
    // BR-24 exception: tracking dispatch stays fail-closed.
    expect(externalStoreTrackingEnabled(env)).toBe(false);
  });

  it('explicit false on either master flag disables the master', () => {
    expect(
      storesEnabled({
        THIRD_PARTY_STORES_ENABLED: 'false',
        store_sync_enabled: 'true',
      }),
    ).toBe(false);
    expect(
      storesEnabled({
        THIRD_PARTY_STORES_ENABLED: 'true',
        store_sync_enabled: 'false',
      }),
    ).toBe(false);
    expect(storesEnabled({ store_sync_enabled: 'false' })).toBe(false);
  });

  it('child flags cannot bypass a disabled master', () => {
    const env = {
      THIRD_PARTY_STORES_ENABLED: 'false',
      store_product_sync_enabled: 'true',
      store_order_sync_enabled: 'true',
      store_order_push_enabled: 'true',
      store_stock_sync_enabled: 'true',
      store_reconcile_enabled: 'true',
      store_stock_audit_enabled: 'true',
    };
    expect(productSyncEnabled(env)).toBe(false);
    expect(orderSyncEnabled(env)).toBe(false);
    expect(orderPushEnabled(env)).toBe(false);
    expect(stockSyncEnabled(env)).toBe(false);
    expect(reconcileEnabled(env)).toBe(false);
    expect(stockAuditEnabled(env)).toBe(false);
  });

  it('an explicit false child disables only that child', () => {
    expect(productSyncEnabled({ store_product_sync_enabled: 'false' })).toBe(false);
    expect(orderSyncEnabled({ store_product_sync_enabled: 'false' })).toBe(true);
    expect(
      reconcileWideningEnabled({ store_reconcile_widening_enabled: 'false' }),
    ).toBe(false);
    expect(reconcileEnabled({ store_reconcile_widening_enabled: 'false' })).toBe(true);
  });

  it('P7: order push stays nested under order sync', () => {
    // Push flag alone cannot bypass a disabled order sync.
    expect(
      orderPushEnabled({ store_order_sync_enabled: 'false' }),
    ).toBe(false);
    expect(orderPushEnabled({})).toBe(true);
  });

  it('garbage values resolve to ON (a typo can never silently kill sync)', () => {
    expect(
      storesEnabled({
        THIRD_PARTY_STORES_ENABLED: 'TRUE',
        store_sync_enabled: '1',
      }),
    ).toBe(true);
    // BR-24 stays fail-closed: only exact 'true' enables tracking dispatch.
    expect(externalStoreTrackingEnabled({ tracking_send_external_store_orders: 'yes' })).toBe(
      false,
    );
    expect(
      externalStoreTrackingEnabled({ tracking_send_external_store_orders: 'true' }),
    ).toBe(true);
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

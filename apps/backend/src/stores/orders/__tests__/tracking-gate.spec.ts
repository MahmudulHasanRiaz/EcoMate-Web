/**
 * P6 tracking-gate suite (§8.5.3, BR-24): EXTERNAL_STORE category,
 * fail-closed `tracking_send_external_store_orders` (default off).
 *
 * Every dispatch site in the create path is individually audited here:
 *  1. firePurchaseInstant — consults eligibilityGate (policy-denied by
 *     default) AND is skipped outright when internal.skipPurchaseTracking.
 *  2. fireOrderPlacedEvent — same two gates (only runs when no instant
 *     Purchase fired AND not skipped).
 *  3. order.created / status_changed internal bus (OrdersEventService.emit)
 *     — internal SSE/cache fan-out, NOT a tracking dispatch (no CAPI).
 *  4. fireOrderStatusLifecycleEvent / fireRefundEvent — policy-gated at
 *     capture time (same EXTERNAL_STORE default-off).
 *  5. marketingAttribution.resolveFromOrder — internal read-only campaign
 *     matching, no outbound pixel dispatch.
 */
import {
  resolveOrderSourceCategory,
  SOURCE_CONFIG_KEYS,
  SOURCE_DEFAULTS,
  OrderSourcePolicyService,
} from '../../../tracking/order-source-policy';
import { externalStoreTrackingEnabled } from '../../store-flags';

describe('P6 tracking gate — EXTERNAL_STORE category (BR-24)', () => {
  it('external ingest identity wins over every legacy signal', () => {
    expect(
      resolveOrderSourceCategory({ idempotencyKey: 'store:s1:order:ext-1', source: 'POS', posSessionId: 'sess-1', salesChannel: 'POS' }),
    ).toBe('EXTERNAL_STORE');
    expect(
      resolveOrderSourceCategory({ idempotencyKey: 'store:s1:order:ext-1', sourcePlatform: 'PHONE', sourceType: 'CALL' }),
    ).toBe('EXTERNAL_STORE');
  });

  it('native classification is unchanged', () => {
    expect(resolveOrderSourceCategory({ source: 'ECOMMERCE' })).toBe('DIRECT_WEBSITE');
    expect(resolveOrderSourceCategory({ source: 'POS' })).toBe('POS');
    expect(resolveOrderSourceCategory({ posSessionId: 'sess-1' })).toBe('POS');
    expect(resolveOrderSourceCategory({ source: 'MANUAL', salesChannel: 'OFFLINE' })).toBe('MANUAL');
  });

  it('fail-closed defaults: off unless explicitly enabled', () => {
    expect(SOURCE_DEFAULTS.EXTERNAL_STORE).toBe(false);
    expect(SOURCE_CONFIG_KEYS.EXTERNAL_STORE).toBe('tracking_send_external_store_orders');
    expect(externalStoreTrackingEnabled({})).toBe(false);
    expect(externalStoreTrackingEnabled({ tracking_send_external_store_orders: 'true' })).toBe(true);
    expect(externalStoreTrackingEnabled({ tracking_send_external_store_orders: 'false' })).toBe(false);
  });

  it('policy denies external orders with no stored setting (fail-closed)', async () => {
    const prisma: any = { systemSetting: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) } };
    const policy = new OrderSourcePolicyService(prisma);
    const res = await policy.checkEligibility({ idempotencyKey: 'store:s1:order:ext-1' } as any);
    expect(res).toMatchObject({
      eligible: false,
      category: 'EXTERNAL_STORE',
      configKey: 'tracking_send_external_store_orders',
      configValue: false,
    });
  });

  it('policy honors an explicit opt-in', async () => {
    const prisma: any = {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue({ key: 'tracking_send_external_store_orders', value: 'true' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const policy = new OrderSourcePolicyService(prisma);
    const res = await policy.checkEligibility({ idempotencyKey: 'store:s1:order:ext-1' } as any);
    expect(res).toMatchObject({ eligible: true, category: 'EXTERNAL_STORE', configValue: true });
  });
});

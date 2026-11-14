/**
 * P6 order suite (§13) — normalization + job identity + reconcile bounds.
 * Pure functions: no DB, no network. Deterministic fixtures only.
 */
import {
  normalizeOrder,
  buildStoreDeliveryKey,
  buildStoreOrderIdentity,
  clampReconcileWindow,
  RECONCILE_DEFAULT_WINDOW_DAYS,
  RECONCILE_MAX_WINDOW_DAYS,
  RECONCILE_MAX_PAGES,
} from '../normalize-order';
import { buildOrderFixtures } from '../../providers/__tests__/fixtures';

describe('P6 normalizeOrder — WooCommerce shape', () => {
  it('maps WC REST fields to the canonical shape', () => {
    const out = normalizeOrder({
      id: 4821,
      status: 'processing',
      total: '750.00',
      currency: 'BDT',
      date_created: '2026-09-23T13:00:00',
      line_items: [
        { sku: 'SKU-IN-001', name: 'Tee', quantity: 2, price: '250' },
      ],
      billing: { first_name: 'Sara', last_name: 'K', phone: '01700000001', email: 's@x.test' },
    });
    expect(out.externalId).toBe('4821');
    expect(out.externalStatus).toBe('processing');
    expect(out.externalTotal).toBe(750);
    expect(out.items).toEqual([{ sku: 'SKU-IN-001', name: 'Tee', quantity: 2, price: 250 }]);
    expect(out.customerName).toBe('Sara K');
    expect(out.customerPhone).toBe('01700000001');
    expect(out.customerEmail).toBe('s@x.test');
    expect(out.externalCreatedAt).toBeInstanceOf(Date);
  });
});

describe('P6 normalizeOrder — Shopify shape', () => {
  it('maps Shopify REST fields to the canonical shape', () => {
    const out = normalizeOrder({
      id: 987654321,
      financial_status: 'paid',
      total_price: '500.00',
      presentment_currency: 'BDT',
      created_at: '2026-09-21T11:00:00Z',
      line_items: [{ sku: 'SKU-VAR-RED-M', title: 'Red / M', quantity: 1, price: '400' }],
      customer: { first_name: 'Order', last_name: 'Two', phone: '+8801700000002' },
    });
    expect(out.externalId).toBe('987654321');
    expect(out.externalStatus).toBe('paid');
    expect(out.externalTotal).toBe(500);
    expect(out.currency).toBe('BDT');
    expect(out.items[0]).toMatchObject({ sku: 'SKU-VAR-RED-M', quantity: 1, price: 400 });
  });
});

describe('P6 normalizeOrder — bridge/fixture shape', () => {
  it('normalizes every scripted fixture order', () => {
    for (const f of buildOrderFixtures()) {
      const out = normalizeOrder({ ...f } as unknown as Record<string, unknown>);
      expect(out.externalId).toBe(f.id);
      expect(out.externalStatus).toBe(f.status);
      expect(out.items).toHaveLength(f.items.length);
      expect(out.items[0].sku).toBe(f.items[0].sku);
    }
  });

  it('never throws on unknown shapes — empty items, pending status', () => {
    const out = normalizeOrder({ whatever: true } as any);
    expect(out.items).toEqual([]);
    expect(out.externalStatus).toBe('pending');
    expect(out.externalCreatedAt).toBeNull();
  });

  it('extracts only allowlisted scalars (no secret passthrough)', () => {
    const out = normalizeOrder({
      id: 'x-1',
      consumerSecret: 'SHOULD-NOT-FLOW',
      webhookSecret: 'SHOULD-NOT-FLOW',
      credentials: { key: 'SHOULD-NOT-FLOW' },
    } as any);
    expect(JSON.stringify(out)).not.toContain('SHOULD-NOT-FLOW');
  });
});

describe('P6 job identity (§4.1, BR-11/BR-12)', () => {
  it('deliveryKey = sha256(storeId + delivery id), stable', () => {
    const a = buildStoreDeliveryKey('store-1', 'del-9');
    const b = buildStoreDeliveryKey('store-1', 'del-9');
    const c = buildStoreDeliveryKey('store-1', 'del-10');
    const d = buildStoreDeliveryKey('store-2', 'del-9');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('execution identity is store-scoped (webhook ≡ reconcile)', () => {
    const { idempotencyKey, objectKey } = buildStoreOrderIdentity('store-1', 'ext-5');
    expect(idempotencyKey).toBe('store:store-1:order:ext-5');
    expect(objectKey).toBe(idempotencyKey);
  });
});

describe('P6 reconcile window bounds (BR-10)', () => {
  it('defaults to the 3-day window', () => {
    expect(clampReconcileWindow({ wideningEnabled: true }).windowDays).toBe(
      RECONCILE_DEFAULT_WINDOW_DAYS,
    );
    expect(RECONCILE_DEFAULT_WINDOW_DAYS).toBe(3);
  });

  it('widening without flag or reason stays at 3 days', () => {
    expect(
      clampReconcileWindow({ requestedDays: 10, wideningEnabled: false, wideningReason: 'missed' }),
    ).toMatchObject({ windowDays: 3, widened: false });
    expect(
      clampReconcileWindow({ requestedDays: 10, wideningEnabled: true }),
    ).toMatchObject({ windowDays: 3, widened: false });
  });

  it('opt-in failure-driven widening applies, hard-capped at 30 days', () => {
    expect(
      clampReconcileWindow({ requestedDays: 10, wideningEnabled: true, wideningReason: 'webhook outage 2026-09-20' }),
    ).toMatchObject({ windowDays: 10, widened: true, wideningReason: 'webhook outage 2026-09-20' });
    const capped = clampReconcileWindow({ requestedDays: 90, wideningEnabled: true, wideningReason: 'x' });
    expect(capped.windowDays).toBe(RECONCILE_MAX_WINDOW_DAYS);
    expect(RECONCILE_MAX_WINDOW_DAYS).toBe(30);
    expect(RECONCILE_MAX_PAGES).toBeGreaterThan(0);
  });
});

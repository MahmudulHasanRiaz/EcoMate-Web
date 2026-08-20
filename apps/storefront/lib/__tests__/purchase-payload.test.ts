import { describe, it, expect } from 'vitest';
import { buildPurchaseSharedData, buildPurchaseUserData } from '../purchase-payload';

const productOrder = {
  id: 'order-1',
  total: '2050',
  items: [
    {
      id: 'item-1',
      productId: 'prod-1',
      quantity: 2,
      price: '1000',
      product: { name: 'Organic Rice', category: { name: 'Groceries' } },
    },
    { id: 'item-2', comboId: 'combo-1', quantity: 1, price: '50', combo: { name: 'Starter Pack' } },
  ],
} as any;

describe('browser Purchase payload (spec §5, §12, §33)', () => {
  it('builds content metadata (ids, name, category, num_items, contents, value, currency)', () => {
    const d = buildPurchaseSharedData(productOrder, 'BDT');
    expect(d.content_ids).toEqual(['prod-1', 'combo-1']);
    expect(d.content_name).toBe('Organic Rice'); // first line item
    expect(d.content_category).toBe('Groceries');
    expect(d.num_items).toBe(3);
    expect(d.value).toBe(2050);
    expect(d.currency).toBe('BDT');
    expect(d.contents).toEqual([
      { id: 'prod-1', quantity: 2, item_price: 1000 },
      { id: 'combo-1', quantity: 1, item_price: 50 },
    ]);
    // Falls back to id when displayId is absent
    expect(d.order_id).toBe('order-1');
  });

  it('uses displayId as order_id when available (business order ID, not UUID)', () => {
    const orderWithDisplayId = {
      ...productOrder,
      displayId: 'ORD-260820-00123',
    };
    const d = buildPurchaseSharedData(orderWithDisplayId, 'BDT');
    expect(d.order_id).toBe('ORD-260820-00123');
  });

  it('content_name falls back to the combo when the first line item is a combo', () => {
    const d = buildPurchaseSharedData(
      { id: 'o', items: [{ comboId: 'c', quantity: 1, price: 1 }] } as any,
      'BDT',
    );
    expect(d.content_name).toBeUndefined(); // no combo relation loaded
    expect(d.content_ids).toEqual(['c']);
  });

  it('maps BD geo correctly: ct=district, st=division, country=BD', () => {
    const u = buildPurchaseUserData({
      id: 'o',
      shippingAddress: { district: "Cox's Bazar", division: 'Chittagong' },
    } as any);
    expect(u.city).toBe("Cox's Bazar");
    expect(u.state).toBe('Chittagong');
    expect(u.country).toBe('BD');
  });

  it('historically stale shipping address without division falls back to district for st', () => {
    const u = buildPurchaseUserData({
      id: 'o',
      shippingAddress: { district: 'Dhaka' },
    } as any);
    expect(u.city).toBe('Dhaka');
    expect(u.state).toBe('Dhaka');
  });

  it('carries name/phone/email/zip/address when present', () => {
    const u = buildPurchaseUserData({
      id: 'o',
      guestName: 'Jane Doe',
      guestPhone: '01812345678',
      customer: { email: 'jane@example.com' },
      shippingAddress: { district: 'Dhaka', thana: 'Dhanmondi', address: 'Flat 5', zip: '1205' },
    } as any);
    expect(u.name).toBe('Jane Doe');
    expect(u.phone).toBe('01812345678');
    expect(u.email).toBe('jane@example.com');
    expect(u.zip).toBe('1205');
  });
});
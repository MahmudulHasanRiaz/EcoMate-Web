/**
 * P8 analytics-parity suite (§9.3, R-3).
 *
 * With `NEW_SALES_CHANNEL_MODEL_ENABLED` off (the default), every consumer
 * reads ONLY the legacy model: canonical inputs are ignored and responses
 * carry no canonical keys — byte-identical to pre-P8. With the flag on, the
 * canonical dimensions appear as ADDITIVE keys beside the unchanged legacy
 * ones.
 */
import { describe, expect, it, afterEach } from '@jest/globals';
import { resolveActionSource } from '../../../tracking/meta-action-source';
import { resolveOrderSourceCategory } from '../../../tracking/order-source-policy';
import { aggregateSourceRevenue } from '../../../business-analytics/analytics-marketing.service';
import { computeCancellations } from '../../../business-analytics/analytics-sales.service';

const FLAG = 'NEW_SALES_CHANNEL_MODEL_ENABLED';
const prev = process.env[FLAG];
afterEach(() => {
  if (prev === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prev;
});

describe('P8 parity — flag off (default)', () => {
  it('resolveActionSource ignores canonical fields (legacy exactly)', () => {
    delete process.env[FLAG];
    // Legacy quirk preserved: 'TikTok Chat' is not in the platform set.
    expect(resolveActionSource({ salesChannel: 'TikTok Chat' })).toBe('physical_store');
    // Canonical chat channel alone changes nothing with the flag off.
    expect(
      resolveActionSource({ salesChannel: 'WEBSITE', marketingChannel: 'TIKTOK_INBOX' }),
    ).toBe('website');
    expect(resolveActionSource({ salesChannel: 'CALL' })).toBe('phone_call');
  });

  it('resolveOrderSourceCategory ignores canonical storeId', () => {
    delete process.env[FLAG];
    expect(
      resolveOrderSourceCategory({
        source: 'ECOMMERCE',
        salesChannel: 'WEBSITE',
        storeId: 'store-1',
      }),
    ).toBe('DIRECT_WEBSITE');
  });

  it('aggregateSourceRevenue carries no canonical keys', () => {
    delete process.env[FLAG];
    const res = aggregateSourceRevenue([
      { source: 'facebook', channel: 'WEBSITE', revenue: 100, salesChannelType: 'ONLINE', marketingChannel: 'FACEBOOK' },
    ]);
    expect(res).not.toHaveProperty('salesChannelTypes');
    expect(res).not.toHaveProperty('marketingChannels');
    expect(res.channels).toEqual([{ key: 'WEBSITE', label: 'WEBSITE', orders: 1, revenue: 100 }]);
  });

  it('computeCancellations carries no canonical keys', () => {
    delete process.env[FLAG];
    const res = computeCancellations(
      [
        {
          id: 'o1',
          displayId: 'D1',
          total: 50,
          subtotal: 50,
          shippingCharge: 0,
          discount: 0,
          discountType: 'flat',
          status: 'Cancelled',
          timeline: [],
          createdAt: new Date('2026-09-10T00:00:00Z'),
          items: [],
          payments: [],
          refunds: [],
          salesChannel: 'WEBSITE',
          source: 'ECOMMERCE',
          salesChannelType: 'ONLINE',
          marketingChannel: null,
        } as any,
      ],
      { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-09-30T00:00:00Z') },
    );
    expect(res).not.toHaveProperty('bySalesChannelType');
    expect(res).not.toHaveProperty('byMarketingChannel');
    expect(res.total).toBe(1);
  });
});

describe('P8 dual-read — flag on', () => {
  it("canonical chat marketing resolves to 'chat' (fixes legacy *_CHAT fallthrough)", () => {
    process.env[FLAG] = 'true';
    expect(
      resolveActionSource({ salesChannel: 'TikTok Chat', marketingChannel: 'TIKTOK_INBOX' }),
    ).toBe('chat');
    // Non-chat canonical values still fall through to legacy logic.
    expect(
      resolveActionSource({ salesChannel: 'WEBSITE', marketingChannel: null }),
    ).toBe('website');
    expect(resolveActionSource({ salesChannel: 'CALL' })).toBe('phone_call');
  });

  it('canonical storeId signals EXTERNAL_STORE', () => {
    process.env[FLAG] = 'true';
    expect(
      resolveOrderSourceCategory({
        source: 'ECOMMERCE',
        salesChannel: 'WEBSITE',
        storeId: 'store-1',
      }),
    ).toBe('EXTERNAL_STORE');
  });

  it('canonical groupings appear additively beside legacy ones', () => {
    process.env[FLAG] = 'true';
    const res = aggregateSourceRevenue([
      { source: 'facebook', channel: 'WEBSITE', revenue: 100, salesChannelType: 'ONLINE', marketingChannel: 'FACEBOOK' },
    ]);
    expect(res.channels).toEqual([{ key: 'WEBSITE', label: 'WEBSITE', orders: 1, revenue: 100 }]);
    expect(res.salesChannelTypes).toEqual([{ key: 'ONLINE', label: 'ONLINE', orders: 1, revenue: 100 }]);
    expect(res.marketingChannels).toEqual([{ key: 'FACEBOOK', label: 'FACEBOOK', orders: 1, revenue: 100 }]);
  });
});

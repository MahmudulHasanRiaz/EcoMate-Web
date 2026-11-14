/**
 * Channel-backfill idempotency suite (P8 §9.2, §16 item 2).
 * Pure-function level: NULL-only, second application is a no-op.
 */
import { describe, expect, it } from '@jest/globals';
import { buildBackfillUpdate } from '../channel-backfill.service';

const BASE_ROW = {
  id: 'o1',
  salesChannel: 'WEBSITE',
  source: 'ECOMMERCE',
  sourcePlatform: null,
  sourceType: 'DIRECT',
  sourceEntity: null,
  trackingSessionId: null,
  salesChannelType: null,
} as const;

describe('buildBackfillUpdate', () => {
  it('writes salesChannelType for an untyped row', () => {
    expect(buildBackfillUpdate({ ...BASE_ROW }, null, null)).toEqual({
      salesChannelType: 'ONLINE',
    });
  });

  it('includes marketingChannel only when the resolver yields one', () => {
    expect(
      buildBackfillUpdate(
        { ...BASE_ROW, salesChannel: 'OFFLINE', sourcePlatform: 'WHATSAPP' },
        null,
        null,
      ),
    ).toEqual({ salesChannelType: 'OFFLINE', marketingChannel: 'WHATSAPP' });
    // CALL → NULL marketing stays NULL (column untouched, not written).
    expect(
      buildBackfillUpdate({ ...BASE_ROW, salesChannel: 'CALL' }, null, null),
    ).toEqual({ salesChannelType: 'OFFLINE' });
  });

  it('includes showroomId only when resolved to a Warehouse id', () => {
    expect(
      buildBackfillUpdate(
        { ...BASE_ROW, salesChannel: 'POS', sourceEntity: 'Dhanmondi' },
        null,
        'wh-1',
      ),
    ).toMatchObject({ salesChannelType: 'OFFLINE', showroomId: 'wh-1' });
    expect(
      buildBackfillUpdate(
        { ...BASE_ROW, salesChannel: 'POS', sourceEntity: 'Unknown Name' },
        null,
        null,
      ),
    ).toEqual({ salesChannelType: 'OFFLINE' });
  });

  it('honours the session utmSource for WEBSITE rows', () => {
    expect(buildBackfillUpdate({ ...BASE_ROW }, 'instagram', null)).toEqual({
      salesChannelType: 'ONLINE',
      marketingChannel: 'INSTAGRAM',
    });
  });

  it('is idempotent: an already-typed row yields null (no write)', () => {
    expect(
      buildBackfillUpdate({ ...BASE_ROW, salesChannelType: 'ONLINE' }, null, null),
    ).toBeNull();
  });
});

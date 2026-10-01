/**
 * [C5] Every legacy `SalesChannel` value must have an explicit fate.
 *
 * This file exists so that adding a new legacy enum value — or shipping a
 * mapper that forgot one — fails a test instead of silently producing an
 * unmapped order. It imports the Prisma enum at runtime so the list can
 * never drift from the schema.
 */
import { SalesChannel } from '@prisma/client';
import { mapOrderToCanonical } from '../sales-channel.mapper';

/** Every value of the legacy enum, read from the schema itself. */
export const SALES_CHANNEL_LEGACY_VALUES: string[] = Object.values(SalesChannel);

describe('legacy SalesChannel value coverage', () => {
  it('the enum still has the 12 documented values', () => {
    expect(SALES_CHANNEL_LEGACY_VALUES).toHaveLength(12);
    expect([...SALES_CHANNEL_LEGACY_VALUES].sort()).toEqual(
      [
        'CALL', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'MESSENGER', 'WHATSAPP',
        'THREADS', 'WALK_IN', 'WEBSITE', 'OFFLINE', 'POS', 'OTHER',
      ].sort(),
    );
  });

  it.each(SALES_CHANNEL_LEGACY_VALUES)(
    '%s produces a canonical mapping with a reason',
    (legacy) => {
      const m = mapOrderToCanonical({ salesChannel: legacy });
      // NULL is a valid canonical value, so assert the shape rather than
      // using expect.anything() (which rejects null).
      expect(Object.keys(m).sort()).toEqual(
        ['acquisitionType', 'channel', 'channelEntity', 'reason', 'sourceSlug'].sort(),
      );
      expect(m.reason.length).toBeGreaterThan(0);
    },
  );

  it.each(SALES_CHANNEL_LEGACY_VALUES)(
    '%s never yields an acquisition type without explicit evidence',
    (legacy) => {
      // No legacy channel value, on its own, is evidence of paid/organic.
      // Only sourceType / platform evidence may set acquisition.
      const m = mapOrderToCanonical({ salesChannel: legacy });
      if (m.acquisitionType === 'PAID' || m.acquisitionType === 'ORGANIC') {
        fail(`${legacy} produced ${m.acquisitionType} with no acquisition evidence`);
      }
    },
  );

  it('a NULL legacy channel is handled explicitly', () => {
    const m = mapOrderToCanonical({ salesChannel: null });
    expect(m.channel).toBeNull();
    expect(m.reason).toContain('insufficient evidence');
  });

  it('an unrecognised future channel value degrades to NULL, never a guess', () => {
    const m = mapOrderToCanonical({ salesChannel: 'SOME_FUTURE_VALUE' });
    expect(m.channel).toBeNull();
    expect(m.acquisitionType).toBeNull();
    expect(m.reason).toContain('insufficient evidence');
  });
});

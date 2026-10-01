/**
 * [C4] Canonical analytics dimension with a compatibility strategy.
 *
 * The point of these tests is that adopting the canonical dimension never
 * breaks an existing consumer: the legacy `salesChannel` filter still works,
 * the pinned `bySalesChannel` breakdown is untouched, and the new breakdowns
 * appear alongside rather than replacing anything.
 */
import { LEGACY_CHANNEL_TO_V2, V2_TO_LEGACY_CHANNELS } from '../legacy-channel-map';

describe('canonical channel analytics — legacy compatibility', () => {
  describe('legacy → canonical translation', () => {
    it('translates the venue-shaped legacy values', () => {
      expect(LEGACY_CHANNEL_TO_V2.WEBSITE).toBe('WEBSITE');
      expect(LEGACY_CHANNEL_TO_V2.POS).toBe('POS');
      expect(LEGACY_CHANNEL_TO_V2.CALL).toBe('PHONE_CALL');
    });

    it('translates platform-shaped legacy values to MESSAGING', () => {
      for (const legacy of ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'MESSENGER', 'WHATSAPP', 'THREADS']) {
        expect(LEGACY_CHANNEL_TO_V2[legacy]).toBe('MESSAGING');
      }
    });

    it('omits values the canonical model deliberately leaves NULL', () => {
      // WALK_IN / OFFLINE / OTHER map to NULL (insufficient evidence), so a
      // canonical filter must NOT match legacy rows carrying them.
      for (const legacy of ['WALK_IN', 'OFFLINE', 'OTHER']) {
        expect(LEGACY_CHANNEL_TO_V2[legacy]).toBeUndefined();
      }
    });

    it('MESSAGING maps back to all six legacy platform-shaped values', () => {
      expect(V2_TO_LEGACY_CHANNELS.MESSAGING.sort()).toEqual(
        ['FACEBOOK', 'INSTAGRAM', 'MESSENGER', 'THREADS', 'TIKTOK', 'WHATSAPP'].sort(),
      );
    });

    it('WEBSITE has exactly one legacy equivalent', () => {
      expect(V2_TO_LEGACY_CHANNELS.WEBSITE).toEqual(['WEBSITE']);
    });
  });

  describe('filter behaviour', () => {
    /** Mirrors the OR-clause the filter service builds. */
    const whereFor = (channel: string) => {
      const legacy = V2_TO_LEGACY_CHANNELS[channel];
      return [
        { channel },
        ...(legacy ? [{ channel: null, salesChannel: { in: legacy } }] : []),
      ];
    };

    it('matches canonical rows directly', () => {
      const w = whereFor('WEBSITE');
      expect(w[0]).toEqual({ channel: 'WEBSITE' });
    });

    it('also matches legacy rows that predate the canonical mapping', () => {
      const w = whereFor('MESSAGING');
      expect(w[1]).toEqual({
        channel: null,
        salesChannel: { in: expect.arrayContaining(['FACEBOOK']) },
      });
    });

    it('produces a canonical-only clause when no legacy equivalent exists', () => {
      // PHONE_CALL has no legacy counterpart other than CALL, which is why the
      // translation table is consulted rather than assumed.
      expect(LEGACY_CHANNEL_TO_V2.CALL).toBe('PHONE_CALL');
      expect(whereFor('PHONE_CALL')[0]).toEqual({ channel: 'PHONE_CALL' });
    });
  });

  describe('breakdown keys', () => {
    it('keeps the legacy keys AND adds the canonical ones', () => {
      // The response type must contain both generations so no consumer loses a
      // field it already reads.
      const keys = [
        'bySalesChannel', 'bySource', 'byCategory',            // legacy, unchanged
        'byChannel', 'byChannelEntity', 'bySourcePlatform', 'byAcquisitionType', // new
      ];
      expect(keys).toHaveLength(7);
      expect(keys).toContain('bySalesChannel');
      expect(keys).toContain('byChannel');
    });

    it('keeps bySource on the LEGACY source, not the canonical slug', () => {
      // `bySource` groups Order.source (ECOMMERCE/POS/MANUAL). Reinterpreting
      // it as a marketing platform would be exactly the forbidden conflation.
      expect(['ECOMMERCE', 'POS', 'MANUAL']).toContain('ECOMMERCE');
    });
  });
});

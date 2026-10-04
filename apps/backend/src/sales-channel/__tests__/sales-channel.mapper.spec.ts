/**
 * The mapper is where the "never fabricate" invariant lives. These tests exist
 * to make a regression impossible to merge silently.
 */
import { mapOrderToCanonical, resolveSourceSlug } from '../sales-channel.mapper';
import { SALES_CHANNEL_LEGACY_VALUES } from './legacy-value-coverage.spec';

describe('sales-channel.mapper', () => {
  // ── [C1] DIRECT is never ORGANIC ─────────────────────────────────────────
  describe('DIRECT ≠ ORGANIC', () => {
    it('Google + DIRECT → google + ORGANIC (known referrer, unpaid)', () => {
      const m = mapOrderToCanonical({
        salesChannel: 'WEBSITE', sourcePlatform: 'GOOGLE', sourceType: 'DIRECT',
      });
      expect(m.sourceSlug).toBe('google');
      expect(m.acquisitionType).toBe('ORGANIC');
    });

    it('Facebook + DIRECT → facebook + ORGANIC', () => {
      const m = mapOrderToCanonical({
        salesChannel: 'WEBSITE', sourcePlatform: 'FACEBOOK', sourceType: 'DIRECT',
      });
      expect(m.sourceSlug).toBe('facebook');
      expect(m.acquisitionType).toBe('ORGANIC');
    });

    it('DIRECT + DIRECT (the resolver no-signal default) → direct source + NULL acquisition', () => {
      const m = mapOrderToCanonical({
        salesChannel: 'WEBSITE', sourcePlatform: 'DIRECT', sourceType: 'DIRECT',
      });
      expect(m.sourceSlug).toBe('direct');
      expect(m.acquisitionType).toBeNull();
      // The critical assertion: a no-signal row is NOT reported as organic.
      expect(m.acquisitionType).not.toBe('ORGANIC');
      // DIRECT is a SOURCE, never an acquisition value.
      expect(m.acquisitionType).not.toBe('DIRECT' as never);
    });

    it('never maps any input to ORGANIC without a known platform', () => {
      const cases = [
        { salesChannel: 'WEBSITE', sourceType: 'DIRECT' },
        { salesChannel: 'POS', sourceType: 'DIRECT' },
        { salesChannel: 'CALL', sourceType: 'DIRECT' },
        { sourceType: 'DIRECT', sourcePlatform: 'DIRECT' },
      ];
      for (const c of cases) {
        const m = mapOrderToCanonical(c);
        expect(m.acquisitionType).not.toBe('ORGANIC');
        expect(m.sourceSlug).toBe('direct');
      }
    });

    it('maps no-signal DIRECT to the direct source slug', () => {
      const m = mapOrderToCanonical({ salesChannel: 'WEBSITE', sourceType: 'DIRECT' });
      expect(m.sourceSlug).toBe('direct');
      expect(m.acquisitionType).toBeNull();
    });
  });

  // ── [C1] PAID requires explicit evidence ────────────────────────────────
  describe('PAID', () => {
    it('sourceType=AD → PAID', () => {
      const m = mapOrderToCanonical({
        salesChannel: 'WEBSITE', sourcePlatform: 'GOOGLE', sourceType: 'AD',
      });
      expect(m.acquisitionType).toBe('PAID');
      expect(m.sourceSlug).toBe('google');
    });

    it('records the corroborating signal in the reason', () => {
      const m = mapOrderToCanonical({
        salesChannel: 'WEBSITE', sourcePlatform: 'GOOGLE', sourceType: 'AD',
        attributionMethod: 'click_id', attribution: { utm: { medium: 'cpc' } },
      });
      expect(m.reason).toContain('click_id');
    });

    it('records a paid utm medium in the reason', () => {
      const m = mapOrderToCanonical({
        salesChannel: 'WEBSITE', sourcePlatform: 'GOOGLE', sourceType: 'AD',
        attribution: { utm: { medium: 'cpc' } },
      });
      expect(m.reason).toContain('cpc');
    });
  });

  // ── Channel never implies acquisition ───────────────────────────────────
  describe('channel never implies acquisition', () => {
    it('POS is never ORGANIC', () => {
      const m = mapOrderToCanonical({ salesChannel: 'POS', sourceType: 'SHOWROOM' });
      expect(m.channel).toBe('POS');
      expect(m.acquisitionType).toBeNull();
    });

    it('PHONE_CALL is never ORGANIC', () => {
      const m = mapOrderToCanonical({ salesChannel: 'CALL' });
      expect(m.channel).toBe('PHONE_CALL');
      expect(m.acquisitionType).toBeNull();
    });

    it('MESSAGING is never ORGANIC', () => {
      const m = mapOrderToCanonical({ salesChannel: 'FACEBOOK' });
      expect(m.channel).toBe('MESSAGING');
      expect(m.acquisitionType).toBeNull();
    });
  });

  // ── [C5] Operational values never become a Source ───────────────────────
  describe('resolveSourceSlug', () => {
    it('maps real marketing platforms to registry slugs', () => {
      expect(resolveSourceSlug('GOOGLE')).toBe('google');
      expect(resolveSourceSlug('TIKTOK')).toBe('tiktok');
      expect(resolveSourceSlug('FACEBOOK')).toBe('facebook');
    });

    it('returns null for operational values', () => {
      for (const v of ['POS', 'PHONE', 'EXTERNAL_STORE', 'LEAD']) {
        expect(resolveSourceSlug(v)).toBeNull();
      }
    });

    it('resolves DIRECT to the direct source slug', () => {
      expect(resolveSourceSlug('DIRECT')).toBe('direct');
    });

    it('returns null for an unknown custom string', () => {
      expect(resolveSourceSlug('SOME_UNKNOWN_PLATFORM')).toBeNull();
    });

    it('returns null for absent input', () => {
      expect(resolveSourceSlug(null)).toBeNull();
      expect(resolveSourceSlug('')).toBeNull();
      expect(resolveSourceSlug(undefined)).toBeNull();
    });
  });

  // ── [C5] Every legacy value has an explicit, handled outcome ────────────
  describe('legacy value coverage', () => {
    it('maps every legacy SalesChannel value without throwing', () => {
      for (const legacy of SALES_CHANNEL_LEGACY_VALUES) {
        const m = mapOrderToCanonical({ salesChannel: legacy });
        expect(m.reason).toBeTruthy();
      }
    });

    it('platform-named legacy values become MESSAGING + their source', () => {
      const expectations: [string, string | null][] = [
        ['FACEBOOK', 'facebook'],
        ['INSTAGRAM', 'instagram'],
        ['TIKTOK', 'tiktok'],
        ['MESSENGER', 'facebook'],
        ['WHATSAPP', 'whatsapp'],
        ['THREADS', 'threads'],
      ];
      for (const [legacy, slug] of expectations) {
        const m = mapOrderToCanonical({ salesChannel: legacy });
        expect(m.channel).toBe('MESSAGING');
        expect(m.sourceSlug).toBe(slug);
      }
    });

    it('WALK_IN is NOT mapped to POS', () => {
      const m = mapOrderToCanonical({ salesChannel: 'WALK_IN' });
      expect(m.channel).toBeNull();
      expect(m.reason).toContain('insufficient evidence');
    });

    it('OTHER is NOT mapped to anything', () => {
      const m = mapOrderToCanonical({ salesChannel: 'OTHER' });
      expect(m.channel).toBeNull();
      expect(m.reason).toContain('insufficient evidence');
    });

    it('OFFLINE without chat evidence stays NULL', () => {
      const m = mapOrderToCanonical({ salesChannel: 'OFFLINE' });
      expect(m.channel).toBeNull();
      expect(m.reason).toContain('insufficient evidence');
    });

    it('OFFLINE WITH chat evidence becomes MESSAGING', () => {
      const m = mapOrderToCanonical({
        salesChannel: 'OFFLINE', sourceType: 'CHAT', sourcePlatform: 'TIKTOK',
      });
      expect(m.channel).toBe('MESSAGING');
      expect(m.sourceSlug).toBe('tiktok');
    });

    it('a NULL channel yields insufficient evidence, not a guess', () => {
      const m = mapOrderToCanonical({ salesChannel: null, source: 'ECOMMERCE' });
      expect(m.channel).toBeNull();
      expect(m.acquisitionType).toBeNull();
      expect(m.reason).toContain('insufficient evidence');
    });
  });

  // ── Entity handling ─────────────────────────────────────────────────────
  describe('channel entity', () => {
    it('carries the showroom name for POS evidence', () => {
      const m = mapOrderToCanonical({
        salesChannel: 'POS', sourcePlatform: 'POS', sourceType: 'SHOWROOM',
        sourceEntity: 'Test Showroom',
      });
      expect(m.channelEntity).toBe('Test Showroom');
    });

    it('carries the store name for an external-store integration', () => {
      const m = mapOrderToCanonical({
        salesChannel: 'WEBSITE', sourcePlatform: 'EXTERNAL_STORE',
        sourceType: 'EXTERNAL_STORE:SHOPIFY', sourceEntity: 'Shop Name',
      });
      expect(m.channel).toBe('WEBSITE');
      expect(m.channelEntity).toBe('Shop Name');
      // An integration is NOT a marketing platform.
      expect(m.sourceSlug).toBeNull();
    });

    it('is null when no entity was recorded', () => {
      const m = mapOrderToCanonical({ salesChannel: 'CALL' });
      expect(m.channelEntity).toBeNull();
    });

    it('treats a blank entity as absent', () => {
      const m = mapOrderToCanonical({ salesChannel: 'CALL', sourceEntity: '   ' });
      expect(m.channelEntity).toBeNull();
    });
  });

  // ── Determinism ─────────────────────────────────────────────────────────
  describe('determinism', () => {
    it('produces identical output for identical input', () => {
      const input = {
        salesChannel: 'WEBSITE', sourcePlatform: 'GOOGLE', sourceType: 'AD',
        sourceEntity: 'E', attribution: { utm: { medium: 'cpc' } },
      };
      expect(mapOrderToCanonical(input)).toEqual(mapOrderToCanonical(input));
    });

    it('never produces all-null output without a stated reason', () => {
      for (const legacy of [...SALES_CHANNEL_LEGACY_VALUES, null as any]) {
        const m = mapOrderToCanonical({ salesChannel: legacy });
        if (m.channel === null) expect(m.reason).toBeTruthy();
      }
    });
  });
});

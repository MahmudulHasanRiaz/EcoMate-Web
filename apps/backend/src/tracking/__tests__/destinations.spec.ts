import {
  LEGACY_DESTINATION_ID,
  MAX_META_DESTINATIONS,
  TrackingDestination,
  activeDestinations,
  capturedDestinationRefs,
  isDestinationDeliverable,
  normalizeDestinations,
  publicMetaDestinations,
  resolveMetaDestinations,
  synthesizeLegacyDestination,
  validateMetaDestinations,
} from '../destinations';

const NOW = '2026-09-16T00:00:00.000Z';

function dest(over: Partial<TrackingDestination> = {}): TrackingDestination {
  return {
    id: 'primary',
    label: 'Main Pixel',
    pixelId: '111111111111111',
    accessToken: 'EAA-token',
    enabled: true,
    browserPixelEnabled: true,
    testEventCode: '',
    testMode: false,
    createdAt: NOW,
    updatedAt: NOW,
    removedAt: null,
    ...over,
  };
}

describe('destinations — multi-destination Meta delivery model (Step 3)', () => {
  describe('resolveMetaDestinations (backward compatibility)', () => {
    it('prefers the configured array when present', () => {
      const raw = JSON.stringify([dest({ id: 'a' }), dest({ id: 'b' })]);
      const out = resolveMetaDestinations(raw, 'legacy-pixel', 'legacy-token', NOW);
      expect(out.map((d) => d.id)).toEqual(['a', 'b']);
    });

    it('synthesizes the legacy single destination when unset (existing installs)', () => {
      const out = resolveMetaDestinations(null, '999999', 'tok', NOW);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        id: LEGACY_DESTINATION_ID,
        pixelId: '999999',
        accessToken: 'tok',
        enabled: true,
        browserPixelEnabled: true,
        removedAt: null,
      });
    });

    it('yields no destinations when there is no legacy pixel id either', () => {
      expect(resolveMetaDestinations(null, null, null, NOW)).toEqual([]);
      expect(synthesizeLegacyDestination('', 'tok', NOW)).toEqual([]);
    });

    it('falls back to legacy when the stored value is malformed JSON', () => {
      const out = resolveMetaDestinations('{not json', '999999', 'tok', NOW);
      expect(out.map((d) => d.pixelId)).toEqual(['999999']);
    });

    it('falls back to legacy when the stored array normalizes to nothing', () => {
      const out = resolveMetaDestinations('[{"nope":1}]', '999999', 'tok', NOW);
      expect(out.map((d) => d.pixelId)).toEqual(['999999']);
    });

    it('treats an empty-string setting as unset', () => {
      const out = resolveMetaDestinations('', '999999', 'tok', NOW);
      expect(out.map((d) => d.id)).toEqual([LEGACY_DESTINATION_ID]);
    });
  });

  describe('normalizeDestinations (immutable identity, deterministic order)', () => {
    it('preserves array order deterministically', () => {
      const out = normalizeDestinations(
        [{ id: 'z' }, { id: 'a' }, { id: 'm' }],
        NOW,
      );
      expect(out.map((d) => d.id)).toEqual(['z', 'a', 'm']);
    });

    it('drops entries whose id is missing or not slug-safe', () => {
      const out = normalizeDestinations(
        [{ id: 'ok' }, { id: 'Bad Id' }, { id: '-leading' }, { pixelId: 'x' }],
        NOW,
      );
      expect(out.map((d) => d.id)).toEqual(['ok']);
    });

    it('de-duplicates by id — a repeated id is never a second destination', () => {
      const out = normalizeDestinations(
        [{ id: 'a', pixelId: '1' }, { id: 'a', pixelId: '2' }],
        NOW,
      );
      expect(out).toHaveLength(1);
      expect(out[0].pixelId).toBe('1');
    });

    it('caps at MAX_META_DESTINATIONS', () => {
      const many = Array.from({ length: MAX_META_DESTINATIONS + 5 }, (_, i) => ({
        id: `p${i}`,
      }));
      expect(normalizeDestinations(many, NOW)).toHaveLength(MAX_META_DESTINATIONS);
    });

    it('defaults enabled/browserPixelEnabled to true and testMode to false', () => {
      const out = normalizeDestinations([{ id: 'a', pixelId: '1' }], NOW);
      expect(out[0]).toMatchObject({
        enabled: true,
        browserPixelEnabled: true,
        testMode: false,
      });
    });

    it('is not an array → no destinations', () => {
      expect(normalizeDestinations({ id: 'a' }, NOW)).toEqual([]);
      expect(normalizeDestinations(null, NOW)).toEqual([]);
    });
  });

  describe('activeDestinations / publicMetaDestinations', () => {
    it('excludes disabled and removed destinations from capture eligibility', () => {
      const out = activeDestinations([
        dest({ id: 'on' }),
        dest({ id: 'off', enabled: false }),
        dest({ id: 'gone', removedAt: NOW }),
      ]);
      expect(out.map((d) => d.id)).toEqual(['on']);
    });

    it('NEVER projects an access token to the browser-safe shape', () => {
      const pubs = publicMetaDestinations([
        dest({ id: 'a', pixelId: '111', accessToken: 'SECRET-A' }),
        dest({ id: 'b', pixelId: '222', accessToken: 'SECRET-B' }),
      ]);
      expect(pubs).toHaveLength(2);
      for (const p of pubs) {
        expect(p).not.toHaveProperty('accessToken');
        expect(Object.keys(p).sort()).toEqual(['id', 'label', 'pixelId']);
      }
      // The serialized payload must not contain the secret anywhere.
      expect(JSON.stringify(pubs)).not.toContain('SECRET-A');
      expect(JSON.stringify(pubs)).not.toContain('SECRET-B');
    });

    it('omits destinations whose browser pixel is off or whose pixel id is empty', () => {
      const pubs = publicMetaDestinations([
        dest({ id: 'no-browser', browserPixelEnabled: false }),
        dest({ id: 'no-pixel', pixelId: '' }),
        dest({ id: 'ok' }),
      ]);
      expect(pubs.map((p) => p.id)).toEqual(['ok']);
    });
  });

  describe('capturedDestinationRefs (capture-time eligibility)', () => {
    it('materializes only destinations enabled at capture, token-free', () => {
      const refs = capturedDestinationRefs(
        [
          dest({ id: 'a', pixelId: '111' }),
          dest({ id: 'off', enabled: false }),
          dest({ id: 'gone', removedAt: NOW }),
        ],
        'instant',
      );
      expect(refs).toEqual([
        { provider: 'meta', destinationId: 'a', pixelId: '111', purchaseMode: 'instant' },
      ]);
      expect(JSON.stringify(refs)).not.toContain('EAA-token');
    });

    it('a destination added LATER is absent from an earlier capture (no backfill)', () => {
      const atCapture = capturedDestinationRefs([dest({ id: 'a' })], 'instant');
      const afterAdd = capturedDestinationRefs(
        [dest({ id: 'a' }), dest({ id: 'b' })],
        'instant',
      );
      expect(atCapture.map((r) => r.destinationId)).toEqual(['a']);
      expect(afterAdd.map((r) => r.destinationId)).toEqual(['a', 'b']);
    });

    it('records the purchase mode per destination so a future per-destination mode needs no schema change', () => {
      const refs = capturedDestinationRefs([dest({ id: 'a' }), dest({ id: 'b' })], 'validated');
      expect(refs.map((r) => r.purchaseMode)).toEqual(['validated', 'validated']);
    });
  });

  describe('isDestinationDeliverable (capture-time semantics)', () => {
    it('delivers to a destination disabled AFTER capture (disable is forward-looking)', () => {
      expect(isDestinationDeliverable([dest({ id: 'a', enabled: false })], 'a')).toBe(true);
    });

    it('does NOT deliver to a removed destination (observable skip)', () => {
      expect(isDestinationDeliverable([dest({ id: 'a', removedAt: NOW })], 'a')).toBe(false);
    });

    it('does NOT deliver when the identity can no longer be resolved', () => {
      expect(isDestinationDeliverable([], 'a')).toBe(false);
      expect(isDestinationDeliverable([dest({ id: 'other' })], 'a')).toBe(false);
    });
  });

  describe('validateMetaDestinations (server-side invariants)', () => {
    it('accepts a well-formed list', () => {
      const res = validateMetaDestinations(
        [
          { id: 'a', label: 'A', pixelId: '111', accessToken: 't', enabled: true },
          { id: 'b', label: 'B', pixelId: '222', accessToken: 't', enabled: false },
        ],
        NOW,
      );
      expect(res.ok).toBe(true);
      expect(res.errors).toEqual([]);
      expect(res.value).toHaveLength(2);
    });

    it('rejects a duplicate id (ids are immutable and never reused)', () => {
      const res = validateMetaDestinations(
        [
          { id: 'a', pixelId: '111', accessToken: 't' },
          { id: 'a', pixelId: '222', accessToken: 't' },
        ],
        NOW,
      );
      expect(res.ok).toBe(false);
      expect(res.errors.join(' ')).toMatch(/Duplicate destination id 'a'/);
    });

    it('rejects a missing pixel id on a live destination', () => {
      const res = validateMetaDestinations([{ id: 'a', accessToken: 't' }], NOW);
      expect(res.ok).toBe(false);
      expect(res.errors.join(' ')).toMatch(/pixelId is required/);
    });

    it('rejects an enabled destination with no access token', () => {
      const res = validateMetaDestinations(
        [{ id: 'a', pixelId: '111', enabled: true }],
        NOW,
      );
      expect(res.ok).toBe(false);
      expect(res.errors.join(' ')).toMatch(/accessToken is required/);
    });

    it('allows a disabled destination with no token', () => {
      const res = validateMetaDestinations(
        [{ id: 'a', pixelId: '111', enabled: false }],
        NOW,
      );
      expect(res.ok).toBe(true);
    });

    it('rejects more than the maximum number of destinations', () => {
      const many = Array.from({ length: MAX_META_DESTINATIONS + 1 }, (_, i) => ({
        id: `p${i}`,
        pixelId: String(i),
        accessToken: 't',
      }));
      const res = validateMetaDestinations(many, NOW);
      expect(res.ok).toBe(false);
      expect(res.errors.join(' ')).toMatch(/At most 10/);
    });

    it('WARNS (does not block) on a duplicated pixel id', () => {
      const res = validateMetaDestinations(
        [
          { id: 'a', pixelId: '111', accessToken: 't' },
          { id: 'b', pixelId: '111', accessToken: 't' },
        ],
        NOW,
      );
      expect(res.ok).toBe(true);
      expect(res.warnings.join(' ')).toMatch(/used by multiple destinations/);
    });

    it('rejects a non-array payload', () => {
      expect(validateMetaDestinations({ id: 'a' }, NOW).ok).toBe(false);
    });

    it('does not require pixel id/token for a removed (soft-deleted) destination', () => {
      const res = validateMetaDestinations(
        [{ id: 'a', removedAt: NOW, enabled: false }],
        NOW,
      );
      expect(res.ok).toBe(true);
    });

    it('rejects an id that is not slug-safe', () => {
      const res = validateMetaDestinations([{ id: 'Bad Id', pixelId: '1', accessToken: 't' }], NOW);
      expect(res.ok).toBe(false);
    });
  });
});

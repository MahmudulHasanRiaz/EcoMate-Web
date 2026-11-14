/**
 * Store identity tests — central-commerce §8.10 (P1).
 * Duplicate protection rests on deterministic fingerprints: the same
 * logical store always resolves to the same fingerprint, so connect →
 * 409 "reconnect to existing" instead of a duplicate row.
 */
import { normaliseDomain, identityFingerprint } from './store-identity';

describe('store identity (§8.10)', () => {
  describe('normaliseDomain', () => {
    it('lowercases and strips scheme, www, path and port', () => {
      expect(normaliseDomain('https://WWW.Example.com/shop?q=1')).toBe('example.com');
      expect(normaliseDomain('example.com:8080')).toBe('example.com');
    });

    it('returns null for empty input', () => {
      expect(normaliseDomain(null)).toBeNull();
      expect(normaliseDomain(undefined)).toBeNull();
      expect(normaliseDomain('   ')).toBeNull();
    });
  });

  describe('identityFingerprint', () => {
    it('is stable for the same logical store across domain spellings', () => {
      const a = identityFingerprint({
        kind: 'WOOCOMMERCE',
        providerStoreId: 'site-1',
        domain: 'https://www.example.com/',
      });
      const b = identityFingerprint({
        kind: 'WOOCOMMERCE',
        providerStoreId: 'site-1',
        domain: 'example.com',
      });
      expect(a).toBe(b);
    });

    it('differs across kinds, provider ids and domains', () => {
      const base = { kind: 'WOOCOMMERCE', providerStoreId: 's1', domain: 'a.com' };
      expect(identityFingerprint({ ...base, kind: 'SHOPIFY' })).not.toBe(
        identityFingerprint(base),
      );
      expect(identityFingerprint({ ...base, providerStoreId: 's2' })).not.toBe(
        identityFingerprint(base),
      );
      expect(identityFingerprint({ ...base, domain: 'b.com' })).not.toBe(
        identityFingerprint(base),
      );
    });
  });
});

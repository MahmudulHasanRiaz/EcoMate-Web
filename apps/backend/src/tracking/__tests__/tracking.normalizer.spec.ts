import { createHash } from 'node:crypto';
import { TrackingNormalizer } from '../tracking.normalizer';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('TrackingNormalizer (design §4.5 — single hashing/normalization abstraction)', () => {
  const normalizer = new TrackingNormalizer();

  describe('version', () => {
    it('is a positive integer', () => {
      expect(Number.isInteger(normalizer.version)).toBe(true);
      expect(normalizer.version).toBeGreaterThan(0);
    });
  });

  describe('hashEmail', () => {
    it('trims leading/trailing spaces and lowercases before SHA-256', () => {
      expect(normalizer.hashEmail('  John.Doe@Example.COM  ')).toBe(
        sha256('john.doe@example.com'),
      );
      expect(normalizer.hashEmail('  JOHN.DOE@EXAMPLE.COM  ')).toBe(
        normalizer.hashEmail('john.doe@example.com'),
      );
    });

    it('returns undefined for empty email', () => {
      expect(normalizer.hashEmail('')).toBeUndefined();
      expect(normalizer.hashEmail('   ')).toBeUndefined();
    });

    it('returns undefined for synthetic emails (cust_, numeric, +-tag)', () => {
      expect(normalizer.hashEmail('cust_123@example.com')).toBeUndefined();
      expect(normalizer.hashEmail('12345@example.com')).toBeUndefined();
      expect(normalizer.hashEmail('john+tag@example.com')).toBeUndefined();
    });

    it('hashes a real email', () => {
      expect(normalizer.hashEmail('john.doe@example.com')).toBe(
        '836f82db99121b3481011f16b49dfa5fbc714a0d1b1b9f784a1ebbbf5b39577f',
      );
    });
  });

  describe('hashPhone', () => {
    it('prepends 880 to a 10-digit BD local number', () => {
      expect(normalizer.hashPhone('1712345678', 'BD')).toBe(
        sha256('8801712345678'),
      );
    });

    it('strips the leading trunk 0 from an 11-digit BD number', () => {
      expect(normalizer.hashPhone('01712345678', 'BD')).toBe(
        sha256('8801712345678'),
      );
    });

    it('normalizes all BD input formats to the same E.164 hash', () => {
      expect(normalizer.hashPhone('1712345678', 'BD')).toBe(
        sha256('8801712345678'),
      );
      expect(normalizer.hashPhone('01712345678', 'BD')).toBe(
        sha256('8801712345678'),
      );
      expect(normalizer.hashPhone('+8801712345678', 'BD')).toBe(
        sha256('8801712345678'),
      );
    });

    it('leaves an already-coded number as-is', () => {
      expect(normalizer.hashPhone('8801712345678')).toBe(
        sha256('8801712345678'),
      );
      expect(normalizer.hashPhone('+1-415-555-1234')).toBe(
        sha256('14155551234'),
      );
    });

    it('strips non-digits and +', () => {
      expect(normalizer.hashPhone('+88 0171-2345678', 'BD')).toBe(
        sha256('8801712345678'),
      );
    });

    it('never emits a bare local number without a country code', () => {
      expect(normalizer.hashPhone('1234567890')).toBeUndefined(); // 10-digit, no country
      expect(normalizer.hashPhone('5551234', 'US')).toBeUndefined(); // too short
      expect(normalizer.hashPhone('1234567890123456')).toBeUndefined(); // >15 digits
      expect(normalizer.hashPhone('')).toBeUndefined();
      expect(normalizer.hashPhone('abc')).toBeUndefined();
    });
  });

  describe('hashName', () => {
    it('lowercases and strips punctuation before SHA-256', () => {
      expect(normalizer.hashName('John Smith')).toBe(sha256('john smith'));
      expect(normalizer.hashName("O'Brien")).toBe(sha256('obrien'));
      expect(normalizer.hashName('Jean-Luc')).toBe(sha256('jeanluc'));
    });
  });

  describe('normalizeZip', () => {
    it('removes dashes/spaces and truncates US zips to first 5 digits', () => {
      expect(normalizer.normalizeZip('12345-6789')).toBe('12345');
      expect(normalizer.normalizeZip(' 12345 ')).toBe('12345');
    });

    it('keeps non-US postal codes untruncated', () => {
      expect(normalizer.normalizeZip('SW1A 1AA')).toBe('sw1a1aa');
    });
  });

  describe('hashZip', () => {
    it('hashes the normalized zip', () => {
      expect(normalizer.hashZip('12345-6789')).toBe(sha256('12345'));
    });
  });

  /**
   * Meta customer-information contract for ct/st (verified against
   * https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters):
   * ct — "Lowercase only with no punctuation, no special characters, and no spaces."
   * st — non-US: "lowercase with no punctuation, no special characters, and no spaces".
   */
  describe('hashCity / hashState (Meta ct/st canonicalization)', () => {
    it('lowercases a simple city/state', () => {
      expect(normalizer.hashCity('Dhaka')).toBe(sha256('dhaka'));
      expect(normalizer.hashState('Dhaka')).toBe(sha256('dhaka'));
      expect(normalizer.hashCity('Chattogram')).toBe(sha256('chattogram'));
    });

    it('removes internal spaces (no spaces allowed)', () => {
      expect(normalizer.hashCity('New York')).toBe(sha256('newyork'));
      expect(normalizer.hashCity('Dhaka City')).toBe(sha256('dhakacity'));
      expect(normalizer.hashState('New York')).toBe(sha256('newyork'));
    });

    it('removes straight and typographic apostrophes', () => {
      expect(normalizer.hashCity("Cox's Bazar")).toBe(sha256('coxsbazar'));
      expect(normalizer.hashCity('Cox’s Bazar')).toBe(sha256('coxsbazar'));
    });

    it('removes hyphens and periods', () => {
      expect(normalizer.hashCity('Saint-Louis')).toBe(sha256('saintlouis'));
      expect(normalizer.hashCity('Dhaka-City')).toBe(sha256('dhakacity'));
      expect(normalizer.hashCity('St. Louis')).toBe(sha256('stlouis'));
    });

    it('trims surrounding whitespace', () => {
      expect(normalizer.hashCity('  Dhaka  ')).toBe(sha256('dhaka'));
      expect(normalizer.hashState('\tDhaka\n')).toBe(sha256('dhaka'));
    });

    it('collapses repeated whitespace to nothing', () => {
      expect(normalizer.hashCity('New    York')).toBe(sha256('newyork'));
    });

    it('maps every spelling of the same place to one canonical hash', () => {
      const canonical = sha256('coxsbazar');
      expect(normalizer.hashCity("Cox's Bazar")).toBe(canonical);
      expect(normalizer.hashCity('Cox’s Bazar')).toBe(canonical);
      expect(normalizer.hashCity('COX’S  BAZAR')).toBe(canonical);
      expect(normalizer.hashCity("  Cox's-Bazar  ")).toBe(canonical);
    });

    it('keeps distinct places distinct (normalization never merges them)', () => {
      expect(normalizer.hashCity('Dhaka City')).not.toBe(
        normalizer.hashCity('Dhaka'),
      );
      expect(normalizer.hashCity('Chattogram')).not.toBe(
        normalizer.hashCity('Dhaka'),
      );
    });

    it('deliberately collapses space-only variants (Meta removes spaces)', () => {
      // Space removal is part of Meta's ct contract, so these two spellings of
      // the same place MUST canonicalize identically — not a data-loss bug.
      expect(normalizer.hashCity('New York')).toBe(normalizer.hashCity('NewYork'));
    });

    it('returns undefined when nothing survives normalization', () => {
      expect(normalizer.hashCity('')).toBeUndefined();
      expect(normalizer.hashCity('   ')).toBeUndefined();
      expect(normalizer.hashCity("-'.")).toBeUndefined();
      expect(normalizer.hashState('---')).toBeUndefined();
    });

    it('preserves Unicode letters and combining marks (never destroys geo data)', () => {
      // Bangla: ঢ + া (combining mark) + ক + া — punctuation stripping must not
      // eat the marks (stripping \p{L}\p{N} only would).
      expect(normalizer.hashCity('ঢাকা')).toBe(sha256('ঢাকা'));
      expect(normalizer.hashCity('চট্টগ্রাম')).toBe(sha256('চট্টগ্রাম'));
      // Latin diacritics survive too
      expect(normalizer.hashCity('Málaga')).toBe(sha256('málaga'));
    });
  });

  describe('hashCountry', () => {
    it('lowercases ISO alpha-2 and trims', () => {
      expect(normalizer.hashCountry('BD')).toBe(sha256('bd'));
      expect(normalizer.hashCountry(' Bd ')).toBe(sha256('bd'));
    });

    it('returns undefined for empty input', () => {
      expect(normalizer.hashCountry('')).toBeUndefined();
      expect(normalizer.hashCountry('  ')).toBeUndefined();
    });
  });

  describe('hashExternalId', () => {
    it('SHA-256 of lowercase+trim', () => {
      expect(normalizer.hashExternalId('  CUST-123 ')).toBe(
        sha256('cust-123'),
      );
      expect(normalizer.hashExternalId('')).toBeUndefined();
    });
  });

  describe('isSyntheticEmail', () => {
    it('flags empty emails', () => {
      expect(normalizer.isSyntheticEmail('')).toBe(true);
      expect(normalizer.isSyntheticEmail('   ')).toBe(true);
    });

    it('flags cust_ prefixed local parts', () => {
      expect(normalizer.isSyntheticEmail('cust_123@example.com')).toBe(true);
    });

    it('flags all-numeric local parts', () => {
      expect(normalizer.isSyntheticEmail('12345@example.com')).toBe(true);
    });

    it('flags +-tagged addresses', () => {
      expect(normalizer.isSyntheticEmail('john+tag@example.com')).toBe(true);
    });

    it('passes real emails', () => {
      expect(normalizer.isSyntheticEmail('john@example.com')).toBe(false);
    });
  });

  describe('splitName', () => {
    it('single token → firstName only', () => {
      expect(normalizer.splitName('John')).toEqual({
        firstName: 'John',
        lastName: undefined,
      });
    });

    it('two tokens → first and last', () => {
      expect(normalizer.splitName('John Doe')).toEqual({
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('multi-token → last token is lastName, rest is firstName', () => {
      expect(normalizer.splitName('John Michael Doe')).toEqual({
        firstName: 'John Michael',
        lastName: 'Doe',
      });
    });

    it('empty string → empty names', () => {
      expect(normalizer.splitName('')).toEqual({
        firstName: undefined,
        lastName: undefined,
      });
    });
  });

  describe('resolveNameFields (P1 fix — canonical fn/ln resolution for adapters)', () => {
    it('splits a full name stored in firstName when lastName is absent', () => {
      expect(normalizer.resolveNameFields('Md Rahim Uddin')).toEqual({
        firstName: 'Md Rahim',
        lastName: 'Uddin',
      });
    });

    it('keeps explicit firstName + lastName untouched', () => {
      expect(normalizer.resolveNameFields('John', 'Doe')).toEqual({
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('treats a single token as firstName only', () => {
      expect(normalizer.resolveNameFields('John')).toEqual({
        firstName: 'John',
        lastName: undefined,
      });
    });

    it('passes lastName through when firstName is empty', () => {
      expect(normalizer.resolveNameFields('', 'Doe')).toEqual({
        firstName: undefined,
        lastName: 'Doe',
      });
    });

    it('never splits a two-field payload even if first name contains many words', () => {
      expect(normalizer.resolveNameFields('John Michael Doe', 'Jr')).toEqual({
        firstName: 'John Michael Doe',
        lastName: 'Jr',
      });
    });

    it('empty inputs → empty names', () => {
      expect(normalizer.resolveNameFields()).toEqual({
        firstName: undefined,
        lastName: undefined,
      });
    });
  });
});

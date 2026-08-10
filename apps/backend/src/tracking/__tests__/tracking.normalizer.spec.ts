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

  describe('hashCity / hashState / hashCountry', () => {
    it('lowercases before hashing', () => {
      expect(normalizer.hashCity('Dhaka')).toBe(sha256('dhaka'));
      expect(normalizer.hashState('Dhaka')).toBe(sha256('dhaka'));
      expect(normalizer.hashCountry('BD')).toBe(sha256('bd'));
      expect(normalizer.hashCountry(' Bd ')).toBe(sha256('bd'));
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

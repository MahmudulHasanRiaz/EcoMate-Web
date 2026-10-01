import {
  normalizeAddressPart,
  normalizeFullAddress,
  addressFingerprint,
  readAddressBlob,
  isEmptyAddressBlob,
} from '../customer-address.util';

describe('customer-address.util', () => {
  describe('normalizeAddressPart', () => {
    it('lowercases and strips punctuation', () => {
      expect(normalizeAddressPart('House 12, Road 5.')).toBe('house 12 road 5');
    });

    it('folds Bengali digits to ASCII', () => {
      expect(normalizeAddressPart('১২৩')).toBe('123');
    });

    it('unifies & with and', () => {
      expect(normalizeAddressPart('Rahim & Sons')).toBe(normalizeAddressPart('Rahim and Sons'));
    });

    it('canonicalises common abbreviation aliases', () => {
      expect(normalizeAddressPart('Rd 7')).toBe(normalizeAddressPart('Road 7'));
      expect(normalizeAddressPart('Mirpur Thana')).toBe(normalizeAddressPart('Mirpur Upazila'));
      expect(normalizeAddressPart('post code 1212')).toBe(normalizeAddressPart('zip 1212'));
    });

    it('collapses repeated whitespace', () => {
      expect(normalizeAddressPart('  House   12 ')).toBe('house 12');
    });

    it('returns empty string for absent values', () => {
      expect(normalizeAddressPart(null)).toBe('');
      expect(normalizeAddressPart(undefined)).toBe('');
      expect(normalizeAddressPart('   ')).toBe('');
    });
  });

  describe('addressFingerprint', () => {
    const base = {
      fullName: 'Rahim Uddin',
      phone: '+8801711111111',
      addressLine: 'House 12, Road 5',
      area: 'Mirpur',
      thana: 'Mirpur Thana',
      district: 'Dhaka',
      postalCode: '1216',
      country: 'Bangladesh',
    };

    it('is stable for equivalent inputs', () => {
      const variant = {
        ...base,
        addressLine: 'house 12 road 5',
        thana: 'Mirpur Upazila',
        postalCode: '1216',
      };
      expect(addressFingerprint(variant)).toBe(addressFingerprint(base));
    });

    it('differs when the house/road line differs, even with identical locality', () => {
      // THE core dedup rule: thana/district alone must never identify an address.
      const otherHouse = { ...base, addressLine: 'House 99, Road 5' };
      expect(addressFingerprint(otherHouse)).not.toBe(addressFingerprint(base));
    });

    it('differs when only the area differs', () => {
      expect(addressFingerprint({ ...base, area: 'Uttara' })).not.toBe(
        addressFingerprint(base),
      );
    });

    it('differs when the recipient name differs', () => {
      expect(addressFingerprint({ ...base, fullName: 'Karim Uddin' })).not.toBe(
        addressFingerprint(base),
      );
    });

    it('ignores division, which is derived from district', () => {
      // A resolver disagreement about division must not create a new address.
      const withDivision = { ...base, division: 'Dhaka Division' };
      const withOtherDivision = { ...base, division: 'Wrong Division' };
      expect(addressFingerprint(withDivision)).toBe(addressFingerprint(withOtherDivision));
    });

    it('defaults a missing country so it does not change identity', () => {
      const noCountry = { ...base };
      delete (noCountry as any).country;
      expect(addressFingerprint(noCountry)).toBe(addressFingerprint(base));
    });
  });

  describe('readAddressBlob', () => {
    it('reads the canonical shape', () => {
      const blob = {
        fullName: 'Rahim Uddin',
        phone: '+8801711111111',
        addressLine: 'House 12, Road 5',
        area: 'Mirpur',
        thana: 'Mirpur Thana',
        district: 'Dhaka',
        postalCode: '1216',
      };
      expect(readAddressBlob(blob)).toMatchObject({
        addressLine: 'House 12, Road 5',
        district: 'Dhaka',
        country: 'Bangladesh',
      });
    });

    it('reads legacy alias keys used across the order flow', () => {
      const blob = {
        name: 'Rahim Uddin',
        phoneNumber: '01711111111',
        street: 'House 12',
        upazila: 'Mirpur',
        city: 'Dhaka',
        zip: '1216',
      };
      expect(readAddressBlob(blob)).toMatchObject({
        fullName: 'Rahim Uddin',
        phone: '01711111111',
        addressLine: 'House 12',
        thana: 'Mirpur',
        district: 'Dhaka',
        postalCode: '1216',
      });
    });

    it('returns null for a blob with no address line', () => {
      expect(readAddressBlob({ area: 'Mirpur', district: 'Dhaka' })).toBeNull();
    });

    it('returns null for null, {}, arrays, and non-objects', () => {
      expect(readAddressBlob(null)).toBeNull();
      expect(readAddressBlob({})).toBeNull();
      expect(readAddressBlob([])).toBeNull();
      expect(readAddressBlob('a string')).toBeNull();
    });

    it('isEmptyAddressBlob agrees with readAddressBlob', () => {
      expect(isEmptyAddressBlob({})).toBe(true);
      expect(isEmptyAddressBlob({ addressLine: 'House 1' })).toBe(false);
    });
  });

  describe('normalizeFullAddress', () => {
    it('normalises every component', () => {
      const n = normalizeFullAddress({
        fullName: 'Rahim Uddin',
        phone: '০১৭',
        addressLine: 'Rd 5',
        thana: 'Mirpur Upazila',
      });
      expect(n).toMatchObject({
        fullName: 'rahim uddin',
        phone: '017',
        addressLine: 'road 5',
        thana: 'mirpur thana',
        country: 'bangladesh',
      });
    });
  });
});

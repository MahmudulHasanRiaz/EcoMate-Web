import { formatCourierAddress } from '../address-format';

describe('formatCourierAddress (Hotfix 1 — shared courier address formatter)', () => {
  it('assembles the full address from available components', () => {
    expect(
      formatCourierAddress({
        addressLine: 'House 12, Road 5',
        thana: 'Dhanmondi',
        district: 'Dhaka',
        division: 'Dhaka Division',
        postCode: '1205',
      }),
    ).toBe('House 12, Road 5, Dhanmondi, Dhaka, Dhaka Division, 1205');
  });

  it('supports the address/upazila/postal/area/country key aliases', () => {
    expect(
      formatCourierAddress({
        address: 'House 1',
        upazila: 'Mirpur',
        area: 'Ward 1',
        postal: '1216',
        district: 'Dhaka',
        country: 'BD',
      }),
    ).toBe('House 1, Ward 1, Mirpur, Dhaka, 1216, BD');
  });

  it('dedupes exact duplicate components', () => {
    expect(
      formatCourierAddress({ addressLine: 'Dhaka', district: 'Dhaka' }),
    ).toBe('Dhaka');
  });

  it('skips empty components and leaves no trailing comma', () => {
    expect(
      formatCourierAddress({ addressLine: 'House 1', thana: '', district: 'Dhaka' }),
    ).toBe('House 1, Dhaka');
  });

  it('returns null for absent or fully-empty address data', () => {
    expect(formatCourierAddress(null)).toBeNull();
    expect(formatCourierAddress(undefined)).toBeNull();
    expect(formatCourierAddress({})).toBeNull();
    expect(formatCourierAddress({ addressLine: '', district: '', thana: '' })).toBeNull();
  });

  it('ignores unknown keys (no fabricated components)', () => {
    expect(formatCourierAddress({ addressLine: 'A', deliveryType: 'home' })).toBe('A');
  });
});
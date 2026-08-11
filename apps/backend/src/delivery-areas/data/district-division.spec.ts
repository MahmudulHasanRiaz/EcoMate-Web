import {
  BD_DIVISIONS,
  DISTRICT_TO_DIVISION,
  resolveDivision,
  isKnownDistrict,
} from './district-division';
import { BD_DISTRICTS } from './bd-districts';

describe('Bangladesh district → division resolver', () => {
  it('maps all 64 project districts to exactly one division', () => {
    // BD_DISTRICTS is the authoritative source of districts used by the
    // storefront delivery-areas endpoint.
    const districts = BD_DISTRICTS.map((d) => d.name);
    expect(districts.length).toBe(64);

    const missing: string[] = [];
    for (const district of districts) {
      const division = resolveDivision(district);
      if (!division) missing.push(district);
      else if (!BD_DIVISIONS.includes(division as any)) missing.push(district);
    }
    expect(missing).toEqual([]);

    // Exactly one mapping per district (no duplicate keys possible in the
    // object, but ensure every district resolves).
    expect(Object.keys(DISTRICT_TO_DIVISION).length).toBe(64);
  });

  it('resolves the known division for every canonical district', () => {
    expect(resolveDivision('Dhaka')).toBe('Dhaka');
    expect(resolveDivision('Chittagong')).toBe('Chittagong');
    expect(resolveDivision("Cox's Bazar")).toBe('Chittagong');
    expect(resolveDivision('Feni')).toBe('Chittagong');
    expect(resolveDivision('Rajshahi')).toBe('Rajshahi');
    expect(resolveDivision('Khulna')).toBe('Khulna');
    expect(resolveDivision('Barisal')).toBe('Barisal');
    expect(resolveDivision('Sylhet')).toBe('Sylhet');
    expect(resolveDivision('Rangpur')).toBe('Rangpur');
    expect(resolveDivision('Mymensingh')).toBe('Mymensingh');
    expect(resolveDivision('Sherpur')).toBe('Mymensingh');
    expect(resolveDivision('Panchagarh')).toBe('Rangpur');
    expect(resolveDivision('Habiganj')).toBe('Sylhet');
    expect(resolveDivision('Tangail')).toBe('Dhaka');
    expect(resolveDivision('Satkhira')).toBe('Khulna');
  });

  it('accepts official spelling variants via aliases', () => {
    expect(resolveDivision('Chattogram')).toBe('Chittagong');
    expect(resolveDivision('Cumilla')).toBe('Chittagong');
    expect(resolveDivision('Barishal')).toBe('Barisal');
    expect(resolveDivision('Jhalokathi')).toBe('Barisal');
    expect(resolveDivision('Khagrachhari')).toBe('Chittagong');
    expect(resolveDivision('Khagrachory')).toBe('Chittagong');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveDivision('  dhaka  ')).toBe('Dhaka');
    expect(resolveDivision('DHAKA')).toBe('Dhaka');
    expect(resolveDivision('cox\'s bazar')).toBe('Chittagong');
  });

  it('returns undefined for unknown/invalid districts', () => {
    expect(resolveDivision('')).toBeUndefined();
    expect(resolveDivision(undefined)).toBeUndefined();
    expect(resolveDivision(null)).toBeUndefined();
    expect(resolveDivision('Atlantis')).toBeUndefined();
    expect(resolveDivision('12345')).toBeUndefined();
    expect(isKnownDistrict('Atlantis')).toBe(false);
    expect(isKnownDistrict('Dhaka')).toBe(true);
  });

  it('covers each of the 8 divisions with the expected district counts', () => {
    const perDivision: Record<string, number> = {};
    for (const [district, division] of Object.entries(DISTRICT_TO_DIVISION)) {
      perDivision[division] = (perDivision[division] || 0) + 1;
    }
    // Official counts: Dhaka 13, Chittagong 11, Rajshahi 8, Khulna 10,
    // Barisal 6, Sylhet 4, Rangpur 8, Mymensingh 4.
    expect(perDivision).toEqual({
      Dhaka: 13,
      Chittagong: 11,
      Rajshahi: 8,
      Khulna: 10,
      Barisal: 6,
      Sylhet: 4,
      Rangpur: 8,
      Mymensingh: 4,
    });
  });
});
import { describe, it, expect } from 'vitest';
import { hasLicenseFeature } from '@/lib/api/storefront-config';

describe('hasLicenseFeature (license wildcard)', () => {
  it("opens every feature for the '*' plan", () => {
    expect(hasLicenseFeature({ licenseFeatures: ['*'] }, 'admin_combos')).toBe(true);
    expect(hasLicenseFeature({ licenseFeatures: ['*'] }, 'storefront_wishlist')).toBe(true);
    expect(hasLicenseFeature({ licenseFeatures: ['*'] }, 'anything_at_all')).toBe(true);
  });

  it('matches exact features without wildcard', () => {
    const config = { licenseFeatures: ['admin_combos'] };
    expect(hasLicenseFeature(config, 'admin_combos')).toBe(true);
    expect(hasLicenseFeature(config, 'storefront_wishlist')).toBe(false);
  });

  it('denies safely on missing config', () => {
    expect(hasLicenseFeature(null, 'admin_combos')).toBe(false);
    expect(hasLicenseFeature(undefined, 'admin_combos')).toBe(false);
    expect(hasLicenseFeature({}, 'admin_combos')).toBe(false);
  });
});

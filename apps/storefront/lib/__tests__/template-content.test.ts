import { describe, it, expect } from 'vitest';
import { TEMPLATE_PAGE_ROUTES, hasRealShippingConfig } from '../template-content';

describe('template-content route table (D8)', () => {
  it('covers every template route exactly once with a unique slug', () => {
    const slugs = TEMPLATE_PAGE_ROUTES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(TEMPLATE_PAGE_ROUTES.map((t) => t.key).sort()).toEqual([
      'about', 'careers', 'company', 'contact', 'delivery-areas', 'download',
      'exchange-policy', 'faq', 'privacy-policy', 'refund-policy',
      'shipping-policy', 'stores', 'terms-conditions',
    ]);
  });

  it('includes /company and /download', () => {
    const paths = TEMPLATE_PAGE_ROUTES.map((t) => t.path);
    expect(paths).toContain('/company');
    expect(paths).toContain('/download');
  });
});

describe('hasRealShippingConfig', () => {
  it('false for missing / empty configs', () => {
    expect(hasRealShippingConfig(null)).toBe(false);
    expect(hasRealShippingConfig(undefined)).toBe(false);
    expect(hasRealShippingConfig({})).toBe(false);
    expect(hasRealShippingConfig({ shippingZones: [], districtCharges: {}, shippingOptions: [], delivery: { charge: 0 } })).toBe(false);
  });

  it('true when zones, district charges, options, or a default charge exist', () => {
    expect(hasRealShippingConfig({ shippingZones: [{ id: 'z1' }] })).toBe(true);
    expect(hasRealShippingConfig({ districtCharges: { Dhaka: 60 } })).toBe(true);
    expect(hasRealShippingConfig({ shippingOptions: [{ id: 'o1' }] })).toBe(true);
    expect(hasRealShippingConfig({ delivery: { charge: 60 } })).toBe(true);
  });
});

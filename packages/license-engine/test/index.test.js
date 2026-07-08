const { LicenseEngine } = require('../dist/index');

describe('LicenseEngine', () => {
  test('verify returns LicenseInfo with correct features', () => {
    const engine = new LicenseEngine();
    const response = { features: ['storefront', 'admin_products', 'admin_orders'] };
    const result = engine.verify(response);
    expect(result.features.length).toBe(3);
    expect(result.hasFeature('storefront')).toBe(true);
    expect(result.hasFeature('admin_products')).toBe(true);
    expect(result.hasFeature('admin_orders')).toBe(true);
    expect(result.hasFeature('nonexistent')).toBe(false);
  });

  test('getLicense returns null before verify', () => {
    const engine = new LicenseEngine();
    expect(engine.getLicense()).toBeNull();
  });

  test('getLicense returns LicenseInfo after verify', () => {
    const engine = new LicenseEngine();
    const response = { features: ['storefront'] };
    engine.verify(response);
    const license = engine.getLicense();
    expect(license).not.toBeNull();
    expect(license.hasFeature('storefront')).toBe(true);
  });

  test('checkIn returns false before verify', () => {
    const engine = new LicenseEngine();
    expect(engine.checkIn()).toBe(false);
  });

  test('checkIn returns true after verify', () => {
    const engine = new LicenseEngine();
    engine.verify({ features: ['storefront'] });
    expect(engine.checkIn()).toBe(true);
  });
});

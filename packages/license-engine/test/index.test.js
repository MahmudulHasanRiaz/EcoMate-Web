const { LicenseEngine } = require('../dist/index');

describe('LicenseEngine', () => {
  test('verify returns LicenseInfo with correct structure', async () => {
    const engine = new LicenseEngine();
    // Without apiClient, verify returns engine_unavailable
    const result = await engine.verify('test-key', 'example.com');
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('code');
  });

  test('getLicense returns null before verify', () => {
    const engine = new LicenseEngine();
    expect(engine.getLicense()).toBeNull();
  });

  test('getLicense returns LicenseInfo after verify', async () => {
    const engine = new LicenseEngine();
    await engine.verify('test-key', 'example.com');
    const license = engine.getLicense();
    expect(license).not.toBeNull();
  });

  test('checkIn returns false before verify', () => {
    const engine = new LicenseEngine();
    expect(engine.checkIn()).toBe(false);
  });

  test('canUseFeature checks feature in license', () => {
    const engine = new LicenseEngine();
    const license = { valid: true, features: ['storefront', 'admin_products'] };
    expect(engine.canUseFeature(license, 'storefront')).toBe(true);
    expect(engine.canUseFeature(license, 'admin_products')).toBe(true);
    expect(engine.canUseFeature(license, 'nonexistent')).toBe(false);
  });

  test('canUseFeature wildcard', () => {
    const engine = new LicenseEngine();
    const license = { valid: true, features: ['*'] };
    expect(engine.canUseFeature(license, 'anything')).toBe(true);
  });

  test('canUseFeature returns false for invalid license', () => {
    const engine = new LicenseEngine();
    const license = { valid: false };
    expect(engine.canUseFeature(license, 'anything')).toBe(false);
  });
});

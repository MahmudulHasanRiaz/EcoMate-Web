const assert = require('assert');
const { LicenseEngine } = require('../dist/index');

const tests = [];

function test(desc, fn) {
  tests.push({ desc, fn });
}

test('verify returns LicenseInfo with correct features', () => {
  const engine = new LicenseEngine();
  const response = { features: ['storefront', 'admin_products', 'admin_orders'] };
  const result = engine.verify(response);

  assert.strictEqual(result.features.length, 3);
  assert.ok(result.hasFeature('storefront'));
  assert.ok(result.hasFeature('admin_products'));
  assert.ok(result.hasFeature('admin_orders'));
  assert.strictEqual(result.hasFeature('nonexistent'), false);
});

test('getLicense returns null before verify', () => {
  const engine = new LicenseEngine();
  assert.strictEqual(engine.getLicense(), null);
});

test('getLicense returns LicenseInfo after verify', () => {
  const engine = new LicenseEngine();
  const response = { features: ['storefront'] };
  engine.verify(response);

  const license = engine.getLicense();
  assert.ok(license !== null);
  assert.ok(license.hasFeature('storefront'));
});

test('checkIn returns false before verify', () => {
  const engine = new LicenseEngine();
  assert.strictEqual(engine.checkIn(), false);
});

test('checkIn returns true after verify', () => {
  const engine = new LicenseEngine();
  engine.verify({ features: ['storefront'] });
  assert.strictEqual(engine.checkIn(), true);
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const { desc, fn } of tests) {
    try {
      await fn();
      console.log(`  PASS  ${desc}`);
      passed++;
    } catch (e) {
      console.error(`  FAIL  ${desc}: ${e.message}`);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();

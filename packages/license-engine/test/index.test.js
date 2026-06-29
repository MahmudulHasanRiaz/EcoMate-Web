const assert = require('assert');
const mod = require('../dist/index');
const LicenseEngine = mod.LicenseEngine;

const KEYMATE_URL = 'http://localhost:3000/api/v1/saas';

function mockFetch(handler) {
  const orig = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = orig; };
}

const tests = [];

function test(desc, fn) {
  tests.push({ desc, fn });
}

const validResponse = {
  valid: true,
  plan: { id: 'p1', name: 'Growth', planType: 'fixed', price: 99 },
  features: ['storefront_catalog', 'admin_products', 'admin_orders', 'admin_accounting'],
  limits: { orders_per_month: 5000, staff_users: 10 },
  domains: ['client-store.com'],
  expiry: '2026-12-31T00:00:00Z',
  lastCheckIn: null,
};

// ── verify ──
test('verify returns valid license info', async () => {
  const restore = mockFetch(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(validResponse),
  }));
  const engine = new LicenseEngine({ keymateUrl: KEYMATE_URL });
  const result = await engine.verify('test-license-key', 'client-store.com');
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.plan.name, 'Growth');
  assert.ok(result.features.includes('storefront_catalog'));
  assert.strictEqual(result.limits.orders_per_month, 5000);
  restore();
});

test('verify returns invalid for rejected license', async () => {
  const restore = mockFetch(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ valid: false, code: 'license_not_found' }),
  }));
  const engine = new LicenseEngine({ keymateUrl: KEYMATE_URL });
  const result = await engine.verify('bad-key');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.code, 'license_not_found');
  restore();
});

test('verify falls back to cache on network error', async () => {
  const engine = new LicenseEngine({ keymateUrl: KEYMATE_URL, offlineGraceMs: 5000 });
  const restoreSuccess = mockFetch(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(validResponse),
  }));
  await engine.verify('cache-test-key', 'client-store.com');
  restoreSuccess();
  const restoreFail = mockFetch(() => Promise.reject(new Error('network error')));
  const result = await engine.verify('cache-test-key', 'client-store.com');
  assert.strictEqual(result.valid, true, 'should fall back to cached license');
  assert.strictEqual(result.detail, 'offline_cache');
  restoreFail();
});

// ── canUseFeature ──
test('canUseFeature checks feature list', () => {
  const engine = new LicenseEngine({ keymateUrl: KEYMATE_URL });
  assert.strictEqual(engine.canUseFeature({ valid: true, features: ['a', 'b'] }, 'a'), true);
  assert.strictEqual(engine.canUseFeature({ valid: true, features: ['a', 'b'] }, 'c'), false);
});

test('canUseFeature returns false for invalid license', () => {
  const engine = new LicenseEngine({ keymateUrl: KEYMATE_URL });
  assert.strictEqual(engine.canUseFeature({ valid: false }, 'a'), false);
  assert.strictEqual(engine.canUseFeature(null, 'a'), false);
});

// ── checkLimit ──
test('checkLimit returns ok when under limit', () => {
  const engine = new LicenseEngine({ keymateUrl: KEYMATE_URL });
  const limit = engine.checkLimit({ valid: true, limits: { orders_per_month: 100 } }, 'orders_per_month', 50);
  assert.strictEqual(limit.ok, true);
  assert.strictEqual(limit.allowed, 100);
  assert.strictEqual(limit.remaining, 50);
});

test('checkLimit returns fail when over limit', () => {
  const engine = new LicenseEngine({ keymateUrl: KEYMATE_URL });
  const limit = engine.checkLimit({ valid: true, limits: { orders_per_month: 100 } }, 'orders_per_month', 150);
  assert.strictEqual(limit.ok, false);
  assert.strictEqual(limit.remaining, 0);
});

test('checkLimit handles missing metric as unlimited', () => {
  const engine = new LicenseEngine({ keymateUrl: KEYMATE_URL });
  const limit = engine.checkLimit({ valid: true, limits: {} }, 'nonexistent', 999999);
  assert.strictEqual(limit.ok, true);
  assert.strictEqual(limit.allowed, Infinity);
});

// ── setLicense / getLicense ──
test('setLicense stores key for later verification', () => {
  const engine = new LicenseEngine({ keymateUrl: KEYMATE_URL });
  const result = engine.setLicense('test-key');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.code, 'not_verified');
});

test('getLicense returns null before verification', () => {
  const engine = new LicenseEngine({ keymateUrl: KEYMATE_URL });
  assert.strictEqual(engine.getLicense(), null);
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

const assert = require('assert');
const LicenseEngine = require('../index');

const VALID_JWT = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJjbGllbnRJZCI6InRlc3QtY2xpZW50IiwicGxhbiI6ImVudGVycHJpc2UiLCJwYWNrYWdlcyI6WyJwb3MiXSwiY3VzdG9tRmVhdHVyZXMiOlsiYWR2YW5jZWQtcmVwb3J0cyJdLCJsaW1pdHMiOnsiY3B1cyI6NCwibWVtb3J5IjoiOEciLCJ1c2VycyI6MTAsInN0b3JlcyI6NX0sImV4cCI6OTk5OTk5OTk5OX0.ZmFrZXNpZ25hdHVyZQ';

function test(desc, fn) {
  try {
    fn();
    console.log(`  PASS  ${desc}`);
  } catch (e) {
    console.error(`  FAIL  ${desc}: ${e.message}`);
    process.exitCode = 1;
  }
}

test('verify returns valid for well-formed JWT', () => {
  const result = LicenseEngine.verify(VALID_JWT);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.clientId, 'test-client');
  assert.strictEqual(result.plan, 'enterprise');
  assert.deepStrictEqual(result.packages, ['pos']);
  assert.deepStrictEqual(result.customFeatures, ['advanced-reports']);
  assert.deepStrictEqual(result.limits, { cpus: 4, memory: '8G', users: 10, stores: 5 });
  assert.strictEqual(result.exp, 9999999999);
});

test('verify returns invalid for malformed token', () => {
  const result = LicenseEngine.verify('not-a-jwt');
  assert.strictEqual(result.valid, false);
});

test('verify returns invalid for empty string', () => {
  const result = LicenseEngine.verify('');
  assert.strictEqual(result.valid, false);
});

test('canUseFeature returns true for plan-based feature', () => {
  const license = LicenseEngine.verify(VALID_JWT);
  assert.strictEqual(LicenseEngine.canUseFeature(license, 'pos'), true);
});

test('canUseFeature returns true for enterprise plan multi-warehouse', () => {
  const license = LicenseEngine.verify(VALID_JWT);
  assert.strictEqual(LicenseEngine.canUseFeature(license, 'multi-warehouse'), true);
});

test('canUseFeature returns true for custom feature', () => {
  const license = LicenseEngine.verify(VALID_JWT);
  assert.strictEqual(LicenseEngine.canUseFeature(license, 'advanced-reports'), true);
});

test('canUseFeature returns false for unknown feature key', () => {
  const license = LicenseEngine.verify(VALID_JWT);
  assert.strictEqual(LicenseEngine.canUseFeature(license, 'nonexistent-feature'), false);
});

test('canUseFeature returns false for invalid license', () => {
  assert.strictEqual(LicenseEngine.canUseFeature({ valid: false }, 'pos'), false);
  assert.strictEqual(LicenseEngine.canUseFeature(null, 'pos'), false);
});

test('growth plan has pos feature', () => {
  const growthPayload = btoa(JSON.stringify({ clientId: 'g', plan: 'growth', packages: [], customFeatures: [], limits: {}, exp: 9999999999 }));
  const token = `header.${growthPayload}.sig`;
  const license = LicenseEngine.verify(token);
  assert.strictEqual(LicenseEngine.canUseFeature(license, 'pos'), true);
});

test('basic plan cannot use pos feature', () => {
  const basicPayload = btoa(JSON.stringify({ clientId: 'b', plan: 'basic', packages: [], customFeatures: [], limits: {}, exp: 9999999999 }));
  const token = `header.${basicPayload}.sig`;
  const license = LicenseEngine.verify(token);
  assert.strictEqual(LicenseEngine.canUseFeature(license, 'pos'), false);
});

function btoa(s) {
  return Buffer.from(s).toString('base64url');
}

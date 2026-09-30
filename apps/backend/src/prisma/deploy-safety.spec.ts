/**
 * Deploy-path data-loss guards (2026-09-30 audit, section A).
 *
 * These are source-level contract tests, in the same spirit as
 * migration-safety.p0.spec.ts: they lock the invariants that protect live data
 * on every redeploy, where a behavioural test would need a real production
 * database to be meaningful.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');

describe('Deploy-path data-loss guards', () => {
  describe('boot-time schema repair (src/prisma/prisma.service.ts)', () => {
    const svc = read('src/prisma/prisma.service.ts');

    it('never drops live columns in production', () => {
      const start = svc.indexOf('private async dropStaleColumns');
      expect(start).toBeGreaterThan(-1);
      const end = svc.indexOf('private async validateSchemaCompleteness', start);
      const body = svc.slice(start, end > start ? end : undefined);

      // The production gate must come BEFORE any DROP COLUMN statement.
      const gate = body.indexOf("process.env.NODE_ENV === 'production'");
      const drop = body.indexOf('DROP COLUMN');
      expect(gate).toBeGreaterThan(-1);
      expect(drop).toBeGreaterThan(-1);
      expect(gate).toBeLessThan(drop);
    });

    it('still defers all repairs while a restore is in progress', () => {
      const init = svc.slice(
        svc.indexOf('async onModuleInit()'),
        svc.indexOf('async onModuleDestroy()'),
      );
      expect(init).toMatch(/isRestoreWriteBlocked/);
      expect(init.indexOf('isRestoreWriteBlocked')).toBeLessThan(
        init.indexOf('dropStaleColumns'),
      );
    });
  });

  describe('seed (prisma/seed.ts)', () => {
    const seed = read('prisma/seed.ts');

    it('demo data is opt-in — an unset env var must mean OFF', () => {
      expect(seed).toContain("process.env.SEED_DUMMY_DATA === 'true'");
      expect(seed).not.toContain("process.env.SEED_DUMMY_DATA !== 'false'");
    });

    it('never resets an existing admin password on a reseed', () => {
      expect(seed).not.toMatch(/update:\s*\{[^}]*password/);
      expect(seed).toMatch(/password left unchanged/);
      // A brand-new production admin must never get the public default.
      expect(seed).toMatch(/ADMIN_PASSWORD must be set/);
    });

    it('system settings are create-only (client edits survive a reseed)', () => {
      const idx = seed.indexOf('systemSetting.upsert');
      expect(idx).toBeGreaterThan(-1);
      const block = seed.slice(idx, idx + 400);
      expect(block).toMatch(/update:\s*\{\s*\}/);
    });

    it('order-status transitions come from the runtime map and are never overwritten', () => {
      expect(seed).toContain("from '../src/orders/order-transitions'");
      expect(seed).toContain('createdStatusNames');
      expect(seed).toMatch(/if \(!createdStatusNames\.has\(name\)\) continue;/);
    });

    it('the shipped transition map keeps the RTN rule (no Partial → Delivered)', () => {
      const shared = read('src/orders/order-transitions.ts');
      expect(shared).toMatch(/Partial:\s*\['Return Pending'\]/);
      expect(shared).not.toMatch(/Partial:\s*\['Delivered'/);
    });

    it('demo orders/payments cannot be duplicated by a second run', () => {
      expect(seed).toContain('existingDemoOrders');
      const idx = seed.indexOf('existingDemoOrders');
      expect(seed.slice(idx, idx + 400)).toMatch(/order\.count|prisma\.order/);
    });
  });

  describe('inventory E2E script (prisma/scripts/e2e-inventory-test.ts)', () => {
    const script = read('prisma/scripts/e2e-inventory-test.ts');

    it('refuses to run against a production database without an explicit override', () => {
      expect(script).toMatch(/NODE_ENV === 'production'/);
      expect(script).toMatch(/ALLOW_E2E_INVENTORY/);
      const guard = script.indexOf("NODE_ENV === 'production'");
      const wipe = script.indexOf('blockedIp.deleteMany');
      expect(guard).toBeGreaterThan(-1);
      expect(wipe).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(wipe);
    });
  });
});

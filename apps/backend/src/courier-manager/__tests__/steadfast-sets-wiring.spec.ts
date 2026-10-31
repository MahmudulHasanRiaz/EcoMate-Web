import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression tripwire — Steadfast credential-sets DI incident (2026-10-31).
 *
 * Five classes inject SteadfastCredentialSetsService with @Optional(). All
 * five imported it with `import type`, so TypeScript elided the import
 * entirely: the compiled JS contains no require() for the service and the
 * emitted design:paramtypes entry degrades to Object. Nest therefore could
 * never resolve the token and every @Optional() injection was undefined at
 * runtime — set creation 500'd ("Credential sets not available"), the list
 * endpoint silently degraded to [], and dispatch / tracking / webhook /
 * customer-history silently fell back to the legacy single account. The
 * whole multi-account feature was dead while every unit test passed,
 * because the specs construct their subjects by hand.
 *
 * A value import is the fix; this test keeps it from regressing. (Same
 * spirit as src/testing/prisma-schema-guard.ts: scan the source for the
 * class of mistake mocks cannot see.)
 */
describe('SteadfastCredentialSetsService DI wiring', () => {
  const consumers = [
    'courier-manager.controller.ts',
    'courier-webhook.controller.ts',
    'courier-customer-history.service.ts',
    'courier-manager.service.ts',
    'courier-tracking.service.ts',
  ];

  for (const file of consumers) {
    it(`${file} imports the sets service as a VALUE (not import type)`, () => {
      const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      expect(src).not.toMatch(
        /import\s+type\s*\{[^}]*SteadfastCredentialSetsService/,
      );
      expect(src).toMatch(
        /import\s*\{[^}]*SteadfastCredentialSetsService[^}]*\}\s*from\s*'\.\/steadfast-credential-sets\.service'/,
      );
    });
  }
});

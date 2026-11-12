import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { CachePurgeController } from '../cache-purge.controller';

/**
 * Cache-purge controller tests (P0 stale-bundle round, 2026-11-12).
 *
 * The purge endpoint is superadmin-only (enforced by the global
 * RolesGuard via @Roles('superadmin')); the version endpoint is public
 * so every device — including the storefront and not-yet-updated admin
 * bundles — can read the current cache version without a session.
 * No @RequiresFeature: this is a superadmin ops tool, not a licensed
 * feature, so it must never 403 on a tenant whose plan lacks a key.
 */
describe('CachePurgeController', () => {
  const service = {
    purgeAll: jest.fn(),
    getCacheVersion: jest.fn(),
  };
  const controller = new CachePurgeController(service as any);

  it('marks purgeAll superadmin-only', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      CachePurgeController.prototype.purgeAll,
    );
    expect(roles).toEqual(['superadmin']);
  });

  it('marks getCacheVersion public', () => {
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      CachePurgeController.prototype.getCacheVersion,
    );
    expect(isPublic).toBe(true);
  });

  it('does not gate purgeAll behind a licensed feature', () => {
    const meta = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      CachePurgeController.prototype.purgeAll,
    );
    expect(meta).toBeUndefined();
  });

  it('purgeAll delegates to the service and returns its per-layer result', async () => {
    const result = { version: '2', layers: {} };
    service.purgeAll.mockResolvedValueOnce(result);
    await expect(controller.purgeAll()).resolves.toBe(result);
  });

  it('getCacheVersion delegates to the service', async () => {
    service.getCacheVersion.mockResolvedValueOnce({ version: '2' });
    await expect(controller.getCacheVersion()).resolves.toEqual({
      version: '2',
    });
  });
});

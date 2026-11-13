import { ForbiddenException } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';

/**
 * Careers feature gate — explicit parent enforcement.
 *
 * `admin_hr_careers` is declared with `dependencies: ['admin_hr']` in the
 * shared feature catalogue, but the FeatureGuard only checks the single
 * feature on `@RequiresFeature` and ignores dependencies (see
 * packages/feature-flags/src/guard.ts). So every careers service method
 * calls this helper, which requires BOTH the parent `admin_hr` AND the
 * careers key. A client holding `admin_hr` without `admin_hr_careers`
 * is refused here even though the guard alone would let the careers key
 * through — and vice versa.
 *
 * `'*'` (Special Custom Plan / dev-mode) opens both keys via canUse().
 */
export function assertCareersFeature(
  featureFlags: FeatureFlagsService,
): void {
  if (!featureFlags.canUse('admin_hr')) {
    throw new ForbiddenException(
      'Feature "admin_hr" is not included in your plan',
    );
  }
  if (!featureFlags.canUse('admin_hr_careers')) {
    throw new ForbiddenException(
      'Feature "admin_hr_careers" is not included in your plan',
    );
  }
}

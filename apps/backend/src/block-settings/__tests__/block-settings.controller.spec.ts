import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { BlockSettingsController } from '../block-settings.controller';

describe('BlockSettingsController', () => {
  it('has RequiresFeature(admin_blocking) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      BlockSettingsController,
    );
    expect(featureKey).toBe('admin_blocking');
  });

  const STAFF_ROLES = ['superadmin', 'admin', 'manager', 'cashier'];

  it.each(['get', 'update'])(
    '%s is allowed for all roles except customer',
    (method) => {
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        BlockSettingsController.prototype[method],
      );
      expect(roles).toEqual(STAFF_ROLES);
      expect(roles).not.toContain('customer');
    },
  );
});

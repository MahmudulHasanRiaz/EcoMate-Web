import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { BlockedEntriesController } from '../blocked-entries.controller';

describe('BlockedEntriesController', () => {
  it('has RequiresFeature(admin_blocking) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      BlockedEntriesController,
    );
    expect(featureKey).toBe('admin_blocking');
  });

  const STAFF_ROLES = ['superadmin', 'admin', 'manager', 'cashier'];

  it.each(['findAll', 'create', 'unblock', 'toggleWhitelist'])(
    '%s is allowed for all roles except customer',
    (method) => {
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        BlockedEntriesController.prototype[method],
      );
      expect(roles).toEqual(STAFF_ROLES);
      expect(roles).not.toContain('customer');
    },
  );
});

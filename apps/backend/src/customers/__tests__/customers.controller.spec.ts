import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { CustomersController } from '../customers.controller';

describe('CustomersController', () => {
  it('has RequiresFeature(admin_customers) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      CustomersController,
    );
    expect(featureKey).toBe('admin_customers');
  });

  const BLOCK_ROLES = ['superadmin', 'admin', 'manager', 'cashier'];

  it.each(['blockPhone', 'unblockPhone'])(
    '%s is allowed for all staff roles',
    (method) => {
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        CustomersController.prototype[method],
      );
      expect(roles).toEqual(BLOCK_ROLES);
      expect(roles).not.toContain('customer');
    },
  );
});

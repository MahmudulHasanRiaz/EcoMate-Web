import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { UsersController } from '../users.controller';

describe('UsersController', () => {
  it('has RequiresFeature(admin_staff_users) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      UsersController,
    );
    expect(featureKey).toBe('admin_staff_users');
  });
});

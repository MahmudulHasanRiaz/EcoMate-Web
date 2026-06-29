import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { DashboardController } from '../dashboard.controller';

describe('DashboardController', () => {
  it('has RequiresFeature(admin_dashboard) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, DashboardController);
    expect(featureKey).toBe('admin_dashboard');
  });
});

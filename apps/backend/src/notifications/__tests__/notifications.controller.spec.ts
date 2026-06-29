import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { NotificationsController } from '../notifications.controller';

describe('NotificationsController', () => {
  it('has RequiresFeature(admin_notifications) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, NotificationsController);
    expect(featureKey).toBe('admin_notifications');
  });
});

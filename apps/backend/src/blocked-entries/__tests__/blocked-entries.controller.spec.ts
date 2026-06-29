import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { BlockedEntriesController } from '../blocked-entries.controller';

describe('BlockedEntriesController', () => {
  it('has RequiresFeature(admin_blocking) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, BlockedEntriesController);
    expect(featureKey).toBe('admin_blocking');
  });
});

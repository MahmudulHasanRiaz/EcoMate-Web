import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { TasksController } from '../tasks.controller';

describe('TasksController', () => {
  it('has RequiresFeature(admin_tasks) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      TasksController,
    );
    expect(featureKey).toBe('admin_tasks');
  });
});

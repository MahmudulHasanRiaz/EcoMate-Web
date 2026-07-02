import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ImportController } from '../import.controller';

describe('ImportController', () => {
  it('has RequiresFeature(admin_import) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      ImportController,
    );
    expect(featureKey).toBe('admin_import');
  });
});

import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { SearchController } from '../search.controller';

describe('SearchController', () => {
  it('has RequiresFeature(storefront_search) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      SearchController,
    );
    expect(featureKey).toBe('storefront_search');
  });
});

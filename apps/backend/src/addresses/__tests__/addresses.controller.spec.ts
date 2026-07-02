import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { AddressesController } from '../addresses.controller';

describe('AddressesController', () => {
  it('has RequiresFeature(storefront_account) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      AddressesController,
    );
    expect(featureKey).toBe('storefront_account');
  });
});

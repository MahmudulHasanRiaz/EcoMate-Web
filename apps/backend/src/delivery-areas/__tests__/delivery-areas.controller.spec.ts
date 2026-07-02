import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { DeliveryAreasController } from '../delivery-areas.controller';

describe('DeliveryAreasController', () => {
  const allPublicMethods = ['getDistricts', 'getThanas'];

  it('has no RequiresFeature metadata on any method', () => {
    for (const method of allPublicMethods) {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        DeliveryAreasController.prototype[method],
      );
      expect(meta).toBeUndefined();
    }
  });
});

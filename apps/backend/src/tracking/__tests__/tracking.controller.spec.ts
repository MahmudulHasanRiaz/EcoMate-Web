import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { TrackingController } from '../tracking.controller';

describe('TrackingController', () => {
  const allPublicMethods = ['trackEvent', 'saveContext'];

  it('has no RequiresFeature metadata on any method', () => {
    for (const method of allPublicMethods) {
      const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, TrackingController.prototype[method]);
      expect(meta).toBeUndefined();
    }
  });
});

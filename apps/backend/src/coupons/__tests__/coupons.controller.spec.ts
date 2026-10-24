import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { CouponsController } from '../coupons.controller';

describe('CouponsController', () => {
  it('has RequiresFeature(admin_coupons) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      CouponsController,
    );
    expect(featureKey).toBe('admin_coupons');
  });

  it('exposes coupon validation publicly for storefront guests (D11)', () => {
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      CouponsController.prototype.validate,
    );
    expect(isPublic).toBe(true);
  });
});

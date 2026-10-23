import { PATH_METADATA } from '@nestjs/common/constants';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ShippingController } from '../shipping.controller';

describe('ShippingController', () => {
  it('has RequiresFeature(admin_shipments) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      ShippingController,
    );
    expect(featureKey).toBe('admin_shipments');
  });

  /**
   * The admin calls `GET /shipping/zones` (zone-group list + city → charge
   * suggestion). The old client path `/shipping-zones` 404'd, so this pins the
   * canonical route the UI depends on.
   */
  it('serves the zone groups under /shipping/zones', () => {
    const base = Reflect.getMetadata(PATH_METADATA, ShippingController);
    const zones = Reflect.getMetadata(
      PATH_METADATA,
      ShippingController.prototype.findAllZoneGroups,
    );

    expect(base).toBe('shipping');
    expect(zones).toBe('zones');
    expect(`${base}/${zones}`).toBe('shipping/zones');
  });

  it('delegates the zone-group list to the service', async () => {
    const groups = [{ id: 'zone-1', name: 'Inside Dhaka' }];
    const shippingService = {
      findAllZoneGroups: jest.fn().mockResolvedValue(groups),
    };
    const controller = new ShippingController(shippingService as any);

    await expect(controller.findAllZoneGroups()).resolves.toEqual(groups);
    expect(shippingService.findAllZoneGroups).toHaveBeenCalledTimes(1);
  });
});

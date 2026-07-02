import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { InventoryController } from '../inventory.controller';

describe('InventoryController', () => {
  it('has RequiresFeature(admin_inventory) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      InventoryController,
    );
    expect(featureKey).toBe('admin_inventory');
  });
});

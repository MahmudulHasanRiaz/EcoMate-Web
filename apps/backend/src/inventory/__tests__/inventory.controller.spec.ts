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

  describe('list pagination guard (unbounded perPage)', () => {
    const service = {
      logs: jest.fn(),
      listTransfers: jest.fn(),
      stockOverview: jest.fn(),
    };
    const controller = new InventoryController(service as any, {} as any);

    beforeEach(() => jest.clearAllMocks());

    it('caps perPage at 100 on transfers', async () => {
      await controller.transfers(undefined, '100000');
      expect(service.listTransfers).toHaveBeenCalledWith(1, 100, undefined, undefined);
    });

    it('caps perPage at 100 on logs and stock-overview', async () => {
      await controller.logs(undefined, '5000');
      expect(service.logs).toHaveBeenCalledWith(1, 100, undefined, undefined, undefined);

      await controller.stockOverview(undefined, '5000', undefined, undefined, undefined, 'x', 'y');
      expect(service.stockOverview).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, perPage: 100 }),
      );
    });

    it('falls back to defaults on garbage input instead of passing NaN through', async () => {
      await controller.transfers('not-a-number', 'abc');
      expect(service.listTransfers).toHaveBeenCalledWith(1, 20, undefined, undefined);
    });

    it('keeps normal page sizes untouched', async () => {
      await controller.transfers('3', '50');
      expect(service.listTransfers).toHaveBeenCalledWith(3, 50, undefined, undefined);
    });
  });
});

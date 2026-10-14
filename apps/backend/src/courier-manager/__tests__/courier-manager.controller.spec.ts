import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { CourierManagerController } from '../courier-manager.controller';

const createController = () => {
  const prisma = {
    order: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const svc = {
    bulkCreateSteadfastOrders: jest.fn().mockResolvedValue({ results: [] }),
  };
  const controller = new CourierManagerController(
    svc as any,
    {} as any,
    prisma as any,
    {} as any,
    { reconcileSteadfastReturn: jest.fn() } as any,
  );
  return { controller, prisma, svc };
};

describe('CourierManagerController', () => {
  it('has RequiresFeature(admin_courier) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      CourierManagerController,
    );
    expect(featureKey).toBe('admin_courier');
  });

  describe('steadfast/bulk', () => {
    // The COD amount sent to Steadfast is derived from recorded payments
    // (getCollectableAmount). Without `payments` in the include, the due
    // amount silently falls back to partialAmount / the full total.
    it('loads payments alongside items so the COD amount reflects advances', async () => {
      const { controller, prisma } = createController();

      await controller.bulkCreateSteadfastOrders({ orderIds: ['ord-1'] });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['ord-1'] } },
          include: expect.objectContaining({ payments: true }),
        }),
      );
    });
  });
});

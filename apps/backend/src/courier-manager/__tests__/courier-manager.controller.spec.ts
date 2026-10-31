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

  describe('credentials reveal (2026-10-31)', () => {
    const makeController = (row: any) => {
      const prisma = {
        order: { findMany: jest.fn().mockResolvedValue([]) },
        courierCredentials: {
          findUnique: jest.fn().mockResolvedValue(row),
          findMany: jest.fn().mockResolvedValue(row ? [row] : []),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      const controller = new CourierManagerController(
        {} as any,
        {} as any,
        prisma as any,
        {} as any,
        {} as any,
      );
      return { controller, prisma };
    };

    it('list stays masked while reveal returns stored values (columns win over legacy JSON)', async () => {
      const row = {
        id: 'cc-1',
        courier: 'pathao',
        enabled: true,
        mode: 'production',
        apiKey: 'pk-live',
        secretKey: '',
        username: null,
        password: null,
        clientId: null,
        clientSecret: 'cs-live',
        clientContext: null,
        storeId: null,
        shopId: null,
        webhookSecret: null,
        pathaoIntegrationSecret: null,
        credentials: { secretKey: 'legacy-secret' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { controller } = makeController(row);

      const [listed] = await controller.listCredentials();
      expect(JSON.stringify(listed)).not.toContain('pk-live');
      expect((listed as any).fieldsPresent).toEqual(
        expect.arrayContaining(['apiKey', 'secretKey', 'clientSecret']),
      );

      const revealed = await controller.revealCredentials('pathao');
      expect(revealed.values.apiKey).toBe('pk-live');
      expect(revealed.values.secretKey).toBe('legacy-secret');
      expect(revealed.values.clientSecret).toBe('cs-live');
    });

    it('reveal 404s for an unconfigured courier', async () => {
      const { controller } = makeController(null);
      await expect(controller.revealCredentials('pathao')).rejects.toThrow(
        /not configured/i,
      );
    });
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

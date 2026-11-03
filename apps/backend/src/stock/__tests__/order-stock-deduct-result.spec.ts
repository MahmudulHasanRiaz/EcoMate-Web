import { OrderStockDeductService } from '../order-stock-deduct.service';

/**
 * deductForOrder movement reporting (inventory audit fix round, WS1
 * item 8). The reconciliation heal used to label every Delivered order
 * 'deducted' unconditionally; deductForOrder now reports whether any leg
 * actually moved so the label can be honest. Existing callers ignore the
 * return value — the change is additive.
 */
describe('OrderStockDeductService — movement result', () => {
  let tx: any;
  let stockService: any;
  let stockRouter: any;
  let service: OrderStockDeductService;

  const item = (overrides: Record<string, any> = {}) => ({
    id: 'oi-1',
    orderId: 'order-1',
    productId: 'p1',
    variantId: null,
    comboId: null,
    quantity: 2,
    managedStockDeducted: false,
    product: {
      id: 'p1',
      availabilityMode: 'MANAGED_STOCK',
      manageStock: true,
      syncManagedStock: false,
      warehouseId: 'w1',
      name: 'Widget',
    },
    ...overrides,
  });

  beforeEach(() => {
    tx = {
      orderStockCycle: { findFirst: jest.fn().mockResolvedValue(null) },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([item()]),
        update: jest.fn().mockResolvedValue({}),
      },
      orderItemComboComponent: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      physicalReservation: { findUnique: jest.fn() },
      comboComponentPhysicalReservation: { findUnique: jest.fn() },
      physicalInventory: { findFirst: jest.fn() },
      costingLotConsumption: { findMany: jest.fn().mockResolvedValue([]) },
    };
    stockService = {
      deduct: jest.fn().mockResolvedValue([]),
      fulfillPhysicalReservation: jest.fn().mockResolvedValue(undefined),
    };
    stockRouter = {
      isInventoryManagementEnabled: jest.fn().mockResolvedValue(false),
      resolve: jest
        .fn()
        .mockReturnValue({ ms: 'deduct', pi: 'skip', msConditionalOnSync: false }),
    };
    service = new OrderStockDeductService({} as any, stockService, stockRouter);
  });

  const call = () =>
    service.deductForOrder({
      orderId: 'order-1',
      reference: 'Heal Deduct: order-1',
      performedBy: 'reconcile',
      tx,
      strict: false,
    });

  it('reports moved=true and counts the unit when the managed leg deducts', async () => {
    const result = await call();
    expect(stockService.deduct).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      moved: true,
      managedDeductedUnits: 1,
      physicalFulfilledUnits: 0,
    });
  });

  it('reports moved=false when every leg is already settled (idempotent re-run)', async () => {
    tx.orderItem.findMany.mockResolvedValue([item({ managedStockDeducted: true })]);
    const result = await call();
    expect(stockService.deduct).not.toHaveBeenCalled();
    expect(result).toEqual({
      moved: false,
      managedDeductedUnits: 0,
      physicalFulfilledUnits: 0,
    });
  });

  it('counts a physical fulfill on an ACTIVE reservation as movement', async () => {
    stockRouter.isInventoryManagementEnabled.mockResolvedValue(true);
    stockRouter.resolve.mockReturnValue({
      ms: 'skip',
      pi: 'fulfill',
      msConditionalOnSync: false,
    });
    tx.orderStockCycle.findFirst.mockResolvedValue({ id: 'cycle-1', status: 'ACTIVE' });
    tx.physicalReservation.findUnique.mockResolvedValue({ id: 'res-1', status: 'ACTIVE' });

    const result = await call();

    expect(stockService.fulfillPhysicalReservation).toHaveBeenCalledTimes(1);
    expect(result.moved).toBe(true);
    expect(result.physicalFulfilledUnits).toBe(1);
  });

  it('reports moved=false when the reservation is already CONSUMED', async () => {
    stockRouter.isInventoryManagementEnabled.mockResolvedValue(true);
    stockRouter.resolve.mockReturnValue({
      ms: 'skip',
      pi: 'fulfill',
      msConditionalOnSync: false,
    });
    tx.orderStockCycle.findFirst.mockResolvedValue({ id: 'cycle-1', status: 'ACTIVE' });
    tx.physicalReservation.findUnique.mockResolvedValue({ id: 'res-1', status: 'CONSUMED' });

    const result = await call();

    expect(stockService.fulfillPhysicalReservation).not.toHaveBeenCalled();
    expect(result.moved).toBe(false);
  });
});

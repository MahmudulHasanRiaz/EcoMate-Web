import { StockService } from '../stock.service';

/**
 * listReservations order reference + dates (inventory audit fix round,
 * WS1 item 10). Rows used to carry NO order reference at all, and the date
 * shown as "reserved since" was the ORDER's updatedAt (managed rows) or the
 * PhysicalInventory row's updatedAt (physical rows) — both move on any
 * unrelated edit. Rows now link the order's displayId and date the hold
 * from the reservation record's own createdAt.
 */
describe('StockService — listReservations', () => {
  const itemCreatedAt = new Date('2026-01-02T10:00:00Z');
  const orderUpdatedAt = new Date('2026-03-01T10:00:00Z');
  const reservationCreatedAt = new Date('2026-01-05T10:00:00Z');
  const piUpdatedAt = new Date('2026-04-01T10:00:00Z');

  const makeService = (prisma: any) =>
    new StockService(
      prisma,
      { invalidateByPrefix: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
    );

  it('managed rows carry the order displayId and the orderItem createdAt', async () => {
    const prisma: any = {
      physicalInventory: { findMany: jest.fn().mockResolvedValue([]) },
      physicalReservation: { findMany: jest.fn().mockResolvedValue([]) },
      comboComponentPhysicalReservation: { findMany: jest.fn().mockResolvedValue([]) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'oi-1',
            orderId: 'o-1',
            productId: 'p1',
            variantId: null,
            quantity: 2,
            createdAt: itemCreatedAt,
            product: { id: 'p1', name: 'Widget', sku: 'W-1', images: [] },
            variant: null,
            order: { id: 'o-1', displayId: 'ORD-260102-0001', updatedAt: orderUpdatedAt },
          },
        ]),
      },
      orderItemComboComponent: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const rows = await makeService(prisma).listReservations();

    expect(rows).toHaveLength(1);
    expect(rows[0].orderId).toBe('o-1');
    expect(rows[0].orderDisplayId).toBe('ORD-260102-0001');
    expect(rows[0].createdAt).toEqual(itemCreatedAt);
    expect(rows[0].reservedSince).toEqual(itemCreatedAt);
    // The dashboard's date field must be the reservation date, NOT the
    // order's updatedAt.
    expect(rows[0].updatedAt).toEqual(itemCreatedAt);
    expect(rows[0].updatedAt).not.toEqual(orderUpdatedAt);
  });

  it('physical rows resolve the order + reserved-since from ACTIVE reservation records', async () => {
    const prisma: any = {
      physicalInventory: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'pi-1',
            productId: 'p1',
            variantId: null,
            warehouseId: 'w1',
            quantity: 10,
            reservedQuantity: 3,
            createdAt: new Date('2025-12-01T00:00:00Z'),
            updatedAt: piUpdatedAt,
            product: { id: 'p1', name: 'Widget', sku: 'W-1', images: [] },
            warehouse: { id: 'w1', name: 'Main' },
          },
        ]),
      },
      physicalReservation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'res-1',
            orderId: 'o-1',
            productId: 'p1',
            variantId: null,
            warehouseId: 'w1',
            quantity: 3,
            status: 'ACTIVE',
            createdAt: reservationCreatedAt,
          },
        ]),
      },
      comboComponentPhysicalReservation: { findMany: jest.fn().mockResolvedValue([]) },
      order: {
        findMany: jest.fn().mockResolvedValue([{ id: 'o-1', displayId: 'ORD-260105-0007' }]),
      },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      orderItemComboComponent: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const rows = await makeService(prisma).listReservations();

    const phys = rows.find((r: any) => r.id === 'pi-1');
    expect(phys.orderId).toBe('o-1');
    expect(phys.orderDisplayId).toBe('ORD-260105-0007');
    expect(phys.reservedSince).toEqual(reservationCreatedAt);
    expect(phys.createdAt).toEqual(reservationCreatedAt);
    expect(phys.updatedAt).toEqual(reservationCreatedAt);
    expect(phys.updatedAt).not.toEqual(piUpdatedAt);
    expect(phys.reservations).toHaveLength(1);
    expect(phys.reservations[0]).toEqual(
      expect.objectContaining({ orderDisplayId: 'ORD-260105-0007', quantity: 3 }),
    );
    // Existing PI fields are preserved.
    expect(phys.quantity).toBe(10);
    expect(phys.reservedQuantity).toBe(3);
  });

  it('physical rows spanning multiple orders expose the list and no single order', async () => {
    const prisma: any = {
      physicalInventory: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'pi-1',
            productId: 'p1',
            variantId: null,
            warehouseId: 'w1',
            quantity: 10,
            reservedQuantity: 5,
            createdAt: new Date('2025-12-01T00:00:00Z'),
            updatedAt: piUpdatedAt,
            product: { id: 'p1', name: 'Widget', sku: 'W-1', images: [] },
            warehouse: { id: 'w1', name: 'Main' },
          },
        ]),
      },
      physicalReservation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'res-1', orderId: 'o-1', productId: 'p1', variantId: null, warehouseId: 'w1', quantity: 2, status: 'ACTIVE', createdAt: reservationCreatedAt },
          { id: 'res-2', orderId: 'o-2', productId: 'p1', variantId: null, warehouseId: 'w1', quantity: 3, status: 'ACTIVE', createdAt: new Date('2026-01-06T10:00:00Z') },
        ]),
      },
      comboComponentPhysicalReservation: { findMany: jest.fn().mockResolvedValue([]) },
      order: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'o-1', displayId: 'ORD-260105-0007' },
          { id: 'o-2', displayId: 'ORD-260106-0002' },
        ]),
      },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      orderItemComboComponent: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const rows = await makeService(prisma).listReservations();
    const phys = rows.find((r: any) => r.id === 'pi-1');
    expect(phys.orderDisplayId).toBeNull();
    expect(phys.reservations).toHaveLength(2);
    // Reserved since = the EARLIEST outstanding reservation.
    expect(phys.reservedSince).toEqual(reservationCreatedAt);
  });
});

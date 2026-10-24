import { CourierManagerService } from '../courier-manager.service';

/**
 * D19-B (owner rule): an order with ANY payment still awaiting verification
 * (status PENDING) must NEVER be sent to a courier. The gate lives in
 * dispatch() — the single booking entry point every courier shares — so no
 * courier path or UI can bypass it. Pure-COD orders (no payment rows) and
 * terminal rows (PAID / FAILED / CANCELLED) pass: nothing is pending.
 */
describe('CourierManagerService.dispatch — pending-payment gate (D19-B)', () => {
  let service: CourierManagerService;
  let prisma: any;

  function makeOrder(payments: any[]) {
    return {
      id: 'order-1',
      displayId: 'ORD-1',
      total: 500,
      customer: { name: 'Test', phone: '01712345678', email: null },
      items: [{ product: { name: 'Item' } }],
      payments,
    };
  }

  function setup(order: any) {
    prisma = {
      order: { findMany: jest.fn().mockResolvedValue([order]) },
      dispatch: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new CourierManagerService(prisma as any);
    // dispatchOne is the courier call itself; stub it so the tests prove
    // only whether the gate let the order through, never hitting a courier.
    (service as any).dispatchOne = jest.fn().mockResolvedValue({
      consignmentId: 'CONS-1',
    });
  }

  it('blocks dispatch when any payment is PENDING, without calling the courier', async () => {
    setup(
      makeOrder([
        { status: 'PAID', amount: 100 },
        { status: 'PENDING', amount: 400 },
      ]),
    );
    const results = await service.dispatch('steadfast', ['order-1']);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].message).toMatch(/awaiting verification/);
    expect((service as any).dispatchOne).not.toHaveBeenCalled();
  });

  it('allows dispatch when all payments are PAID', async () => {
    setup(makeOrder([{ status: 'PAID', amount: 500 }]));
    const results = await service.dispatch('steadfast', ['order-1']);
    expect(results[0].ok).toBe(true);
    expect(results[0].consignmentId).toBe('CONS-1');
  });

  it('allows dispatch for pure-COD orders with no payment rows', async () => {
    setup(makeOrder([]));
    const results = await service.dispatch('steadfast', ['order-1']);
    expect(results[0].ok).toBe(true);
  });

  it('allows partial-COD dispatch: a PAID advance row passes, and the COD balance due is not a row at all', async () => {
    // Owner note 2026-10-24: the due balance (collected by the courier
    // AFTER delivery) must never block dispatch. It is not a payment row —
    // only the verified ৳100 advance row exists — so the gate passes.
    setup(
      makeOrder([
        { status: 'PAID', amount: 100 },
        // No row for the remaining ৳400 COD balance: it has no status,
        // so there is nothing "pending verification" to block on.
      ]),
    );
    const results = await service.dispatch('steadfast', ['order-1']);
    expect(results[0].ok).toBe(true);
    expect((service as any).dispatchOne).toHaveBeenCalled();
  });

  it('does not treat terminal FAILED rows as pending', async () => {
    setup(makeOrder([{ status: 'FAILED', amount: 500 }]));
    const results = await service.dispatch('steadfast', ['order-1']);
    expect(results[0].ok).toBe(true);
  });
});

import { CodMismatchController } from '../cod-mismatch.controller';
import { CodMismatchService } from '../cod-mismatch.service';

describe('CodMismatchController', () => {
  let controller: CodMismatchController;
  let svc: { listForOrder: jest.Mock; resolve: jest.Mock };

  beforeEach(() => {
    svc = { listForOrder: jest.fn(), resolve: jest.fn() };
    controller = new CodMismatchController(svc as unknown as CodMismatchService);
  });

  it('GET /orders/:id/cod-alerts lists alerts for the order', async () => {
    svc.listForOrder.mockResolvedValue([{ id: 'a1' }]);

    await expect(controller.list('order-1')).resolves.toEqual([{ id: 'a1' }]);
    expect(svc.listForOrder).toHaveBeenCalledWith('order-1');
  });

  it('POST resolve passes the order id and staff user id to the service', async () => {
    svc.resolve.mockResolvedValue({ id: 'a1', status: 'resolved' });

    await controller.resolve('order-1', 'a1', { userId: 'staff-7' } as any);

    expect(svc.resolve).toHaveBeenCalledWith('a1', 'staff-7', 'order-1');
  });
});

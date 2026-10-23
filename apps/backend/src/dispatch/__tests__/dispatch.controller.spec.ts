import { DispatchController } from '../dispatch.controller';

/**
 * GET /dispatch/metrics returns a single pre-aggregated object:
 * `{ total, byCourier: [{ courier, count }], byStatus: [{ status, count }] }`.
 *
 * The admin dashboard typed it as an array of raw `groupBy` rows and called
 * `data.reduce`, so every metrics card silently rendered nothing. These tests
 * pin the object shape (and the list envelope next to it) at the controller
 * boundary.
 */
function makeController() {
  const dispatchService = {
    getMetrics: jest.fn().mockResolvedValue({
      total: 7,
      byCourier: [
        { courier: 'pathao', count: 4 },
        { courier: 'steadfast', count: 3 },
      ],
      byStatus: [
        { status: 'PENDING', count: 5 },
        { status: 'IN_TRANSIT', count: 2 },
      ],
    }),
    findAll: jest.fn().mockResolvedValue({
      data: [{ id: 'd-1' }],
      total: 1,
      facets: { status: { PENDING: 1 }, courier: { pathao: 1 } },
    }),
  };
  const dispatchCancel = { cancel: jest.fn() };
  const controller = new DispatchController(
    dispatchService as any,
    dispatchCancel as any,
  );
  return { controller, dispatchService };
}

describe('DispatchController response contracts', () => {
  it('GET /dispatch/metrics returns one object, not an array of groupBy rows', async () => {
    const { controller } = makeController();

    const result = await controller.getMetrics();

    expect(Array.isArray(result)).toBe(false);
    expect(result).toEqual({
      total: 7,
      byCourier: [
        { courier: 'pathao', count: 4 },
        { courier: 'steadfast', count: 3 },
      ],
      byStatus: [
        { status: 'PENDING', count: 5 },
        { status: 'IN_TRANSIT', count: 2 },
      ],
    });
  });

  it('GET /dispatch keeps the { data, total, facets } list shape', async () => {
    const { controller, dispatchService } = makeController();

    const result = await controller.findAll({ page: 1 } as any);

    expect(dispatchService.findAll).toHaveBeenCalledWith({ page: 1 });
    expect(result).toEqual({
      data: [{ id: 'd-1' }],
      total: 1,
      facets: { status: { PENDING: 1 }, courier: { pathao: 1 } },
    });
  });
});

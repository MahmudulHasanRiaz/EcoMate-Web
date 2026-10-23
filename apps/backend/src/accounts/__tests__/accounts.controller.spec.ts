import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { BadRequestException } from '@nestjs/common';
import { AccountsController } from '../accounts.controller';

/**
 * The admin accounting pages read GET /accounts the same way they read
 * GET /accounting/entries: `response.data.data` + `response.data.meta`.
 * These tests pin the HTTP contract (envelope), not the service's internal
 * array, so the parent-account picker / journal-entry selects cannot silently
 * go empty again.
 */
function makeController(accounts: any[]) {
  const service = {
    findAll: jest.fn().mockResolvedValue(accounts),
  };
  const controller = new AccountsController(service as any);
  return { controller, service };
}

const ACCOUNTS = Array.from({ length: 25 }, (_, i) => ({
  id: `acc-${i + 1}`,
  code: String(1000 + i),
  name: `Account ${i + 1}`,
  type: 'asset',
  parentId: null,
  isActive: true,
  isGroup: false,
}));

describe('AccountsController', () => {
  it('has RequiresFeature(admin_accounting) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      AccountsController,
    );
    expect(featureKey).toBe('admin_accounting');
  });

  it('returns the paginated { data, meta } envelope, never a bare array', async () => {
    const { controller } = makeController(ACCOUNTS);

    const result = await controller.findAll();

    expect(Array.isArray(result)).toBe(false);
    expect(result).toEqual({
      data: ACCOUNTS.slice(0, 10),
      meta: { total: 25, page: 1, perPage: 10, totalPages: 3 },
    });
  });

  it('honours page/perPage and the type filter passthrough', async () => {
    const { controller, service } = makeController(ACCOUNTS);

    const result = await controller.findAll('asset', '2', '10');

    expect(service.findAll).toHaveBeenCalledWith('asset');
    expect(result.data).toHaveLength(10);
    expect(result.data[0].id).toBe('acc-11');
    expect(result.meta).toEqual({
      total: 25,
      page: 2,
      perPage: 10,
      totalPages: 3,
    });
  });

  it('returns the last partial page without inventing rows', async () => {
    const { controller } = makeController(ACCOUNTS);

    const result = await controller.findAll(undefined, '3', '10');

    expect(result.data).toHaveLength(5);
    expect(result.data[0].id).toBe('acc-21');
    expect(result.meta.totalPages).toBe(3);
  });

  it('rejects non-positive or non-numeric pagination with a 400', async () => {
    const { controller } = makeController(ACCOUNTS);

    await expect(controller.findAll(undefined, '0', '10')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      controller.findAll(undefined, 'abc', '10'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.findAll(undefined, '1', '0')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

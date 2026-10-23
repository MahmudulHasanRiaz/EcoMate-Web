import { BadRequestException } from '@nestjs/common';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { AccountingController } from '../accounting.controller';

describe('AccountingController', () => {
  it('has RequiresFeature(admin_accounting) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      AccountingController,
    );
    expect(featureKey).toBe('admin_accounting');
  });

  describe('GET /accounting/entries response contract', () => {
    function makeController(serviceResult: Record<string, unknown>) {
      const accountingService = {
        findAllEntries: jest.fn().mockResolvedValue(serviceResult),
      };
      const controller = new AccountingController(
        accountingService as any,
        {} as any,
      );
      return { controller, accountingService };
    }

    const flatResult = {
      data: [{ id: 'je-1' }, { id: 'je-2' }],
      total: 25,
      page: 2,
      perPage: 10,
      totalPages: 3,
    };

    it('wraps the service result in the { data, meta } envelope the admin list expects', async () => {
      const { controller } = makeController(flatResult);

      await expect(controller.findAllEntries('2', '10')).resolves.toEqual({
        data: flatResult.data,
        meta: { total: 25, page: 2, perPage: 10, totalPages: 3 },
      });
    });

    it('passes page, perPage and periodId through to the service untouched', async () => {
      const { controller, accountingService } = makeController(flatResult);

      await controller.findAllEntries('3', '5', 'fp-open');

      expect(accountingService.findAllEntries).toHaveBeenCalledWith(
        3,
        5,
        'fp-open',
      );
    });

    it('defaults to page 1 / perPage 10 when the query is empty', async () => {
      const { controller, accountingService } = makeController({
        data: [],
        total: 0,
        page: 1,
        perPage: 10,
        totalPages: 0,
      });

      await controller.findAllEntries();

      expect(accountingService.findAllEntries).toHaveBeenCalledWith(
        1,
        10,
        undefined,
      );
    });

    it('rejects invalid pagination before touching the service', async () => {
      const { controller, accountingService } = makeController(flatResult);

      await expect(controller.findAllEntries('0', '10')).rejects.toThrow(
        BadRequestException,
      );
      expect(accountingService.findAllEntries).not.toHaveBeenCalled();
    });
  });
});

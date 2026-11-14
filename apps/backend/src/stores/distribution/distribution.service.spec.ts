/**
 * DistributionService spec — central-commerce §8.2 + §8.2.1 + §10 (P3).
 *
 * Row-level storeId validation on every mutation; NATIVE rejected 400 on
 * writes and excluded from bulk; bulk >50 enqueues; assignment/rule
 * mutations never write Product rows (storefront read path untouched).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DistributionService } from './distribution.service';
import { StoreAvailabilityService } from './store-availability.service';

describe('DistributionService', () => {
  let svc: DistributionService;
  let prisma: any;

  const wooStore = { id: 'store-woo', kind: 'WOOCOMMERCE', name: 'Woo' };
  const shopifyStore = { id: 'store-shop', kind: 'SHOPIFY', name: 'Shop' };
  const nativeStore = { id: 'store-native', kind: 'NATIVE', name: 'Native Website' };
  const product = {
    id: 'prod-1',
    status: 'active',
    isActive: true,
    categoryId: 'cat-child',
    productCategories: [],
  };

  beforeEach(() => {
    prisma = {
      store: { findUnique: jest.fn(), findMany: jest.fn() },
      product: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      productStoreAssignment: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      storeAvailabilityRule: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      category: { findUnique: jest.fn(), findMany: jest.fn() },
    };
    prisma.product.findUnique.mockResolvedValue(product);
    prisma.category.findMany.mockResolvedValue([
      { id: 'cat-child', parentId: 'cat-parent', name: 'Child', slug: 'child' },
      { id: 'cat-parent', parentId: null, name: 'Parent', slug: 'parent' },
    ]);
    svc = new DistributionService(prisma, new StoreAvailabilityService());
  });

  describe('getAvailability', () => {
    it('resolves effective = global AND (override ?? rule ?? default)', async () => {
      prisma.store.findMany.mockResolvedValue([wooStore]);
      prisma.productStoreAssignment.findMany.mockResolvedValue([]);
      prisma.storeAvailabilityRule.findMany.mockResolvedValue([
        { storeId: 'store-woo', categoryId: 'cat-parent', available: true, inheritFromParent: true },
      ]);
      const view = await svc.getAvailability('prod-1');
      expect(view.globalActive).toBe(true);
      expect(view.stores).toHaveLength(1);
      expect(view.stores[0]).toMatchObject({ storeId: 'store-woo', effective: true, ruleAvailable: true });
    });

    it('override beats rule', async () => {
      prisma.store.findMany.mockResolvedValue([wooStore]);
      prisma.productStoreAssignment.findMany.mockResolvedValue([
        { storeId: 'store-woo', available: false, source: 'MANUAL' },
      ]);
      prisma.storeAvailabilityRule.findMany.mockResolvedValue([
        { storeId: 'store-woo', categoryId: 'cat-parent', available: true, inheritFromParent: true },
      ]);
      const view = await svc.getAvailability('prod-1');
      expect(view.stores[0].effective).toBe(false);
      expect(view.stores[0].overrideAvailable).toBe(false);
    });

    it('404s for an unknown product', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(svc.getAvailability('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('rule inheritance', () => {
    function mockStoresWithRules(rules: any[]) {
      prisma.store.findMany.mockResolvedValue([wooStore]);
      prisma.productStoreAssignment.findMany.mockResolvedValue([]);
      prisma.storeAvailabilityRule.findMany.mockResolvedValue(rules);
    }

    it('a parent rule propagates to a child category by default', async () => {
      mockStoresWithRules([
        { storeId: 'store-woo', categoryId: 'cat-parent', available: false, inheritFromParent: true },
      ]);
      const view = await svc.getAvailability('prod-1');
      expect(view.stores[0]).toMatchObject({ effective: false, ruleAvailable: false });
    });

    it('a child rule with inheritFromParent=false wins over the parent', async () => {
      mockStoresWithRules([
        { storeId: 'store-woo', categoryId: 'cat-parent', available: false, inheritFromParent: true },
        { storeId: 'store-woo', categoryId: 'cat-child', available: true, inheritFromParent: false },
      ]);
      const view = await svc.getAvailability('prod-1');
      expect(view.stores[0]).toMatchObject({ effective: true, ruleAvailable: true });
    });

    it('a child rule with inheritFromParent=true defers to the parent', async () => {
      mockStoresWithRules([
        { storeId: 'store-woo', categoryId: 'cat-parent', available: false, inheritFromParent: true },
        { storeId: 'store-woo', categoryId: 'cat-child', available: true, inheritFromParent: true },
      ]);
      const view = await svc.getAvailability('prod-1');
      expect(view.stores[0]).toMatchObject({ effective: false, ruleAvailable: false });
    });

    it('a non-propagating parent rule (inheritFromParent=false) does not reach the child', async () => {
      mockStoresWithRules([
        { storeId: 'store-woo', categoryId: 'cat-parent', available: true, inheritFromParent: false },
      ]);
      const view = await svc.getAvailability('prod-1');
      // No applicable rule → external default OFF.
      expect(view.stores[0]).toMatchObject({ effective: false, ruleAvailable: null });
    });
  });

  describe('setOverride', () => {
    it('upserts a MANUAL override', async () => {
      prisma.store.findUnique.mockResolvedValue(wooStore);
      prisma.productStoreAssignment.upsert.mockResolvedValue({ available: true });
      await svc.setOverride('prod-1', 'store-woo', true);
      expect(prisma.productStoreAssignment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storeId_productId: { storeId: 'store-woo', productId: 'prod-1' } },
          create: expect.objectContaining({ source: 'MANUAL', available: true }),
        }),
      );
    });

    it('null clears the override without writing one', async () => {
      prisma.store.findUnique.mockResolvedValue(wooStore);
      await svc.setOverride('prod-1', 'store-woo', null);
      expect(prisma.productStoreAssignment.deleteMany).toHaveBeenCalled();
      expect(prisma.productStoreAssignment.upsert).not.toHaveBeenCalled();
    });

    it('rejects NATIVE with 400', async () => {
      prisma.store.findUnique.mockResolvedValue(nativeStore);
      await expect(svc.setOverride('prod-1', 'store-native', true)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.productStoreAssignment.upsert).not.toHaveBeenCalled();
    });

    it('404s for an unknown store', async () => {
      prisma.store.findUnique.mockResolvedValue(null);
      await expect(svc.setOverride('prod-1', 'ghost', true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('bulkSet', () => {
    beforeEach(() => {
      prisma.store.findMany.mockResolvedValue([wooStore, shopifyStore, nativeStore]);
      prisma.productStoreAssignment.upsert.mockResolvedValue({});
    });

    it('excludes NATIVE and reports excludedNativeCount', async () => {
      const res = await svc.bulkSet('prod-1', 'all_on');
      expect(res).toMatchObject({ enqueued: false, updated: 2, total: 2, excludedNativeCount: 1 });
      expect(prisma.productStoreAssignment.upsert).toHaveBeenCalledTimes(2);
    });

    it('Disable-all requires typed confirmation', async () => {
      await expect(svc.bulkSet('prod-1', 'all_off')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.bulkSet('prod-1', 'all_off', 'WRONG')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.productStoreAssignment.upsert).not.toHaveBeenCalled();
      const res = await svc.bulkSet('prod-1', 'all_off', 'DISABLE');
      expect(res.updated).toBe(2);
    });

    it('enqueues a background job when targets exceed 50', async () => {
      const many = Array.from({ length: 55 }, (_, i) => ({
        id: `store-${i}`,
        kind: 'WOOCOMMERCE',
        name: `S${i}`,
      }));
      prisma.store.findMany.mockResolvedValue([...many, nativeStore]);
      const res = await svc.bulkSet('prod-1', 'all_on');
      expect(res.enqueued).toBe(true);
      expect(res.jobId).toBeDefined();
      expect(res).toMatchObject({ total: 55, excludedNativeCount: 1 });
      // Background processing completes the writes without blocking the response.
      await svc.waitForBulkJob(res.jobId as string);
      expect(prisma.productStoreAssignment.upsert).toHaveBeenCalledTimes(55);
    });
  });

  describe('rules', () => {
    it('upserts a rule with the inherit flag', async () => {
      prisma.store.findUnique.mockResolvedValue(wooStore);
      prisma.category.findUnique.mockResolvedValue({ id: 'cat-parent' });
      prisma.storeAvailabilityRule.upsert.mockResolvedValue({});
      await svc.upsertRule('store-woo', 'cat-parent', { available: false, inheritFromParent: true });
      expect(prisma.storeAvailabilityRule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storeId_categoryId: { storeId: 'store-woo', categoryId: 'cat-parent' } },
        }),
      );
    });

    it('rejects NATIVE rules with 400 and writes nothing', async () => {
      prisma.store.findUnique.mockResolvedValue(nativeStore);
      await expect(
        svc.upsertRule('store-native', 'cat-parent', { available: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.storeAvailabilityRule.upsert).not.toHaveBeenCalled();
    });

    it('404s for an unknown category', async () => {
      prisma.store.findUnique.mockResolvedValue(wooStore);
      prisma.category.findUnique.mockResolvedValue(null);
      await expect(svc.upsertRule('store-woo', 'ghost', { available: true })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('storefront isolation', () => {
    it('no distribution mutation writes Product rows', async () => {
      prisma.store.findUnique.mockResolvedValue(wooStore);
      prisma.store.findMany.mockResolvedValue([wooStore]);
      prisma.category.findUnique.mockResolvedValue({ id: 'cat-parent' });
      await svc.setOverride('prod-1', 'store-woo', true);
      await svc.setOverride('prod-1', 'store-woo', null);
      await svc.bulkSet('prod-1', 'all_on');
      await svc.upsertRule('store-woo', 'cat-parent', { available: true });
      expect(prisma.product.update).not.toHaveBeenCalled();
      expect(prisma.product.create).not.toHaveBeenCalled();
      expect(prisma.product.delete).not.toHaveBeenCalled();
    });
  });
});

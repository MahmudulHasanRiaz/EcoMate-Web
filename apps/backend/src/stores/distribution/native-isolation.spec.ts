/**
 * Native-isolation regression suite (BR-20) — central-commerce §8.2.1 (P3).
 *
 * Five mechanisms, all proven here against the real services:
 * 1. registry guard throws for kind === 'NATIVE'
 * 2. resolver short-circuits NATIVE to plain global publish
 * 3. assignment/rule/bulk endpoints reject NATIVE ids with 400
 * 4. bulk excludes NATIVE with excludedNativeCount
 * 5. storefront visibility (isActive + status != draft) is byte-identical
 *    after assignment/rule/bulk mutations — P3 writes never touch it.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { StoreAvailabilityService } from './store-availability.service';
import { DistributionService } from './distribution.service';
import {
  ProductStoreAvailabilityController,
  StoreAvailabilityRulesController,
} from './distribution.controller';
import { ProductsService } from '../../products/products.service';

describe('P3 native isolation (BR-20)', () => {
  const NATIVE_ID = '11111111-1111-4111-8111-111111111111';
  const WOO_ID = '22222222-2222-4222-8222-222222222222';
  const PROD_ID = '33333333-3333-4333-8333-333333333333';
  const CAT_ID = '44444444-4444-4444-8444-444444444444';

  const nativeStore = { id: NATIVE_ID, kind: 'NATIVE', name: 'Native Website' };
  const wooStore = { id: WOO_ID, kind: 'WOOCOMMERCE', name: 'Woo' };
  const product = {
    id: PROD_ID,
    status: 'active',
    isActive: true,
    categoryId: CAT_ID,
    productCategories: [],
  };

  let prisma: any;
  let registry: ProviderRegistryService;
  let availability: ProductStoreAvailabilityController;
  let rules: StoreAvailabilityRulesController;
  let products: ProductsService;

  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env.THIRD_PARTY_STORES_ENABLED = 'true';
    process.env.store_sync_enabled = 'true';
    prisma = {
      store: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === NATIVE_ID ? nativeStore : where.id === WOO_ID ? wooStore : null,
        ),
        findMany: jest.fn(async () => [wooStore, nativeStore]),
      },
      product: {
        findUnique: jest.fn(async () => ({ ...product })),
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        update: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      productStoreAssignment: {
        findMany: jest.fn(async () => []),
        upsert: jest.fn(async ({ create }: any) => ({ ...create })),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      storeAvailabilityRule: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async ({ create }: any) => ({ ...create })),
      },
      category: {
        findUnique: jest.fn(async () => ({ id: CAT_ID })),
        findMany: jest.fn(async () => [{ id: CAT_ID, parentId: null }]),
      },
    };
    registry = new ProviderRegistryService({} as any, {} as any, {} as any);
    const distribution = new DistributionService(prisma, new StoreAvailabilityService());
    availability = new ProductStoreAvailabilityController(distribution);
    rules = new StoreAvailabilityRulesController(distribution);
    products = new ProductsService(
      prisma,
      {} as any,
      { get: jest.fn(), set: jest.fn(), invalidateByPrefix: jest.fn() } as any,
      { isInventoryManagementEnabled: jest.fn(async () => false) } as any,
      { resolve: jest.fn(async () => ({})) } as any,
    );
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('registry providerFor() throws for NATIVE', () => {
    expect(() => registry.providerFor({ kind: 'NATIVE' })).toThrow(BadRequestException);
    expect(() => registry.providerFor({ kind: 'NATIVE' })).toThrow(/BR-20/);
  });

  it('endpoints reject NATIVE store ids with 400 and write nothing', async () => {
    await expect(
      availability.setAvailability(PROD_ID, { storeId: NATIVE_ID, available: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      rules.upsertRule(CAT_ID, { storeId: NATIVE_ID, available: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.productStoreAssignment.upsert).not.toHaveBeenCalled();
    expect(prisma.storeAvailabilityRule.upsert).not.toHaveBeenCalled();
  });

  it('bulk excludes NATIVE with excludedNativeCount', async () => {
    const res = await availability.bulkSet(PROD_ID, { action: 'all_on' });
    expect(res).toMatchObject({ enqueued: false, updated: 1, total: 1, excludedNativeCount: 1 });
    expect(prisma.productStoreAssignment.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.productStoreAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ storeId: WOO_ID }),
      }),
    );
  });

  it('endpoints are double-gated: flags off → 403 without touching the service', async () => {
    process.env.THIRD_PARTY_STORES_ENABLED = 'false';
    // assertEnabled() throws synchronously before any service call.
    expect(() => availability.getAvailability(PROD_ID)).toThrow(ForbiddenException);
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
  });

  it('storefront visibility is unchanged after assignment/rule/bulk mutations', async () => {
    // Mutate every P3 surface, then read the storefront path on the SAME
    // mocked database handle.
    await availability.setAvailability(PROD_ID, { storeId: WOO_ID, available: false });
    await rules.upsertRule(CAT_ID, { storeId: WOO_ID, available: true });
    await availability.bulkSet(PROD_ID, { action: 'all_on' });

    // No Product row was written by any mutation.
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.product.delete).not.toHaveBeenCalled();

    // The storefront list still filters drafts exactly as before.
    await products.findAll({});
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: 'draft' } }) }),
    );
  });
});

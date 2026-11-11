import { ImportService } from '../import.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaService } from '../../media/media.service';
import { CacheService } from '../../cache/cache.service';
import { StockService } from '../../stock/stock.service';
import { ImportSummary } from '../types/woocommerce-csv.types';
import { BadRequestException } from '@nestjs/common';

function makeSummary(): ImportSummary {
  return {
    productsCreated: 0,
    productsUpdated: 0,
    productsSkipped: 0,
    categoriesCreated: 0,
    categoriesReused: 0,
    tagsCreated: 0,
    tagsReused: 0,
    attributesImported: 0,
    variantsImported: 0,
    imagesDownloaded: 0,
    imagesImported: 0,
    imagesReused: 0,
    imagesFailed: 0,
    errors: 0,
  };
}

function makeService() {
  const prisma = {
    product: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockResolvedValue({ id: 'prod-created', slug: 'created', sku: 'SKU' }),
      update: jest.fn().mockResolvedValue({}),
    },
    productVariant: {
      create: jest.fn().mockResolvedValue({ id: 'variant-created' }),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    physicalInventory: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    systemSetting: {
      findUnique: jest.fn().mockResolvedValue({ value: 'true' }),
    },
    warehouse: {
      findFirst: jest.fn().mockResolvedValue({ id: 'wh-1' }),
    },
  };
  const media = {};
  const cache = {};
  // StockService is the IC re-import level-set engine: operatePhysical is
  // how a legitimate physical entry would be written. A MANAGED_STOCK
  // import must never reach it.
  const stock = {
    operatePhysical: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ImportService(
    prisma as unknown as PrismaService,
    media as unknown as MediaService,
    cache as unknown as CacheService,
    stock as unknown as StockService,
  );
  return { service, prisma, stock, svc: service as any };
}

const row = (rowNumber: number, data: Record<string, unknown>) => ({
  rowNumber,
  data: data as any,
});

const GROUP_CALL_META = () => ({
  summary: makeSummary(),
  errors: [] as any[],
  categoryCacheByPath: new Map<string, string>(),
  tagCache: new Map<string, string>(),
  brandCache: new Map<string, string>(),
  attributeCache: new Map<string, any>(),
  mediaCache: new Map<string, string>(),
  productCache: new Map<string, string>(),
  variantCache: new Map<string, string>(),
  slugSet: new Set<string>(),
  sortOrderObj: { value: 0 },
});

async function runGroup(
  svc: any,
  rows: ReturnType<typeof row>[],
  meta = GROUP_CALL_META(),
  icWarehouseId: string | null = null,
  mode: 'create' | 'update' = 'create',
) {
  await svc.processProductGroupCached(
    'VAR-1',
    rows,
    mode,
    meta.summary,
    meta.errors,
    meta.categoryCacheByPath,
    meta.tagCache,
    meta.brandCache,
    meta.attributeCache,
    meta.mediaCache,
    meta.productCache,
    meta.variantCache,
    meta.slugSet,
    meta.sortOrderObj,
    icWarehouseId,
  );
  return meta;
}

describe('ImportService.lowestVariationPrice', () => {
  it('returns the minimum effective price (salePrice ?? regular) across rows', () => {
    const { svc } = makeService();
    const lowest = svc.lowestVariationPrice([
      row(2, { 'Regular price': '600', 'Sale price': '450' }),
      row(3, { 'Regular price': '300' }),
      row(4, { 'Regular price': '900', 'Sale price': '800' }),
    ]);
    expect(lowest).toBe(300);
  });

  it('accepts the legacy "Price" header as the regular price', () => {
    const { svc } = makeService();
    const lowest = svc.lowestVariationPrice([
      row(2, { Price: '420' }),
      row(3, { 'Regular price': '500' }),
    ]);
    expect(lowest).toBe(420);
  });

  it('returns undefined when no row has a parseable price', () => {
    const { svc } = makeService();
    expect(
      svc.lowestVariationPrice([
        row(2, { 'Regular price': '', 'Sale price': '' }),
        row(3, {}),
      ]),
    ).toBeUndefined();
  });
});

describe('ImportService parent price fallback for variable products', () => {
  it('fills the parent basePrice with the lowest variant price when the CSV parent price is empty and the stored price is 0', async () => {
    const { svc, prisma } = makeService();
    jest.spyOn(svc, 'createProductCached').mockResolvedValue('prod-1');
    jest.spyOn(svc, 'processVariationCached').mockResolvedValue(undefined);
    prisma.product.findUnique.mockResolvedValue({ basePrice: 0 });

    await runGroup(svc, [
      row(1, { SKU: 'VAR-1', Type: 'variable', Name: 'Var Parent', 'Regular price': '', 'Price': '' }),
      row(2, { SKU: 'VAR-1-RED', Type: 'variation', 'Regular price': '600', 'Sale price': '450' }),
      row(3, { SKU: 'VAR-1-BLUE', Type: 'variation', 'Regular price': '300' }),
    ]);

    expect(svc.createProductCached).toHaveBeenCalled();
    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      select: { basePrice: true },
    });
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { basePrice: 300 },
    });
  });

  it('never overwrites a non-zero stored parent price', async () => {
    const { svc, prisma } = makeService();
    jest.spyOn(svc, 'createProductCached').mockResolvedValue('prod-1');
    jest.spyOn(svc, 'processVariationCached').mockResolvedValue(undefined);
    prisma.product.findUnique.mockResolvedValue({ basePrice: 4999 });

    await runGroup(svc, [
      row(1, { SKU: 'VAR-1', Type: 'variable', 'Regular price': '' }),
      row(2, { SKU: 'VAR-1-RED', Type: 'variation', 'Regular price': '300' }),
    ]);

    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('skips the fallback when the CSV parent row carries an explicit price', async () => {
    const { svc, prisma } = makeService();
    jest.spyOn(svc, 'createProductCached').mockResolvedValue('prod-1');
    jest.spyOn(svc, 'processVariationCached').mockResolvedValue(undefined);

    await runGroup(svc, [
      row(1, { SKU: 'VAR-1', Type: 'variable', 'Regular price': '999' }),
      row(2, { SKU: 'VAR-1-RED', Type: 'variation', 'Regular price': '300' }),
    ]);

    expect(prisma.product.findUnique).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('skips the fallback for non-variable parents', async () => {
    const { svc, prisma } = makeService();
    jest.spyOn(svc, 'createProductCached').mockResolvedValue('prod-1');
    jest.spyOn(svc, 'processVariationCached').mockResolvedValue(undefined);

    await runGroup(svc, [
      row(1, { SKU: 'SIM-1', Type: 'simple', 'Regular price': '' }),
      row(2, { SKU: 'SIM-1-RED', Type: 'variation', 'Regular price': '300' }),
    ]);

    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('does not update when no variation row has a parseable price', async () => {
    const { svc, prisma } = makeService();
    jest.spyOn(svc, 'createProductCached').mockResolvedValue('prod-1');
    jest.spyOn(svc, 'processVariationCached').mockResolvedValue(undefined);

    await runGroup(svc, [
      row(1, { SKU: 'VAR-1', Type: 'variable', 'Regular price': '' }),
      row(2, { SKU: 'VAR-1-RED', Type: 'variation', 'Regular price': '', 'Sale price': '' }),
    ]);

    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('fills the price when the product cannot be re-read (fresh create)', async () => {
    const { svc, prisma } = makeService();
    jest.spyOn(svc, 'createProductCached').mockResolvedValue('prod-1');
    jest.spyOn(svc, 'processVariationCached').mockResolvedValue(undefined);
    prisma.product.findUnique.mockResolvedValue(null);

    await runGroup(svc, [
      row(1, { SKU: 'VAR-1', Type: 'variable', 'Regular price': '' }),
      row(2, { SKU: 'VAR-1-RED', Type: 'variation', 'Regular price': '350' }),
    ]);

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { basePrice: 350 },
    });
  });
});

describe('ImportService.updateProductCached parent price handling', () => {
  async function runUpdate(svc: any, prisma: any, data: Record<string, unknown>) {
    jest.spyOn(svc, 'resolveCategoriesCached').mockResolvedValue([]);
    const unchangedSpy = jest
      .spyOn(svc, 'isProductUnchanged')
      .mockResolvedValue(false);
    prisma.product.update.mockResolvedValue({});
    await svc.updateProductCached(
      'prod-1',
      row(1, data),
      makeSummary(),
      [],
      new Map<string, string>(),
      new Map<string, string>(),
      new Map<string, string>(),
      new Map<string, string>(),
      new Map<string, string>(),
      new Set<string>(),
      { value: 0 },
    );
    return { unchangedSpy };
  }

  it('omits basePrice from the update for a variable product with an empty CSV price', async () => {
    const { svc, prisma } = makeService();
    const { unchangedSpy } = await runUpdate(svc, prisma, {
      SKU: 'VAR-1',
      Type: 'variable',
      Name: 'Var Parent',
      'Regular price': '',
      'Price': '',
    });

    expect(prisma.product.update).toHaveBeenCalledTimes(1);
    const updateData = prisma.product.update.mock.calls[0][0].data;
    expect('basePrice' in updateData).toBe(false);
    expect(updateData.type).toBe('variable');
    const intended = unchangedSpy.mock.calls[0][1];
    expect('basePrice' in intended).toBe(false);
  });

  it('writes an explicit price for a variable product', async () => {
    const { svc, prisma } = makeService();
    await runUpdate(svc, prisma, {
      SKU: 'VAR-1',
      Type: 'variable',
      Name: 'Var Parent',
      'Regular price': '750',
    });

    const updateData = prisma.product.update.mock.calls[0][0].data;
    expect(updateData.basePrice).toBe(750);
  });

  it('keeps the empty-price -> 0 behavior for simple products', async () => {
    const { svc, prisma } = makeService();
    await runUpdate(svc, prisma, {
      SKU: 'SIM-1',
      Type: 'simple',
      Name: 'Simple',
      'Regular price': '',
    });

    const updateData = prisma.product.update.mock.calls[0][0].data;
    expect(updateData.basePrice).toBe(0);
  });

  it('repairs manageStock=true for a MANAGED_STOCK variable on re-import (CSV-import state)', async () => {
    const { svc, prisma } = makeService();
    (prisma.product.findUnique as jest.Mock).mockResolvedValue({
      availabilityMode: 'MANAGED_STOCK',
    });
    await runUpdate(svc, prisma, {
      SKU: 'VAR-1',
      Type: 'variable',
      Name: 'Var Parent',
    });

    const updateData = prisma.product.update.mock.calls[0][0].data;
    expect(updateData.manageStock).toBe(true);
  });

  it('does not flip manageStock for an INVENTORY_CONTROLLED product on re-import', async () => {
    const { svc, prisma } = makeService();
    (prisma.product.findUnique as jest.Mock).mockResolvedValue({
      availabilityMode: 'INVENTORY_CONTROLLED',
    });
    await runUpdate(svc, prisma, {
      SKU: 'VAR-1',
      Type: 'variable',
      Name: 'Var Parent',
    });

    const updateData = prisma.product.update.mock.calls[0][0].data;
    // WS4 mode rule: for IC products the import writes NEITHER the managed
    // counter NOR the manageStock flag — the field is left untouched
    // (previously it wrote `false`, which also didn't flip it, but any
    // write at all risks diverging the layers).
    expect(updateData.manageStock).toBeUndefined();
    expect(updateData.managedStockQuantity).toBeUndefined();
  });
});

/**
 * Fifth-mirror removal (owner decision, directive §0.1 + §2 sweep rule):
 * an imported MANAGED_STOCK product's CSV stock stays in the managed
 * counter ONLY — no PhysicalInventory row is fabricated for it, exactly
 * like product create behaves since the other mirrors were removed.
 * The physical layer is written ONLY through StockService.operatePhysical
 * (setPhysicalStockLevel), so asserting it is never called — and that the
 * physical level is never even read — proves no physical row is created.
 * These groups are deliberately handed a resolved IC warehouse ('wh-1'):
 * even with a warehouse available, a managed import must not use it.
 */
describe('ImportService MANAGED_STOCK import — no physical mirroring', () => {
  it('simple product: managed qty lands as managed qty, NO physical row created', async () => {
    const { svc, prisma, stock } = makeService();
    prisma.product.create.mockResolvedValue({
      id: 'prod-1',
      slug: 'simple',
      sku: 'SIM-1',
    });

    await runGroup(
      svc,
      [
        row(1, {
          SKU: 'SIM-1',
          Type: 'simple',
          Name: 'Simple',
          Stock: '5',
          'Regular price': '100',
        }),
      ],
      GROUP_CALL_META(),
      'wh-1',
    );

    // The managed quantity write itself is kept.
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ managedStockQuantity: 5 }),
    });
    // No physical entry of any kind.
    expect(stock.operatePhysical).not.toHaveBeenCalled();
    expect(prisma.physicalInventory.findFirst).not.toHaveBeenCalled();
  });

  it('variant product: variant stock stays managed-only, NO physical row created', async () => {
    const { svc, prisma, stock } = makeService();
    jest.spyOn(svc, 'createProductCached').mockResolvedValue('prod-1');
    prisma.productVariant.create.mockResolvedValue({ id: 'variant-a' });
    // Non-zero stored price keeps the parent-price fallback out of the way.
    prisma.product.findUnique.mockResolvedValue({ basePrice: 500 });

    await runGroup(
      svc,
      [
        row(1, { SKU: 'VAR-1', Type: 'variable' }),
        row(2, {
          SKU: 'VAR-1-RED',
          Type: 'variation',
          Stock: '3',
          'Regular price': '300',
        }),
      ],
      GROUP_CALL_META(),
      'wh-1',
    );

    expect(prisma.productVariant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ managedStockQuantity: 3 }),
    });
    expect(stock.operatePhysical).not.toHaveBeenCalled();
    expect(prisma.physicalInventory.findFirst).not.toHaveBeenCalled();
  });

  it('re-import of an existing MANAGED_STOCK product writes no physical row either', async () => {
    const { svc, prisma, stock } = makeService();
    jest
      .spyOn(svc, 'updateProductCached')
      .mockResolvedValue('MANAGED_STOCK');
    const meta = GROUP_CALL_META();
    meta.productCache.set('SIM-1', 'prod-1');

    await runGroup(
      svc,
      [row(1, { SKU: 'SIM-1', Type: 'simple', Stock: '9' })],
      meta,
      'wh-1',
      'update',
    );

    expect(svc.updateProductCached).toHaveBeenCalled();
    expect(stock.operatePhysical).not.toHaveBeenCalled();
    expect(prisma.physicalInventory.findFirst).not.toHaveBeenCalled();
  });
});

/**
 * The INVENTORY_CONTROLLED path is NOT a mirror and stays fully working:
 * for an IC product the CSV Stock cell IS physical stock, so a re-import
 * level-sets the physical layer via StockService.operatePhysical.
 */
describe('ImportService INVENTORY_CONTROLLED re-import — physical level still set', () => {
  function icMeta() {
    const meta = GROUP_CALL_META();
    meta.productCache.set('IC-1', 'prod-ic');
    return meta;
  }

  it('simple IC product: physical level is set to the CSV quantity (delta applied)', async () => {
    const { svc, prisma, stock } = makeService();
    jest
      .spyOn(svc, 'updateProductCached')
      .mockResolvedValue('INVENTORY_CONTROLLED');
    prisma.physicalInventory.findFirst.mockResolvedValue({ quantity: 2 });

    await runGroup(
      svc,
      [row(1, { SKU: 'IC-1', Type: 'simple', Stock: '7' })],
      icMeta(),
      'wh-1',
      'update',
    );

    expect(stock.operatePhysical).toHaveBeenCalledWith(
      'add',
      expect.objectContaining({
        productId: 'prod-ic',
        warehouseId: 'wh-1',
        quantity: 5, // level 7 − existing 2
        reference: 'Stock level set by CSV re-import',
        ledgerType: 'ADJUSTMENT',
      }),
    );
  });

  it('existing variant of an IC product: physical level is set per variant', async () => {
    const { svc, prisma, stock } = makeService();
    jest
      .spyOn(svc, 'updateProductCached')
      .mockResolvedValue('INVENTORY_CONTROLLED');
    prisma.physicalInventory.findFirst.mockResolvedValue({ quantity: 1 });
    const meta = icMeta();
    meta.variantCache.set('IC-1-RED', 'var-1');

    await runGroup(
      svc,
      [
        row(1, {
          SKU: 'IC-1',
          Type: 'variable',
          'Regular price': '999',
        }),
        row(2, {
          SKU: 'IC-1-RED',
          Type: 'variation',
          Stock: '4',
          'Regular price': '300',
        }),
      ],
      meta,
      'wh-1',
      'update',
    );

    expect(stock.operatePhysical).toHaveBeenCalledWith(
      'add',
      expect.objectContaining({
        productId: 'prod-ic',
        variantId: 'var-1',
        warehouseId: 'wh-1',
        quantity: 3, // level 4 − existing 1
      }),
    );
  });

  it('new variant of an IC product: physical level seeded via the level-set path, managed counter stays 0', async () => {
    const { svc, prisma, stock } = makeService();
    jest
      .spyOn(svc, 'updateProductCached')
      .mockResolvedValue('INVENTORY_CONTROLLED');
    prisma.productVariant.create.mockResolvedValue({ id: 'var-new' });
    prisma.physicalInventory.findFirst.mockResolvedValue(null);

    await runGroup(
      svc,
      [
        row(1, {
          SKU: 'IC-1',
          Type: 'variable',
          'Regular price': '999',
        }),
        row(2, {
          SKU: 'IC-1-RED',
          Type: 'variation',
          Stock: '6',
          'Regular price': '300',
        }),
      ],
      icMeta(),
      'wh-1',
      'update',
    );

    expect(prisma.productVariant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ managedStockQuantity: 0 }),
    });
    expect(stock.operatePhysical).toHaveBeenCalledWith(
      'add',
      expect.objectContaining({
        productId: 'prod-ic',
        variantId: 'var-new',
        warehouseId: 'wh-1',
        quantity: 6,
      }),
    );
  });
});

/**
 * Warehouse resolution is now IC-only: it exists solely so the legitimate
 * IC level-set has somewhere to land. Managed (and brand-new) products
 * never trigger it, so their imports cannot fail on a missing warehouse.
 */
describe('ImportService.resolveImportWarehouse (IC-only)', () => {
  const groupsOf = (sku: string, data: Record<string, unknown>) => ({
    [sku]: [row(1, { SKU: sku, ...data })] as any,
  });

  it('returns null for MANAGED_STOCK groups without touching warehouse/settings', async () => {
    const { svc, prisma } = makeService();

    await expect(
      svc.resolveImportWarehouse(
        groupsOf('SIM-1', { Stock: '4' }),
        new Map([['SIM-1', 'MANAGED_STOCK']]),
      ),
    ).resolves.toBeNull();
    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
    expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
  });

  it('returns null for brand-new products (no stored mode) with stock', async () => {
    const { svc, prisma } = makeService();

    await expect(
      svc.resolveImportWarehouse(
        groupsOf('NEW-1', { Stock: '4' }),
        new Map<string, string>(),
      ),
    ).resolves.toBeNull();
    expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
  });

  it('resolves the main active warehouse for an IC group when IM is on', async () => {
    const { svc, prisma } = makeService();

    await expect(
      svc.resolveImportWarehouse(
        groupsOf('IC-1', { Stock: '4' }),
        new Map([['IC-1', 'INVENTORY_CONTROLLED']]),
      ),
    ).resolves.toBe('wh-1');
    expect(prisma.warehouse.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, type: 'main' },
      }),
    );
  });

  it('returns null for an IC group when Inventory Management is off', async () => {
    const { svc, prisma } = makeService();
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'false' });

    await expect(
      svc.resolveImportWarehouse(
        groupsOf('IC-1', { Stock: '4' }),
        new Map([['IC-1', 'INVENTORY_CONTROLLED']]),
      ),
    ).resolves.toBeNull();
    expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
  });

  it('fails loudly for an IC group when IM is on but no active warehouse exists', async () => {
    const { svc, prisma } = makeService();
    prisma.warehouse.findFirst.mockResolvedValue(null);

    await expect(
      svc.resolveImportWarehouse(
        groupsOf('IC-1', { Stock: '4' }),
        new Map([['IC-1', 'INVENTORY_CONTROLLED']]),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.resolveImportWarehouse(
        groupsOf('IC-1', { Stock: '4' }),
        new Map([['IC-1', 'INVENTORY_CONTROLLED']]),
      ),
    ).rejects.toThrow(/no active warehouse/i);
  });
});

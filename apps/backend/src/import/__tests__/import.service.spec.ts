import { ImportService } from '../import.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaService } from '../../media/media.service';
import { CacheService } from '../../cache/cache.service';
import { ImportSummary } from '../types/woocommerce-csv.types';

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
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const media = {};
  const cache = {};
  const service = new ImportService(
    prisma as unknown as PrismaService,
    media as unknown as MediaService,
    cache as unknown as CacheService,
  );
  return { service, prisma, svc: service as any };
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
) {
  await svc.processProductGroupCached(
    'VAR-1',
    rows,
    'create',
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
});

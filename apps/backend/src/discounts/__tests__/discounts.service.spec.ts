import { DiscountsService } from '../discounts.service';

/**
 * D19 — DiscountsService: scope/value validation and the delete guard.
 * The evaluation engine itself is covered by discount-evaluation.spec.ts.
 */
describe('DiscountsService (D19)', () => {
  let service: DiscountsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      category: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]) },
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]) },
      discount: {
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: 'd1',
          ...data,
        })),
        update: jest.fn().mockImplementation(({ data }: any) => ({
          id: 'd1',
          ...data,
        })),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    service = new DiscountsService(prisma as any);
  });

  const base = {
    title: 'Eid Sale',
    scope: 'CATEGORY',
    categoryIds: ['c1'],
    type: 'percentage',
    value: 10,
  };

  it('creates a valid category discount', async () => {
    const created = await service.create(base as any);
    expect(created.id).toBe('d1');
    expect(prisma.discount.create).toHaveBeenCalled();
  });

  it('rejects a category discount with no categories', async () => {
    await expect(
      service.create({ ...base, categoryIds: [] } as any),
    ).rejects.toThrow(/at least one category/);
  });

  it('rejects a product discount with no products', async () => {
    await expect(
      service.create({
        ...base,
        scope: 'PRODUCT',
        productIds: [],
      } as any),
    ).rejects.toThrow(/at least one product/);
  });

  it('rejects a percentage over 100', async () => {
    await expect(
      service.create({ ...base, value: 101 } as any),
    ).rejects.toThrow(/between 0 and 100/);
  });

  it('rejects unknown category ids instead of creating a silent no-op rule', async () => {
    prisma.category.findMany.mockResolvedValue([]);
    await expect(service.create(base as any)).rejects.toThrow(
      /categories do not exist/,
    );
  });

  it('refuses to delete a discount that has been applied to orders', async () => {
    prisma.discount.findUnique.mockResolvedValue({
      id: 'd1',
      _count: { applications: 3 },
    });
    await expect(service.remove('d1')).rejects.toThrow(/deactivate it instead/);
    expect(prisma.discount.delete).not.toHaveBeenCalled();
  });

  it('deletes an never-applied discount', async () => {
    prisma.discount.findUnique.mockResolvedValue({
      id: 'd1',
      _count: { applications: 0 },
    });
    await service.remove('d1');
    expect(prisma.discount.delete).toHaveBeenCalledWith({
      where: { id: 'd1' },
    });
  });

  it('update with endsAt: null reopens an ended campaign', async () => {
    prisma.discount.findUnique.mockResolvedValue({
      id: 'd1',
      scope: 'SITEWIDE',
      categoryIds: [],
      productIds: [],
      type: 'percentage',
      value: 10,
      _count: { applications: 0 },
    });
    await service.update('d1', { endsAt: null } as any);
    expect(prisma.discount.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: expect.objectContaining({ endsAt: null }),
    });
  });
});

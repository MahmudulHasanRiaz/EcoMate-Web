import { DiscountsService } from '../discounts.service';

/**
 * D19 — DiscountsService: scope/value validation and the delete guard.
 * The evaluation engine itself is covered by discount-evaluation.spec.ts.
 * V2 — evaluateForCart gates: usage caps, first-order, coupon suppression,
 * server-side sale detection.
 */
describe('DiscountsService.evaluateForCart (V2 gates)', () => {
  let service: DiscountsService;
  let prisma: any;

  const ruleRow = (over: Record<string, unknown>) => ({
    id: 'd1',
    title: 'Campaign',
    scope: 'SITEWIDE',
    categoryIds: [],
    productIds: [],
    variantIds: [],
    type: 'percentage',
    value: 10,
    minOrderAmount: null,
    minQuantity: null,
    excludeSaleItems: false,
    maxDiscountAmount: null,
    combineWithCoupon: true,
    maxUses: null,
    maxUsesPerCustomer: null,
    firstOrderOnly: false,
    priority: 0,
    startsAt: null,
    endsAt: null,
    isActive: true,
    ...over,
  });

  function setup(ruleOverrides: Record<string, unknown>) {
    prisma = {
      discount: {
        findMany: jest.fn().mockResolvedValue([ruleRow(ruleOverrides)]),
      },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      productCategory: { findMany: jest.fn().mockResolvedValue([]) },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p1', categoryId: null, salePrice: null, basePrice: 100 },
        ]),
      },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      discountApplication: { count: jest.fn().mockResolvedValue(0) },
      order: { count: jest.fn().mockResolvedValue(0) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    };
    service = new DiscountsService(prisma as any);
  }

  const cart = [{ productId: 'p1', quantity: 2, unitPrice: 100 }];

  it('drops a rule whose total usage cap is reached', async () => {
    setup({ maxUses: 1 });
    prisma.discountApplication.count.mockResolvedValue(1);
    const res = await service.evaluateForCart({ items: cart } as any);
    expect(res.autoDiscount).toBe(0);
    expect(res.skipped).toEqual([
      { discountId: 'd1', discountTitle: 'Campaign', reason: 'usage-cap-reached' },
    ]);
  });

  it('keeps a rule under its total usage cap', async () => {
    setup({ maxUses: 5 });
    prisma.discountApplication.count.mockResolvedValue(4);
    const res = await service.evaluateForCart({ items: cart } as any);
    expect(res.autoDiscount).toBe(20);
  });

  it('suppresses a non-combining rule when the cart carries a coupon code', async () => {
    setup({ combineWithCoupon: false });
    const res = await service.evaluateForCart({
      items: cart,
      couponCode: 'SAVE10',
    } as any);
    expect(res.autoDiscount).toBe(0);
    const plain = await service.evaluateForCart({ items: cart } as any);
    expect(plain.autoDiscount).toBe(20);
  });

  it('firstOrderOnly drops the rule for a returning customer (order path)', async () => {
    setup({ firstOrderOnly: true });
    prisma.order.count.mockResolvedValue(2);
    const res = await service.evaluateForCart({ items: cart } as any, prisma, new Date(), {
      customerKey: { userId: 'u1' },
    });
    expect(res.autoDiscount).toBe(0);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalled();
    prisma.order.count.mockResolvedValue(0);
    const first = await service.evaluateForCart({ items: cart } as any, prisma, new Date(), {
      customerKey: { userId: 'u1' },
    });
    expect(first.autoDiscount).toBe(20);
  });

  it('detects sale lines server-side from product prices', async () => {
    setup({ excludeSaleItems: true });
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', categoryId: null, salePrice: 80, basePrice: 100 },
    ]);
    const res = await service.evaluateForCart({ items: cart } as any);
    expect(res.autoDiscount).toBe(0);
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', categoryId: null, salePrice: null, basePrice: 100 },
    ]);
    const full = await service.evaluateForCart({ items: cart } as any);
    expect(full.autoDiscount).toBe(20);
  });

  it('per-customer cap counts applications joined to the customer key', async () => {
    setup({ maxUsesPerCustomer: 2 });
    prisma.discountApplication.count.mockResolvedValue(2);
    const res = await service.evaluateForCart({ items: cart } as any, prisma, new Date(), {
      customerKey: { userId: 'u1', phone: '+8801' },
    });
    expect(res.autoDiscount).toBe(0);
    expect(prisma.discountApplication.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        discountId: 'd1',
        order: expect.objectContaining({ OR: expect.any(Array) }),
      }),
    });
  });
});
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

  it('V2: rejects variantIds on a non-product scope', async () => {
    await expect(
      service.create({
        ...base,
        scope: 'CATEGORY',
        variantIds: ['v1'],
      } as any),
    ).rejects.toThrow(/only narrow a product discount/);
  });

  it('V2: rejects a variant that belongs to another product', async () => {
    prisma.productVariant = {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'v1', productId: 'pX' }]),
    };
    await expect(
      service.create({
        ...base,
        scope: 'PRODUCT',
        productIds: ['p1'],
        variantIds: ['v1'],
      } as any),
    ).rejects.toThrow(/belong to another product/);
  });

  it('V2: accepts variant narrowing when the variant belongs to a listed product', async () => {
    prisma.productVariant = {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'v1', productId: 'p1' }]),
    };
    const created = await service.create({
      ...base,
      scope: 'PRODUCT',
      productIds: ['p1'],
      variantIds: ['v1'],
    } as any);
    expect(created.variantIds).toEqual(['v1']);
  });

  it('V2: update changing scope away from PRODUCT clears variantIds', async () => {
    prisma.discount.findUnique.mockResolvedValue({
      id: 'd1',
      scope: 'PRODUCT',
      categoryIds: [],
      productIds: ['p1'],
      variantIds: ['v1'],
      type: 'percentage',
      value: 10,
      _count: { applications: 0 },
    });
    await service.update('d1', { scope: 'SITEWIDE' } as any);
    expect(prisma.discount.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: expect.objectContaining({ variantIds: [] }),
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

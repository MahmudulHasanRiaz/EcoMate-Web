import { StockService } from '../stock.service';

/**
 * listPhysical — product-based Physical tab listing (2026-11-24 fix).
 *
 * The tab must list PRODUCTS (LEFT JOIN physical rows, COALESCE 0), not
 * PhysicalInventory rows: a MANAGED_STOCK / INVENTORY_CONTROLLED product
 * with no physical row gets one synthetic ("virtual") 0/0 row so staff can
 * see it and Adjust it into existence. Real rows keep their exact shape.
 */
describe('StockService.listPhysical — product-based listing', () => {
  let service: StockService;
  let prisma: any;

  const realRow = (over: any = {}) => ({
    id: 'pi-1',
    productId: 'prod-1',
    variantId: null,
    warehouseId: 'wh-1',
    binLocationId: null,
    quantity: 5,
    reservedQuantity: 1,
    product: {
      id: 'prod-1',
      name: 'Simple Tee',
      sku: 'TEE-1',
      images: [],
      lowStockQty: 2,
      type: 'simple',
      availabilityMode: 'MANAGED_STOCK',
      warehouseId: null,
    },
    variant: null,
    warehouse: { id: 'wh-1', name: 'Main Warehouse' },
    binLocation: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    ...over,
  });

  const productRow = (over: any = {}) => ({
    id: 'prod-1',
    name: 'Simple Tee',
    sku: 'TEE-1',
    images: [],
    lowStockQty: 2,
    type: 'simple',
    availabilityMode: 'MANAGED_STOCK',
    warehouseId: null,
    isActive: true,
    status: 'active',
    variants: [],
    ...over,
  });

  const variantRow = (over: any = {}) => ({
    id: 'var-1',
    sku: 'TEE-S',
    attributeValues: [{ attributeValue: { id: 'av-1', value: 'S', attribute: { name: 'Size' } } }],
    ...over,
  });

  beforeEach(() => {
    prisma = {
      physicalInventory: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new StockService(
      prisma,
      { invalidateByPrefix: jest.fn() } as any,
      {} as any,
    );
  });

  it('row-less MANAGED_STOCK simple product appears as a virtual 0/0 row', async () => {
    prisma.product.findMany.mockResolvedValue([productRow()]);

    const rows = await service.listPhysical();

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row._virtual).toBe(true);
    expect(row.id).toBe('virtual-prod-1-base');
    expect(row.productId).toBe('prod-1');
    expect(row.variantId).toBeNull();
    expect(row.quantity).toBe(0);
    expect(row.reservedQuantity).toBe(0);
    // No location is fabricated for a row that does not exist yet.
    expect(row.warehouseId).toBeNull();
    expect(row.binLocationId).toBeNull();
    expect(row.warehouse).toBeNull();
    expect(row.binLocation).toBeNull();
    expect(row.variant).toBeNull();
    expect(row.product).toMatchObject({ id: 'prod-1', name: 'Simple Tee', sku: 'TEE-1' });
  });

  it('row-less INVENTORY_CONTROLLED product appears as a virtual 0/0 row', async () => {
    prisma.product.findMany.mockResolvedValue([
      productRow({ id: 'prod-ic', availabilityMode: 'INVENTORY_CONTROLLED' }),
    ]);

    const rows = await service.listPhysical();

    expect(rows).toHaveLength(1);
    expect(rows[0]._virtual).toBe(true);
    expect(rows[0].productId).toBe('prod-ic');
  });

  it('product with real rows shows the real rows and no virtual row', async () => {
    const real = realRow();
    prisma.physicalInventory.findMany.mockResolvedValue([real]);
    prisma.product.findMany.mockResolvedValue([productRow()]);

    const rows = await service.listPhysical();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(real);
    expect((rows[0] as any)._virtual).toBeUndefined();
  });

  it('variable product: variant with rows keeps its real row, variant without rows gets a virtual row', async () => {
    const real = realRow({ id: 'pi-v1', productId: 'prod-var', variantId: 'var-1', quantity: 7, reservedQuantity: 1 });
    prisma.physicalInventory.findMany.mockResolvedValue([real]);
    prisma.product.findMany.mockResolvedValue([
      productRow({
        id: 'prod-var',
        type: 'variable',
        variants: [variantRow(), variantRow({ id: 'var-2', sku: 'TEE-M' })],
      }),
    ]);

    const rows = await service.listPhysical();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(real);
    const [virtual] = rows.slice(1);
    expect(virtual._virtual).toBe(true);
    expect(virtual.productId).toBe('prod-var');
    expect(virtual.variantId).toBe('var-2');
    expect(virtual.quantity).toBe(0);
    expect(virtual.variant).toMatchObject({ id: 'var-2', sku: 'TEE-M' });
  });

  it('variable product with no variants yet gets one base virtual row', async () => {
    prisma.product.findMany.mockResolvedValue([
      productRow({ id: 'prod-var', type: 'variable', variants: [] }),
    ]);

    const rows = await service.listPhysical();

    expect(rows).toHaveLength(1);
    expect(rows[0]._virtual).toBe(true);
    expect(rows[0].variantId).toBeNull();
  });

  it('ALWAYS_IN_STOCK / ALWAYS_OUT_OF_STOCK products never get a virtual row', async () => {
    prisma.product.findMany.mockResolvedValue([
      productRow({ id: 'prod-always', availabilityMode: 'ALWAYS_IN_STOCK' }),
      productRow({ id: 'prod-out', availabilityMode: 'ALWAYS_OUT_OF_STOCK' }),
    ]);

    const rows = await service.listPhysical();

    expect(rows).toHaveLength(0);
  });

  it('inactive and draft products never get a virtual row', async () => {
    prisma.product.findMany.mockResolvedValue([
      productRow({ id: 'prod-inactive', isActive: false }),
      productRow({ id: 'prod-draft', status: 'draft' }),
    ]);

    const rows = await service.listPhysical();

    expect(rows).toHaveLength(0);
  });

  it('ALWAYS_* product WITH real rows still shows those rows (no behaviour change)', async () => {
    const real = realRow({ productId: 'prod-always' });
    prisma.physicalInventory.findMany.mockResolvedValue([real]);
    prisma.product.findMany.mockResolvedValue([
      productRow({ id: 'prod-always', availabilityMode: 'ALWAYS_IN_STOCK' }),
    ]);

    const rows = await service.listPhysical();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(real);
  });

  it('warehouse filter scopes the real rows but row-less products still appear with 0/0', async () => {
    prisma.product.findMany.mockResolvedValue([productRow()]);

    const rows = await service.listPhysical(undefined, 'wh-2');

    expect(prisma.physicalInventory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ warehouseId: 'wh-2' }) }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]._virtual).toBe(true);
    expect(rows[0].quantity).toBe(0);
  });

  it('product with rows in another warehouse only gets a virtual row under a warehouse filter', async () => {
    // The real-row query is warehouse-scoped, so under wh-2 it returns
    // nothing — the product is row-less THERE and must show 0/0 for wh-2.
    prisma.physicalInventory.findMany.mockResolvedValue([]);
    prisma.product.findMany.mockResolvedValue([productRow()]);

    const rows = await service.listPhysical(undefined, 'wh-2');

    expect(rows).toHaveLength(1);
    expect(rows[0]._virtual).toBe(true);
  });

  it('under a warehouse filter, a variant with a real row there keeps it and the other variant gets a virtual row', async () => {
    // Covered is built from the warehouse-scoped real rows, so var-1
    // (stocked in wh-2) shows its real quantity while var-2 (row-less in
    // wh-2) shows 0/0 for wh-2 — never the other warehouse's figures.
    const real = realRow({ id: 'pi-v1', productId: 'prod-var', variantId: 'var-1', warehouseId: 'wh-2', quantity: 4, reservedQuantity: 0 });
    prisma.physicalInventory.findMany.mockResolvedValue([real]);
    prisma.product.findMany.mockResolvedValue([
      productRow({
        id: 'prod-var',
        type: 'variable',
        variants: [variantRow(), variantRow({ id: 'var-2', sku: 'TEE-M' })],
      }),
    ]);

    const rows = await service.listPhysical(undefined, 'wh-2');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(real);
    const [virtual] = rows.slice(1);
    expect(virtual._virtual).toBe(true);
    expect(virtual.variantId).toBe('var-2');
    expect(virtual.quantity).toBe(0);
  });

  it('real rows of an inactive/draft product are still returned (no behaviour change for stocked products)', async () => {
    // The virtual synthesis skips inactive/draft products, but their REAL
    // rows were always listed and still are — only the synthesis is new.
    const real = realRow({ productId: 'prod-draft' });
    prisma.physicalInventory.findMany.mockResolvedValue([real]);
    prisma.product.findMany.mockResolvedValue([
      productRow({ id: 'prod-draft', status: 'draft' }),
    ]);

    const rows = await service.listPhysical();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(real);
    expect((rows[0] as any)._virtual).toBeUndefined();
  });

  it("binLocationId '' queries unassigned (NULL) bins", async () => {
    await service.listPhysical(undefined, undefined, '');

    expect(prisma.physicalInventory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ binLocationId: null }) }),
    );
  });

  it('productId filter scopes both queries', async () => {
    prisma.product.findMany.mockResolvedValue([productRow({ id: 'prod-9' })]);

    const rows = await service.listPhysical('prod-9');

    expect(prisma.physicalInventory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ productId: 'prod-9' }) }),
    );
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'prod-9' }) }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].productId).toBe('prod-9');
  });

  it('product query is scoped to active, non-draft, stock-tracked products', async () => {
    await service.listPhysical();

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { not: 'draft' },
          isActive: true,
          availabilityMode: { in: ['MANAGED_STOCK', 'INVENTORY_CONTROLLED'] },
        }),
      }),
    );
  });
});

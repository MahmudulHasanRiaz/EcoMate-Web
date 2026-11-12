import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  ProductsService,
  computeEffectivePrice,
} from './products.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { MediaResolverService } from '../media/media-resolver.service';
import { CacheService } from '../cache/cache.service';
import { StockRouterService } from '../stock/stock-router.service';
import { StockService } from '../stock/stock.service';
import { CustomizationService } from '../customization/customization.service';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-v4'),
}));

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: PrismaService;
  let media: MediaService;

  const mockProduct = {
    id: 'prod-1',
    name: 'Test Product',
    slug: 'test-product',
    type: 'simple',
    basePrice: 1000,
    salePrice: 800,
    sku: 'SKU-001',
    stock: 50,
    lowStockQty: 5,
    description: 'A test product',
    shortDesc: 'Short description',
    isFeatured: false,
    isActive: true,
    manageStock: false,
    tags: ['test', 'product'],
    images: ['https://cdn.example.com/img1.jpg'],
    seoMeta: { title: 'Test Product' },
    categoryId: 'cat-1',
    category: { id: 'cat-1', name: 'Test Category' },
    variants: [],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  const mockVariant = {
    id: 'variant-1',
    productId: 'prod-1',
    sku: 'SKU-001-RED_L',
    price: 1200,
    stock: 10,
    image: 'variant-image.jpg',
    attributeValues: [
      {
        id: 'av-1',
        attributeValueId: 'attr-val-1',
        attributeValue: {
          id: 'attr-val-1',
          value: 'Red',
          attribute: { id: 'attr-1', name: 'Color' },
        },
      },
    ],
  };

  let cache: CacheService;
  let stockRouter: StockRouterService;
  let stockService: StockService;

  beforeEach(async () => {
    const prismaMock = {
      $transaction: jest.fn((fn: any) => fn(prismaMock)),
      product: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      productVariant: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      attributeValue: {
        findMany: jest.fn(),
      },
      media: {
        findFirst: jest.fn(),
      },
      productTag: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      tag: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'tag-1',
          name: 'Test Tag',
          slug: 'test-tag',
        }),
        create: jest.fn().mockResolvedValue({
          id: 'tag-1',
          name: 'Test Tag',
          slug: 'test-tag',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'tag-1',
          name: 'Test Tag',
          slug: 'test-tag',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      orderItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      orderItemComboComponent: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      comboItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      category: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({
          id: 'cat-1',
          name: 'Test Category',
          slug: 'test-category',
        }),
      },
      physicalInventory: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      warehouse: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      managedStockLedger: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: MediaService,
          useValue: {
            attach: jest.fn(),
            detach: jest.fn(),
            detachAll: jest.fn(),
            syncEntityImages: jest.fn(),
          },
        },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn().mockReturnValue(null),
            set: jest.fn().mockResolvedValue(undefined),
            invalidateByPrefix: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StockRouterService,
          useValue: {
            getStock: jest.fn(),
            adjustStock: jest.fn(),
            isInventoryManagementEnabled: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: MediaResolverService,
          useValue: {
            resolve: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: StockService,
          useValue: {
            operatePhysical: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: CustomizationService,
          useValue: new CustomizationService({ canUse: () => true } as any),
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    prisma = module.get<PrismaService>(PrismaService);
    media = module.get<MediaService>(MediaService);
    cache = module.get<CacheService>(CacheService);
    stockRouter = module.get<StockRouterService>(StockRouterService);
    stockService = module.get<StockService>(StockService);
    (media.syncEntityImages as jest.Mock).mockImplementation(
      (_t: string, _id: string, imgs: string[]) => Promise.resolve(imgs),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated products', async () => {      (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);
      (prisma.product.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ page: 1, perPage: 10 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
      expect(prisma.product.count).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        perPage: 10,
        totalPages: 1,
        hasMore: false,
        nextCursor: null,
      });
    });

    it('strips internal fields for public callers, keeps them for staff (security 2026-10-25)', async () => {
      const makeSensitive = () => ({
        ...mockProduct,
        standardCost: 400,
        managedStockQuantity: 25,
        reservedStock: 3,
        warehouseId: 'wh-1',
        variants: [
          { id: 'v-1', standardCost: 100, managedStockQuantity: 7, reservedStock: 1, warehouseId: 'wh-1' },
        ],
        _count: { orderItems: 9 },
      });
      (prisma.product.findMany as jest.Mock).mockResolvedValue([makeSensitive()]);
      (prisma.product.count as jest.Mock).mockResolvedValue(1);

      const pub = await service.findAll({ page: 1, perPage: 10 });
      const pubRow: any = pub.data[0];
      expect(pubRow.standardCost).toBeUndefined();
      expect(pubRow.managedStockQuantity).toBeUndefined();
      expect(pubRow.reservedStock).toBeUndefined();
      expect(pubRow.warehouseId).toBeUndefined();
      expect(pubRow._count).toBeUndefined();
      expect(pubRow.variants[0].standardCost).toBeUndefined();
      expect(pubRow.name).toBe('Test Product');

      (prisma.product.findMany as jest.Mock).mockResolvedValue([makeSensitive()]);
      const staff = await service.findAll({ page: 1, perPage: 10 }, { isStaff: true });
      expect((staff.data[0] as any).standardCost).toBe(400);
      expect((staff.data[0] as any).managedStockQuantity).toBe(25);
    });

    it('fields=card returns the slim card projection; default keeps the full payload (P2 opt-in)', async () => {
      const makeFull = () => ({
        ...mockProduct,
        description: '<p>heavy</p>',
        descriptionSections: { tagline: 't' },
        customizations: [{ id: 'g1' }],
        detailRows: [{ label: 'a', value: 'b' }],
        videoUrl: 'https://youtube.com/watch?v=x',
        images: ['https://cdn.example.com/img1.jpg', 'https://cdn.example.com/img2.jpg'],
        brand: { id: 'b1', name: 'Brand', slug: 'brand', logo: 'logo.png', createdAt: new Date(), updatedAt: new Date() },
        variants: [
          {
            id: 'v-1', price: 1200, salePrice: 900, isActive: true, sku: 'V1',
            image: 'variant-image.jpg', images: ['variant-image.jpg'],
            attributeValues: [{ attributeValue: { id: 'av', value: 'Red', attribute: { id: 'a', name: 'Color' } } }],
          },
        ],
      });
      (prisma.product.findMany as jest.Mock).mockResolvedValue([makeFull()]);
      (prisma.product.count as jest.Mock).mockResolvedValue(1);

      const cardRes = await service.findAll({ page: 1, perPage: 10, fields: 'card' });
      const row: any = cardRes.data[0];
      expect(row.name).toBe('Test Product');
      expect(row.basePrice).toBe(1000);
      expect(row.description).toBeUndefined();
      expect(row.descriptionSections).toBeUndefined();
      expect(row.customizations).toBeUndefined();
      expect(row.detailRows).toBeUndefined();
      expect(row.videoUrl).toBeUndefined();
      expect(row.images).toEqual(['https://cdn.example.com/img1.jpg']);
      expect(row.brand).toEqual({ id: 'b1', name: 'Brand', slug: 'brand' });
      // Variant stubs carry only what the storefront transform derives
      // price range / stock from — no attribute tree, no images.
      expect(row.variants).toHaveLength(1);
      expect(row.variants[0]).toEqual(
        expect.objectContaining({ id: 'v-1', price: 1200, salePrice: 900, isActive: true }),
      );
      expect(Object.keys(row.variants[0]).sort()).toEqual(
        ['availableStock', 'id', 'isActive', 'price', 'salePrice'].sort(),
      );
      expect(row.variants[0].attributeValues).toBeUndefined();

      // Default (no fields param) is byte-shape unchanged for the
      // admin consumers sharing this endpoint.
      (prisma.product.findMany as jest.Mock).mockResolvedValue([makeFull()]);
      const fullRes = await service.findAll({ page: 1, perPage: 10 });
      const fullRow: any = fullRes.data[0];
      expect(fullRow.description).toBe('<p>heavy</p>');
      expect(fullRow.images).toHaveLength(2);
      expect(fullRow.variants[0].attributeValues).toBeDefined();
    });

    it('clamps an unbounded perPage so one page cannot dump the catalogue', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      const result = await service.findAll({ page: 1, perPage: 1000000 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
      expect(result.meta.perPage).toBe(100);
    });

    it('falls back to page 1 / 24 rows on garbage page input', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      const result = await service.findAll({ page: NaN, perPage: NaN } as any);

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 24 }),
      );
      expect(result.meta.page).toBe(1);
      expect(result.meta.perPage).toBe(24);
    });

    it('should filter by search term', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ search: 'test', page: 1, perPage: 10 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: { not: 'draft' },
            OR: [
              { name: { contains: 'test', mode: 'insensitive' } },
              { slug: { contains: 'test', mode: 'insensitive' } },
              { sku: { contains: 'test', mode: 'insensitive' } },
              {
                variants: {
                  some: {
                    sku: { contains: 'test', mode: 'insensitive' },
                  },
                },
              },
            ],
          },
        }),
      );
    });

    it('should find a product by its VARIANT SKU (Product.sku is nullable)', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([
        { id: 'p1', name: 'T-Shirt', sku: null },
      ]);
      (prisma.product.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({
        search: 'TSH-001',
        page: 1,
        perPage: 10,
      });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: { not: 'draft' },
            OR: expect.arrayContaining([
              {
                variants: {
                  some: {
                    sku: { contains: 'TSH-001', mode: 'insensitive' },
                  },
                },
              },
            ]),
          },
        }),
      );
      expect(result.data).toHaveLength(1);
    });

    it('should strip leading # and trim spaces when searching', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({
        search: '  #TSH-001  ',
        page: 1,
        perPage: 10,
      });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { sku: { contains: 'TSH-001', mode: 'insensitive' } },
              {
                variants: {
                  some: {
                    sku: { contains: 'TSH-001', mode: 'insensitive' },
                  },
                },
              },
            ]),
          }),
        }),
      );
    });

    it('should filter by categoryId, type, and isActive', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({
        categoryId: 'cat-1',
        type: 'simple',
        isActive: true,
      });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [
              {
                OR: [
                  { categoryId: { in: ['cat-1'] } },
                  {
                    productCategories: {
                      some: { categoryId: { in: ['cat-1'] } },
                    },
                  },
                ],
              },
            ],
            type: 'simple',
            isActive: true,
          }),
        }),
      );
    });

    it('should use default page values when not provided', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({});

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 24 }),
      );
    });

    it('excludes drafts by default and when status=active', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({});
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: { not: 'draft' } }) }),
      );

      (prisma.product.findMany as jest.Mock).mockClear();
      await service.findAll({ status: 'active' });
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'active' }) }),
      );
    });

    it('returns drafts only when status=draft is requested', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([
        { ...mockProduct, status: 'draft', isActive: false },
      ]);
      (prisma.product.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ status: 'draft' });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'draft' }) }),
      );
      expect(result.data).toHaveLength(1);
    });

    it('should calculate total pages correctly', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);
      (prisma.product.count as jest.Mock).mockResolvedValue(25);

      const result = await service.findAll({ page: 1, perPage: 10 });

      expect(result.meta.totalPages).toBe(3);
    });
  });

  describe('findAllCursor', () => {
    const makeProduct = (id: string, iso: string) => ({
      ...mockProduct,
      id,
      createdAt: new Date(iso),
    });

    it('returns a stable order and includes cursor meta', async () => {
      const rows = [
        makeProduct('p-3', '2025-01-03T00:00:00Z'),
        makeProduct('p-2', '2025-01-02T00:00:00Z'),
        makeProduct('p-1', '2025-01-01T00:00:00Z'),
      ];
      (prisma.product.findMany as jest.Mock).mockResolvedValue(rows);
      (prisma.product.count as jest.Mock).mockResolvedValue(100);

      const result = await service.findAllCursor({ perPage: 3 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 3,
        }),
      );
      expect(result.data).toHaveLength(3);
      expect(result.meta.hasMore).toBe(true);
      expect(result.meta.nextCursor).toBeTruthy();
      expect(result.meta.perPage).toBe(3);
      expect(result.meta.total).toBe(100);
    });

    it('signals hasMore=false and nextCursor=null when last page is partial', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([
        makeProduct('p-1', '2025-01-01T00:00:00Z'),
      ]);
      (prisma.product.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAllCursor({ perPage: 5 });

      expect(result.meta.hasMore).toBe(false);
      expect(result.meta.nextCursor).toBeNull();
    });

    it('clamps an unbounded cursor perPage to the list ceiling', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      const result = await service.findAllCursor({ perPage: 999999 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
      expect(result.meta.perPage).toBe(100);
    });

    it('decodes cursor and applies keyset filter to query', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      const cursor = Buffer.from(
        '2025-01-02T00:00:00.000Z|p-2',
        'utf8',
      ).toString('base64url');
      await service.findAllCursor({ perPage: 5, cursor });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [
              expect.objectContaining({
                OR: [
                  { createdAt: { lt: new Date('2025-01-02T00:00:00.000Z') } },
                  {
                    createdAt: new Date('2025-01-02T00:00:00.000Z'),
                    id: { lt: 'p-2' },
                  },
                ],
              }),
            ],
          }),
        }),
      );
    });

    it('ignores malformed cursor and proceeds as first page', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      const result = await service.findAllCursor({
        perPage: 5,
        cursor: 'not-a-real-cursor',
      });

      expect(result.data).toHaveLength(0);
      const callArg = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
      expect(callArg.where?.OR).toBeUndefined();
    });

    it('uses default perPage of 24 when not provided', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await service.findAllCursor({});

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 24 }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a product by id', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(mockProduct);

      const result = await service.findOne('prod-1');

      expect(prisma.product.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'prod-1' } }),
      );
      expect(result).toEqual(mockProduct);
    });

    it('should throw NotFoundException if product not found', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    const createDto = {
      name: 'New Product',
      slug: 'new-product',
      type: 'simple',
      basePrice: 1500,
      salePrice: 1200,
      sku: 'SKU-NEW',
      stock: 100,
      description: 'New product description',
      images: ['https://cdn.example.com/img-new.jpg'],
      categoryId: 'cat-1',
      tags: ['new'],
    };

    it('should create a simple product without variants', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.product.create as jest.Mock).mockResolvedValue(mockProduct);
      (media.syncEntityImages as jest.Mock).mockResolvedValue(createDto.images);

      const result = await service.create(createDto);

      expect(prisma.product.findUnique).toHaveBeenCalledWith({
        where: { slug: 'new-product' },
        select: { id: true, status: true },
      });
      expect(prisma.product.create).toHaveBeenCalled();
      expect(media.syncEntityImages).toHaveBeenCalledWith(
        'product',
        'prod-1',
        createDto.images,
      );
      expect(result).toEqual(mockProduct);
    });

    it('persists videoUrl and detailRows scalars on create', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.product.create as jest.Mock).mockResolvedValue(mockProduct);
      (media.syncEntityImages as jest.Mock).mockResolvedValue([]);

      await service.create({
        ...createDto,
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        detailRows: [{ label: 'Fabric', value: 'Popcorn' }],
        descriptionSections: {
          tagline: 'Festive essential',
          benefits: ['Soft & breathable'],
          specifications: '<p>100% cotton</p>',
          stylingTip: 'Pair it with white pajama',
        },
      });

      const createCall = (prisma.product.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.videoUrl).toBe('https://youtu.be/dQw4w9WgXcQ');
      expect(createCall.data.detailRows).toEqual([
        { label: 'Fabric', value: 'Popcorn' },
      ]);
      expect(createCall.data.descriptionSections).toEqual({
        tagline: 'Festive essential',
        benefits: ['Soft & breathable'],
        specifications: '<p>100% cotton</p>',
        stylingTip: 'Pair it with white pajama',
      });
    });

    it('trims a padded videoUrl on create and clears a whitespace-only one', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.product.create as jest.Mock).mockResolvedValue(mockProduct);
      (media.syncEntityImages as jest.Mock).mockResolvedValue([]);

      await service.create({
        ...createDto,
        videoUrl: '  https://youtu.be/dQw4w9WgXcQ  ',
      });
      expect(
        (prisma.product.create as jest.Mock).mock.calls[0][0].data.videoUrl,
      ).toBe('https://youtu.be/dQw4w9WgXcQ');

      await service.create({ ...createDto, videoUrl: '   ' });
      expect(
        (prisma.product.create as jest.Mock).mock.calls[1][0].data.videoUrl,
      ).toBeNull();
    });

    it('persists an explicit availabilityMode on variable products (no force to MANAGED_STOCK)', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.product.create as jest.Mock).mockResolvedValue(mockProduct);
      (media.syncEntityImages as jest.Mock).mockResolvedValue([]);

      await service.create({
        ...createDto,
        type: 'variable',
        availabilityMode: 'ALWAYS_IN_STOCK',
      });

      const createCall = (prisma.product.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.availabilityMode).toBe('ALWAYS_IN_STOCK');
      expect(createCall.data.manageStock).toBe(false);
    });

    it('defaults variable products to MANAGED_STOCK when availabilityMode is omitted', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.product.create as jest.Mock).mockResolvedValue(mockProduct);
      (media.syncEntityImages as jest.Mock).mockResolvedValue([]);

      await service.create({ ...createDto, type: 'variable' });

      const createCall = (prisma.product.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.availabilityMode).toBe('MANAGED_STOCK');
    });

    it('should throw ConflictException if slug already exists', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(mockProduct);

      await expect(service.create(createDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('adopts a draft row that already holds the slug instead of throwing', async () => {
      const draftRow = { id: 'draft-9', status: 'draft' };
      const adopted = { ...mockProduct, id: 'draft-9', status: 'active' };
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(draftRow);
      (prisma.product.update as jest.Mock).mockResolvedValue(adopted);
      (media.syncEntityImages as jest.Mock).mockResolvedValue([]);

      const result = await service.create(createDto);

      expect(result).toEqual(adopted);
      expect(prisma.product.create).not.toHaveBeenCalled();
      const updateCall = (prisma.product.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.status).toBe('active');
      expect(updateCall.data.isActive).toBe(true);
      expect(updateCall.data.sku).toBe('SKU-NEW');
      expect(updateCall.data.productCategories.deleteMany).toBeDefined();
      expect(updateCall.data.slug).toBe('new-product');
    });

    it('promotes the draft that holds the SKU when the slug does not collide (P2002 path)', async () => {
      const skuDraft = { id: 'draft-42', status: 'draft' };
      const adopted = { ...mockProduct, id: 'draft-42', status: 'active' };
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.product.create as jest.Mock).mockRejectedValue({ code: 'P2002' });
      (prisma.product.findFirst as jest.Mock).mockResolvedValue(skuDraft);
      (prisma.product.update as jest.Mock).mockResolvedValue(adopted);
      (media.syncEntityImages as jest.Mock).mockResolvedValue([]);

      const result = await service.create(createDto);

      expect(result).toEqual(adopted);
      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { sku: 'SKU-NEW', status: 'draft' },
        select: { id: true },
      });
      expect(prisma.product.update).toHaveBeenCalled();
    });

    it('maps raw SKU unique violations to a friendly ConflictException when no draft holds the SKU', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.product.create as jest.Mock).mockRejectedValue({ code: 'P2002' });
      (prisma.product.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(
        'SKU already in use',
      );
    });

    it('propagates non-unique errors from the insert', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.product.create as jest.Mock).mockRejectedValue(
        new Error('db down'),
      );

      await expect(service.create(createDto)).rejects.toThrow('db down');
    });

    it('should create a product with variants', async () => {
      const dtoWithVariants = {
        ...createDto,
        variants: [
          {
            sku: 'SKU-NEW-RED',
            price: 1600,
            stock: 20,
            image: 'red.jpg',
            attributeValues: [{ attributeValueId: 'attr-val-1' }],
          },
        ],
      };

      const productWithVariant = { ...mockProduct, variants: [mockVariant] };

      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.product.create as jest.Mock).mockResolvedValue(
        productWithVariant,
      );
      (media.syncEntityImages as jest.Mock).mockResolvedValue(
        dtoWithVariants.images,
      );

      const result = await service.create(dtoWithVariants);

      const createCall = (prisma.product.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.variants.create).toBeDefined();
      expect(createCall.data.variants.create[0].sku).toBe('SKU-NEW-RED');
      expect(result.variants).toHaveLength(1);
    });

    it('should sync images for product and variants when images and variants are provided', async () => {
      const dtoWithVariants = {
        ...createDto,
        variants: [
          {
            sku: 'SKU-NEW-RED',
            price: 1600,
            stock: 20,
            image: 'variant-image.jpg',
            attributeValues: [{ attributeValueId: 'attr-val-1' }],
          },
        ],
      };
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.product.create as jest.Mock).mockResolvedValue({
        ...mockProduct,
        variants: [mockVariant],
      });
      (media.syncEntityImages as jest.Mock).mockResolvedValue(
        dtoWithVariants.images,
      );

      await service.create(dtoWithVariants);

      expect(media.syncEntityImages).toHaveBeenCalledWith(
        'product',
        'prod-1',
        dtoWithVariants.images,
      );
      expect(media.syncEntityImages).toHaveBeenCalledWith(
        'variant',
        'variant-1',
        ['variant-image.jpg'],
      );
    });

    describe('initial stock — NO physical mirror (2026-11-11 mirror removal)', () => {
      const managedProduct = {
        ...mockProduct,
        type: 'simple',
        availabilityMode: 'MANAGED_STOCK',
        manageStock: true,
        managedStockQuantity: 25,
        warehouseId: null,
        variants: [],
      };

      it('does NOT mirror initial managed stock into a physical record, and never looks up a warehouse', async () => {
        (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(
          true,
        );
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.product.create as jest.Mock).mockResolvedValue(managedProduct);
        (prisma.product.update as jest.Mock).mockResolvedValue({
          ...managedProduct,
          warehouseId: 'wh-1',
        });
        (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue({
          id: 'wh-1',
        });

        await service.create({
          ...createDto,
          availabilityMode: 'MANAGED_STOCK',
          managedStockQuantity: 25,
        });

        expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
        expect(stockService.operatePhysical).not.toHaveBeenCalled();
        expect(prisma.product.create).toHaveBeenCalled();
      });

      it('creates successfully when no active warehouse exists anywhere (nothing to mirror any more)', async () => {
        (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(
          true,
        );
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.product.create as jest.Mock).mockResolvedValue(managedProduct);

        await expect(
          service.create({
            ...createDto,
            availabilityMode: 'MANAGED_STOCK',
            managedStockQuantity: 25,
          }),
        ).resolves.toBeDefined();

        expect(prisma.product.create).toHaveBeenCalled();
        expect(stockService.operatePhysical).not.toHaveBeenCalled();
      });

      it('leaves the physical layer alone when inventory management is off', async () => {
        (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(
          false,
        );
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.product.create as jest.Mock).mockResolvedValue(managedProduct);

        await service.create({
          ...createDto,
          availabilityMode: 'MANAGED_STOCK',
          managedStockQuantity: 25,
        });

        expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
        expect(stockService.operatePhysical).not.toHaveBeenCalled();
      });

      it('does NOT mirror variant stock either — variants stay managed-only at creation', async () => {
        const variableProduct = {
          ...mockProduct,
          type: 'variable',
          availabilityMode: 'MANAGED_STOCK',
          manageStock: true,
          managedStockQuantity: 0,
          warehouseId: null,
          variants: [
            { id: 'variant-a', managedStockQuantity: 7 },
            { id: 'variant-b', managedStockQuantity: 0 },
          ],
        };
        (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(
          true,
        );
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.product.create as jest.Mock).mockResolvedValue(variableProduct);
        (prisma.product.update as jest.Mock).mockResolvedValue({
          ...variableProduct,
          warehouseId: 'wh-1',
        });
        (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue({
          id: 'wh-1',
        });

        await service.create({
          ...createDto,
          type: 'variable',
          variants: [
            { sku: 'V-A', price: 100, managedStockQuantity: 7 },
            { sku: 'V-B', price: 100, managedStockQuantity: 0 },
          ],
        });

        expect(stockService.operatePhysical).not.toHaveBeenCalled();
        expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
      });
    });
  });

  describe('checkSkuAvailability', () => {
    it('checks variant SKUs across all statuses, including drafts (drafts hold the unique constraint too)', async () => {
      (prisma.product.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.productVariant.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.checkSkuAvailability('SKU-NEW');

      expect(result).toEqual({ available: true });
      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { sku: 'SKU-NEW', status: { not: 'draft' } },
        select: { id: true },
      });
      expect(prisma.productVariant.findFirst).toHaveBeenCalledWith({
        where: { sku: 'SKU-NEW' },
        select: { id: true },
      });
    });

    it('reports unavailable when a live product holds the SKU', async () => {
      (prisma.product.findFirst as jest.Mock).mockResolvedValue({ id: 'p-1' });

      const result = await service.checkSkuAvailability('SKU-NEW');

      expect(result).toEqual({ available: false });
    });

    it('reports unavailable when a live variant holds the SKU', async () => {
      (prisma.product.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.productVariant.findFirst as jest.Mock).mockResolvedValue({
        id: 'v-1',
      });

      const result = await service.checkSkuAvailability('SKU-NEW');

      expect(result).toEqual({ available: false });
    });

    it('excludes the given product from the variant check', async () => {
      (prisma.product.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.productVariant.findFirst as jest.Mock).mockResolvedValue(null);

      await service.checkSkuAvailability('SKU-NEW', 'exclude-1');

      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: {
          sku: 'SKU-NEW',
          status: { not: 'draft' },
          id: { not: 'exclude-1' },
        },
        select: { id: true },
      });
      expect(prisma.productVariant.findFirst).toHaveBeenCalledWith({
        where: {
          sku: 'SKU-NEW',
          productId: { not: 'exclude-1' },
        },
        select: { id: true },
      });
    });
  });

  describe('update', () => {
    const updateDto = {
      name: 'Updated Product',
      salePrice: 900,
    };

    it('should update a product successfully', async () => {
      (prisma.product.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockProduct)
        .mockResolvedValueOnce(null);
      (prisma.product.update as jest.Mock).mockResolvedValue({
        ...mockProduct,
        name: 'Updated Product',
        salePrice: 900,
      });

      const result = await service.update('prod-1', updateDto);

      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'prod-1' } }),
      );
      expect(result.name).toBe('Updated Product');
    });

    it('normalizes videoUrl on update only when the field is present', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(mockProduct);
      (prisma.product.update as jest.Mock).mockResolvedValue(mockProduct);

      await service.update('prod-1', {
        ...updateDto,
        videoUrl: '  https://youtu.be/dQw4w9WgXcQ ',
      });
      expect(
        (prisma.product.update as jest.Mock).mock.calls[0][0].data.videoUrl,
      ).toBe('https://youtu.be/dQw4w9WgXcQ');

      // Absent field → no write at all (undefined must not clear the column).
      await service.update('prod-1', { ...updateDto });
      expect(
        (prisma.product.update as jest.Mock).mock.calls[1][0].data,
      ).not.toHaveProperty('videoUrl');

      // Explicit null still clears it.
      await service.update('prod-1', { ...updateDto, videoUrl: null });
      expect(
        (prisma.product.update as jest.Mock).mock.calls[2][0].data.videoUrl,
      ).toBeNull();
    });

    it('should throw NotFoundException if product not found', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.update('nonexistent-id', updateDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException if new slug already exists on another product', async () => {
      (prisma.product.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockProduct)
        .mockResolvedValueOnce({ id: 'other-prod', slug: 'taken-slug' });

      await expect(
        service.update('prod-1', { slug: 'taken-slug' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow updating to same slug', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(mockProduct);
      (prisma.product.update as jest.Mock).mockResolvedValue(mockProduct);

      await service.update('prod-1', { slug: 'test-product' });

      expect(prisma.product.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.product.update).toHaveBeenCalled();
    });

    it('regenerates an invalid stored slug on update instead of persisting it', async () => {
      // Once-only mock: the uniqueness check for the regenerated slug
      // must see "no collision" (undefined), not the stored row again.
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({
        ...mockProduct,
        slug: '-',
      });
      (prisma.product.update as jest.Mock).mockResolvedValue(mockProduct);

      await service.update('prod-1', { name: 'Renamed Product' });

      const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
      expect(call.data.slug).toBe('renamed-product');
    });

    it('keeps a valid stored slug when an invalid slug is sent on update', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(mockProduct);
      (prisma.product.update as jest.Mock).mockResolvedValue(mockProduct);

      await service.update('prod-1', { slug: '-' });

      const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
      expect(call.data.slug).toBeUndefined();
    });

    it('should sync images via MediaService when images are provided', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(
        mockProduct,
      );
      (prisma.product.update as jest.Mock).mockResolvedValue(mockProduct);
      (media.syncEntityImages as jest.Mock).mockResolvedValue([
        'https://cdn.example.com/new-image.jpg',
      ]);

      await service.update('prod-1', {
        images: ['https://cdn.example.com/new-image.jpg'],
      });

      expect(media.syncEntityImages).toHaveBeenCalledWith('product', 'prod-1', [
        'https://cdn.example.com/new-image.jpg',
      ]);
    });

    it('repairs manageStock on a MANAGED_STOCK variable stranded with manageStock=false (CSV-import state)', async () => {
      const stranded = {
        ...mockProduct,
        type: 'variable',
        availabilityMode: 'MANAGED_STOCK',
        manageStock: false,
      };
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(stranded);
      (prisma.product.update as jest.Mock).mockResolvedValue(stranded);

      await service.update('prod-1', { name: 'Updated Product' });

      expect(
        (prisma.product.update as jest.Mock).mock.calls[0][0].data.manageStock,
      ).toBe(true);
    });

    it('leaves manageStock untouched for a non-MANAGED variable on edit-save', async () => {
      const icProduct = {
        ...mockProduct,
        type: 'variable',
        availabilityMode: 'INVENTORY_CONTROLLED',
        manageStock: true,
      };
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(icProduct);
      (prisma.product.update as jest.Mock).mockResolvedValue(icProduct);

      await service.update('prod-1', { name: 'Updated Product' });

      expect(
        (prisma.product.update as jest.Mock).mock.calls[0][0].data,
      ).not.toHaveProperty('manageStock');
    });
  });

  describe('remove', () => {
    it('should delete a product successfully and detach all media', async () => {
      (prisma.product.findUniqueOrThrow as jest.Mock).mockResolvedValue(
        mockProduct,
      );
      (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([
        { id: 'variant-1' },
      ]);
      (media.detachAll as jest.Mock).mockResolvedValue(undefined);
      (prisma.product.delete as jest.Mock).mockResolvedValue(mockProduct);

      const result = await service.remove('prod-1');

      expect(media.detachAll).toHaveBeenCalledWith('variant', 'variant-1');
      expect(media.detachAll).toHaveBeenCalledWith('product', 'prod-1');
      expect(prisma.product.delete).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
      });
      expect(result).toEqual({ message: 'Product deleted' });
    });

    it('should throw Prisma error (NotFound) if product does not exist', async () => {
      const notFoundError = new Error('Not found');
      (prisma.product.findUniqueOrThrow as jest.Mock).mockRejectedValue(
        notFoundError,
      );

      await expect(service.remove('nonexistent-id')).rejects.toThrow(
        'Not found',
      );
      expect(prisma.product.delete).not.toHaveBeenCalled();
    });
  });

  describe('updateVariant', () => {
    it('should update variant fields and sync its image attachment', async () => {
      (prisma.productVariant.findUnique as jest.Mock).mockResolvedValue(
        mockVariant,
      );
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({
        ...mockVariant,
        price: 1500,
      });
      (media.syncEntityImages as jest.Mock).mockResolvedValue(['new.jpg']);

      const result = await service.updateVariant('prod-1', 'variant-1', {
        price: 1500,
        image: 'new.jpg',
      });

      expect(prisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'variant-1' },
        data: { price: 1500, image: 'new.jpg' },
      });
      expect(media.syncEntityImages).toHaveBeenCalledWith(
        'variant',
        'variant-1',
        ['new.jpg'],
      );
      expect(result.price).toBe(1500);
    });

    it('should throw NotFoundException if variant does not belong to product', async () => {
      (prisma.productVariant.findUnique as jest.Mock).mockResolvedValue({
        ...mockVariant,
        productId: 'other-prod',
      });

      await expect(
        service.updateVariant('prod-1', 'variant-1', { price: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('persists standardCost edits (previously silently dropped)', async () => {
      (prisma.productVariant.findUnique as jest.Mock).mockResolvedValue(
        mockVariant,
      );
      (prisma.productVariant.update as jest.Mock).mockResolvedValue({
        ...mockVariant,
        standardCost: 450,
      });

      await service.updateVariant('prod-1', 'variant-1', {
        standardCost: 450,
      });

      expect(prisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'variant-1' },
        data: { standardCost: 450 },
      });
    });
  });

  describe('generateVariants', () => {
    const generateDto = {
      attributeIds: ['attr-1', 'attr-2'],
      defaultPrice: 1500,
      defaultStock: 20,
    };

    it('should generate variants from attribute combinations', async () => {
      const product = { ...mockProduct, sku: 'PROD', basePrice: 1000 };

      (prisma.product.findUniqueOrThrow as jest.Mock).mockResolvedValue(
        product,
      );
      (prisma.productVariant.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prisma.attributeValue.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'av-1',
          value: 'Red',
          attributeId: 'attr-1',
          attribute: { id: 'attr-1', name: 'Color' },
        },
        {
          id: 'av-2',
          value: 'Blue',
          attributeId: 'attr-1',
          attribute: { id: 'attr-1', name: 'Color' },
        },
        {
          id: 'av-3',
          value: 'S',
          attributeId: 'attr-2',
          attribute: { id: 'attr-2', name: 'Size' },
        },
        {
          id: 'av-4',
          value: 'M',
          attributeId: 'attr-2',
          attribute: { id: 'attr-2', name: 'Size' },
        },
      ]);
      (prisma.productVariant.create as jest.Mock).mockResolvedValue(
        mockVariant,
      );
      (prisma.product.update as jest.Mock).mockResolvedValue({
        ...product,
        type: 'variable',
      });
      (prisma.product.findUnique as jest.Mock).mockResolvedValue({
        ...product,
        type: 'variable',
        variants: [mockVariant],
      });

      await service.generateVariants('prod-1', generateDto);

      expect(prisma.productVariant.deleteMany).toHaveBeenCalledWith({
        where: { productId: 'prod-1' },
      });
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { type: 'variable', manageStock: false, managedStockQuantity: 0 },
      });
    });
  });

  describe('persistent drafts', () => {
    const draftProduct = {
      ...mockProduct,
      id: 'draft-1',
      slug: 'draft-mock-uui',
      name: 'Untitled Draft',
      status: 'draft',
      isActive: false,
      basePrice: 0,
    };

    describe('createDraft', () => {
      it('creates a hidden draft record with a typed slug', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.product.create as jest.Mock).mockResolvedValue(draftProduct);

        const result = await service.createDraft({ name: 'New Item' });

        expect(result).toBe(draftProduct);
        const call = (prisma.product.create as jest.Mock).mock.calls[0][0];
        expect(call.data.status).toBe('draft');
        expect(call.data.isActive).toBe(false);
        expect(call.data.slug).toMatch(/^draft-[0-9a-f]{8}$/);
        expect(call.data.name).toBe('New Item');
        expect(call.data.availabilityMode).toBe('MANAGED_STOCK');
        expect(call.data.manageStock).toBe(true);
      });

      it('uses the global IM setting for the draft default mode', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.product.create as jest.Mock).mockResolvedValue(draftProduct);
        (
          stockRouter.isInventoryManagementEnabled as jest.Mock
        ).mockResolvedValue(true);

        await service.createDraft({ name: 'New Item' });

        const call = (prisma.product.create as jest.Mock).mock.calls[0][0];
        expect(call.data.availabilityMode).toBe('INVENTORY_CONTROLLED');
        expect(call.data.manageStock).toBe(false);
      });

      it('ensures slug uniqueness for explicit slugs', async () => {
        (prisma.product.findUnique as jest.Mock)
          .mockResolvedValueOnce(mockProduct)
          .mockResolvedValueOnce(null);
        (prisma.product.create as jest.Mock).mockResolvedValue(draftProduct);

        await service.createDraft({ slug: 'test-product' });

        const call = (prisma.product.create as jest.Mock).mock.calls[0][0];
        expect(call.data.slug).toBe('test-product-2');
      });

      it('treats a no-alphanumeric slug as empty and falls back to the SKU slug', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.product.create as jest.Mock).mockResolvedValue(draftProduct);

        await service.createDraft({ slug: '-', sku: 'WOO-ID-127' });

        const call = (prisma.product.create as jest.Mock).mock.calls[0][0];
        expect(call.data.slug).toBe('woo-id-127');
      });

      it('falls back to a draft-uuid slug when name and SKU yield nothing usable', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.product.create as jest.Mock).mockResolvedValue(draftProduct);

        await service.createDraft({ slug: '-', name: 'টেস্ট পণ্য' });

        const call = (prisma.product.create as jest.Mock).mock.calls[0][0];
        expect(call.data.slug).toMatch(/^draft-[0-9a-f]{8}$/);
      });

      it('creates nested variants and invalidates the product cache', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.product.create as jest.Mock).mockResolvedValue(draftProduct);

        await service.createDraft({
          variants: [
            {
              sku: 'V-1',
              price: 100,
              attributeValues: [{ attributeValueId: 'av-1' }],
            },
          ],
        });

        const call = (prisma.product.create as jest.Mock).mock.calls[0][0];
        expect(call.data.variants.create[0].sku).toBe('V-1');
        expect(cache.invalidateByPrefix).toHaveBeenCalledWith('product:');
      });
    });

    describe('findBySlug', () => {
      it('caches the enriched product with a short 10s TTL so stock never serves stale for long', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(mockProduct);

        const result = await service.findBySlug('test-product');

        expect(result).toBeTruthy();
        // F16: the cache key is scope-qualified — a token-less call is public.
        expect(cache.set).toHaveBeenCalledWith(
          'product:slug:test-product:public',
          expect.anything(),
          10_000,
        );
      });

      it('serves the cached payload without querying the database', async () => {
        (cache.get as jest.Mock).mockReturnValue(mockProduct);

        const result = await service.findBySlug('test-product');

        expect(result).toEqual(mockProduct);
        expect(prisma.product.findUnique).not.toHaveBeenCalled();
      });

      it('throws NotFoundException for an unknown slug', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);

        await expect(service.findBySlug('missing-slug')).rejects.toThrow(
          NotFoundException,
        );
      });
    });

    describe('updateDraft', () => {
      it('refuses to edit a non-draft product', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(mockProduct);

        await expect(service.updateDraft('prod-1', { name: 'X' })).rejects.toThrow(
          BadRequestException,
        );
        expect(prisma.product.update).not.toHaveBeenCalled();
      });

      it('persists autosave data while keeping the record a hidden draft', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(
          draftProduct,
        );
        (prisma.product.update as jest.Mock).mockResolvedValue({
          ...draftProduct,
          name: 'Mid Progress',
        });

        await service.updateDraft('draft-1', {
          name: 'Mid Progress',
          isActive: true,
          managedStockQuantity: 25,
        });

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.name).toBe('Mid Progress');
        expect(call.data.managedStockQuantity).toBe(25);
        expect(call.data.status).toBeUndefined();
        expect(call.data.isActive).toBeUndefined();
      });

      it('rejects a slug owned by another product', async () => {
        (prisma.product.findUnique as jest.Mock)
          .mockResolvedValueOnce(draftProduct)
          .mockResolvedValueOnce(mockProduct);

        await expect(
          service.updateDraft('draft-1', { slug: 'test-product' }),
        ).rejects.toThrow(ConflictException);
      });

      it('regenerates an invalid stored slug from the SKU on draft save', async () => {
        // Pre-fix Bengali draft: stored "-" must not survive a save.
        // Name-derived yields nothing usable, so the SKU slug wins.
        (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({
          ...draftProduct,
          slug: '-',
          name: 'টেস্ট পণ্য',
          sku: 'TEST-BN-001',
        });
        (prisma.product.update as jest.Mock).mockResolvedValue(draftProduct);

        await service.updateDraft('draft-1', {
          name: 'টেস্ট পণ্য',
          sku: 'TEST-BN-001',
        });

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.slug).toBe('test-bn-001');
      });

      it('regenerates an invalid stored slug from the name when the SKU yields nothing', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({
          ...draftProduct,
          slug: '-',
          name: 'Old Name',
        });
        (prisma.product.update as jest.Mock).mockResolvedValue(draftProduct);

        await service.updateDraft('draft-1', { name: 'New Latin Name' });

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.slug).toBe('new-latin-name');
      });

      it('keeps a valid stored slug when the draft save carries an unusable slug', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(draftProduct);
        (prisma.product.update as jest.Mock).mockResolvedValue(draftProduct);

        await service.updateDraft('draft-1', { slug: '-' });

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.slug).toBeUndefined();
      });

      it('replaces the variant set wholesale when variants are provided', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(draftProduct);
        (prisma.product.update as jest.Mock).mockResolvedValue(draftProduct);

        await service.updateDraft('draft-1', {
          variants: [
            {
              sku: 'V-1',
              price: 100,
              attributeValues: [{ attributeValueId: 'av-1' }],
            },
            {
              sku: 'V-2',
              price: 150,
              attributeValues: [{ attributeValueId: 'av-2' }],
            },
          ],
        });

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.variants.deleteMany).toEqual({});
        expect(call.data.variants.create.map((v: any) => v.sku)).toEqual([
          'V-1',
          'V-2',
        ]);
        expect(call.data.variants.create[0].attributeValues.create[0]).toEqual({
          attributeValueId: 'av-1',
        });
      });

      it('leaves existing variants untouched when variants are omitted', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(draftProduct);
        (prisma.product.update as jest.Mock).mockResolvedValue(draftProduct);

        await service.updateDraft('draft-1', { name: 'Renamed Draft' });
        (prisma.product.update as jest.Mock).mockClear();

        await service.updateDraft('draft-1', { shortDesc: 'More info' });

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.variants).toBeUndefined();
      });

      it('clears stale variant rows when switching back to a simple product', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue({
          ...draftProduct,
          type: 'variable',
        });
        (prisma.product.update as jest.Mock).mockResolvedValue(draftProduct);

        await service.updateDraft('draft-1', { type: 'simple' });

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.variants.deleteMany).toEqual({});
      });

      it('preserves existing tags when tags are omitted from the autosave', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(draftProduct);
        (prisma.product.update as jest.Mock).mockResolvedValue(draftProduct);

        await service.updateDraft('draft-1', { name: 'No Tags Sent' });

        expect(prisma.productTag.deleteMany).not.toHaveBeenCalled();
      });

      it('clears tag links when tags are explicitly emptied', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(draftProduct);
        (prisma.product.update as jest.Mock).mockResolvedValue(draftProduct);
        (prisma.productTag.findMany as jest.Mock).mockResolvedValue([
          { tagId: 'tag-1' },
        ]);
        (prisma.tag.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

        await service.updateDraft('draft-1', { tags: [] });

        expect(prisma.productTag.deleteMany).toHaveBeenCalledWith({
          where: { productId: 'draft-1' },
        });
        expect(prisma.tag.updateMany).toHaveBeenCalled();
      });

      it('drops DTO-only categoryIds instead of passing them to Prisma', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(draftProduct);
        (prisma.product.update as jest.Mock).mockResolvedValue(draftProduct);

        await service.updateDraft('draft-1', {
          name: 'Categorized Draft',
          categoryIds: ['cat-1', 'cat-2'],
        });

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.categoryIds).toBeUndefined();
        expect(call.data.categoryId).toBe('cat-1');
        expect(call.data.productCategories).toEqual({
          deleteMany: {},
          create: [{ categoryId: 'cat-1' }, { categoryId: 'cat-2' }],
        });
      });

      it('drops variant attribute rows without an attributeValueId', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(draftProduct);
        (prisma.product.update as jest.Mock).mockResolvedValue(draftProduct);

        await service.updateDraft('draft-1', {
          variants: [
            {
              sku: 'V-1',
              price: 100,
              attributeValues: [
                { attributeValueId: 'av-1' },
                { attributeValueId: undefined as any },
              ],
            },
            { sku: 'V-2', price: 150, attributeValues: [] },
          ],
        });

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.variants.create[0].attributeValues).toEqual({
          create: [{ attributeValueId: 'av-1' }],
        });
        expect(call.data.variants.create[1].attributeValues).toBeUndefined();
      });

      it('never stores a no-alphanumeric slug on update (keeps the stored slug)', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(draftProduct);
        (prisma.product.update as jest.Mock).mockResolvedValue(draftProduct);

        await service.updateDraft('draft-1', { slug: '-' });

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.slug).toBeUndefined();
      });

      it('maps post-update media failures to a named error, not a bare 500', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(draftProduct);
        (prisma.product.update as jest.Mock).mockResolvedValue(draftProduct);
        (media.syncEntityImages as jest.Mock).mockRejectedValue({
          code: 'P2003',
          meta: { field_name: 'Product_images_fkey (index)' },
        });

        await expect(
          service.updateDraft('draft-1', { images: ['gone.jpg'] }),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('publishDraft', () => {
      it('activates a complete draft and replaces variants', async () => {
        (prisma.product.findUnique as jest.Mock)
          .mockResolvedValueOnce(draftProduct)
          .mockResolvedValueOnce(null);
        (prisma.product.update as jest.Mock).mockResolvedValue({
          ...draftProduct,
          name: 'Ready Product',
          status: 'active',
          isActive: true,
        });

        const result = await service.publishDraft('draft-1', {
          name: 'Ready Product',
          basePrice: 1200,
          variants: [{ sku: 'V3', price: 500 }],
        });

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.status).toBe('active');
        expect(call.data.isActive).toBe(true);
        expect(call.data.name).toBe('Ready Product');
        expect(call.data.basePrice).toBe(1200);
        expect(call.data.availabilityMode).toBe('MANAGED_STOCK');
        expect(call.data.manageStock).toBe(true);
        expect(call.data.slug).toBe('draft-mock-uui');
        expect(call.data.variants.deleteMany).toEqual({});
        expect(call.data.variants.create[0].sku).toBe('V3');
        expect(result.name).toBe('Ready Product');
      });

      it('keeps the stored slug when the publish payload carries "-"', async () => {
        (prisma.product.findUnique as jest.Mock)
          .mockResolvedValueOnce(draftProduct)
          .mockResolvedValueOnce(null);
        (prisma.product.update as jest.Mock).mockResolvedValue({
          ...draftProduct,
          name: 'Ready Product',
          status: 'active',
          isActive: true,
        });

        await service.publishDraft('draft-1', {
          name: 'Ready Product',
          basePrice: 1200,
          slug: '-',
        });

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.slug).toBe('draft-mock-uui');
      });

      it('regenerates an invalid stored slug from the name on publish', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({
          ...draftProduct,
          slug: '-',
        });
        (prisma.product.update as jest.Mock).mockResolvedValue({
          ...draftProduct,
          name: 'Ready Product',
          status: 'active',
          isActive: true,
        });

        await service.publishDraft('draft-1', {
          name: 'Ready Product',
          basePrice: 1200,
        });

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.slug).toBe('ready-product');
      });

      it('does NOT mirror initial stock when a stocked draft is published (2026-11-11)', async () => {
        (stockRouter.isInventoryManagementEnabled as jest.Mock).mockResolvedValue(
          true,
        );
        (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({
          ...draftProduct,
          availabilityMode: 'MANAGED_STOCK',
          manageStock: true,
          salePrice: null,
        });
        (prisma.product.update as jest.Mock).mockResolvedValue({
          ...draftProduct,
          name: 'Stocked Product',
          status: 'active',
          isActive: true,
          availabilityMode: 'MANAGED_STOCK',
          manageStock: true,
          managedStockQuantity: 12,
          warehouseId: null,
          variants: [],
        });
        (prisma.warehouse.findFirst as jest.Mock).mockResolvedValue({
          id: 'wh-1',
        });

        await service.publishDraft('draft-1', {
          name: 'Stocked Product',
          basePrice: 500,
          availabilityMode: 'MANAGED_STOCK',
          managedStockQuantity: 12,
        });

        expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
        expect(stockService.operatePhysical).not.toHaveBeenCalled();
      });

      it('rejects unnamed drafts', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(
          draftProduct,
        );

        await expect(service.publishDraft('draft-1', {})).rejects.toThrow(
          BadRequestException,
        );
        await expect(
          service.publishDraft('draft-1', { name: 'Untitled Draft' }),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.product.update).not.toHaveBeenCalled();
      });

      it('rejects negative base price', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(
          draftProduct,
        );

        await expect(
          service.publishDraft('draft-1', { name: 'X', basePrice: -5 }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects publishing a non-draft record', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(
          mockProduct,
        );

        await expect(
          service.publishDraft('prod-1', { name: 'X' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects sale price above base price', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({
          ...draftProduct,
          salePrice: null,
        });

        await expect(
          service.publishDraft('draft-1', {
            name: 'X',
            basePrice: 500,
            salePrice: 600,
          }),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.product.update).not.toHaveBeenCalled();
      });

      it('rejects a variable draft with zero variants', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce({
          ...draftProduct,
          type: 'variable',
          salePrice: null,
          basePrice: 100,
        });
        (prisma.productVariant.count as jest.Mock).mockResolvedValue(0);

        await expect(
          service.publishDraft('draft-1', { name: 'Var', basePrice: 100 }),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.product.update).not.toHaveBeenCalled();
      });

      it('rejects a variant SKU already held by another product with a named conflict', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(
          draftProduct,
        );
        (prisma.productVariant.findFirst as jest.Mock).mockResolvedValue({
          sku: 'TAKEN',
        });

        await expect(
          service.publishDraft('draft-1', {
            name: 'X',
            basePrice: 500,
            variants: [{ sku: 'TAKEN', price: 500 }],
          }),
        ).rejects.toThrow(ConflictException);
        expect(prisma.product.update).not.toHaveBeenCalled();
      });
    });

    describe('update() on drafts', () => {
      it('never activates a draft through the generic edit path', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(
          draftProduct,
        );
        (prisma.product.update as jest.Mock).mockResolvedValue({
          ...draftProduct,
          name: 'Edited',
        });

        await service.update('draft-1', { name: 'Edited', isActive: true }, 'tester@ecomate.com');

        const call = (prisma.product.update as jest.Mock).mock.calls[0][0];
        expect(call.data.isActive).toBe(false);
        expect(call.data.status).toBeUndefined();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // PLP scale round — persisted effectivePrice: the pure rule, its
  // maintenance helper, the DB price sorts (offset + keyset cursor),
  // the variant-price maintenance wiring, and the SQL backfill
  // contract that must mirror the JS rule exactly.
  // ─────────────────────────────────────────────────────────────────
  describe('effectivePrice (PLP scale round)', () => {
    describe('computeEffectivePrice', () => {
      it('simple: the sale price wins over the base price', () => {
        expect(
          computeEffectivePrice(
            { type: 'simple', basePrice: 1200, salePrice: 999 },
            [],
          ),
        ).toBe(999);
      });

      it('simple: falls back to the base price without a sale', () => {
        expect(
          computeEffectivePrice(
            { type: 'simple', basePrice: 1200, salePrice: null },
            [],
          ),
        ).toBe(1200);
      });

      it('simple: an explicit zero sale price stays zero (?? not ||)', () => {
        expect(
          computeEffectivePrice(
            { type: 'simple', basePrice: 1200, salePrice: 0 },
            [],
          ),
        ).toBe(0);
      });

      it('variable: minimum over variants, per-variant sale precedence', () => {
        expect(
          computeEffectivePrice(
            { type: 'variable', basePrice: 2000, salePrice: null },
            [
              { price: 900, salePrice: 700 },
              { price: 600, salePrice: null },
              // A variant's sale price REPLACES its price even when
              // higher — the coalesce is not a "cheapest of the two".
              { price: 400, salePrice: 450 },
            ],
          ),
        ).toBe(450);
      });

      it('variable: unpriced variants (null, 0, negative) are ignored', () => {
        expect(
          computeEffectivePrice(
            { type: 'variable', basePrice: 2000, salePrice: null },
            [
              { price: null, salePrice: null },
              { price: 0, salePrice: null },
              { price: -50, salePrice: null },
              { price: 300, salePrice: null },
            ],
          ),
        ).toBe(300);
      });

      it('variable: a variant sale price of 0 makes it unpriced, price notwithstanding', () => {
        expect(
          computeEffectivePrice(
            { type: 'variable', basePrice: 2000, salePrice: null },
            [
              { price: 500, salePrice: 0 },
              { price: 800, salePrice: null },
            ],
          ),
        ).toBe(800);
      });

      it('variable: no priced variant falls back to the product rule', () => {
        expect(
          computeEffectivePrice(
            { type: 'variable', basePrice: 2000, salePrice: 1500 },
            [
              { price: null, salePrice: null },
              { price: 0, salePrice: null },
            ],
          ),
        ).toBe(1500);
      });

      it('variable: no variants at all falls back to the product rule', () => {
        expect(
          computeEffectivePrice(
            { type: 'variable', basePrice: 2000, salePrice: null },
            [],
          ),
        ).toBe(2000);
      });

      it('accepts Decimal-shaped values (Prisma Decimal / strings)', () => {
        expect(
          computeEffectivePrice(
            { type: 'simple', basePrice: '1200.50' as any, salePrice: null },
            [],
          ),
        ).toBe(1200.5);
      });
    });

    describe('syncEffectivePrice', () => {
      it('writes the variable minimum when the stored value drifted', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue({
          id: 'prod-1',
          type: 'variable',
          basePrice: 2000,
          salePrice: null,
          effectivePrice: 999,
        });
        (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([
          { price: 500, salePrice: 450 },
          { price: 700, salePrice: null },
          { price: null, salePrice: null },
          { price: 0, salePrice: null },
        ]);
        (prisma.product.update as jest.Mock).mockResolvedValue({});

        const value = await service.syncEffectivePrice('prod-1');

        expect(value).toBe(450);
        expect(prisma.product.update).toHaveBeenCalledWith({
          where: { id: 'prod-1' },
          data: { effectivePrice: 450 },
        });
      });

      it('writes nothing when the stored value already matches', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue({
          id: 'prod-1',
          type: 'simple',
          basePrice: 1000,
          salePrice: 800,
          effectivePrice: 800,
        });

        const value = await service.syncEffectivePrice('prod-1');

        expect(value).toBe(800);
        expect(prisma.product.update).not.toHaveBeenCalled();
        expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
      });

      it('returns null for a missing product', async () => {
        (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
        await expect(service.syncEffectivePrice('ghost')).resolves.toBeNull();
        expect(prisma.product.update).not.toHaveBeenCalled();
      });
    });

    describe('findAll price sort (offset path)', () => {
      it('orders by the persisted column in Postgres — a single paged read', async () => {
        (prisma.product.findMany as jest.Mock).mockResolvedValue([
          mockProduct,
        ]);
        (prisma.product.count as jest.Mock).mockResolvedValue(1);

        await service.findAll({
          page: 2,
          perPage: 10,
          sort: 'basePrice',
          order: 'asc',
        });

        expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
        const call = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
        expect(call.orderBy).toEqual([
          { effectivePrice: 'asc' },
          { id: 'asc' },
        ]);
        expect(call.skip).toBe(10);
        expect(call.take).toBe(10);
      });

      it('defaults the price direction to desc, tie-break stays id asc', async () => {
        (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.product.count as jest.Mock).mockResolvedValue(0);

        await service.findAll({ sort: 'price' });

        const call = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
        expect(call.orderBy).toEqual([
          { effectivePrice: 'desc' },
          { id: 'asc' },
        ]);
      });
    });

    describe('findAllCursor price sort (keyset)', () => {
      const priceRows = (specs: Array<[string, number]>) =>
        specs.map(([id, price]) => ({
          id,
          slug: id,
          name: id,
          type: 'simple',
          basePrice: price,
          salePrice: null,
          effectivePrice: price,
          images: [],
          variants: [],
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }));

      it('orders by (effectivePrice, id) and encodes the price key in the cursor', async () => {
        (prisma.product.findMany as jest.Mock).mockResolvedValue(
          priceRows([
            ['p-1', 100],
            ['p-2', 250.5],
          ]),
        );
        (prisma.product.count as jest.Mock).mockResolvedValue(2);

        const result = await service.findAllCursor({
          perPage: 2,
          sort: 'basePrice',
          order: 'asc',
        });

        const call = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
        expect(call.orderBy).toEqual([
          { effectivePrice: 'asc' },
          { id: 'asc' },
        ]);
        expect(call.where.AND).toBeUndefined();
        // The cursor payload is `${price}|${id}` — the keyset position.
        expect(
          Buffer.from(result.meta.nextCursor!, 'base64url').toString(),
        ).toBe('250.5|p-2');
      });

      it('applies the desc keyset filter: price below, or equal price with greater id', async () => {
        (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.product.count as jest.Mock).mockResolvedValue(0);
        const cursor = Buffer.from('450.5|p-9', 'utf8').toString(
          'base64url',
        );

        await service.findAllCursor({ cursor, sort: 'price', order: 'desc' });

        const call = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
        expect(call.orderBy).toEqual([
          { effectivePrice: 'desc' },
          { id: 'asc' },
        ]);
        expect(call.where.AND).toEqual([
          {
            OR: [
              { effectivePrice: { lt: 450.5 } },
              { effectivePrice: 450.5, id: { gt: 'p-9' } },
            ],
          },
        ]);
      });

      it('treats a createdAt-shaped cursor as a first page on the price path', async () => {
        (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.product.count as jest.Mock).mockResolvedValue(0);
        const legacy = Buffer.from(
          '2026-01-01T00:00:00.000Z|p-9',
          'utf8',
        ).toString('base64url');

        await service.findAllCursor({
          cursor: legacy,
          sort: 'basePrice',
          order: 'asc',
        });

        const call = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
        expect(call.where.AND).toBeUndefined();
      });

      // Stateful fake: applies the service's OWN emitted keyset filter
      // and orderBy to an in-memory catalogue, the way Postgres would —
      // so a wrong gt/lt or a flipped tie-break shows up here as
      // duplicated or skipped products across pages.
      it('pages a price-sorted catalogue with no duplicates or skips (asc + desc)', async () => {
        const dataset = priceRows([
          ['p-a', 100],
          ['p-b', 200],
          ['p-c', 200],
          ['p-d', 200],
          ['p-e', 350],
          ['p-f', 900],
        ]);
        (prisma.product.count as jest.Mock).mockResolvedValue(dataset.length);
        (prisma.product.findMany as jest.Mock).mockImplementation(
          async (args: any) => {
            let rows = [...dataset];
            const ands: any[] = args.where?.AND ?? [];
            const keyset = ands.find(
              (c: any) =>
                Array.isArray(c.OR) &&
                c.OR.some((o: any) => 'effectivePrice' in o),
            );
            if (keyset) {
              const [range, tie] = keyset.OR;
              rows = rows.filter((r: any) => {
                const p = Number(r.effectivePrice);
                const inRange =
                  range.effectivePrice.gt !== undefined
                    ? p > range.effectivePrice.gt
                    : p < range.effectivePrice.lt;
                const inTie =
                  p === Number(tie.effectivePrice) && r.id > tie.id.gt;
                return inRange || inTie;
              });
            }
            const dir = args.orderBy[0].effectivePrice === 'asc' ? 1 : -1;
            rows.sort((a: any, b: any) => {
              const d = (Number(a.effectivePrice) - Number(b.effectivePrice)) * dir;
              if (d !== 0) return d;
              return a.id < b.id ? -1 : 1; // id ASC tie-break, both ways
            });
            return rows.slice(0, args.take);
          },
        );

        const collect = async (order: 'asc' | 'desc') => {
          const seen: string[] = [];
          let cursor: string | undefined;
          for (let page = 0; page < 10; page++) {
            const res = await service.findAllCursor({
              cursor,
              perPage: 2,
              sort: 'basePrice',
              order,
            });
            seen.push(...res.data.map((p: any) => p.id));
            if (!res.meta.nextCursor) break;
            cursor = res.meta.nextCursor;
          }
          return seen;
        };

        expect(await collect('asc')).toEqual([
          'p-a',
          'p-b',
          'p-c',
          'p-d',
          'p-e',
          'p-f',
        ]);
        expect(await collect('desc')).toEqual([
          'p-f',
          'p-e',
          'p-b',
          'p-c',
          'p-d',
          'p-a',
        ]);
      });
    });

    describe('updateVariant → effectivePrice maintenance', () => {
      it('recomputes the parent sort price from the post-edit variant set', async () => {
        (prisma.productVariant.findUnique as jest.Mock).mockResolvedValue(
          mockVariant,
        );
        (prisma.productVariant.update as jest.Mock).mockResolvedValue({
          ...mockVariant,
          price: 600,
          salePrice: 550,
        });
        (prisma.product.findUnique as jest.Mock).mockResolvedValue({
          id: 'prod-1',
          type: 'variable',
          basePrice: 2000,
          salePrice: null,
          effectivePrice: 800,
        });
        (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([
          { price: 600, salePrice: 550 },
          { price: 900, salePrice: null },
        ]);
        (prisma.product.update as jest.Mock).mockResolvedValue({});

        await service.updateVariant('prod-1', 'variant-1', {
          salePrice: 550,
        });

        expect(prisma.product.update).toHaveBeenCalledWith({
          where: { id: 'prod-1' },
          data: { effectivePrice: 550 },
        });
      });
    });

    describe('migration backfill contract', () => {
      // Executing the SQL needs a database the unit suite does not
      // have; the contract is the load-bearing fragments, cross-checked
      // against the computeEffectivePrice matrix above: same coalesce
      // order (sale before base/price), same > 0 priced-variant gate,
      // same MIN aggregate, same product-rule fallback.
      it('migration SQL mirrors the JS effective-price rule', () => {
        const sql = fs.readFileSync(
          path.resolve(
            __dirname,
            '..',
            '..',
            'prisma',
            'migrations',
            '20261105120000_product_effective_price',
            'migration.sql',
          ),
          'utf8',
        );
        expect(sql).toContain(
          'ADD COLUMN "effectivePrice" DECIMAL(10,2) NOT NULL DEFAULT 0',
        );
        expect(sql).toContain(
          'CREATE INDEX "Product_effectivePrice_id_idx" ON "Product"("effectivePrice", "id")',
        );
        expect(sql).toContain("p.type = 'variable'");
        expect(sql).toContain('MIN(COALESCE(v."salePrice", v.price))');
        expect(sql).toContain('COALESCE(v."salePrice", v.price) > 0');
        expect(sql).toContain('COALESCE(p."salePrice", p."basePrice")');
        // Additive-only deploy safety (migration-safety gate).
        expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i);
      });
    });
  });

  describe('clearManagedStockForModeChange — reservation settlement (Q8 root cause, 2026-11-12)', () => {
    // The mode switch left `reservedStock` and the `managedStockReserved`
    // flags untouched, so a product switching MS→IC with stock 2 /
    // reserved 2 came out 0 / 2 / −2 (Q8 FAIL) and no later order flow
    // could ever release those holds (the router skips the managed leg
    // for IC products). The settlement must release every flagged line
    // and leave `reservedStock` 0 on every counter row.
    const clear = (overrides: any = {}) =>
      (service as any).clearManagedStockForModeChange({
        productId: 'prod-1',
        fromMode: 'MANAGED_STOCK',
        toMode: 'INVENTORY_CONTROLLED',
        performedBy: 'user-1',
        ...overrides,
      });

    const ledgerData = () =>
      (prisma.managedStockLedger.create as jest.Mock).mock.calls.map(
        (c) => c[0].data,
      );
    const releases = () => ledgerData().filter((d) => d.type === 'RELEASE');

    const simpleProduct = (reserved: number, qty = 0) => ({
      type: 'simple',
      managedStockQuantity: qty,
      reservedStock: reserved,
    });

    it('releases live reservations + clears already-deducted flags, ending at reserved 0', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(
        simpleProduct(2),
      );
      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'oi-live',
          variantId: null,
          quantity: 1,
          managedStockDeducted: false,
          order: { id: 'o-pending', displayId: 'ORD-261024-0003' },
        },
        {
          id: 'oi-live-2',
          variantId: null,
          quantity: 1,
          managedStockDeducted: false,
          order: { id: 'o-return', displayId: 'ORD-261022-0008' },
        },
        {
          id: 'oi-deducted',
          variantId: null,
          quantity: 1,
          managedStockDeducted: true,
          order: { id: 'o-delivered', displayId: 'ORD-261024-0002' },
        },
      ]);
      (prisma.orderItemComboComponent.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      await clear();

      // Every flagged line's flag is cleared, deducted or not.
      expect(prisma.orderItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['oi-live', 'oi-live-2', 'oi-deducted'] } },
        data: { managedStockReserved: false },
      });
      // Only the two LIVE units decrement the counter (2 × 1); the
      // deducted unit was already decremented at delivery.
      expect(prisma.product.update).toHaveBeenCalledTimes(2);
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { reservedStock: { decrement: 1 } },
      });
      // One RELEASE entry per flagged line.
      expect(releases()).toHaveLength(3);
      const live = releases().filter((r) => r.quantity === 1);
      expect(live).toHaveLength(2);
      expect(live[0]).toMatchObject({
        direction: 'IN',
        reservedBefore: 2,
        reservedAfter: 1,
        referenceType: 'ORDER',
        referenceId: 'o-pending',
        performedById: 'user-1',
      });
      expect(live[0].note).toContain('ORD-261024-0003');
      expect(live[0].note).toContain('released 1 reserved unit(s)');
      const deducted = releases().find((r) => r.quantity === 0);
      expect(deducted).toMatchObject({
        referenceId: 'o-delivered',
        reservedBefore: 0,
        reservedAfter: 0,
      });
      expect(deducted.note).toContain('already-deducted');
      // No residual sweep: the counter is exactly 0 after the releases.
      expect(
        ledgerData().filter(
          (d) => d.type === 'ADJUSTMENT' && d.note.includes('orphaned'),
        ),
      ).toHaveLength(0);
    });

    it('already-deducted history rows clear their flags with NO counter move', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(
        simpleProduct(0),
      );
      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'oi-d1',
          variantId: null,
          quantity: 1,
          managedStockDeducted: true,
          order: { id: 'o-d1', displayId: 'ORD-261024-0002' },
        },
        {
          id: 'oi-d2',
          variantId: null,
          quantity: 1,
          managedStockDeducted: true,
          order: { id: 'o-d2', displayId: 'ORD-261023-0003' },
        },
      ]);
      (prisma.orderItemComboComponent.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      await clear();

      expect(prisma.orderItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['oi-d1', 'oi-d2'] } },
        data: { managedStockReserved: false },
      });
      // No decrement and no sweep: the counter already sits at 0.
      expect(prisma.product.update).not.toHaveBeenCalled();
      expect(releases()).toHaveLength(2);
      expect(releases().every((r) => r.quantity === 0)).toBe(true);
    });

    it('zero reservations behaves exactly as before (one qty clearing entry, nothing else)', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(
        simpleProduct(0),
      );
      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.orderItemComboComponent.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      await clear();

      expect(prisma.orderItem.updateMany).not.toHaveBeenCalled();
      expect(prisma.orderItemComboComponent.updateMany).not.toHaveBeenCalled();
      expect(prisma.product.update).not.toHaveBeenCalled();
      expect(releases()).toHaveLength(0);
      // Only the pre-existing quantity-0 ADJUSTMENT clearing entry.
      expect(ledgerData()).toHaveLength(1);
      expect(ledgerData()[0]).toMatchObject({
        type: 'ADJUSTMENT',
        quantity: 0,
        stockBefore: 0,
        stockAfter: 0,
      });
    });

    it('variable product: a live reservation releases the VARIANT counter, not the product row', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue({
        type: 'variable',
        managedStockQuantity: 0,
        reservedStock: 0,
      });
      (prisma.productVariant.findMany as jest.Mock).mockResolvedValue([
        { id: 'v-a', managedStockQuantity: 0, reservedStock: 2 },
        { id: 'v-b', managedStockQuantity: 0, reservedStock: 0 },
      ]);
      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'oi-var',
          variantId: 'v-a',
          quantity: 2,
          managedStockDeducted: false,
          order: { id: 'o-var', displayId: 'ORD-261024-0010' },
        },
      ]);
      (prisma.orderItemComboComponent.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      await clear();

      expect(prisma.orderItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['oi-var'] } },
        data: { managedStockReserved: false },
      });
      expect(prisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'v-a' },
        data: { reservedStock: { decrement: 2 } },
      });
      // The product row itself is never touched for a variant hold.
      expect(prisma.product.update).not.toHaveBeenCalled();
      expect(releases()).toHaveLength(1);
      expect(releases()[0]).toMatchObject({
        variantId: 'v-a',
        quantity: 2,
        reservedBefore: 2,
        reservedAfter: 0,
        referenceId: 'o-var',
      });
    });

    it('combo-component lines release the component product counter and clear their flags', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(
        simpleProduct(2),
      );
      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.orderItemComboComponent.findMany as jest.Mock).mockResolvedValue(
        [
          {
            id: 'cc-1',
            variantId: null,
            totalQuantity: 2,
            managedStockDeducted: false,
            orderItem: {
              order: { id: 'o-combo', displayId: 'ORD-261024-0009' },
            },
          },
        ],
      );

      await clear();

      expect(prisma.orderItemComboComponent.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['cc-1'] } },
        data: { managedStockReserved: false },
      });
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { reservedStock: { decrement: 2 } },
      });
      expect(releases()).toHaveLength(1);
      expect(releases()[0]).toMatchObject({
        quantity: 2,
        referenceId: 'o-combo',
      });
      expect(releases()[0].note).toContain('ORD-261024-0009');
    });

    it('orphaned reserved units with no backing line are zeroed by the residual sweep', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(
        simpleProduct(3),
      );
      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.orderItemComboComponent.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      await clear();

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { reservedStock: 0 },
      });
      const sweep = ledgerData().filter(
        (d) => d.type === 'ADJUSTMENT' && d.note.includes('orphaned'),
      );
      expect(sweep).toHaveLength(1);
      expect(sweep[0]).toMatchObject({
        quantity: 3,
        direction: 'IN',
        reservedBefore: 3,
        reservedAfter: 0,
      });
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { CacheService } from '../cache/cache.service';

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

  beforeEach(async () => {
    const prismaMock = {
      $transaction: jest.fn((fn: any) => fn(prismaMock)),
      product: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      productVariant: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
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
    }

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
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    prisma = module.get<PrismaService>(PrismaService);
    media = module.get<MediaService>(MediaService);
    cache = module.get<CacheService>(CacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated products', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);
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

    it('should filter by search term', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ search: 'test', page: 1, perPage: 10 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { name: { contains: 'test', mode: 'insensitive' } },
              { slug: { contains: 'test', mode: 'insensitive' } },
              { sku: { contains: 'test', mode: 'insensitive' } },
            ],
          },
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
      });
      expect(prisma.product.create).toHaveBeenCalled();
      expect(media.syncEntityImages).toHaveBeenCalledWith(
        'product',
        'prod-1',
        createDto.images,
      );
      expect(result).toEqual(mockProduct);
    });

    it('should throw ConflictException if slug already exists', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(mockProduct);

      await expect(service.create(createDto)).rejects.toThrow(
        ConflictException,
      );
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
});

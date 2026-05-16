import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: PrismaService,
          useValue: {
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
          },
        },
        {
          provide: MediaService,
          useValue: {
            attach: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    prisma = module.get<PrismaService>(PrismaService);
    media = module.get<MediaService>(MediaService);
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
          where: { categoryId: 'cat-1', type: 'simple', isActive: true },
        }),
      );
    });

    it('should use default page values when not provided', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({});

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
    });

    it('should calculate total pages correctly', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([mockProduct]);
      (prisma.product.count as jest.Mock).mockResolvedValue(25);

      const result = await service.findAll({ page: 1, perPage: 10 });

      expect(result.meta.totalPages).toBe(3);
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
      (prisma.media.findFirst as jest.Mock).mockResolvedValue({
        id: 'media-1',
        filename: 'img-new.jpg',
      });

      const result = await service.create(createDto);

      expect(prisma.product.findUnique).toHaveBeenCalledWith({
        where: { slug: 'new-product' },
      });
      expect(prisma.product.create).toHaveBeenCalled();
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
      (prisma.media.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.create(dtoWithVariants);

      const createCall = (prisma.product.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.variants.create).toBeDefined();
      expect(createCall.data.variants.create[0].sku).toBe('SKU-NEW-RED');
      expect(result.variants).toHaveLength(1);
    });

    it('should attach media when images are provided and media found', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.product.create as jest.Mock).mockResolvedValue(mockProduct);
      (prisma.media.findFirst as jest.Mock).mockResolvedValue({
        id: 'media-1',
        filename: 'img-new.jpg',
      });
      (media.attach as jest.Mock).mockResolvedValue(undefined);

      await service.create(createDto);

      expect(prisma.media.findFirst).toHaveBeenCalledWith({
        where: { filename: 'img-new.jpg' },
      });
      expect(media.attach).toHaveBeenCalledWith('media-1', 'product', 'prod-1');
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
      (prisma.media.findFirst as jest.Mock).mockResolvedValue(null);

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

    it('should attach new media when images are provided', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValueOnce(
        mockProduct,
      );
      (prisma.product.update as jest.Mock).mockResolvedValue(mockProduct);
      (prisma.media.findFirst as jest.Mock).mockResolvedValue({
        id: 'media-2',
        filename: 'new-image.jpg',
      });
      (media.attach as jest.Mock).mockResolvedValue(undefined);

      await service.update('prod-1', {
        images: ['https://cdn.example.com/new-image.jpg'],
      });

      expect(media.attach).toHaveBeenCalledWith('media-2', 'product', 'prod-1');
    });
  });

  describe('remove', () => {
    it('should delete a product successfully', async () => {
      (prisma.product.findUniqueOrThrow as jest.Mock).mockResolvedValue(
        mockProduct,
      );
      (prisma.product.delete as jest.Mock).mockResolvedValue(mockProduct);

      const result = await service.remove('prod-1');

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
        data: { type: 'variable' },
      });
    });
  });
});

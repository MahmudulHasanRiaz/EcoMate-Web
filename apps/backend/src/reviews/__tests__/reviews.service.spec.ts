import { Test, TestingModule } from '@nestjs/testing';
import { ReviewsService } from '../reviews.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ReviewsService (mobile)', () => {
  let svc: ReviewsService;
  let prisma: {
    product: { findUnique: jest.Mock };
    review: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn() },
      review: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = module.get<ReviewsService>(ReviewsService);
  });

  it('normalizes mobile and stores it on create', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.review.findFirst.mockResolvedValue(null);
    prisma.review.create.mockResolvedValue({ id: 'r1' });

    await svc.create({ productId: 'p1', mobile: '01712345678' });

    expect(prisma.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mobile: '+8801712345678' }),
    });
  });

  it('rejects invalid mobile with the BD message', async () => {
    await expect(
      svc.create({ productId: 'p1', mobile: 'abc' }),
    ).rejects.toThrow('Please enter a valid Bangladeshi mobile number.');
    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  it('defaults missing name to Verified Buyer and missing rating to null (never an inflated 5)', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.review.findFirst.mockResolvedValue(null);
    prisma.review.create.mockResolvedValue({ id: 'r1' });

    await svc.create({ productId: 'p1', mobile: '+8801712345678' });

    expect(prisma.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerName: 'Verified Buyer',
        rating: null,
      }),
    });
  });

  it('stores a provided rating and rejects out-of-range ratings', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.review.findFirst.mockResolvedValue(null);
    prisma.review.create.mockResolvedValue({ id: 'r1' });

    await svc.create({ productId: 'p1', mobile: '+8801712345678', rating: 4 });
    expect(prisma.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ rating: 4 }),
    });

    await expect(
      svc.create({ productId: 'p1', mobile: '+8801712345678', rating: 6 }),
    ).rejects.toThrow('Rating must be between 1 and 5');
    await expect(
      svc.create({ productId: 'p1', mobile: '+8801712345678', rating: 0 }),
    ).rejects.toThrow('Rating must be between 1 and 5');
  });

  it('throws already-reviewed on duplicate mobile for the same product', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.review.findFirst.mockResolvedValue({ id: 'r0' });

    await expect(
      svc.create({ productId: 'p1', mobile: '01712345678' }),
    ).rejects.toThrow('You have already reviewed this product');
  });

  it('public findByProductSlug never selects mobile', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.review.findMany.mockResolvedValue([]);
    prisma.review.count.mockResolvedValue(0);

    await svc.findByProductSlug('some-slug');

    const findManyArg = prisma.review.findMany.mock.calls[0][0];
    expect(findManyArg.select).toBeDefined();
    expect(findManyArg.select).not.toHaveProperty('mobile');
  });
});

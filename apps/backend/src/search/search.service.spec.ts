import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SearchService', () => {
  let service: SearchService;
  let prisma: { $queryRawUnsafe: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRawUnsafe: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty results when nothing matches', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);

    const result = await service.search('zzz_no_match');

    expect(result).toEqual({ orders: [], products: [], customers: [] });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(3);
  });

  it('searches all three entity types', async () => {
    const mockOrder = {
      id: '1',
      displayId: 'ORD-1',
      total: 100,
      status: 'Pending',
      customerName: 'Test',
      phone: null,
    };
    const mockProduct = {
      id: '2',
      name: 'Test Product',
      sku: 'TP-1',
      price: 50,
    };
    const mockCustomer = {
      id: '3',
      name: 'Test User',
      phone: '017...',
      email: 't@t.com',
    };

    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([mockOrder])
      .mockResolvedValueOnce([mockProduct])
      .mockResolvedValueOnce([mockCustomer]);

    const result = await service.search('test');

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(3);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].displayId).toBe('ORD-1');
    expect(result.products).toHaveLength(1);
    expect(result.products[0].name).toBe('Test Product');
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0].name).toBe('Test User');
  });

  it('returns partial results if only some entities match', async () => {
    const mockOrder = {
      id: '1',
      displayId: 'ORD-1',
      total: 100,
      status: 'Pending',
      customerName: 'Test',
      phone: null,
    };

    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([mockOrder])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.search('ORD');

    expect(result.orders).toHaveLength(1);
    expect(result.products).toHaveLength(0);
    expect(result.customers).toHaveLength(0);
  });
});

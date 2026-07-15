import { Test, TestingModule } from '@nestjs/testing';
import { DispatchService } from './dispatch.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { StockRouterService } from '../stock/stock-router.service';

describe('DispatchService', () => {
  let service: DispatchService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      dispatch: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'd-1',
          courier: 'pathao',
          consignmentId: 'CG-001',
        }),
        update: jest.fn().mockResolvedValue({ id: 'd-1' }),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StockService,
          useValue: {
            operate: jest.fn().mockResolvedValue([]),
            deduct: jest.fn().mockResolvedValue(undefined),
            fulfillPhysicalReservation: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StockRouterService,
          useValue: {
            isInventoryManagementEnabled: jest.fn().mockResolvedValue(false),
            resolve: jest.fn().mockReturnValue({ ms: 'skip', pi: 'skip' }),
          },
        },
      ],
    }).compile();

    service = module.get<DispatchService>(DispatchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return dispatches list', async () => {
    const result = await service.findAll({});
    expect(result).toEqual([]);
    expect(prisma.dispatch.findMany).toHaveBeenCalled();
  });

  it('should throw on not found', async () => {
    await expect(service.findOne('nonexistent')).rejects.toThrow();
  });
});

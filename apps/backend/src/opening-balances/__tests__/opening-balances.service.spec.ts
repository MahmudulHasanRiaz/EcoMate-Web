import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { OpeningBalancesService } from '../opening-balances.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('OpeningBalancesService', () => {
  let service: OpeningBalancesService;
  let prisma: PrismaService;

  const mockBalance = {
    id: 'ob-1',
    accountId: 'acc-1',
    periodId: 'fp-1',
    debit: 100000,
    credit: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpeningBalancesService,
        {
          provide: PrismaService,
          useValue: {
            openingBalance: {
              findMany: jest.fn().mockResolvedValue([mockBalance]),
              findUnique: jest.fn().mockResolvedValue(mockBalance),
              upsert: jest.fn().mockResolvedValue(mockBalance),
            },
            account: {
              findUnique: jest.fn().mockResolvedValue({ id: 'acc-1', name: 'Cash' }),
            },
            financialPeriod: {
              findUnique: jest.fn().mockResolvedValue({ id: 'fp-1', isClosed: false }),
            },
          },
        },
      ],
    }).compile();

    service = module.get<OpeningBalancesService>(OpeningBalancesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => { expect(service).toBeDefined(); });

  describe('setBalance', () => {
    it('should set opening balance for account in period', async () => {
      const result = await service.setBalance({ accountId: 'acc-1', periodId: 'fp-1', debit: 100000, credit: 0 });
      expect(result).toEqual(mockBalance);
    });

    it('should throw if account not found', async () => {
      jest.spyOn(prisma.account, 'findUnique').mockResolvedValue(null);
      await expect(service.setBalance({ accountId: 'invalid', periodId: 'fp-1', debit: 0, credit: 0 }))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw if period is closed', async () => {
      jest.spyOn(prisma.financialPeriod, 'findUnique').mockResolvedValue({ id: 'fp-1', isClosed: true });
      await expect(service.setBalance({ accountId: 'acc-1', periodId: 'fp-1', debit: 100000, credit: 0 }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('getBalances', () => {
    it('should return all opening balances for a period', async () => {
      const result = await service.getBalances('fp-1');
      expect(result).toHaveLength(1);
    });
  });
});

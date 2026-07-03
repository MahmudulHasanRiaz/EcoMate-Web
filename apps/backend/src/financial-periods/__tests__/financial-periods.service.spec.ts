import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FinancialPeriodsService } from '../financial-periods.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('FinancialPeriodsService', () => {
  let service: FinancialPeriodsService;
  let prisma: PrismaService;

  const mockPeriod = {
    id: 'fp-1',
    name: 'July 2026',
    startDate: new Date('2026-07-01'),
    endDate: new Date('2026-07-31'),
    isClosed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const prismaMock = {
      financialPeriod: {
        findMany: jest.fn().mockResolvedValue([mockPeriod]),
        findUnique: jest.fn().mockResolvedValue(mockPeriod),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(mockPeriod),
        update: jest
          .fn()
          .mockResolvedValue({ ...mockPeriod, isClosed: true }),
      },
      journalEntry: {
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn((cb) => cb(prismaMock)),
    } as unknown as PrismaService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialPeriodsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<FinancialPeriodsService>(FinancialPeriodsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a period', async () => {
      const result = await service.create({
        name: 'July 2026',
        startDate: new Date('2026-07-01'),
        endDate: new Date('2026-07-31'),
      });
      expect(result).toEqual(mockPeriod);
    });

    it('should throw on overlapping dates', async () => {
      jest
        .spyOn(prisma.financialPeriod, 'findFirst')
        .mockResolvedValue(mockPeriod);
      await expect(
        service.create({
          name: 'July 2026',
          startDate: new Date('2026-07-01'),
          endDate: new Date('2026-07-31'),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw if startDate > endDate', async () => {
      await expect(
        service.create({
          name: 'Invalid',
          startDate: new Date('2026-08-01'),
          endDate: new Date('2026-07-01'),
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('should return all periods ordered by startDate desc', async () => {
      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(prisma.financialPeriod.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { startDate: 'desc' } }),
      );
    });
  });

  describe('closePeriod', () => {
    it('should close an open period with entries', async () => {
      jest
        .spyOn(prisma.journalEntry, 'count')
        .mockResolvedValue(1);
      const result = await service.closePeriod('fp-1');
      expect(result.isClosed).toBe(true);
    });

    it('should throw if period not found', async () => {
      jest.spyOn(prisma.financialPeriod, 'findUnique').mockResolvedValue(null);
      await expect(service.closePeriod('invalid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw if already closed', async () => {
      jest
        .spyOn(prisma.financialPeriod, 'findUnique')
        .mockResolvedValue({ ...mockPeriod, isClosed: true });
      await expect(service.closePeriod('fp-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw if period has no journal entries', async () => {
      jest
        .spyOn(prisma.journalEntry, 'count')
        .mockResolvedValue(0);
      await expect(service.closePeriod('fp-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('openPeriod', () => {
    it('should reopen a closed period', async () => {
      jest
        .spyOn(prisma.financialPeriod, 'findUnique')
        .mockResolvedValue({ ...mockPeriod, isClosed: true });
      jest
        .spyOn(prisma.financialPeriod, 'update')
        .mockResolvedValue(mockPeriod);
      const result = await service.openPeriod('fp-1');
      expect(result.isClosed).toBe(false);
    });
  });
});

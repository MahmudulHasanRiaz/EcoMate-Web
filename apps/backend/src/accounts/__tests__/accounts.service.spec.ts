import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccountsService } from '../accounts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAccountDto } from '../dto/create-account.dto';

describe('AccountsService', () => {
  let service: AccountsService;
  let prisma: PrismaService;

  const mockAccount = {
    id: 'acc-1',
    code: '1-1000',
    name: 'Cash',
    type: 'asset',
    parentId: null,
    description: null,
    isActive: true,
    isGroup: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    children: [],
  };

  const mockParentAccount = {
    id: 'acc-parent',
    code: '1-0000',
    name: 'Current Assets',
    type: 'asset',
    parentId: null,
    description: null,
    isActive: true,
    isGroup: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    children: [mockAccount],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        {
          provide: PrismaService,
          useValue: {
            account: {
              findMany: jest.fn().mockResolvedValue([mockAccount]),
              findUnique: jest.fn().mockImplementation(({ where }: any) => {
                if (where.id === 'acc-1') return Promise.resolve(mockAccount);
                if (where.id === 'acc-parent') return Promise.resolve(mockParentAccount);
                return Promise.resolve(null);
              }),
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue(mockAccount),
              update: jest.fn().mockResolvedValue(mockAccount),
              delete: jest.fn().mockResolvedValue(mockAccount),
              count: jest.fn().mockResolvedValue(1),
            },
          },
        },
      ],
    }).compile();

    service = module.get<AccountsService>(AccountsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create an account', async () => {
      const dto: CreateAccountDto = { code: '1-1000', name: 'Cash', type: 'asset' };
      const result = await service.create(dto);
      expect(result).toEqual(mockAccount);
    });

    it('should throw on duplicate code', async () => {
      jest.spyOn(prisma.account, 'findUnique').mockResolvedValue(mockAccount);
      const dto: CreateAccountDto = { code: '1-1000', name: 'Cash', type: 'asset' };
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('should throw if parent not found', async () => {
      jest.spyOn(prisma.account, 'findUnique').mockResolvedValue(null);
      const dto: CreateAccountDto = { code: '1-1001', name: 'Petty Cash', type: 'asset', parentId: 'nonexistent' };
      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });

    it('should create leaf account under a group parent', async () => {
      jest.spyOn(prisma.account, 'findUnique').mockImplementation(async ({ where }: any) => {
        if (where.id === 'acc-parent') return Promise.resolve(mockParentAccount);
        return Promise.resolve(null);
      });
      jest.spyOn(prisma.account, 'findFirst').mockResolvedValue(null);
      const dto: CreateAccountDto = { code: '1-1001', name: 'Petty Cash', type: 'asset', parentId: 'acc-parent' };
      const result = await service.create(dto);
      expect(result).toEqual(mockAccount);
    });
  });

  describe('findAll', () => {
    it('should return all accounts grouped by type', async () => {
      const result = await service.findAll();
      expect(result).toBeDefined();
    });

    it('should filter by type', async () => {
      const result = await service.findAll('asset');
      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ type: 'asset' }) }),
      );
    });
  });

  describe('findOne', () => {
    it('should return account with children', async () => {
      const result = await service.findOne('acc-1');
      expect(result).toEqual(mockAccount);
    });

    it('should throw if not found', async () => {
      jest.spyOn(prisma.account, 'findUnique').mockResolvedValue(null);
      await expect(service.findOne('invalid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update account', async () => {
      const result = await service.update('acc-1', { name: 'Petty Cash' });
      expect(result).toEqual(mockAccount);
    });
  });

  describe('remove', () => {
    it('should throw if account has children', async () => {
      jest.spyOn(prisma.account, 'findUnique').mockResolvedValue(mockParentAccount);
      await expect(service.remove('acc-parent')).rejects.toThrow(BadRequestException);
    });

    it('should delete leaf account', async () => {
      const result = await service.remove('acc-1');
      expect(result).toEqual(mockAccount);
    });

    it('should throw if not found', async () => {
      jest.spyOn(prisma.account, 'findUnique').mockResolvedValue(null);
      await expect(service.remove('invalid')).rejects.toThrow(NotFoundException);
    });
  });
});

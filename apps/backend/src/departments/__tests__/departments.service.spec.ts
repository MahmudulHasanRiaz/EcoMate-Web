import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { DepartmentsService } from '../departments.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DepartmentsService', () => {
  let service: DepartmentsService;
  let prisma: PrismaService;

  const mockDepartment = {
    id: 'dept-1',
    name: 'Engineering',
    slug: 'engineering',
    description: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const prismaMock = {
      department: {
        findMany: jest.fn().mockResolvedValue([mockDepartment]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(mockDepartment),
        update: jest.fn().mockResolvedValue({
          ...mockDepartment,
          name: 'Sales',
          slug: 'sales',
        }),
        delete: jest.fn().mockResolvedValue(mockDepartment),
        count: jest.fn().mockResolvedValue(0),
      },
      employee: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<DepartmentsService>(DepartmentsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a department with slugified name', async () => {
      const result = await service.create({
        name: 'Engineering',
        description: 'Builds products',
      });
      expect(result).toEqual(mockDepartment);
      expect(prisma.department.create).toHaveBeenCalledWith({
        data: {
          name: 'Engineering',
          slug: 'engineering',
          description: 'Builds products',
          isActive: true,
        },
      });
    });

    it('should throw on duplicate name', async () => {
      (prisma.department.findUnique as jest.Mock).mockResolvedValue(
        mockDepartment,
      );
      await expect(service.create({ name: 'Engineering' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('converts a concurrent P2002/slug-collision race into 409', async () => {
      (prisma.department.create as jest.Mock).mockRejectedValue({
        code: 'P2002',
        meta: { target: ['slug'] },
      });
      await expect(service.create({ name: 'Sales' })).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create({ name: 'Sales' })).rejects.toThrow(
        /name already exists/i,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated departments', async () => {
      (prisma.department.count as jest.Mock).mockResolvedValue(1);
      const result = await service.findAll(1, 10);
      expect(prisma.department.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
      expect(result).toEqual({
        data: [mockDepartment],
        meta: { total: 1, page: 1, perPage: 10, totalPages: 1 },
      });
    });

    it('should filter by isActive when provided', async () => {
      await service.findAll(1, 10, true);
      expect(prisma.department.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
      expect(prisma.department.count).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });
  });

  describe('findOne', () => {
    it('should return a department', async () => {
      (prisma.department.findUnique as jest.Mock).mockResolvedValue(
        mockDepartment,
      );
      const result = await service.findOne('dept-1');
      expect(result).toEqual(mockDepartment);
    });

    it('should throw if not found', async () => {
      await expect(service.findOne('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should re-slug when name changes', async () => {
      (prisma.department.findUnique as jest.Mock).mockResolvedValue(
        mockDepartment,
      );
      await service.update('dept-1', { name: 'Sales' });
      expect(prisma.department.update).toHaveBeenCalledWith({
        where: { id: 'dept-1' },
        data: { name: 'Sales', slug: 'sales' },
      });
    });

    it('should throw on duplicate name from another department', async () => {
      (prisma.department.findUnique as jest.Mock).mockResolvedValue({
        ...mockDepartment,
        id: 'dept-2',
        name: 'Sales',
      });
      await expect(
        service.update('dept-1', { name: 'Sales' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow keeping the same name', async () => {
      (prisma.department.findUnique as jest.Mock).mockResolvedValue(
        mockDepartment,
      );
      await service.update('dept-1', { name: 'Engineering' });
      expect(prisma.department.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should delete a department with no employees', async () => {
      (prisma.department.findUnique as jest.Mock).mockResolvedValue(
        mockDepartment,
      );
      (prisma.employee.count as jest.Mock).mockResolvedValue(0);
      const result = await service.remove('dept-1');
      expect(result).toEqual({ message: 'Deleted' });
      expect(prisma.department.delete).toHaveBeenCalledWith({
        where: { id: 'dept-1' },
      });
    });

    it('should throw when employees are assigned', async () => {
      (prisma.department.findUnique as jest.Mock).mockResolvedValue(
        mockDepartment,
      );
      (prisma.employee.count as jest.Mock).mockResolvedValue(3);
      await expect(service.remove('dept-1')).rejects.toThrow(ConflictException);
    });
  });
});
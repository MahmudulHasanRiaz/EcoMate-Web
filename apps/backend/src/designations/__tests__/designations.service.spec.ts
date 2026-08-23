import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { DesignationsService } from '../designations.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DesignationsService', () => {
  let service: DesignationsService;
  let prisma: PrismaService;

  const mockDesignation = {
    id: 'desig-1',
    name: 'Developer',
    slug: 'developer',
    level: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const prismaMock = {
      designation: {
        findMany: jest.fn().mockResolvedValue([mockDesignation]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(mockDesignation),
        update: jest.fn().mockResolvedValue({
          ...mockDesignation,
          name: 'Senior Developer',
          slug: 'senior-developer',
        }),
        delete: jest.fn().mockResolvedValue(mockDesignation),
      },
      employee: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DesignationsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<DesignationsService>(DesignationsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create designation with slugified name', async () => {
      const result = await service.create({ name: 'Developer', level: 1 });
      expect(result).toEqual(mockDesignation);
      expect(prisma.designation.create).toHaveBeenCalledWith({
        data: {
          name: 'Developer',
          slug: 'developer',
          level: 1,
        },
      });
    });

    it('should throw on duplicate name', async () => {
      (prisma.designation.findUnique as jest.Mock).mockResolvedValue(
        mockDesignation,
      );
      await expect(service.create({ name: 'Developer' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('converts a concurrent P2002/slug-collision race into 409', async () => {
      (prisma.designation.create as jest.Mock).mockRejectedValue({
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

  describe('findOne', () => {
    it('should return a designation', async () => {
      (prisma.designation.findUnique as jest.Mock).mockResolvedValue(
        mockDesignation,
      );
      expect(await service.findOne('desig-1')).toEqual(mockDesignation);
    });

    it('should throw if not found', async () => {
      await expect(service.findOne('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should re-slug when name changes', async () => {
      (prisma.designation.findUnique as jest.Mock).mockResolvedValue(
        mockDesignation,
      );
      await service.update('desig-1', { name: 'Senior Developer' });
      expect(prisma.designation.update).toHaveBeenCalledWith({
        where: { id: 'desig-1' },
        data: { name: 'Senior Developer', slug: 'senior-developer' },
      });
    });

    it('converts a concurrent P2002 race into 409 on update', async () => {
      (prisma.designation.findUnique as jest.Mock).mockResolvedValue(
        mockDesignation,
      );
      (prisma.designation.update as jest.Mock).mockRejectedValue({
        code: 'P2002',
        meta: { target: ['slug'] },
      });
      await expect(
        service.update('desig-1', { name: 'Sales' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('should delete a designation with no employees', async () => {
      (prisma.designation.findUnique as jest.Mock).mockResolvedValue(
        mockDesignation,
      );
      const result = await service.remove('desig-1');
      expect(result).toEqual({ message: 'Deleted' });
      expect(prisma.designation.delete).toHaveBeenCalledWith({
        where: { id: 'desig-1' },
      });
    });

    it('should throw when employees are assigned', async () => {
      (prisma.designation.findUnique as jest.Mock).mockResolvedValue(
        mockDesignation,
      );
      (prisma.employee.count as jest.Mock).mockResolvedValue(3);
      await expect(service.remove('desig-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
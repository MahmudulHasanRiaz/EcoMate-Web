jest.mock('../../better-auth/prisma', () => ({
  baPrisma: {
    betterAuthUser: {
      findUnique: jest.fn().mockResolvedValue({ id: 'ba-user-test', name: 'John Doe' }),
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { EmployeeStatus, EmploymentType } from '@prisma/client';
import { EmployeesService } from '../employees.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto } from '../dto/create-employee.dto';

describe('EmployeesService', () => {
  let service: EmployeesService;
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
  const mockDesignation = {
    id: 'desig-1',
    name: 'Developer',
    slug: 'developer',
    level: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockEmployee = {
    id: 'emp-1',
    userId: null,
    employeeId: 'EMP-250624-0001',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+8801711111111',
    departmentId: 'dept-1',
    designationId: 'desig-1',
    employmentType: EmploymentType.full_time,
    status: EmployeeStatus.active,
    joiningDate: new Date('2025-01-15'),
    exitDate: null,
    salary: '50000',
    bankAccountNo: null,
    bankName: null,
    address: null,
    city: null,
    emergencyContact: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    department: mockDepartment,
    designation: mockDesignation,
  };

  beforeEach(async () => {
    const prismaMock = {
      employee: {
        findMany: jest.fn().mockResolvedValue([mockEmployee]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue(mockEmployee),
        update: jest.fn().mockResolvedValue(mockEmployee),
        delete: jest.fn().mockResolvedValue(mockEmployee),
        count: jest.fn().mockResolvedValue(1),
      },
      department: {
        findUnique: jest.fn().mockResolvedValue(mockDepartment),
      },
      designation: {
        findUnique: jest.fn().mockResolvedValue(mockDesignation),
      },
      orderCounter: {
        upsert: jest.fn().mockResolvedValue({ date: '250624', seq: 1 }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(
      async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<EmployeesService>(EmployeesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create an employee', async () => {
      const dto: CreateEmployeeDto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
        departmentId: 'dept-1',
        designationId: 'desig-1',
        employmentType: 'full_time',
      };
      const result = await service.create(dto);
      expect(result).toEqual(mockEmployee);
      expect(prisma.employee.create).toHaveBeenCalled();
    });

    it('should throw if department not found', async () => {
      jest.spyOn(prisma.department, 'findUnique').mockResolvedValue(null);
      const dto: CreateEmployeeDto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
        departmentId: 'invalid',
      };
      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw if user is already an employee', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      const dto: CreateEmployeeDto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
      };
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return paginated employees', async () => {
      const result = await service.findAll(1, 10);
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('should return an employee', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      const result = await service.findOne('emp-1');
      expect(result).toEqual(mockEmployee);
    });

    it('should throw if not found', async () => {
      await expect(service.findOne('invalid')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update an employee', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      const result = await service.update('emp-1', { departmentId: 'dept-2' });
      expect(result).toEqual(mockEmployee);
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'emp-1' } }),
      );
    });

    it('should throw if employee not found', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.update('nonexistent', { bankName: 'Test Bank' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete an employee', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      const result = await service.remove('emp-1');
      expect(result).toEqual(mockEmployee);
      expect(prisma.employee.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'emp-1' } }),
      );
    });
  });
});

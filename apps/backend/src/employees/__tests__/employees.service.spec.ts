jest.mock('../../better-auth/prisma', () => ({
  baPrisma: {
    betterAuthUser: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'ba-user-test', name: 'John Doe' }),
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { EmployeeStatus, EmploymentType } from '@prisma/client';
import { EmployeesService } from '../employees.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto } from '../dto/create-employee.dto';
import { baPrisma } from '../../better-auth/prisma';

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
    betterAuthUserId: 'ba-user-test',
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
      accessPreset: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'preset-1',
          name: 'Staff',
        }),
      },
      employmentHistory: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'profile-1', role: 'customer' }),
        update: jest.fn().mockResolvedValue({}),
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

    it('should promote customer profile to employee role on create', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        id: 'profile-1',
        role: 'customer',
      });
      const dto: CreateEmployeeDto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
      };
      await service.create(dto);
      expect(prisma.userProfile.update).toHaveBeenCalledWith({
        where: { id: 'profile-1' },
        data: { role: 'employee' },
      });
    });

    it('should not downgrade manager profile on create', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        id: 'profile-1',
        role: 'manager',
      });
      const dto: CreateEmployeeDto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
      };
      await service.create(dto);
      expect(prisma.userProfile.update).not.toHaveBeenCalled();
    });

    it('should not change admin profile on create', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        id: 'profile-1',
        role: 'admin',
      });
      const dto: CreateEmployeeDto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
      };
      await service.create(dto);
      expect(prisma.userProfile.update).not.toHaveBeenCalled();
    });

    it('should not promote already-employee profile on create', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        id: 'profile-1',
        role: 'employee',
      });
      const dto: CreateEmployeeDto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
      };
      await service.create(dto);
      expect(prisma.userProfile.update).not.toHaveBeenCalled();
    });

    it('should persist status and exitDate on create when provided', async () => {
      const dto: CreateEmployeeDto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
        status: 'inactive',
        exitDate: '2025-06-01',
      };
      await service.create(dto);
      expect(prisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'inactive',
            exitDate: expect.any(Date),
          }),
        }),
      );
    });

    it('should accept reportingToId on create', async () => {
      const dto: CreateEmployeeDto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
        reportingToId: 'emp-9',
      };
      (prisma.employee.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'emp-9', employeeId: 'EMP-250624-0009' });
      await service.create(dto);
      expect(prisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reportingToId: 'emp-9' }),
        }),
      );
    });

    it('should throw when reporting manager does not exist on create', async () => {
      const dto: CreateEmployeeDto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
        reportingToId: 'ghost',
      };
      (prisma.employee.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
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

    it('should persist status on update', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.update('emp-1', { status: 'inactive' });
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'inactive' }),
        }),
      );
    });

    it('should persist exitDate on update', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.update('emp-1', { exitDate: '2025-06-01' });
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ exitDate: expect.any(Date) }),
        }),
      );
    });

    it('should allow active→inactive transition', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.update('emp-1', { status: 'inactive' });
      expect(prisma.employee.update).toHaveBeenCalled();
    });

    it('should allow inactive→active transition', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue({
        ...mockEmployee,
        status: EmployeeStatus.inactive,
      });
      await service.update('emp-1', { status: 'active' });
      expect(prisma.employee.update).toHaveBeenCalled();
    });

    it('should allow active→on_leave transition', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.update('emp-1', { status: 'on_leave' });
      expect(prisma.employee.update).toHaveBeenCalled();
    });

    it('should allow on_leave→suspended transition', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue({
        ...mockEmployee,
        status: EmployeeStatus.on_leave,
      });
      await service.update('emp-1', { status: 'suspended' });
      expect(prisma.employee.update).toHaveBeenCalled();
    });

    it('should allow suspended→active transition', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue({
        ...mockEmployee,
        status: EmployeeStatus.suspended,
      });
      await service.update('emp-1', { status: 'active' });
      expect(prisma.employee.update).toHaveBeenCalled();
    });

    it('should block inactive→on_leave→terminated chain from suspended', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue({
        ...mockEmployee,
        status: EmployeeStatus.suspended,
      });
      await expect(
        service.update('emp-1', { status: 'terminated' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow active→terminated when exitDate is provided', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.update('emp-1', {
        status: 'terminated',
        exitDate: '2025-06-01',
      });
      expect(prisma.employee.update).toHaveBeenCalled();
    });

    it('should allow active→resigned when exitDate is provided', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.update('emp-1', {
        status: 'resigned',
        exitDate: '2025-06-01',
      });
      expect(prisma.employee.update).toHaveBeenCalled();
    });

    it('should skip transition check when status is unchanged', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.update('emp-1', { status: 'active' });
      expect(prisma.employee.update).toHaveBeenCalled();
    });

    it('should throw on invalid transition from terminated', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue({
        ...mockEmployee,
        status: EmployeeStatus.terminated,
      });
      await expect(
        service.update('emp-1', { status: 'active' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw on invalid transition from resigned', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue({
        ...mockEmployee,
        status: EmployeeStatus.resigned,
      });
      await expect(
        service.update('emp-1', { status: 'inactive' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when terminated without exitDate', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await expect(
        service.update('emp-1', { status: 'terminated' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when resigned without exitDate', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await expect(
        service.update('emp-1', { status: 'resigned' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when department is not found', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      (prisma.department.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.update('emp-1', { departmentId: 'unknown-dept' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw when designation is not found', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      (prisma.designation.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.update('emp-1', { designationId: 'unknown-desig' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw when access preset is not found', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      (prisma.accessPreset.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.update('emp-1', { accessPresetId: 'unknown-preset' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should write employment history when status changes', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.update('emp-1', { status: 'inactive' });
      expect(prisma.employmentHistory.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              field: 'status',
              oldValue: 'active',
              newValue: 'inactive',
              changedById: null,
            }),
          ]),
        }),
      );
    });

    it('should record actor as changedById on history rows', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.update('emp-1', { status: 'inactive' }, 'actor-42');
      expect(prisma.employmentHistory.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ changedById: 'actor-42' }),
          ]),
        }),
      );
    });

    it('should not write employment history when nothing relevant changes', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.update('emp-1', { bankName: 'Test Bank' });
      expect(prisma.employmentHistory.createMany).not.toHaveBeenCalled();
    });

    it('should not write employment history on same-status update', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.update('emp-1', { status: 'active' });
      expect(prisma.employmentHistory.createMany).not.toHaveBeenCalled();
    });

    it('should write department history with resolved names', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      (prisma.department.findUnique as jest.Mock).mockResolvedValue({
        id: 'dept-2',
        name: 'Support',
        slug: 'support',
      });
      await service.update('emp-1', { departmentId: 'dept-2' });
      expect(prisma.employmentHistory.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              field: 'department',
              oldValue: 'Engineering',
              newValue: 'Support',
            }),
          ]),
        }),
      );
    });

    it('should write designation history with resolved names', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      (prisma.designation.findUnique as jest.Mock).mockResolvedValue({
        id: 'desig-2',
        name: 'Lead',
        slug: 'lead',
        level: 2,
      });
      await service.update('emp-1', { designationId: 'desig-2' });
      expect(prisma.employmentHistory.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              field: 'designation',
              oldValue: 'Developer',
              newValue: 'Lead',
            }),
          ]),
        }),
      );
    });

    it('should write employment_type history with raw values', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.update('emp-1', { employmentType: 'contract' });
      expect(prisma.employmentHistory.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              field: 'employment_type',
              oldValue: 'full_time',
              newValue: 'contract',
            }),
          ]),
        }),
      );
    });

    it('should write reporting_manager history as employeeId and name', async () => {
      (prisma.employee.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockEmployee)
        .mockResolvedValueOnce({
          id: 'emp-9',
          employeeId: 'EMP-250624-0009',
          betterAuthUser: { name: 'Jane Doe' },
        });
      await service.update('emp-1', { reportingToId: 'emp-9' });
      expect(prisma.employmentHistory.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              field: 'reporting_manager',
              oldValue: null,
              newValue: 'EMP-250624-0009 · Jane Doe',
            }),
          ]),
        }),
      );
    });

    it('should throw BadRequest when reporting to themselves', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await expect(
        service.update('emp-1', { reportingToId: 'emp-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFound when reporting manager does not exist', async () => {
      (prisma.employee.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockEmployee)
        .mockResolvedValueOnce(null);
      await expect(
        service.update('emp-1', { reportingToId: 'ghost' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should persist reportingToId on update', async () => {
      (prisma.employee.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockEmployee)
        .mockResolvedValueOnce({
          id: 'emp-9',
          employeeId: 'EMP-250624-0009',
          betterAuthUser: { name: 'Jane Doe' },
        });
      await service.update('emp-1', { reportingToId: 'emp-9' }, 'actor-1');
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reportingToId: 'emp-9' }),
        }),
      );
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

    it('should reset BA role to the UserProfile role', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        id: 'profile-1',
        role: 'manager',
      });
      await service.remove('emp-1');
      expect(baPrisma.betterAuthUser.update).toHaveBeenCalledWith({
        where: { id: 'ba-user-test' },
        data: { role: 'manager' },
      });
    });

    it('should reset BA role to customer when no profile exists', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(null);
      await service.remove('emp-1');
      expect(baPrisma.betterAuthUser.update).toHaveBeenCalledWith({
        where: { id: 'ba-user-test' },
        data: { role: 'customer' },
      });
    });
  });
});

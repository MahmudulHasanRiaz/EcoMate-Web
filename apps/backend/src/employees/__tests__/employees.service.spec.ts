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

  const mockBankAccount = {
    id: 'ba-1',
    employeeId: 'emp-1',
    bankName: 'DBBL',
    branchName: null,
    accountName: 'John Doe',
    accountNumber: '1234567890',
    accountType: 'SAVINGS',
    routingNumber: null,
    isPrimary: false,
    verificationStatus: 'PENDING',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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
      attendanceSettings: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'global', mode: 'BOTH' }),
      },
      employeeBankAccount: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([mockBankAccount]),
        findUnique: jest.fn().mockResolvedValue(mockBankAccount),
        create: jest.fn().mockResolvedValue(mockBankAccount),
        update: jest.fn().mockResolvedValue(mockBankAccount),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn().mockResolvedValue(mockBankAccount),
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

    it('converts a concurrent P2002 race on betterAuthUserId into 409', async () => {
      (prisma.employee.create as jest.Mock).mockRejectedValue({
        code: 'P2002',
        meta: { target: ['betterAuthUserId'] },
      });
      const dto: CreateEmployeeDto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
      };
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      await expect(service.create(dto)).rejects.toThrow(
        /already an employee/i,
      );
    });

    it('rethrows non-unique failures from the create', async () => {
      (prisma.employee.create as jest.Mock).mockRejectedValue(
        new Error('boom'),
      );
      const dto: CreateEmployeeDto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
      };
      await expect(service.create(dto)).rejects.toThrow('boom');
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

  describe('create — HR personal fields', () => {
    it('persists all personal fields as strings / dates', async () => {
      const dto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
        dateOfBirth: '1990-04-12',
        gender: 'FEMALE' as const,
        nationality: 'Bangladeshi',
        nidNumber: '1234567890',
        presentAddress: 'Dhaka',
        permanentAddress: 'Sylhet',
        emergencyContactName: 'Jane Doe',
        emergencyContactPhone: '+8801711111111',
        emergencyContactRelation: 'Spouse',
        confirmationDate: '2025-04-01',
        exitReason: 'Hygiene violation',
        attendanceMethod: 'APP' as const,
      };
      await service.create(dto);
      expect(prisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dateOfBirth: expect.any(Date),
            gender: 'FEMALE',
            nationality: 'Bangladeshi',
            nidNumber: '1234567890',
            presentAddress: 'Dhaka',
            permanentAddress: 'Sylhet',
            emergencyContactName: 'Jane Doe',
            emergencyContactPhone: '+8801711111111',
            emergencyContactRelation: 'Spouse',
            confirmationDate: expect.any(Date),
            exitReason: 'Hygiene violation',
            attendanceMethod: 'APP',
          }),
        }),
      );
    });

    it('stores NID as a plain string', async () => {
      const dto = {
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
        nidNumber: '1122334455667',
      };
      await service.create(dto);
      const call = (prisma.employee.create as jest.Mock).mock.lastCall[0];
      expect(typeof call.data.nidNumber).toBe('string');
      expect(call.data.nidNumber).toBe('1122334455667');
    });
  });

  describe('attendanceMethod validation against AttendanceSettings', () => {
    async function createWith(
      method: 'APP' | 'MACHINE' | 'NONE',
      mode: 'APP' | 'MACHINE' | 'BOTH',
    ) {
      (prisma.attendanceSettings.findUnique as jest.Mock).mockResolvedValue({
        id: 'global',
        mode,
      });
      await service.create({
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
        attendanceMethod: method,
      });
    }

    it('rejects MACHINE on create when system mode is APP', async () => {
      await expect(createWith('MACHINE', 'APP')).rejects.toThrow(
        BadRequestException,
      );
      await expect(createWith('MACHINE', 'APP')).rejects.toThrow(
        /MACHINE method requires system mode MACHINE or BOTH/,
      );
    });

    it('rejects APP on create when system mode is MACHINE', async () => {
      await expect(createWith('APP', 'MACHINE')).rejects.toThrow(
        BadRequestException,
      );
      await expect(createWith('APP', 'MACHINE')).rejects.toThrow(
        /APP method requires system mode APP or BOTH/,
      );
    });

    it('allows APP / NONE under mode APP on create', async () => {
      await createWith('APP', 'APP');
      await createWith('NONE', 'APP');
      expect(prisma.employee.create).toHaveBeenCalledTimes(2);
    });

    it('allows MACHINE / NONE under mode MACHINE on create', async () => {
      await createWith('MACHINE', 'MACHINE');
      await createWith('NONE', 'MACHINE');
      expect(prisma.employee.create).toHaveBeenCalledTimes(2);
    });

    it('allows all three methods under mode BOTH on create', async () => {
      await createWith('APP', 'BOTH');
      await createWith('MACHINE', 'BOTH');
      await createWith('NONE', 'BOTH');
      expect(prisma.employee.create).toHaveBeenCalledTimes(3);
    });

    it('skips validation on create when attendanceMethod is not sent', async () => {
      (prisma.attendanceSettings.findUnique as jest.Mock).mockResolvedValue({
        id: 'global',
        mode: 'APP',
      });
      await service.create({
        betterAuthUserId: 'ba-user-test',
        joiningDate: '2025-01-15',
      });
      expect(prisma.employee.create).toHaveBeenCalledTimes(1);
    });

    it('rejects MACHINE on update when system mode is APP', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      (prisma.attendanceSettings.findUnique as jest.Mock).mockResolvedValue({
        id: 'global',
        mode: 'APP',
      });
      await expect(
        service.update('emp-1', { attendanceMethod: 'MACHINE' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('accepts compatible method on update under mode APP', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      (prisma.attendanceSettings.findUnique as jest.Mock).mockResolvedValue({
        id: 'global',
        mode: 'APP',
      });
      await service.update('emp-1', { attendanceMethod: 'NONE' });
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ attendanceMethod: 'NONE' }),
        }),
      );
    });

    it('persists personal fields via update', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.update('emp-1', {
        dateOfBirth: '1991-02-03',
        nationality: 'Indian',
        confirmationDate: '2025-05-01',
      });
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dateOfBirth: expect.any(Date),
            nationality: 'Indian',
            confirmationDate: expect.any(Date),
          }),
        }),
      );
    });

    it('finds the employee with bankAccounts included', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(mockEmployee);
      await service.findOne('emp-1');
      expect(prisma.employee.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            bankAccounts: expect.any(Object),
          }),
        }),
      );
    });
  });

  describe('bank accounts', () => {
    const employeeExists = () =>
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue({
        id: 'emp-1',
      });

    it('lists bank accounts for an employee, primary first', async () => {
      employeeExists();
      await service.listBankAccounts('emp-1');
      expect(prisma.employeeBankAccount.findMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1' },
        orderBy: [
          { isPrimary: 'desc' },
          { createdAt: 'asc' },
        ],
      });
    });

    it('throws 404 listing bank accounts for a missing employee', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.listBankAccounts('ghost')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates an account marked primary and unmarks the previous one', async () => {
      employeeExists();
      await service.createBankAccount('emp-1', {
        bankName: 'DBBL',
        accountName: 'John Doe',
        accountNumber: '0987654321',
        isPrimary: true,
      });
      expect(prisma.employeeBankAccount.updateMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', isPrimary: true },
        data: { isPrimary: false },
      });
      const createCall = (
        prisma.employeeBankAccount.create as jest.Mock
      ).mock.lastCall[0];
      expect(createCall.data).toMatchObject({
        bankName: 'DBBL',
        accountName: 'John Doe',
        accountNumber: '0987654321',
        isPrimary: true,
      });
    });

    it('auto-primaries the first account even without isPrimary', async () => {
      employeeExists();
      (prisma.employeeBankAccount.updateMany as jest.Mock).mockClear();
      (prisma.employeeBankAccount.create as jest.Mock).mockClear();
      (prisma.employeeBankAccount.count as jest.Mock).mockResolvedValue(0);
      await service.createBankAccount('emp-1', {
        bankName: 'DBBL',
        accountName: 'John Doe',
        accountNumber: '0987654321',
      });
      expect(prisma.employeeBankAccount.updateMany).not.toHaveBeenCalled();
      const createCall = (
        prisma.employeeBankAccount.create as jest.Mock
      ).mock.lastCall[0];
      expect(createCall.data.isPrimary).toBe(true);
    });

    it('does not force primary for a second account without isPrimary', async () => {
      employeeExists();
      (prisma.employeeBankAccount.count as jest.Mock).mockResolvedValue(2);
      await service.createBankAccount('emp-1', {
        bankName: 'EBL',
        accountName: 'John Doe',
        accountNumber: '1111111111',
      });
      const createCall = (
        prisma.employeeBankAccount.create as jest.Mock
      ).mock.lastCall[0];
      expect(createCall.data.isPrimary).toBe(false);
    });

    it('throws 404 creating an account for a missing employee', async () => {
      (prisma.employee.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.createBankAccount('ghost', {
          bankName: 'DBBL',
          accountName: 'X',
          accountNumber: '1',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates an account and swaps primary off the sibling', async () => {
      await service.updateBankAccount('ba-1', { isPrimary: true });
      expect(prisma.employeeBankAccount.updateMany).toHaveBeenCalledWith({
        where: {
          employeeId: 'emp-1',
          isPrimary: true,
          NOT: { id: 'ba-1' },
        },
        data: { isPrimary: false },
      });
      const updateCall = (
        prisma.employeeBankAccount.update as jest.Mock
      ).mock.lastCall[0];
      expect(updateCall.where).toEqual({ id: 'ba-1' });
      expect(updateCall.data.isPrimary).toBe(true);
    });

    it('updates non-primary fields without touching primary status', async () => {
      await service.updateBankAccount('ba-1', {
        branchName: 'Gulshan',
        verificationStatus: 'VERIFIED',
      } as any);
      const updateCall = (
        prisma.employeeBankAccount.update as jest.Mock
      ).mock.lastCall[0];
      expect(updateCall.data).toMatchObject({
        branchName: 'Gulshan',
        verificationStatus: 'VERIFIED',
        isPrimary: false,
      });
    });

    it('throws 404 when the account to update is missing', async () => {
      (prisma.employeeBankAccount.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      await expect(
        service.updateBankAccount('ghost', { branchName: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('sets the account as primary and unmarks the others', async () => {
      await service.setPrimaryBankAccount('ba-1');
      expect(prisma.employeeBankAccount.updateMany).toHaveBeenCalledWith({
        where: {
          employeeId: 'emp-1',
          isPrimary: true,
          NOT: { id: 'ba-1' },
        },
        data: { isPrimary: false },
      });
      const updateCall = (
        prisma.employeeBankAccount.update as jest.Mock
      ).mock.lastCall[0];
      expect(updateCall.where).toEqual({ id: 'ba-1' });
      expect(updateCall.data).toMatchObject({ isPrimary: true });
    });

    it('throws 404 when the account to promote is missing', async () => {
      (prisma.employeeBankAccount.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      await expect(
        service.setPrimaryBankAccount('ghost'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes a bank account', async () => {
      await service.deleteBankAccount('ba-1');
      expect(prisma.employeeBankAccount.delete).toHaveBeenCalledWith({
        where: { id: 'ba-1' },
      });
    });

    it('throws 404 when the account to delete is missing', async () => {
      (prisma.employeeBankAccount.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      await expect(service.deleteBankAccount('ghost')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import {
  AttendanceMethod,
  AttendanceModeSetting,
  EmployeeStatus,
  Prisma,
  EmploymentHistoryField,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { baPrisma } from '../better-auth/prisma';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

const TERMINAL_STATUSES: EmployeeStatus[] = ['terminated', 'resigned'];

const EMPLOYEE_STATUS_TRANSITIONS: Record<EmployeeStatus, EmployeeStatus[]> = {
  active: ['inactive', 'on_leave', 'suspended', 'terminated', 'resigned'],
  inactive: ['active', 'on_leave', 'suspended', 'terminated', 'resigned'],
  on_leave: ['terminated', 'resigned', 'active', 'inactive', 'suspended'],
  suspended: ['active', 'on_leave'],
  terminated: ['active'],
  resigned: ['active'],
};

// G-19 audit grouping: personal fields (identity) and employment fields
// (tenure) that are NOT already covered by the dedicated status / department /
// designation / reporting_manager / employment_type rows.
const AUDIT_FIELD_GROUPS: {
  field: EmploymentHistoryField;
  keys: string[];
}[] = [
  {
    field: 'personalInformation',
    keys: [
      'dateOfBirth',
      'gender',
      'nationality',
      'nidNumber',
      'presentAddress',
      'permanentAddress',
      'emergencyContactName',
      'emergencyContactPhone',
      'emergencyContactRelation',
      'confirmationDate',
      'exitReason',
    ],
  },
  {
    field: 'employmentInformation',
    keys: ['joiningDate', 'exitDate'],
  },
];

const AUDIT_KEYS = AUDIT_FIELD_GROUPS.flatMap((g) => g.keys);

const BANK_SNAPSHOT_KEYS = [
  'bankName',
  'branchName',
  'accountName',
  'accountNumber',
  'accountType',
  'routingNumber',
  'isPrimary',
  'verificationStatus',
  'notes',
  'verificationNote',
] as const;

// Models whose presence of any row for an employee blocks hard deletion
// (G-07): the employee must be archived instead.
const DELETE_GUARD_MODELS = [
  'payslip',
  'salaryStructure',
  'employeeEarning',
  'employeeDeduction',
  'commissionRule',
  'commissionEarning',
  'leaveRequest',
  'attendanceDay',
  'employeeBankAccount',
  'employmentHistory',
  'weeklyOff',
] as const;

function serializeScalar(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function pickRecord(obj: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in obj) out[k] = obj[k];
  }
  return out;
}

function bankSnapshot(obj: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of BANK_SNAPSHOT_KEYS) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

export interface EmployeeListQuery {
  page?: number;
  perPage?: number;
  status?: string;
  departmentId?: string;
  designationId?: string;
  reportingToId?: string;
  attendanceMethod?: string;
  search?: string;
  sortBy?: 'createdAt' | 'joiningDate' | 'employeeId' | 'name';
  sortOrder?: 'asc' | 'desc';
}

const EMPLOYEE_DETAIL_INCLUDE: Prisma.EmployeeInclude = {
  department: { select: { id: true, name: true, slug: true } },
  designation: { select: { id: true, name: true, slug: true, level: true } },
  accessPreset: { select: { id: true, name: true } },
  reportingTo: {
    select: {
      id: true,
      employeeId: true,
      betterAuthUser: { select: { name: true } },
    },
  },
  betterAuthUser: {
    select: { id: true, name: true, email: true, role: true },
  },
  bankAccounts: {
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
  salaryStructures: {
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  },
};

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: EmployeeListQuery = {}) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.designationId) where.designationId = query.designationId;
    if (query.reportingToId) where.reportingToId = query.reportingToId;
    if (query.attendanceMethod) where.attendanceMethod = query.attendanceMethod;
    if (query.search) {
      where.OR = [
        { employeeId: { contains: query.search, mode: 'insensitive' } },
        {
          betterAuthUser: {
            is: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    const sortDir = query.sortOrder === 'asc' ? ('asc' as const) : ('desc' as const);
    let orderBy: Prisma.EmployeeOrderByWithRelationInput;
    switch (query.sortBy) {
      case 'joiningDate':
        orderBy = { joiningDate: sortDir };
        break;
      case 'employeeId':
        orderBy = { employeeId: sortDir };
        break;
      case 'name':
        orderBy = { betterAuthUser: { name: sortDir } };
        break;
      default:
        orderBy = { createdAt: sortDir };
        break;
    }

    const [data, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy,
        include: {
          department: { select: { id: true, name: true, slug: true } },
          designation: {
            select: { id: true, name: true, slug: true, level: true },
          },
          accessPreset: { select: { id: true, name: true } },
          reportingTo: {
            select: {
              id: true,
              employeeId: true,
              betterAuthUser: { select: { name: true } },
            },
          },
          betterAuthUser: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: EMPLOYEE_DETAIL_INCLUDE,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  // AttendanceSettings (id='global') declares which attendanceMethod values
  // are allowed on employees. mode APP → {APP, NONE}; mode MACHINE →
  // {MACHINE, NONE}; mode BOTH → all three. Rows may not exist yet
  // (singleton not seeded) — treat as APP, the schema default.
  private async validateAttendanceMethod(method?: AttendanceMethod) {
    if (!method) return;
    const settings = await this.prisma.attendanceSettings.findUnique({
      where: { id: 'global' },
    });
    const mode: AttendanceModeSetting = settings?.mode ?? 'APP';
    if (mode === 'APP' && method === 'MACHINE') {
      throw new BadRequestException(
        'MACHINE method requires system mode MACHINE or BOTH.',
      );
    }
    if (mode === 'MACHINE' && method === 'APP') {
      throw new BadRequestException(
        'APP method requires system mode APP or BOTH.',
      );
    }
  }

  private async ensureEmployeeExists(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  async create(dto: CreateEmployeeDto, actorId?: string) {
    const baUser = await baPrisma.betterAuthUser.findUnique({
      where: { id: dto.betterAuthUserId },
    });
    if (!baUser) throw new BadRequestException('Better Auth user not found');

    const existing = await this.prisma.employee.findUnique({
      where: { betterAuthUserId: dto.betterAuthUserId },
    });
    if (existing) throw new ConflictException('User is already an employee');

    await this.validateAttendanceMethod(dto.attendanceMethod);

    if (dto.departmentId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: dto.departmentId },
      });
      if (!dept) throw new NotFoundException('Department not found');
    }
    if (dto.designationId) {
      const desig = await this.prisma.designation.findUnique({
        where: { id: dto.designationId },
      });
      if (!desig) throw new NotFoundException('Designation not found');
    }
    if (dto.accessPresetId) {
      const preset = await this.prisma.accessPreset.findUnique({
        where: { id: dto.accessPresetId },
      });
      if (!preset) throw new NotFoundException('Access preset not found');
    }
    if (dto.reportingToId) {
      const manager = await this.prisma.employee.findUnique({
        where: { id: dto.reportingToId },
      });
      if (!manager) throw new NotFoundException('Employee not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.orderCounter.upsert({
        where: { date: this.dateStr() },
        create: { date: this.dateStr(), seq: 1 },
        update: { seq: { increment: 1 } },
      });

      const employeeId = `EMP-${this.dateStr()}-${String(counter.seq).padStart(4, '0')}`;

      // Race guard: two concurrent creates for the same BA user can both pass
      // the pre-check above; the unique betterAuthUserId constraint then fires
      // P2002 — surface as a friendly 409, not a raw Prisma error.
      let employee;
      try {
        employee = await tx.employee.create({
          data: {
            betterAuthUserId: dto.betterAuthUserId,
            employeeId,
            departmentId: dto.departmentId,
            designationId: dto.designationId,
            accessPresetId: dto.accessPresetId,
            reportingToId: dto.reportingToId,
            employmentType: dto.employmentType || 'full_time',
            status: dto.status,
            joiningDate: new Date(dto.joiningDate),
            exitDate: dto.exitDate ? new Date(dto.exitDate) : undefined,
            profilePictureUrl: dto.profilePictureUrl,
            notes: dto.notes,
            dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
            gender: dto.gender,
            nationality: dto.nationality,
            nidNumber: dto.nidNumber,
            presentAddress: dto.presentAddress,
            permanentAddress: dto.permanentAddress,
            emergencyContactName: dto.emergencyContactName,
            emergencyContactPhone: dto.emergencyContactPhone,
            emergencyContactRelation: dto.emergencyContactRelation,
            confirmationDate: dto.confirmationDate
              ? new Date(dto.confirmationDate)
              : undefined,
            exitReason: dto.exitReason,
            attendanceMethod: dto.attendanceMethod,
          },
          include: {
            department: { select: { id: true, name: true, slug: true } },
            designation: {
              select: { id: true, name: true, slug: true, level: true },
            },
            accessPreset: { select: { id: true, name: true } },
            betterAuthUser: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
        });
      } catch (err) {
        if ((err as { code?: string } | null)?.code === 'P2002') {
          throw new ConflictException('User is already an employee');
        }
        throw err;
      }

      // G-15 nested salary structure: create it as the active window and mirror
      // netSalary onto Employee.salary (the payroll mirror contract).
      let createdStructure: unknown = null;
      if (dto.salaryStructure) {
        const { basicSalary } = dto.salaryStructure;
        const houseAllowance = dto.salaryStructure.houseAllowance ?? 0;
        const medicalAllowance = dto.salaryStructure.medicalAllowance ?? 0;
        const transportAllowance = dto.salaryStructure.transportAllowance ?? 0;
        const otherAllowance = dto.salaryStructure.otherAllowance ?? 0;
        const taxDeduction = dto.salaryStructure.taxDeduction ?? 0;
        const insuranceDeduction = dto.salaryStructure.insuranceDeduction ?? 0;
        const otherDeduction = dto.salaryStructure.otherDeduction ?? 0;
        const totalEarnings =
          basicSalary +
          houseAllowance +
          medicalAllowance +
          transportAllowance +
          otherAllowance;
        const totalDeductions =
          taxDeduction + insuranceDeduction + otherDeduction;
        const netSalary = totalEarnings - totalDeductions;
        const effectiveFrom = dto.salaryStructure.effectiveFrom
          ? new Date(dto.salaryStructure.effectiveFrom)
          : new Date();

        createdStructure = await tx.salaryStructure.create({
          data: {
            employeeId: employee.id,
            basicSalary,
            houseAllowance,
            medicalAllowance,
            transportAllowance,
            otherAllowance,
            taxDeduction,
            insuranceDeduction,
            otherDeduction,
            totalEarnings,
            totalDeductions,
            netSalary,
            effectiveFrom,
            effectiveTo: null,
            isActive: true,
            createdById: actorId ?? null,
          },
        });

        await tx.employee.update({
          where: { id: employee.id },
          data: { salary: netSalary },
        });
      }

      // G-15 nested bank account: the first account is primary regardless of
      // the flag. accountName defaults to the BA user's name when not sent
      // (the DB column is NOT NULL).
      let createdBank: unknown = null;
      if (dto.bankAccount) {
        const bankData = {
          employeeId: employee.id,
          bankName: dto.bankAccount.bankName,
          branchName: dto.bankAccount.branchName ?? null,
          accountName: dto.bankAccount.accountName || baUser.name || '',
          accountNumber: dto.bankAccount.accountNumber,
          accountType: dto.bankAccount.accountType ?? undefined,
          routingNumber: dto.bankAccount.routingNumber ?? null,
          isPrimary: true,
          verificationStatus: 'PENDING' as const,
          createdById: actorId ?? null,
        };
        createdBank = await tx.employeeBankAccount.create({ data: bankData });
      }

      await baPrisma.betterAuthUser.update({
        where: { id: dto.betterAuthUserId },
        data: { role: 'employee' },
      });

      const profile = await tx.userProfile.findUnique({
        where: { betterAuthUserId: dto.betterAuthUserId },
        select: { id: true, role: true },
      });
      if (profile && profile.role === 'customer') {
        await tx.userProfile.update({
          where: { id: profile.id },
          data: { role: 'employee' },
        });
      }

      return {
        ...employee,
        bankAccounts: dto.bankAccount ? [createdBank] : [],
        salaryStructures: dto.salaryStructure ? [createdStructure] : [],
      } as any;
    });
  }

  async update(id: string, dto: UpdateEmployeeDto, actorId?: string) {
    const current = await this.prisma.employee.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        employmentType: true,
        departmentId: true,
        designationId: true,
        accessPresetId: true,
        reportingToId: true,
        joiningDate: true,
        exitDate: true,
        exitReason: true,
        confirmationDate: true,
        dateOfBirth: true,
        gender: true,
        nationality: true,
        nidNumber: true,
        presentAddress: true,
        permanentAddress: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        emergencyContactRelation: true,
        attendanceMethod: true,
        salary: true,
        bankAccountNo: true,
        bankName: true,
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        reportingTo: {
          select: {
            id: true,
            employeeId: true,
            betterAuthUser: { select: { name: true } },
          },
        },
      },
    });
    if (!current) throw new NotFoundException('Employee not found');

    if (dto.attendanceMethod !== undefined) {
      await this.validateAttendanceMethod(dto.attendanceMethod);
    }

    let newDepartment: { id: string; name: string } | null = null;
    if (dto.departmentId !== undefined && dto.departmentId !== current.departmentId) {
      newDepartment = await this.prisma.department.findUnique({
        where: { id: dto.departmentId },
      });
      if (!newDepartment) throw new NotFoundException('Department not found');
    }
    let newDesignation: { id: string; name: string } | null = null;
    if (dto.designationId !== undefined && dto.designationId !== current.designationId) {
      newDesignation = await this.prisma.designation.findUnique({
        where: { id: dto.designationId },
      });
      if (!newDesignation) throw new NotFoundException('Designation not found');
    }
    if (dto.accessPresetId !== undefined && dto.accessPresetId !== current.accessPresetId) {
      const preset = await this.prisma.accessPreset.findUnique({
        where: { id: dto.accessPresetId },
      });
      if (!preset) throw new NotFoundException('Access preset not found');
    }
    let newManager: {
      id: string;
      employeeId: string;
      betterAuthUser: { name: string | null } | null;
    } | null = null;
    if (dto.reportingToId !== undefined && dto.reportingToId !== current.reportingToId) {
      if (dto.reportingToId === current.id) {
        throw new BadRequestException('Employee cannot report to themselves');
      }
      newManager = await this.prisma.employee.findUnique({
        where: { id: dto.reportingToId },
        select: {
          id: true,
          employeeId: true,
          betterAuthUser: { select: { name: true } },
        },
      });
      if (!newManager) throw new NotFoundException('Employee not found');
    }

    // G-08: rehire = a terminal employee returning to active with a NEW
    // employment start. Requires joiningDate and clears the previous exit data.
    const rehire =
      dto.status === 'active' &&
      (current.status === 'terminated' || current.status === 'resigned');

    if (dto.status && dto.status !== current.status) {
      const allowed = EMPLOYEE_STATUS_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Invalid status transition from ${current.status} to ${dto.status}`,
        );
      }
      if (rehire && !dto.joiningDate) {
        throw new BadRequestException(
          `joiningDate is required to rehire a ${current.status} employee.`,
        );
      }
      if (TERMINAL_STATUSES.includes(dto.status) && !dto.exitDate) {
        throw new BadRequestException(
          `exitDate is required when status is ${dto.status}`,
        );
      }
    }

    const changedById = actorId ?? null;
    const historyRows: {
      employeeId: string;
      field: EmploymentHistoryField;
      oldValue: string | null;
      newValue: string | null;
      effectiveFrom: Date;
      changedById: string | null;
    }[] = [];

    if (dto.status !== undefined && dto.status !== current.status) {
      historyRows.push({
        employeeId: id,
        field: 'status',
        oldValue: current.status,
        newValue: dto.status,
        effectiveFrom: new Date(),
        changedById,
      });
    }
    if (
      dto.departmentId !== undefined &&
      dto.departmentId !== current.departmentId
    ) {
      historyRows.push({
        employeeId: id,
        field: 'department',
        oldValue: current.department?.name ?? current.departmentId,
        newValue: newDepartment?.name ?? dto.departmentId,
        effectiveFrom: new Date(),
        changedById,
      });
    }
    if (
      dto.designationId !== undefined &&
      dto.designationId !== current.designationId
    ) {
      historyRows.push({
        employeeId: id,
        field: 'designation',
        oldValue: current.designation?.name ?? current.designationId,
        newValue: newDesignation?.name ?? dto.designationId,
        effectiveFrom: new Date(),
        changedById,
      });
    }
    if (
      dto.employmentType !== undefined &&
      dto.employmentType !== current.employmentType
    ) {
      historyRows.push({
        employeeId: id,
        field: 'employment_type',
        oldValue: current.employmentType,
        newValue: dto.employmentType,
        effectiveFrom: new Date(),
        changedById,
      });
    }
    if (
      dto.reportingToId !== undefined &&
      dto.reportingToId !== current.reportingToId
    ) {
      const reporterLabel = (emp: {
        employeeId: string;
        betterAuthUser: { name: string | null } | null;
      } | null, fallback: string | null): string | null => {
        if (!emp) return fallback;
        const name = emp.betterAuthUser?.name;
        return name ? `${emp.employeeId} · ${name}` : emp.employeeId;
      };
      historyRows.push({
        employeeId: id,
        field: 'reporting_manager',
        oldValue: reporterLabel(
          current.reportingTo,
          current.reportingToId ?? null,
        ),
        newValue: reporterLabel(newManager, dto.reportingToId ?? null),
        effectiveFrom: new Date(),
        changedById,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // G-15 did not add nested fields to update; strip them defensively so a
      // client cannot pass them into the scalar employee update.
      const updateData: any = { ...dto };
      delete updateData.salaryStructure;
      delete updateData.bankAccount;
      if (dto.joiningDate) updateData.joiningDate = new Date(dto.joiningDate);
      if (dto.exitDate) updateData.exitDate = new Date(dto.exitDate);
      if (dto.dateOfBirth) updateData.dateOfBirth = new Date(dto.dateOfBirth);
      if (dto.confirmationDate) {
        updateData.confirmationDate = new Date(dto.confirmationDate);
      }
      if (rehire) {
        updateData.joiningDate = new Date(dto.joiningDate!);
        updateData.exitDate = null;
        updateData.exitReason = null;
      }

      const employee = await tx.employee.update({
        where: { id },
        data: updateData,
        include: {
          department: { select: { id: true, name: true, slug: true } },
          designation: {
            select: { id: true, name: true, slug: true, level: true },
          },
          accessPreset: { select: { id: true, name: true } },
          betterAuthUser: {
            select: { id: true, name: true, email: true, role: true },
          },
          bankAccounts: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      });

      // G-19: audit changed personal + employment detail as structured JSON.
      // Only fields the DTO actually touches can be "changed" — otherwise an
      // unspecified joiningDate would appear cleared to null.
      const oldSnap: Record<string, unknown> = {};
      const newSnap: Record<string, unknown> = {};
      for (const k of AUDIT_KEYS) {
        const oldVal = serializeScalar((current as any)[k]);
        let newVal: string | null;
        if (k === 'joiningDate' && rehire) {
          newVal = dto.joiningDate ? dto.joiningDate.slice(0, 10) : null;
        } else if (k === 'exitDate' && rehire) {
          newVal = null;
        } else if ((dto as any)[k] === undefined) {
          continue;
        } else {
          newVal = serializeScalar((dto as any)[k]);
        }
        if (oldVal !== newVal) {
          oldSnap[k] = oldVal;
          newSnap[k] = newVal;
        }
      }
      if (Object.keys(newSnap).length > 0) {
        for (const group of AUDIT_FIELD_GROUPS) {
          const changedKeys = group.keys.filter((k) => k in newSnap);
          if (changedKeys.length === 0) continue;
          let newValue = JSON.stringify(pickRecord(newSnap, changedKeys));
          if (rehire && group.field === 'employmentInformation') {
            newValue = JSON.stringify({
              ...pickRecord(newSnap, changedKeys),
              rehire: true,
            });
          }
          historyRows.push({
            employeeId: id,
            field: group.field,
            oldValue: JSON.stringify(pickRecord(oldSnap, changedKeys)),
            newValue,
            effectiveFrom: new Date(),
            changedById,
          });
        }
      }

      if (historyRows.length > 0) {
        await tx.employmentHistory.createMany({ data: historyRows });
      }

      return employee;
    });
  }

  async remove(id: string, actorId?: string) {
    void actorId; // reserved: employee deletion is not audited in G-19
    const emp = await this.findOne(id);

    const guard = async (tx: Prisma.TransactionClient) => {
      const flags = await Promise.all(
        DELETE_GUARD_MODELS.map(async (model) => {
          const count = await (tx as any)[model].count({
            where: { employeeId: id },
          });
          return count > 0;
        }),
      );
      return flags.some(Boolean);
    };

    return this.prisma.$transaction(async (tx) => {
      if (await guard(tx)) {
        throw new ConflictException(
          'Employee has financial/history records — archive instead of deleting.',
        );
      }
      const profile = await tx.userProfile.findUnique({
        where: { betterAuthUserId: emp.betterAuthUserId },
      });
      await baPrisma.betterAuthUser.update({
        where: { id: emp.betterAuthUserId },
        data: { role: profile?.role ?? 'customer' },
      });
      try {
        return await tx.employee.delete({ where: { id } });
      } catch (err) {
        // A FK constraint firing at delete time means the pre-check missed a
        // related record — treat it as the same archive requirement.
        if ((err as { code?: string } | null)?.code === 'P2003') {
          throw new ConflictException(
            'Employee has financial/history records — archive instead of deleting.',
          );
        }
        throw err;
      }
    });
  }

  // ---------- Bank accounts (sub-resource) ----------

  async listBankAccounts(employeeId: string) {
    await this.ensureEmployeeExists(employeeId);
    return this.prisma.employeeBankAccount.findMany({
      where: { employeeId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createBankAccount(
    employeeId: string,
    dto: CreateBankAccountDto,
    actorId?: string,
  ) {
    await this.ensureEmployeeExists(employeeId);
    const existingCount = await this.prisma.employeeBankAccount.count({
      where: { employeeId },
    });
    const isPrimary = dto.isPrimary === true || existingCount === 0;

    return this.prisma.$transaction(async (tx) => {
      if (isPrimary && existingCount > 0) {
        await tx.employeeBankAccount.updateMany({
          where: { employeeId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const bankData = {
        bankName: dto.bankName,
        branchName: dto.branchName ?? null,
        accountName: dto.accountName,
        accountNumber: dto.accountNumber,
        accountType: dto.accountType ?? undefined,
        routingNumber: dto.routingNumber ?? null,
        isPrimary,
        verificationStatus: dto.verificationStatus ?? undefined,
        notes: dto.notes ?? null,
        createdById: actorId ?? null,
      };
      const account = await tx.employeeBankAccount.create({
        data: { ...bankData, employeeId },
      });

      // G-19: bank account created → audit row.
      await tx.employmentHistory.createMany({
        data: [
          {
            employeeId,
            field: 'bankAccount' as EmploymentHistoryField,
            oldValue: null,
            newValue: JSON.stringify(bankSnapshot(bankData)),
            effectiveFrom: new Date(),
            changedById: actorId ?? null,
          },
        ],
      });

      return account;
    });
  }

  async updateBankAccount(
    id: string,
    dto: UpdateBankAccountDto,
    actorId?: string,
  ) {
    const account = await this.prisma.employeeBankAccount.findUnique({
      where: { id },
    });
    if (!account) throw new NotFoundException('Bank account not found');

    const wantPrimary = dto.isPrimary === true;
    const isPrimary =
      dto.isPrimary === undefined ? account.isPrimary : dto.isPrimary;

    const newSnapshot = bankSnapshot({
      ...account,
      ...dto,
      isPrimary,
      updatedById: actorId ?? null,
      notes: dto.notes ?? account.notes,
      verificationNote: dto.verificationNote ?? account.verificationNote,
    });

    return this.prisma.$transaction(async (tx) => {
      if (wantPrimary) {
        await tx.employeeBankAccount.updateMany({
          where: {
            employeeId: account.employeeId,
            isPrimary: true,
            NOT: { id },
          },
          data: { isPrimary: false },
        });
      }
      const updated = await tx.employeeBankAccount.update({
        where: { id },
        data: {
          bankName: dto.bankName,
          branchName: dto.branchName,
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
          accountType: dto.accountType,
          routingNumber: dto.routingNumber,
          isPrimary,
          verificationStatus: dto.verificationStatus,
          verificationNote: dto.verificationNote,
          notes: dto.notes,
          updatedById: actorId ?? null,
        },
      });

      // G-19: bank account patched → audit row with old/new JSON.
      await tx.employmentHistory.createMany({
        data: [
          {
            employeeId: account.employeeId,
            field: 'bankAccount' as EmploymentHistoryField,
            oldValue: JSON.stringify(bankSnapshot(account)),
            newValue: JSON.stringify(newSnapshot),
            effectiveFrom: new Date(),
            changedById: actorId ?? null,
          },
        ],
      });

      return updated;
    });
  }

  async setPrimaryBankAccount(id: string, actorId?: string) {
    const account = await this.prisma.employeeBankAccount.findUnique({
      where: { id },
    });
    if (!account) throw new NotFoundException('Bank account not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.employeeBankAccount.updateMany({
        where: {
          employeeId: account.employeeId,
          isPrimary: true,
          NOT: { id },
        },
        data: { isPrimary: false },
      });
      const updated = await tx.employeeBankAccount.update({
        where: { id },
        data: { isPrimary: true, updatedById: actorId ?? null },
      });

      await tx.employmentHistory.createMany({
        data: [
          {
            employeeId: account.employeeId,
            field: 'bankAccount' as EmploymentHistoryField,
            oldValue: JSON.stringify(bankSnapshot(account)),
            newValue: JSON.stringify(bankSnapshot(updated)),
            effectiveFrom: new Date(),
            changedById: actorId ?? null,
          },
        ],
      });

      return updated;
    });
  }

  async deleteBankAccount(id: string, actorId?: string) {
    const account = await this.prisma.employeeBankAccount.findUnique({
      where: { id },
    });
    if (!account) throw new NotFoundException('Bank account not found');
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.employeeBankAccount.delete({ where: { id } });
      await tx.employmentHistory.createMany({
        data: [
          {
            employeeId: account.employeeId,
            field: 'bankAccount' as EmploymentHistoryField,
            oldValue: JSON.stringify(bankSnapshot(account)),
            newValue: null,
            effectiveFrom: new Date(),
            changedById: actorId ?? null,
          },
        ],
      });
      return deleted;
    });
  }

  async searchBaUsers(query: string) {
    const users = await baPrisma.betterAuthUser.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
        employee: null,
      },
      take: 20,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, role: true },
    });
    return { data: users };
  }

  private dateStr() {
    const d = new Date();
    const yy = d.getFullYear().toString().slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }
}

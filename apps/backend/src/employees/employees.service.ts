import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, perPage = 20, status?: string, departmentId?: string) {
    const where: any = {};
    if (status) where.status = status;
    if (departmentId) where.departmentId = departmentId;

    const [data, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          department: { select: { id: true, name: true, slug: true } },
          designation: { select: { id: true, name: true, slug: true, level: true } },
        },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { data, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } };
  }

  async findOne(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true, slug: true } },
        designation: { select: { id: true, name: true, slug: true, level: true } },
      },
    });
    if (!employee) throw new NotFoundException(`Employee with ID ${id} not found`);
    return employee;
  }

  async create(dto: CreateEmployeeDto) {
    const existing = await this.prisma.employee.findFirst({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Employee with this email already exists');

    if (dto.departmentId) {
      const dept = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
      if (!dept) throw new NotFoundException('Department not found');
    }
    if (dto.designationId) {
      const desig = await this.prisma.designation.findUnique({ where: { id: dto.designationId } });
      if (!desig) throw new NotFoundException('Designation not found');
    }

    const counter = await this.prisma.orderCounter.upsert({
      where: { date: this.dateStr() },
      create: { date: this.dateStr(), seq: 1 },
      update: { seq: { increment: 1 } },
    });

    const employeeId = `EMP-${this.dateStr()}-${String(counter.seq).padStart(4, '0')}`;

    return this.prisma.employee.create({
      data: {
        employeeId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        departmentId: dto.departmentId,
        designationId: dto.designationId,
        employmentType: dto.employmentType || 'full_time',
        joiningDate: new Date(dto.joiningDate),
        salary: dto.salary || undefined,
        bankAccountNo: dto.bankAccountNo,
        bankName: dto.bankName,
        address: dto.address,
        city: dto.city,
        emergencyContact: dto.emergencyContact,
        notes: dto.notes,
      },
      include: {
        department: { select: { id: true, name: true, slug: true } },
        designation: { select: { id: true, name: true, slug: true, level: true } },
      },
    });
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    await this.findOne(id);
    return this.prisma.employee.update({
      where: { id },
      data: {
        ...dto,
        joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : undefined,
      },
      include: {
        department: { select: { id: true, name: true, slug: true } },
        designation: { select: { id: true, name: true, slug: true, level: true } },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.employee.delete({ where: { id } });
  }

  private dateStr() {
    const d = new Date();
    const yy = d.getFullYear().toString().slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }
}

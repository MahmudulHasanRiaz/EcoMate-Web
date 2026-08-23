import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  private slugify(name: string) {
    return name.toLowerCase().replace(/\s+/g, '-');
  }

  async findAll(page = 1, perPage = 20, isActive?: boolean) {
    const where: any = {};
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.department.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.department.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const department = await this.prisma.department.findUnique({
      where: { id },
    });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  async create(dto: CreateDepartmentDto) {
    const existing = await this.prisma.department.findUnique({
      where: { name: dto.name },
    });
    if (existing)
      throw new ConflictException('Department name already exists');

    try {
      return await this.prisma.department.create({
        data: {
          name: dto.name,
          slug: this.slugify(dto.name),
          description: dto.description,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (err) {
      // Race + slug-collision guard: names differing only in case share a
      // slug, and concurrent creates can both pass the pre-check — P2002 on
      // name/slug surfaces as a friendly 409.
      if ((err as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException('Department name already exists');
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateDepartmentDto) {
    await this.findOne(id);

    if (dto.name) {
      const existing = await this.prisma.department.findUnique({
        where: { name: dto.name },
      });
      if (existing && existing.id !== id)
        throw new ConflictException('Department name already exists');
    }

    const data: any = { ...dto };
    if (dto.name) {
      data.slug = this.slugify(dto.name);
    }

    try {
      return await this.prisma.department.update({
        where: { id },
        data,
      });
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException('Department name already exists');
      }
      throw err;
    }
  }

  async remove(id: string) {
    await this.findOne(id);

    const employeeCount = await this.prisma.employee.count({
      where: { departmentId: id },
    });
    if (employeeCount > 0)
      throw new ConflictException('Department is assigned to employees');

    await this.prisma.department.delete({ where: { id } });
    return { message: 'Deleted' };
  }
}
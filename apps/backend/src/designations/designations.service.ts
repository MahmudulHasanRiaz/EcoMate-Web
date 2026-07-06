import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDesignationDto } from './dto/create-designation.dto';
import { UpdateDesignationDto } from './dto/update-designation.dto';

@Injectable()
export class DesignationsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.designation.findMany({
      orderBy: { level: 'asc' },
    });
  }

  async findOne(id: string) {
    const designation = await this.prisma.designation.findUnique({
      where: { id },
    });
    if (!designation) throw new NotFoundException('Designation not found');
    return designation;
  }

  async create(dto: CreateDesignationDto) {
    const slug = dto.name.toLowerCase().replace(/\s+/g, '-');

    const existing = await this.prisma.designation.findUnique({
      where: { name: dto.name },
    });
    if (existing) throw new ConflictException('Designation name already exists');

    return this.prisma.designation.create({
      data: {
        name: dto.name,
        slug,
        level: dto.level ?? 0,
      },
    });
  }

  async update(id: string, dto: UpdateDesignationDto) {
    await this.findOne(id);

    if (dto.name) {
      const existing = await this.prisma.designation.findUnique({
        where: { name: dto.name },
      });
      if (existing && existing.id !== id)
        throw new ConflictException('Designation name already exists');
    }

    const data: any = { ...dto };
    if (dto.name) {
      data.slug = dto.name.toLowerCase().replace(/\s+/g, '-');
    }

    return this.prisma.designation.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    const employeeCount = await this.prisma.employee.count({
      where: { designationId: id },
    });
    if (employeeCount > 0)
      throw new ConflictException(
        'Cannot delete designation assigned to employees',
      );

    await this.prisma.designation.delete({ where: { id } });
    return { message: 'Deleted' };
  }
}

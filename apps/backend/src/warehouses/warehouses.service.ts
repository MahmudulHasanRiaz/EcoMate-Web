import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(type?: string) {
    const where: any = {};
    if (type) {
      where.type = type;
      where.isActive = true;
    }
    return this.prisma.warehouse.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { binLocations: true },
        },
      },
    });
  }

  async findOne(id: string) {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id },
    });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }
    return warehouse;
  }

  async create(dto: CreateWarehouseDto) {
    const slug =
      dto.slug ||
      dto.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    const existing = await this.prisma.warehouse.findUnique({
      where: { slug },
    });
    if (existing) {
      throw new ConflictException('Warehouse slug already exists');
    }
    return this.prisma.warehouse.create({
      data: {
        ...dto,
        slug,
      },
    });
  }

  async update(id: string, dto: UpdateWarehouseDto) {
    await this.findOne(id);
    if (dto.slug) {
      const existing = await this.prisma.warehouse.findUnique({
        where: { slug: dto.slug },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('Warehouse slug already exists');
      }
    }
    return this.prisma.warehouse.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.warehouse.delete({
      where: { id },
    });
  }
}

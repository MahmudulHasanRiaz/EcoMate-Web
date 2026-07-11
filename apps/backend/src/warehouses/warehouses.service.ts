import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { CreateBinLocationDto } from './dto/create-bin-location.dto';
import { UpdateBinLocationDto } from './dto/update-bin-location.dto';

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
      include: {
        binLocations: { orderBy: { code: 'asc' } },
      },
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

  /* ── Bin Locations ── */

  async listBinLocations(warehouseId: string) {
    return this.prisma.binLocation.findMany({
      where: { warehouseId },
      orderBy: { code: 'asc' },
    });
  }

  async createBinLocation(warehouseId: string, dto: CreateBinLocationDto) {
    const existing = await this.prisma.binLocation.findUnique({
      where: { warehouseId_code: { warehouseId, code: dto.code } },
    });
    if (existing) {
      throw new ConflictException('Bin code already exists in this warehouse');
    }
    return this.prisma.binLocation.create({
      data: { ...dto, warehouseId },
    });
  }

  async updateBinLocation(binId: string, dto: UpdateBinLocationDto) {
    const bin = await this.prisma.binLocation.findUnique({
      where: { id: binId },
    });
    if (!bin) throw new NotFoundException('Bin location not found');
    if (dto.code && dto.code !== bin.code) {
      const dup = await this.prisma.binLocation.findUnique({
        where: {
          warehouseId_code: { warehouseId: bin.warehouseId, code: dto.code },
        },
      });
      if (dup) throw new ConflictException('Bin code already in use');
    }
    return this.prisma.binLocation.update({
      where: { id: binId },
      data: dto,
    });
  }

  async deleteBinLocation(binId: string) {
    const bin = await this.prisma.binLocation.findUnique({
      where: { id: binId },
    });
    if (!bin) throw new NotFoundException('Bin location not found');
    return this.prisma.binLocation.delete({ where: { id: binId } });
  }
}

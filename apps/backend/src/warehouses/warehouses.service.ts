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
import {
  CreateZoneDto,
  UpdateZoneDto,
  CreateRackDto,
  UpdateRackDto,
  CreateShelfDto,
  UpdateShelfDto,
} from './dto/hierarchy.dto';

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

  async findAllBins(warehouseId?: string, search?: string, isActive?: string, zoneId?: string, rackId?: string, shelfId?: string) {
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;
    if (search) {
      where.code = { contains: search, mode: 'insensitive' };
    }
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }
    if (zoneId) where.zoneId = zoneId;
    if (rackId) where.rackId = rackId;
    if (shelfId) where.shelfId = shelfId;
    return this.prisma.binLocation.findMany({
      where,
      include: { warehouse: { select: { id: true, name: true } } },
      orderBy: { code: 'asc' },
    });
  }

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
    if (dto.shelfId && !dto.rackId) {
      throw new ConflictException('shelfId requires rackId');
    }
    if (dto.rackId && !dto.zoneId) {
      throw new ConflictException('rackId requires zoneId');
    }
    return this.prisma.binLocation.create({
      data: {
        code: dto.code,
        warehouseId,
        zoneId: dto.zoneId ?? null,
        rackId: dto.rackId ?? null,
        shelfId: dto.shelfId ?? null,
      },
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
    let zoneId = dto.zoneId !== undefined ? dto.zoneId : bin.zoneId;
    let rackId = dto.rackId !== undefined ? dto.rackId : bin.rackId;
    let shelfId = dto.shelfId !== undefined ? dto.shelfId : bin.shelfId;
    if (shelfId && !rackId) {
      throw new ConflictException('shelfId requires rackId');
    }
    if (rackId && !zoneId) {
      throw new ConflictException('rackId requires zoneId');
    }
    if (dto.zoneId !== undefined && dto.zoneId !== bin.zoneId) {
      rackId = null;
      shelfId = null;
    }
    if (dto.rackId !== undefined && dto.rackId !== bin.rackId) {
      shelfId = null;
    }
    return this.prisma.binLocation.update({
      where: { id: binId },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        zoneId: zoneId ?? null,
        rackId: rackId ?? null,
        shelfId: shelfId ?? null,
      },
    });
  }

  async deleteBinLocation(binId: string) {
    const bin = await this.prisma.binLocation.findUnique({
      where: { id: binId },
    });
    if (!bin) throw new NotFoundException('Bin location not found');
    return this.prisma.binLocation.delete({ where: { id: binId } });
  }

  /* ── Zone CRUD ── */

  async listZones(warehouseId: string) {
    return this.prisma.zone.findMany({
      where: { warehouseId },
      include: { racks: { include: { shelves: { include: { bins: true } } } } },
      orderBy: { name: 'asc' },
    });
  }

  async createZone(warehouseId: string, dto: CreateZoneDto) {
    const existing = await this.prisma.zone.findUnique({
      where: { warehouseId_name: { warehouseId, name: dto.name } },
    });
    if (existing) throw new ConflictException('Zone name already exists in this warehouse');
    return this.prisma.zone.create({
      data: { warehouseId, name: dto.name, isActive: dto.isActive ?? true },
    });
  }

  async updateZone(zoneId: string, dto: UpdateZoneDto) {
    const zone = await this.prisma.zone.findUnique({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException('Zone not found');
    if (dto.name && dto.name !== zone.name) {
      const dup = await this.prisma.zone.findUnique({
        where: { warehouseId_name: { warehouseId: zone.warehouseId, name: dto.name } },
      });
      if (dup) throw new ConflictException('Zone name already in use');
    }
    return this.prisma.zone.update({ where: { id: zoneId }, data: dto });
  }

  async deleteZone(zoneId: string) {
    const zone = await this.prisma.zone.findUnique({
      where: { id: zoneId },
      include: { bins: { select: { id: true } } },
    });
    if (!zone) throw new NotFoundException('Zone not found');
    if (zone.bins.length > 0) {
      throw new ConflictException('Cannot delete zone with assigned bins');
    }
    return this.prisma.zone.delete({ where: { id: zoneId } });
  }

  /* ── Rack CRUD ── */

  async listRacks(zoneId: string) {
    return this.prisma.rack.findMany({
      where: { zoneId },
      include: { shelves: { include: { bins: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createRack(dto: CreateRackDto) {
    const zone = await this.prisma.zone.findUnique({ where: { id: dto.zoneId! } });
    if (!zone) throw new NotFoundException('Zone not found');
    const existing = await this.prisma.rack.findUnique({
      where: { zoneId_name: { zoneId: dto.zoneId!, name: dto.name } },
    });
    if (existing) throw new ConflictException('Rack name already exists in this zone');
    return this.prisma.rack.create({
      data: { zoneId: dto.zoneId!, name: dto.name, isActive: dto.isActive ?? true },
    });
  }

  async updateRack(rackId: string, dto: UpdateRackDto) {
    const rack = await this.prisma.rack.findUnique({ where: { id: rackId } });
    if (!rack) throw new NotFoundException('Rack not found');
    if (dto.name && dto.name !== rack.name) {
      const dup = await this.prisma.rack.findUnique({
        where: { zoneId_name: { zoneId: rack.zoneId, name: dto.name } },
      });
      if (dup) throw new ConflictException('Rack name already in use');
    }
    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.zoneId !== undefined) updateData.zoneId = dto.zoneId;
    return this.prisma.rack.update({ where: { id: rackId }, data: updateData });
  }

  async deleteRack(rackId: string) {
    const rack = await this.prisma.rack.findUnique({
      where: { id: rackId },
      include: { bins: { select: { id: true } } },
    });
    if (!rack) throw new NotFoundException('Rack not found');
    if (rack.bins.length > 0) {
      throw new ConflictException('Cannot delete rack with assigned bins');
    }
    return this.prisma.rack.delete({ where: { id: rackId } });
  }

  /* ── Shelf CRUD ── */

  async listShelves(rackId: string) {
    return this.prisma.shelf.findMany({
      where: { rackId },
      include: { bins: true },
      orderBy: { name: 'asc' },
    });
  }

  async createShelf(dto: CreateShelfDto) {
    const rack = await this.prisma.rack.findUnique({ where: { id: dto.rackId! } });
    if (!rack) throw new NotFoundException('Rack not found');
    const existing = await this.prisma.shelf.findUnique({
      where: { rackId_name: { rackId: dto.rackId!, name: dto.name } },
    });
    if (existing) throw new ConflictException('Shelf name already exists in this rack');
    return this.prisma.shelf.create({
      data: { rackId: dto.rackId!, name: dto.name, isActive: dto.isActive ?? true },
    });
  }

  async updateShelf(shelfId: string, dto: UpdateShelfDto) {
    const shelf = await this.prisma.shelf.findUnique({ where: { id: shelfId } });
    if (!shelf) throw new NotFoundException('Shelf not found');
    if (dto.name && dto.name !== shelf.name) {
      const dup = await this.prisma.shelf.findUnique({
        where: { rackId_name: { rackId: shelf.rackId, name: dto.name } },
      });
      if (dup) throw new ConflictException('Shelf name already in use');
    }
    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.rackId !== undefined) updateData.rackId = dto.rackId;
    return this.prisma.shelf.update({ where: { id: shelfId }, data: updateData });
  }

  async deleteShelf(shelfId: string) {
    const shelf = await this.prisma.shelf.findUnique({
      where: { id: shelfId },
      include: { bins: { select: { id: true } } },
    });
    if (!shelf) throw new NotFoundException('Shelf not found');
    if (shelf.bins.length > 0) {
      throw new ConflictException('Cannot delete shelf with assigned bins');
    }
    return this.prisma.shelf.delete({ where: { id: shelfId } });
  }
}

import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    try {
      return await this.prisma.warehouse.delete({
        where: { id },
      });
    } catch (err) {
      // A warehouse that stock, bins or history still reference cannot be
      // deleted — surface that as a clear 400 instead of leaking the raw
      // Prisma FK error to the admin (2026-11-02 audit: deleting a
      // referenced warehouse surfaced a bare "Referenced record not
      // found", which reads like a bug, not a rule).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2003' ||
          err.code === 'P2014' ||
          /foreign key|constraint/i.test(err.message))
      ) {
        throw new BadRequestException(
          'Warehouse is in use — stock, bins or history reference it — and cannot be deleted',
        );
      }
      throw err;
    }
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
      // Hierarchy relations included (2026-11-02 audit): both bin UIs
      // render zone/rack/shelf names from the payload — without the
      // relations those columns were permanently "-".
      include: {
        warehouse: { select: { id: true, name: true } },
        zone: { select: { id: true, name: true } },
        rack: { select: { id: true, name: true } },
        shelf: { select: { id: true, name: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  async listBinLocations(warehouseId: string) {
    return this.prisma.binLocation.findMany({
      where: { warehouseId },
      include: {
        zone: { select: { id: true, name: true } },
        rack: { select: { id: true, name: true } },
        shelf: { select: { id: true, name: true } },
      },
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
        // '' from form selects means "none" — never write it as an FK.
        zoneId: dto.zoneId || null,
        rackId: dto.rackId || null,
        shelfId: dto.shelfId || null,
      },
    });
  }

  async updateBinLocation(binId: string, dto: UpdateBinLocationDto) {
    const bin = await this.prisma.binLocation.findUnique({
      where: { id: binId },
    });
    if (!bin) throw new NotFoundException('Bin location not found');

    // Warehouse move (2026-11-03): the route stays nested under the CURRENT
    // warehouse, but the DTO may carry a different warehouseId — the admin
    // bin-edit form has always had a Warehouse select whose value was
    // silently dropped (the DTO had no such field), so the edit looked
    // inert. A move re-homes the bin; its zone/rack/shelf belong to the OLD
    // warehouse's hierarchy and are cleared unless the DTO supplies
    // replacements that validate against the NEW warehouse.
    const moving = !!dto.warehouseId && dto.warehouseId !== bin.warehouseId;
    const targetWarehouseId = moving ? dto.warehouseId! : bin.warehouseId;
    if (moving) {
      const target = await this.prisma.warehouse.findUnique({
        where: { id: targetWarehouseId },
      });
      if (!target) throw new NotFoundException('Target warehouse not found');
    }

    // Duplicate-code guard — checked against the warehouse the bin will END
    // UP in: a move can collide on an unchanged code, and a rename can
    // collide in the target warehouse.
    const nextCode = dto.code ?? bin.code;
    if ((dto.code && dto.code !== bin.code) || moving) {
      const dup = await this.prisma.binLocation.findUnique({
        where: {
          warehouseId_code: { warehouseId: targetWarehouseId, code: nextCode },
        },
      });
      if (dup && dup.id !== binId) {
        throw new ConflictException('Bin code already in use');
      }
    }

    let zoneId: string | null;
    let rackId: string | null;
    let shelfId: string | null;

    if (moving) {
      // Only DTO-supplied hierarchy survives a move, and only if it belongs
      // to the target warehouse — an old-warehouse zone id written onto a
      // bin in the new warehouse would corrupt the hierarchy.
      zoneId = dto.zoneId || null;
      rackId = dto.rackId || null;
      shelfId = dto.shelfId || null;
      if (zoneId) {
        const zone = await this.prisma.zone.findUnique({
          where: { id: zoneId },
          select: { warehouseId: true },
        });
        if (!zone || zone.warehouseId !== targetWarehouseId) {
          throw new ConflictException('Zone does not belong to the target warehouse');
        }
      }
      if (rackId) {
        const rack = await this.prisma.rack.findUnique({
          where: { id: rackId },
          select: { zoneId: true, zone: { select: { warehouseId: true } } },
        });
        if (!rack || rack.zone.warehouseId !== targetWarehouseId) {
          throw new ConflictException('Rack does not belong to the target warehouse');
        }
        if (zoneId && rack.zoneId !== zoneId) {
          throw new ConflictException('Rack does not belong to the selected zone');
        }
      }
      if (shelfId) {
        const shelf = await this.prisma.shelf.findUnique({
          where: { id: shelfId },
          select: {
            rackId: true,
            rack: { select: { zoneId: true, zone: { select: { warehouseId: true } } } },
          },
        });
        if (!shelf || shelf.rack.zone.warehouseId !== targetWarehouseId) {
          throw new ConflictException('Shelf does not belong to the target warehouse');
        }
        if (rackId && shelf.rackId !== rackId) {
          throw new ConflictException('Shelf does not belong to the selected rack');
        }
      }
      if (shelfId && !rackId) {
        throw new ConflictException('shelfId requires rackId');
      }
      if (rackId && !zoneId) {
        throw new ConflictException('rackId requires zoneId');
      }
    } else {
      // '' from form selects means "clear this level" — normalize to null
      // before it can reach a Prisma FK field (2026-11-02 audit: the admin
      // edit path sent raw '' values the create path already mapped away).
      zoneId = dto.zoneId !== undefined ? dto.zoneId || null : bin.zoneId;
      rackId = dto.rackId !== undefined ? dto.rackId || null : bin.rackId;
      shelfId = dto.shelfId !== undefined ? dto.shelfId || null : bin.shelfId;
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
    }

    return this.prisma.binLocation.update({
      where: { id: binId },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(moving && { warehouseId: targetWarehouseId }),
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
      include: {
        physicalInventories: { select: { id: true }, take: 1 },
        reservationAllocations: { select: { id: true }, take: 1 },
        products: { select: { id: true }, take: 1 },
        variants: { select: { id: true }, take: 1 },
      },
    });
    if (!bin) throw new NotFoundException('Bin location not found');
    if (bin.physicalInventories.length > 0) {
      throw new ConflictException('Cannot delete bin location with physical inventory records');
    }
    if (bin.reservationAllocations.length > 0) {
      throw new ConflictException('Cannot delete bin location with active reservation allocations');
    }
    if (bin.products.length > 0) {
      throw new ConflictException('Cannot delete bin location set as default bin for products');
    }
    if (bin.variants.length > 0) {
      throw new ConflictException('Cannot delete bin location set as bin for variants');
    }
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
      include: {
        racks: { select: { id: true } },
        bins: { select: { id: true } },
      },
    });
    if (!zone) throw new NotFoundException('Zone not found');
    if (zone.racks.length > 0) {
      throw new ConflictException('Cannot delete zone with existing racks');
    }
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
      include: {
        shelves: { select: { id: true } },
        bins: { select: { id: true } },
      },
    });
    if (!rack) throw new NotFoundException('Rack not found');
    if (rack.shelves.length > 0) {
      throw new ConflictException('Cannot delete rack with existing shelves');
    }
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

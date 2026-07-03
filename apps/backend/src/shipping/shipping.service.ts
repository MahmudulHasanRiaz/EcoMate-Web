import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateShippingOptionDto,
  UpdateShippingOptionDto,
  CreateShippingZoneGroupDto,
  UpdateShippingZoneGroupDto,
} from './dto/shipping.dto';

@Injectable()
export class ShippingService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Shipping Options ----
  async findAllOptions() {
    return this.prisma.shippingOption.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findActiveOptions() {
    return this.prisma.shippingOption.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createOption(dto: CreateShippingOptionDto) {
    return this.prisma.shippingOption.create({ data: dto });
  }

  async updateOption(id: string, dto: UpdateShippingOptionDto) {
    const existing = await this.prisma.shippingOption.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Shipping option not found');
    return this.prisma.shippingOption.update({ where: { id }, data: dto });
  }

  async deleteOption(id: string) {
    const existing = await this.prisma.shippingOption.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Shipping option not found');
    const ordersUsing = await this.prisma.order.count({
      where: { selectedShippingOptionId: id },
    });
    if (ordersUsing > 0) {
      throw new ConflictException(
        'Cannot delete: shipping option is in use by active orders',
      );
    }
    return this.prisma.shippingOption.delete({ where: { id } });
  }

  // ---- Zone Groups ----
  async findAllZoneGroups() {
    return this.prisma.shippingZoneGroup.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveZoneGroups() {
    return this.prisma.shippingZoneGroup.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createZoneGroup(dto: CreateShippingZoneGroupDto) {
    if (
      dto.type === 'custom_amount' &&
      (dto.amount == null || dto.amount < 0)
    ) {
      throw new BadRequestException(
        'Amount is required for custom_amount zones',
      );
    }
    await this.checkDistrictOverlap(dto.districts);
    return this.prisma.shippingZoneGroup.create({
      data: {
        label: dto.label,
        type: dto.type,
        amount: dto.type === 'custom_amount' ? dto.amount : null,
        districts: dto.districts,
        isActive: dto.isActive,
      },
    });
  }

  async updateZoneGroup(id: string, dto: UpdateShippingZoneGroupDto) {
    const existing = await this.prisma.shippingZoneGroup.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Zone group not found');

    if (dto.districts) {
      await this.checkDistrictOverlap(dto.districts, id);
    }

    const resolvedType = dto.type ?? existing.type;
    const resolvedAmount =
      resolvedType === 'no_delivery'
        ? null
        : dto.type === 'custom_amount' && dto.amount != null
          ? dto.amount
          : dto.amount !== undefined
            ? dto.amount
            : existing.amount;

    if (resolvedType === 'custom_amount' && resolvedAmount == null) {
      throw new BadRequestException(
        'Amount is required for custom_amount zones',
      );
    }

    return this.prisma.shippingZoneGroup.update({
      where: { id },
      data: {
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.districts !== undefined && { districts: dto.districts }),
        amount: resolvedAmount,
      },
    });
  }

  async deleteZoneGroup(id: string) {
    const existing = await this.prisma.shippingZoneGroup.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Zone group not found');

    return this.prisma.shippingZoneGroup.delete({ where: { id } });
  }

  private async checkDistrictOverlap(districts: string[], excludeId?: string) {
    if (!districts.length) return;
    const existing = await this.prisma.shippingZoneGroup.findMany({
      where: excludeId ? { id: { not: excludeId } } : undefined,
      select: { id: true, label: true, districts: true },
    });
    for (const group of existing) {
      const groupDistricts = group.districts as string[];
      const overlap = districts.filter((d) => groupDistricts.includes(d));
      if (overlap.length > 0) {
        throw new ConflictException(
          `Districts [${overlap.join(', ')}] already assigned to zone "${group.label || group.id}"`,
        );
      }
    }
  }
}

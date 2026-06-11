import { Injectable, NotFoundException } from '@nestjs/common';
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
    const data: any = { ...dto };
    if (dto.type === 'no_delivery') data.amount = null;
    return this.prisma.shippingZoneGroup.update({ where: { id }, data });
  }

  async deleteZoneGroup(id: string) {
    const existing = await this.prisma.shippingZoneGroup.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Zone group not found');
    return this.prisma.shippingZoneGroup.delete({ where: { id } });
  }
}

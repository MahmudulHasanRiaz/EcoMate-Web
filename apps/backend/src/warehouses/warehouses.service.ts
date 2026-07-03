import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(type?: string) {
    const where: any = { isActive: true };
    if (type) where.type = type;
    return this.prisma.warehouse.findMany({ where, orderBy: { name: 'asc' } });
  }
}

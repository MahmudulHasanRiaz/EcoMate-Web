import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('order-statuses')
export class OrderStatusController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.orderStatus.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    dto: {
      name?: string;
      color?: string;
      nextStatuses?: string[];
      isInitial?: boolean;
      isFinal?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.prisma.orderStatus.update({ where: { id }, data: dto as any });
  }
}

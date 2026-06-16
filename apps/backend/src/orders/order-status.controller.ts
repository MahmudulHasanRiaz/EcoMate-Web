import { Controller, Get, Put, Body, Param, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Controller('order-statuses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrderStatusController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.orderStatus.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Roles('superadmin', 'admin')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.prisma.orderStatus.update({ where: { id }, data: dto as any });
  }
}

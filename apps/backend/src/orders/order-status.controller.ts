import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Controller('order-statuses')
@RequiresFeature('admin_order_statuses')
export class OrderStatusController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.orderStatus.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Roles('superadmin', 'admin')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    const existing = await this.prisma.orderStatus.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException(`Order status ${id} not found`);

    if (dto.nextStatuses) {
      const valid = await this.prisma.orderStatus.count({
        where: { id: { in: dto.nextStatuses } },
      });
      if (valid !== dto.nextStatuses.length) {
        throw new BadRequestException(
          'One or more nextStatuses IDs are invalid',
        );
      }
    }

    return this.prisma.orderStatus.update({ where: { id }, data: dto as any });
  }
}

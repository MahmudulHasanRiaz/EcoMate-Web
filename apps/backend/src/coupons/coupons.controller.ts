import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('coupons')
export class CouponsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get() async findAll() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Get('validate')
  async validate(@Query('code') code: string) {
    if (!code) throw new BadRequestException('Coupon code is required');

    const coupon = await this.prisma.coupon.findUnique({
      where: { code },
    });

    if (!coupon) {
      return { valid: false, message: 'Coupon not found' };
    }
    if (!coupon.isActive) {
      return { valid: false, message: 'Coupon is no longer active' };
    }
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
      return { valid: false, message: 'Coupon usage limit has been reached' };
    }
    if (coupon.expiresAt && new Date() > coupon.expiresAt) {
      return { valid: false, message: 'Coupon has expired' };
    }
    if (coupon.startsAt && new Date() < coupon.startsAt) {
      return { valid: false, message: 'Coupon is not yet active' };
    }

    return {
      valid: true,
      coupon: {
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        minOrderValue: coupon.minOrderValue,
      },
    };
  }

  @Roles('superadmin', 'admin')
  @Post() async create(@Body() dto: Record<string, unknown>) {
    return this.prisma.coupon.create({
      data: {
        code: dto['code'] as string,
        type: (dto['type'] as string) || 'flat',
        value: dto['value'] as number,
        minOrderValue: dto['minOrderValue'] as number,
        maxUses: dto['maxUses'] as number,
        startsAt: dto['startsAt'] ? new Date(dto['startsAt'] as string) : null,
        expiresAt: dto['expiresAt']
          ? new Date(dto['expiresAt'] as string)
          : null,
      },
    });
  }
  @Roles('superadmin', 'admin')
  @Put(':id') async update(
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.prisma.coupon.update({
      where: { id },
      data: {
        code: dto['code'] as string,
        type: dto['type'] as string,
        value: dto['value'] as number,
        isActive: dto['isActive'] as boolean,
        minOrderValue: dto['minOrderValue'] as number,
        maxUses: dto['maxUses'] as number,
      },
    });
  }
  @Roles('superadmin', 'admin')
  @Delete(':id') async remove(@Param('id') id: string) {
    await this.prisma.coupon.delete({ where: { id } });
    return { message: 'Deleted' };
  }
}

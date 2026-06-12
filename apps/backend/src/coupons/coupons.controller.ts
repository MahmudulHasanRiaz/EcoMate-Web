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
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';

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
  @Post()
  async create(@Body() dto: CreateCouponDto) {
    return this.prisma.coupon.create({
      data: {
        code: dto.code,
        type: dto.type || 'flat',
        value: dto.value,
        minOrderValue: dto.minOrderValue,
        maxUses: dto.maxUses,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
  }
  @Roles('superadmin', 'admin')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.prisma.coupon.update({
      where: { id },
      data: {
        code: dto.code,
        type: dto.type,
        value: dto.value,
        isActive: dto.isActive,
        minOrderValue: dto.minOrderValue,
        maxUses: dto.maxUses,
      },
    });
  }
  @Roles('superadmin', 'admin')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.coupon.delete({ where: { id } });
    return { message: 'Deleted' };
  }
}

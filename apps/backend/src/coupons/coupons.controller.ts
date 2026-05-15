import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('coupons')
export class CouponsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get() async findAll() { return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } }); }
  @Post() async create(@Body() dto: Record<string, unknown>) { return this.prisma.coupon.create({ data: { code: dto['code'] as string, type: (dto['type'] as string) || 'flat', value: dto['value'] as number, minOrderValue: dto['minOrderValue'] as number, maxUses: dto['maxUses'] as number, startsAt: dto['startsAt'] ? new Date(dto['startsAt'] as string) : null, expiresAt: dto['expiresAt'] ? new Date(dto['expiresAt'] as string) : null } }); }
  @Put(':id') async update(@Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.prisma.coupon.update({ where: { id }, data: { code: dto['code'] as string, type: dto['type'] as string, value: dto['value'] as number, isActive: dto['isActive'] as boolean, minOrderValue: dto['minOrderValue'] as number, maxUses: dto['maxUses'] as number } }); }
  @Delete(':id') async remove(@Param('id') id: string) { await this.prisma.coupon.delete({ where: { id } }); return { message: 'Deleted' }; }
}

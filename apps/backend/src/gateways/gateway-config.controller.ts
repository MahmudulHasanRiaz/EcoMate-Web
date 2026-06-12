import { Controller, Get, Put, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { PaymentOptionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { normalizePhone } from '../common/utils/phone-utils';

@Controller('gateways')
export class GatewayConfigController {
  constructor(private readonly prisma: PrismaService) {}

  // ============ PUBLIC: Storefront fetches enabled gateways ============
  @Public()
  @Get()
  async findAll() {
    const gateways = await this.prisma.paymentGateway.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: 'asc' },
      include: { paymentOption: true },
    });
    return gateways.map((g) => ({
      id: g.id,
      code: g.code,
      name: g.name,
      type: g.type,
      paymentOptionType: g.paymentOptionType,
      paymentOptionName: g.paymentOption?.name,
      enabled: g.enabled,
      mode: g.mode,
      phoneNumber: g.phoneNumber,
    }));
  }

  // ============ ADMIN: Payment Options CRUD ============
  @Roles('superadmin', 'admin')
  @Get('options')
  async findAllOptions() {
    return this.prisma.paymentOption.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        gateways: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  @Roles('superadmin', 'admin')
  @Put('options/:type')
  async upsertOption(@Param('type') type: string, @Body() dto: any) {
    return this.prisma.paymentOption.upsert({
      where: { type: type as PaymentOptionType },
      create: { type, ...dto },
      update: dto,
    });
  }

  // ============ ADMIN: Payment Gateways CRUD ============
  @Roles('superadmin', 'admin')
  @Get('admin')
  async findAllAdmin(@Query('optionType') optionType?: string) {
    const where = optionType ? { paymentOptionType: optionType as PaymentOptionType } : {};
    const gateways = await this.prisma.paymentGateway.findMany({
      where,
      orderBy: [{ paymentOptionType: 'asc' }, { sortOrder: 'asc' }],
      include: { paymentOption: true },
    });
    return gateways.map((g) => ({
      id: g.id,
      code: g.code,
      name: g.name,
      type: g.type,
      paymentOptionType: g.paymentOptionType,
      paymentOptionName: g.paymentOption?.name,
      enabled: g.enabled,
      mode: g.mode,
      phoneNumber: g.phoneNumber,
      credentials: g.credentials,
      sortOrder: g.sortOrder,
    }));
  }

  @Roles('superadmin', 'admin')
  @Post()
  async createGateway(@Body() dto: any) {
    const phoneNumber = dto.phoneNumber ? normalizePhone(dto.phoneNumber) : null;
    return this.prisma.paymentGateway.create({
      data: {
        code: dto.code,
        name: dto.name,
        type: dto.type,
        paymentOptionType: dto.paymentOptionType,
        enabled: dto.enabled ?? false,
        mode: dto.mode || 'personal',
        phoneNumber,
        credentials: dto.credentials || {},
        sortOrder: dto.sortOrder || 0,
      },
    });
  }

  @Roles('superadmin', 'admin')
  @Put(':code')
  async upsertGateway(@Param('code') code: string, @Body() dto: any) {
    const phoneNumber = dto.phoneNumber ? normalizePhone(dto.phoneNumber) : null;
    return this.prisma.paymentGateway.upsert({
      where: { code },
      create: {
        code,
        name: dto.name,
        type: dto.type,
        paymentOptionType: dto.paymentOptionType,
        enabled: dto.enabled ?? false,
        mode: dto.mode || 'personal',
        phoneNumber,
        credentials: dto.credentials || {},
        sortOrder: dto.sortOrder || 0,
      },
      update: {
        name: dto.name,
        type: dto.type,
        paymentOptionType: dto.paymentOptionType,
        enabled: dto.enabled,
        mode: dto.mode,
        phoneNumber,
        credentials: dto.credentials,
        sortOrder: dto.sortOrder,
      },
    });
  }

  // ============ ADMIN: Product Payment Option Overrides ============
  @Roles('superadmin', 'admin')
  @Get('product-overrides/:productId')
  async findProductOverrides(@Param('productId') productId: string) {
    return this.prisma.productPaymentOption.findMany({
      where: { productId },
      include: { paymentOption: true },
    });
  }

  @Roles('superadmin', 'admin')
  @Put('product-overrides/:productId/:type')
  async upsertProductOverride(
    @Param('productId') productId: string,
    @Param('type') type: PaymentOptionType,
    @Body() dto: { enabled: boolean; partialFixedAmount?: number; partialPercentage?: number },
  ) {
    return this.prisma.productPaymentOption.upsert({
      where: { productId_comboId_paymentOptionType: { productId, comboId: null as any, paymentOptionType: type } },
      create: { productId, comboId: null as any, paymentOptionType: type, ...dto },
      update: dto,
    });
  }

  @Roles('superadmin', 'admin')
  @Delete('product-overrides/:productId/:type')
  async deleteProductOverride(
    @Param('productId') productId: string,
    @Param('type') type: PaymentOptionType,
  ) {
    return this.prisma.productPaymentOption.delete({
      where: { productId_comboId_paymentOptionType: { productId, comboId: null as any, paymentOptionType: type } },
    });
  }

  // ============ ADMIN: Combo Payment Option Overrides ============
  @Roles('superadmin', 'admin')
  @Get('combo-overrides/:comboId')
  async findComboOverrides(@Param('comboId') comboId: string) {
    return this.prisma.productPaymentOption.findMany({
      where: { comboId },
      include: { paymentOption: true },
    });
  }

  @Roles('superadmin', 'admin')
  @Put('combo-overrides/:comboId/:type')
  async upsertComboOverride(
    @Param('comboId') comboId: string,
    @Param('type') type: PaymentOptionType,
    @Body() dto: { enabled: boolean; partialFixedAmount?: number; partialPercentage?: number },
  ) {
    return this.prisma.productPaymentOption.upsert({
      where: { productId_comboId_paymentOptionType: { productId: null as any, comboId, paymentOptionType: type } },
      create: { productId: null as any, comboId, paymentOptionType: type, ...dto },
      update: dto,
    });
  }

  @Roles('superadmin', 'admin')
  @Delete('combo-overrides/:comboId/:type')
  async deleteComboOverride(
    @Param('comboId') comboId: string,
    @Param('type') type: PaymentOptionType,
  ) {
    return this.prisma.productPaymentOption.delete({
      where: { productId_comboId_paymentOptionType: { productId: null as any, comboId, paymentOptionType: type } },
    });
  }

  @Roles('superadmin', 'admin')
  @Get(':code')
  async findOne(@Param('code') code: string) {
    return this.prisma.paymentGateway.findUnique({ where: { code } });
  }
}

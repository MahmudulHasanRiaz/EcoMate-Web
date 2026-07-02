import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentOptionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { normalizePhone } from '../common/utils/phone-utils';

@Controller('gateways')
export class GatewayConfigController implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      await this.ensureStandardGateways();
    } catch (err) {
      console.error('Failed to auto-seed payment gateways:', err);
    }
  }

  async ensureStandardGateways() {
    // 1. Ensure payment options
    const paymentOptions = [
      {
        type: PaymentOptionType.FULL_PAYMENT,
        name: 'Full Payment',
        description: 'Pay the full order amount online',
        enabled: true,
        sortOrder: 1,
      },
      {
        type: PaymentOptionType.PARTIAL_PAYMENT,
        name: 'Partial Payment',
        description: 'Pay a partial amount online, rest on delivery',
        enabled: true,
        sortOrder: 2,
      },
      {
        type: PaymentOptionType.CASH_ON_DELIVERY,
        name: 'Cash on Delivery',
        description: 'Pay in cash when order is delivered',
        enabled: true,
        sortOrder: 3,
      },
    ];
    for (const opt of paymentOptions) {
      await this.prisma.paymentOption.upsert({
        where: { type: opt.type },
        create: opt,
        update: {},
      });
    }

    // 2. Ensure gateways
    const gateways = [
      {
        code: 'cash',
        name: 'Cash',
        type: 'cash',
        paymentOptionType: PaymentOptionType.CASH_ON_DELIVERY,
        enabled: true,
        mode: 'personal',
        phoneNumber: null,
        credentials: {},
        sortOrder: 1,
      },
      {
        code: 'bkash',
        name: 'bKash (Manual)',
        type: 'manual',
        paymentOptionType: PaymentOptionType.FULL_PAYMENT,
        enabled: false,
        mode: 'personal',
        phoneNumber: '01700000000',
        credentials: {},
        sortOrder: 2,
      },
      {
        code: 'nagad',
        name: 'Nagad (Manual)',
        type: 'manual',
        paymentOptionType: PaymentOptionType.FULL_PAYMENT,
        enabled: false,
        mode: 'personal',
        phoneNumber: '01700000001',
        credentials: {},
        sortOrder: 3,
      },
      {
        code: 'rocket',
        name: 'Rocket (Manual)',
        type: 'manual',
        paymentOptionType: PaymentOptionType.FULL_PAYMENT,
        enabled: false,
        mode: 'personal',
        phoneNumber: '01700000002',
        credentials: {},
        sortOrder: 4,
      },
      {
        code: 'upay',
        name: 'Upay (Manual)',
        type: 'manual',
        paymentOptionType: PaymentOptionType.FULL_PAYMENT,
        enabled: false,
        mode: 'personal',
        phoneNumber: null,
        credentials: {},
        sortOrder: 5,
      },
      {
        code: 'cellfin',
        name: 'Cellfin (Manual)',
        type: 'manual',
        paymentOptionType: PaymentOptionType.FULL_PAYMENT,
        enabled: false,
        mode: 'personal',
        phoneNumber: null,
        credentials: {},
        sortOrder: 6,
      },
      {
        code: 'bkash_pgw',
        name: 'bKash PGW (API)',
        type: 'api',
        paymentOptionType: PaymentOptionType.FULL_PAYMENT,
        enabled: false,
        mode: 'sandbox',
        phoneNumber: null,
        credentials: { appKey: '', appSecret: '', username: '', password: '' },
        sortOrder: 7,
      },
    ];
    for (const g of gateways) {
      await this.prisma.paymentGateway.upsert({
        where: { code: g.code },
        create: g,
        update: {},
      });
    }
  }

  // ============ PUBLIC: Storefront fetches enabled gateways ============
  @Public()
  @Get()
  async findAll() {
    const gateways = await this.prisma.paymentGateway.findMany({
      where: { enabled: true, paymentOption: { enabled: true } },
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
  @RequiresFeature('admin_payments')
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
  @RequiresFeature('admin_payments')
  @Put('options/:type')
  async upsertOption(@Param('type') type: PaymentOptionType, @Body() dto: any) {
    const validTypes = Object.values(PaymentOptionType);
    if (!validTypes.includes(type))
      throw new BadRequestException(`Invalid payment option type: "${type}"`);
    const displayNames: Record<string, string> = {
      FULL_PAYMENT: 'Full Payment',
      PARTIAL_PAYMENT: 'Partial Payment',
      CASH_ON_DELIVERY: 'Cash on Delivery',
    };
    return this.prisma.paymentOption.upsert({
      where: { type },
      create: { type, name: displayNames[type] || type, ...dto },
      update: dto,
    });
  }

  // ============ ADMIN: Payment Gateways CRUD ============
  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_payments')
  @Get('admin')
  async findAllAdmin(@Query('optionType') optionType?: string) {
    const where = optionType
      ? { paymentOptionType: optionType as PaymentOptionType }
      : {};
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
  @RequiresFeature('admin_payments')
  @Post()
  async createGateway(@Body() dto: any) {
    const phoneNumber = dto.phoneNumber
      ? normalizePhone(dto.phoneNumber)
      : null;
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
  @RequiresFeature('admin_payments')
  @Put(':code')
  async upsertGateway(@Param('code') code: string, @Body() dto: any) {
    const phoneNumber = dto.phoneNumber
      ? normalizePhone(dto.phoneNumber)
      : null;
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
  @RequiresFeature('admin_payments')
  @Get('product-overrides/:productId')
  async findProductOverrides(@Param('productId') productId: string) {
    return this.prisma.productPaymentOption.findMany({
      where: { productId },
      include: { paymentOption: true },
    });
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_payments')
  @Put('product-overrides/:productId/:type')
  async upsertProductOverride(
    @Param('productId') productId: string,
    @Param('type') type: PaymentOptionType,
    @Body()
    dto: {
      enabled: boolean;
      partialFixedAmount?: number;
      partialPercentage?: number;
    },
  ) {
    return this.prisma.productPaymentOption.upsert({
      where: {
        productId_comboId_paymentOptionType: {
          productId,
          comboId: null as any,
          paymentOptionType: type,
        },
      },
      create: {
        productId,
        comboId: null as any,
        paymentOptionType: type,
        ...dto,
      },
      update: dto,
    });
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_payments')
  @Delete('product-overrides/:productId/:type')
  async deleteProductOverride(
    @Param('productId') productId: string,
    @Param('type') type: PaymentOptionType,
  ) {
    try {
      return await this.prisma.productPaymentOption.delete({
        where: {
          productId_comboId_paymentOptionType: {
            productId,
            comboId: null as any,
            paymentOptionType: type,
          },
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      )
        throw new NotFoundException(
          `Product override not found for product ${productId}, type ${type}`,
        );
      throw err;
    }
  }

  // ============ ADMIN: Combo Payment Option Overrides ============
  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_payments')
  @Get('combo-overrides/:comboId')
  async findComboOverrides(@Param('comboId') comboId: string) {
    return this.prisma.productPaymentOption.findMany({
      where: { comboId },
      include: { paymentOption: true },
    });
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_payments')
  @Put('combo-overrides/:comboId/:type')
  async upsertComboOverride(
    @Param('comboId') comboId: string,
    @Param('type') type: PaymentOptionType,
    @Body()
    dto: {
      enabled: boolean;
      partialFixedAmount?: number;
      partialPercentage?: number;
    },
  ) {
    return this.prisma.productPaymentOption.upsert({
      where: {
        productId_comboId_paymentOptionType: {
          productId: null as any,
          comboId,
          paymentOptionType: type,
        },
      },
      create: {
        productId: null as any,
        comboId,
        paymentOptionType: type,
        ...dto,
      },
      update: dto,
    });
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_payments')
  @Delete('combo-overrides/:comboId/:type')
  async deleteComboOverride(
    @Param('comboId') comboId: string,
    @Param('type') type: PaymentOptionType,
  ) {
    try {
      return await this.prisma.productPaymentOption.delete({
        where: {
          productId_comboId_paymentOptionType: {
            productId: null as any,
            comboId,
            paymentOptionType: type,
          },
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      )
        throw new NotFoundException(
          `Combo override not found for combo ${comboId}, type ${type}`,
        );
      throw err;
    }
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_payments')
  @Get(':code')
  async findOne(@Param('code') code: string) {
    const gateway = await this.prisma.paymentGateway.findUnique({
      where: { code },
    });
    if (!gateway) throw new NotFoundException(`Gateway "${code}" not found`);
    return gateway;
  }
}

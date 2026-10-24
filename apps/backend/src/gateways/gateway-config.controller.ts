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
import {
  ensureGatewaySettlementAccount,
  normalizeAccountId,
} from '../payments/payment-account';

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

    // 3. D6: every standard gateway gets its namesake settlement account
    // (created + mapped on first sight; existing accounts and mappings are
    // never overridden). Fail-soft per gateway: a bad row must not stop
    // the app from booting.
    for (const g of gateways) {
      try {
        const row = await this.prisma.paymentGateway.findUnique({
          where: { code: g.code },
          select: { id: true, code: true, name: true, accountId: true },
        });
        if (row) await ensureGatewaySettlementAccount(this.prisma, row);
      } catch (err) {
        console.error(
          `Failed to ensure settlement account for gateway ${g.code}:`,
          err,
        );
      }
    }
  }

  // ============ PUBLIC: Storefront / POS fetch enabled gateways ============
  // One public list, two surfaces (D6): the default view is the website's;
  // the POS app passes ?surface=pos and gets its own visibility set.
  @Public()
  @Get()
  async findAll(@Query('surface') surface?: string) {
    const isPos = surface === 'pos';
    const surfaceWhere = isPos ? { showOnPos: true } : { showOnStorefront: true };
    const gateways = await this.prisma.paymentGateway.findMany({
      where: {
        enabled: true,
        ...surfaceWhere,
        // D7 (owner-locked 2026-10-24): PaymentOption.enabled is a
        // STOREFRONT-ONLY flag — it narrows what website customers may
        // pick at checkout and must never hide gateways from the POS.
        ...(isPos ? {} : { paymentOption: { enabled: true } }),
      },
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
      logoUrl: g.logoUrl,
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
          include: {
            account: { select: { id: true, code: true, name: true, type: true } },
          },
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
      include: {
        paymentOption: true,
        account: { select: { id: true, code: true, name: true, type: true } },
      },
    });
    return gateways.map((g) => ({
      id: g.id,
      code: g.code,
      name: g.name,
      type: g.type,
      paymentOptionType: g.paymentOptionType,
      paymentOptionName: g.paymentOption?.name,
      paymentOptionEnabled: g.paymentOption?.enabled,
      enabled: g.enabled,
      showOnStorefront: g.showOnStorefront,
      showOnAdmin: g.showOnAdmin,
      showOnPos: g.showOnPos,
      logoUrl: g.logoUrl,
      mode: g.mode,
      phoneNumber: g.phoneNumber,
      accountId: g.accountId,
      account: g.account,
      credentials: g.credentials,
      sortOrder: g.sortOrder,
      // D (owner-locked): tri-state overrides — null = use global default.
      staffAutoVerifiedOverride: g.staffAutoVerifiedOverride,
      editAllowedOverride: g.editAllowedOverride,
    }));
  }

  // ============ STAFF-SAFE: Payment-form gateway list (D17) ============
  // Every role that may record a payment (superadmin/admin/employee) needs
  // the selectable gateway set — but GET /gateways/admin ALSO returns raw
  // gateway `credentials`, so it must stay admin-only (widening it would
  // leak secrets to every staff account). This endpoint returns ONLY the
  // fields a payment form selects on; it never returns credentials or
  // settings overrides. The client keeps the D6/D7 filtering (enabled +
  // showOnAdmin for new selections, enabled set for history), so the
  // server returns the whole enabled set with each gateway's mapped
  // settlement account embedded — the form no longer needs the
  // admin-only /accounts/tree call either.
  // Placed before @Get(':code') so 'payment-form' is never captured as a code.
  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_payments')
  @Get('payment-form')
  async findAllForPaymentForm() {
    const gateways = await this.prisma.paymentGateway.findMany({
      where: { enabled: true },
      orderBy: [{ paymentOptionType: 'asc' }, { sortOrder: 'asc' }],
      include: {
        account: {
          select: { id: true, code: true, name: true, type: true, isActive: true },
        },
      },
    });
    return gateways.map((g) => ({
      id: g.id,
      code: g.code,
      name: g.name,
      type: g.type,
      paymentOptionType: g.paymentOptionType,
      enabled: g.enabled,
      showOnAdmin: g.showOnAdmin,
      logoUrl: g.logoUrl,
      phoneNumber: g.phoneNumber,
      accountId: g.accountId,
      // A deactivated mapped account reads as unmapped here — the same
      // stale-mapping warning the form used to derive from the account
      // tree, without needing that admin-only call.
      account:
        g.account && g.account.isActive !== false
          ? {
              id: g.account.id,
              code: g.account.code,
              name: g.account.name,
              type: g.account.type,
            }
          : null,
    }));
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_payments')
  @Post()
  async createGateway(@Body() dto: any) {
    const phoneNumber = dto.phoneNumber
      ? normalizePhone(dto.phoneNumber)
      : null;
    const accountId = await normalizeAccountId(
      this.prisma,
      dto.accountId,
      'Settlement account',
    );
    const created = await this.prisma.paymentGateway.create({
      data: {
        code: dto.code,
        name: dto.name,
        type: dto.type,
        paymentOptionType: dto.paymentOptionType,
        enabled: dto.enabled ?? false,
        showOnStorefront: dto.showOnStorefront !== false,
        showOnAdmin: dto.showOnAdmin !== false,
        showOnPos: dto.showOnPos !== false,
        logoUrl: dto.logoUrl || null,
        mode: dto.mode || 'personal',
        phoneNumber,
        accountId: accountId ?? null,
        credentials: dto.credentials || {},
        sortOrder: dto.sortOrder || 0,
      },
    });
    // D6: a gateway created without a chosen account gets its namesake
    // account auto-created + mapped (owner-locked, custom gateways too).
    if (!created.accountId) {
      const ensured = await ensureGatewaySettlementAccount(this.prisma, created);
      if (ensured.mapped) return { ...created, accountId: ensured.accountId };
    }
    return created;
  }

  @Roles('superadmin', 'admin')
  @RequiresFeature('admin_payments')
  @Put(':code')
  async upsertGateway(@Param('code') code: string, @Body() dto: any) {
    const phoneNumber = dto.phoneNumber
      ? normalizePhone(dto.phoneNumber)
      : null;
    // Part 1: settlement account is optional. Present-and-null clears it;
    // absent leaves the existing mapping untouched. A supplied id must be an
    // active, non-group asset leaf.
    const accountId = await normalizeAccountId(
      this.prisma,
      dto.accountId,
      'Settlement account',
    );
    // D: tri-state overrides — only touched when the key is present, so
    // existing callers that never send them can't silently clear them.
    const overrideUpdate: Record<string, boolean | null> = {};
    if ('staffAutoVerifiedOverride' in dto) {
      overrideUpdate.staffAutoVerifiedOverride =
        dto.staffAutoVerifiedOverride === null
          ? null
          : dto.staffAutoVerifiedOverride === true;
    }
    if ('editAllowedOverride' in dto) {
      overrideUpdate.editAllowedOverride =
        dto.editAllowedOverride === null ? null : dto.editAllowedOverride === true;
    }
    // D6: surface flags + logo — same present-key discipline as the
    // overrides: an absent key leaves the stored value untouched.
    const surfaceUpdate: Record<string, boolean | string | null> = {};
    for (const key of ['showOnStorefront', 'showOnAdmin', 'showOnPos'] as const) {
      if (key in dto) surfaceUpdate[key] = dto[key] === true;
    }
    if ('logoUrl' in dto) surfaceUpdate.logoUrl = dto.logoUrl || null;
    const existing = await this.prisma.paymentGateway.findUnique({
      where: { code },
      select: { id: true },
    });
    const saved = await this.prisma.paymentGateway.upsert({
      where: { code },
      create: {
        code,
        name: dto.name,
        type: dto.type,
        paymentOptionType: dto.paymentOptionType,
        enabled: dto.enabled ?? false,
        showOnStorefront: dto.showOnStorefront !== false,
        showOnAdmin: dto.showOnAdmin !== false,
        showOnPos: dto.showOnPos !== false,
        logoUrl: dto.logoUrl || null,
        mode: dto.mode || 'personal',
        phoneNumber,
        accountId: accountId ?? null,
        credentials: dto.credentials || {},
        sortOrder: dto.sortOrder || 0,
        ...overrideUpdate,
      },
      update: {
        name: dto.name,
        type: dto.type,
        paymentOptionType: dto.paymentOptionType,
        enabled: dto.enabled,
        mode: dto.mode,
        phoneNumber,
        ...(accountId !== undefined ? { accountId } : {}),
        credentials: dto.credentials,
        sortOrder: dto.sortOrder,
        ...overrideUpdate,
        ...surfaceUpdate,
      },
    });
    // D6: only a genuinely NEW gateway (this call created it) with no
    // chosen account gets the auto-created namesake account. Updates —
    // including a deliberate mapping clear — are never re-mapped.
    if (!existing && !saved.accountId) {
      const ensured = await ensureGatewaySettlementAccount(this.prisma, saved);
      if (ensured.mapped) return { ...saved, accountId: ensured.accountId };
    }
    return saved;
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

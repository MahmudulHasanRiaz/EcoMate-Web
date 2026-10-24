import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  evaluateDiscounts,
  isOnSalePrice,
  type CategoryNode,
  type DiscountLine,
  type DiscountRule,
} from './discount-evaluation';
import {
  CreateDiscountDto,
  EvaluateDiscountsDto,
  UpdateDiscountDto,
} from './dto/discount.dto';

/**
 * D19 — Advanced (automatic) discounts, extended by Discount V2
 * (2026-10-24: scoped thresholds, sale exclusion, per-order cap,
 * coupon-stack control, usage caps, first-order-only, priority,
 * variant narrowing, scope names for the admin list).
 *
 * This service owns CRUD plus the two evaluation entry points:
 * - evaluateForCart(): the storefront-facing path (public endpoint) — the
 *   customer sees exactly what order creation will charge.
 * - The order-creation path calls evaluateForCart() with the caller's
 *   transaction client + order context (coupon code, customer key), so
 *   the rule read and the cap/first-order checks are consistent with
 *   the order write. Both funnel into the same pure engine, so display
 *   and charge can never disagree — except for per-customer and
 *   first-order rules on the public endpoint, where the customer is
 *   unknown at display time (order creation is authoritative there).
 */
@Injectable()
export class DiscountsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const discounts = await this.prisma.discount.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { applications: true } } },
    });
    const categoryIds = [
      ...new Set(discounts.flatMap((d) => d.categoryIds ?? [])),
    ];
    const productIds = [
      ...new Set(discounts.flatMap((d) => d.productIds ?? [])),
    ];
    // Empty `in` lists return [] in Prisma, so no conditional needed.
    const [categories, products] = await Promise.all([
      this.prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true },
      }),
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true },
      }),
    ]);
    const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
    const productNames = new Map(products.map((p) => [p.id, p.name]));
    return discounts.map((d) => ({
      ...d,
      scopeNames:
        d.scope === 'CATEGORY'
          ? (d.categoryIds ?? []).map((id) => categoryNames.get(id) ?? id)
          : d.scope === 'PRODUCT'
            ? (d.productIds ?? []).map((id) => productNames.get(id) ?? id)
            : [],
    }));
  }

  async findOne(id: string) {
    const discount = await this.prisma.discount.findUnique({
      where: { id },
      include: { _count: { select: { applications: true } } },
    });
    if (!discount) throw new NotFoundException('Discount not found');
    return discount;
  }

  async findApplications(id: string) {
    await this.findOne(id);
    return this.prisma.discountApplication.findMany({
      where: { discountId: id },
      orderBy: { createdAt: 'desc' },
      include: { order: { select: { displayId: true, total: true } } },
    });
  }

  /** Schedule-active rules only (condition + scope are evaluated per cart). */
  async findActiveRules(now = new Date()): Promise<DiscountRule[]> {
    const rows = await this.prisma.discount.findMany({
      where: {
        isActive: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRule);
  }

  /** Active rules as a public summary (no internals, safe for storefront). */
  async findActiveSummaries(now = new Date()) {
    const rows = await this.findActiveRules(now);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      scope: r.scope,
      type: r.type,
      value: r.value,
      minOrderAmount: r.minOrderAmount,
      minQuantity: r.minQuantity,
      excludeSaleItems: r.excludeSaleItems,
      maxDiscountAmount: r.maxDiscountAmount,
      combineWithCoupon: r.combineWithCoupon,
      firstOrderOnly: r.firstOrderOnly,
      priority: r.priority,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
    }));
  }

  async create(dto: CreateDiscountDto) {
    const data = await this.validateScopeTargets(dto);
    // title is required on create (the DTO guarantees it); the shared
    // validator's return type leaves it optional for the update path.
    return this.prisma.discount.create({
      data: { ...data, title: dto.title },
    });
  }

  async update(id: string, dto: UpdateDiscountDto) {
    await this.findOne(id);
    const current = await this.prisma.discount.findUnique({ where: { id } });
    const merged = {
      scope: dto.scope ?? current!.scope,
      categoryIds: dto.categoryIds ?? current!.categoryIds,
      productIds: dto.productIds ?? current!.productIds,
      // Leaving PRODUCT scope clears variant narrowing (validated as []),
      // so a scope change away from PRODUCT never trips the narrowing
      // guard on the rule's own stale variantIds.
      variantIds:
        (dto.scope ?? current!.scope) !== 'PRODUCT'
          ? []
          : (dto.variantIds ?? current!.variantIds),
      type: dto.type ?? current!.type,
      value: dto.value ?? Number(current!.value),
    };
    await this.validateScopeTargets(merged);
    const clearsVariants = merged.scope !== 'PRODUCT';
    return this.prisma.discount.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.scope !== undefined ? { scope: dto.scope } : {}),
        ...(dto.categoryIds !== undefined
          ? { categoryIds: dto.categoryIds }
          : {}),
        ...(dto.productIds !== undefined
          ? { productIds: dto.productIds }
          : {}),
        ...(clearsVariants
          ? { variantIds: [] }
          : dto.variantIds !== undefined
            ? { variantIds: dto.variantIds }
            : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.value !== undefined ? { value: dto.value } : {}),
        ...(dto.minOrderAmount !== undefined
          ? { minOrderAmount: dto.minOrderAmount }
          : {}),
        ...(dto.minQuantity !== undefined
          ? { minQuantity: dto.minQuantity }
          : {}),
        ...(dto.excludeSaleItems !== undefined
          ? { excludeSaleItems: dto.excludeSaleItems }
          : {}),
        ...(dto.maxDiscountAmount !== undefined
          ? { maxDiscountAmount: dto.maxDiscountAmount }
          : {}),
        ...(dto.combineWithCoupon !== undefined
          ? { combineWithCoupon: dto.combineWithCoupon }
          : {}),
        ...(dto.maxUses !== undefined ? { maxUses: dto.maxUses } : {}),
        ...(dto.maxUsesPerCustomer !== undefined
          ? { maxUsesPerCustomer: dto.maxUsesPerCustomer }
          : {}),
        ...(dto.firstOrderOnly !== undefined
          ? { firstOrderOnly: dto.firstOrderOnly }
          : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.startsAt !== undefined
          ? { startsAt: dto.startsAt ? new Date(dto.startsAt) : null }
          : {}),
        // endsAt: null is a real instruction (reopen), not an omission.
        ...(dto.endsAt !== undefined
          ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async remove(id: string) {
    const discount = await this.findOne(id);
    if ((discount as any)._count.applications > 0) {
      throw new BadRequestException(
        'Cannot delete a discount that has been applied to orders — deactivate it instead',
      );
    }
    await this.prisma.discount.delete({ where: { id } });
    return { message: 'Deleted' };
  }

  /**
   * Shared scope/value validation. A rule pointing at nothing (CATEGORY
   * with no categories, PRODUCT with no products) would silently never
   * apply — fail at creation instead. Referenced ids must exist.
   */
  private async validateScopeTargets(input: {
    scope: string;
    categoryIds?: string[];
    productIds?: string[];
    variantIds?: string[];
    type: string;
    value: number;
    title?: string;
    minOrderAmount?: number | null;
    minQuantity?: number | null;
    excludeSaleItems?: boolean;
    maxDiscountAmount?: number | null;
    combineWithCoupon?: boolean;
    maxUses?: number | null;
    maxUsesPerCustomer?: number | null;
    firstOrderOnly?: boolean;
    priority?: number;
    startsAt?: string | null;
    endsAt?: string | null;
    isActive?: boolean;
  }) {
    const categoryIds = input.categoryIds ?? [];
    const productIds = input.productIds ?? [];
    const variantIds = input.variantIds ?? [];
    if (input.scope === 'CATEGORY' && categoryIds.length === 0) {
      throw new BadRequestException(
        'A category discount needs at least one category',
      );
    }
    if (input.scope === 'PRODUCT' && productIds.length === 0) {
      throw new BadRequestException(
        'A product discount needs at least one product',
      );
    }
    if (input.scope !== 'PRODUCT' && variantIds.length > 0) {
      throw new BadRequestException(
        'Variants can only narrow a product discount',
      );
    }
    if (input.type === 'percentage' && (input.value <= 0 || input.value > 100)) {
      throw new BadRequestException(
        'A percentage discount must be between 0 and 100',
      );
    }
    if (input.type === 'flat' && input.value < 0) {
      throw new BadRequestException('A flat discount cannot be negative');
    }
    if (categoryIds.length > 0) {
      const found = await this.prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true },
      });
      if (found.length !== new Set(categoryIds).size) {
        throw new BadRequestException('One or more categories do not exist');
      }
    }
    if (productIds.length > 0) {
      const found = await this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true },
      });
      if (found.length !== new Set(productIds).size) {
        throw new BadRequestException('One or more products do not exist');
      }
    }
    if (variantIds.length > 0) {
      const found = await this.prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, productId: true },
      });
      const productSet = new Set(productIds);
      if (
        found.length !== new Set(variantIds).size ||
        found.some((v) => !productSet.has(v.productId))
      ) {
        throw new BadRequestException(
          'One or more variants do not exist or belong to another product',
        );
      }
    }
    return {
      title: input.title,
      scope: input.scope,
      categoryIds,
      productIds,
      variantIds,
      type: input.type,
      value: input.value,
      minOrderAmount: input.minOrderAmount ?? null,
      minQuantity: input.minQuantity ?? null,
      excludeSaleItems: input.excludeSaleItems ?? false,
      maxDiscountAmount: input.maxDiscountAmount ?? null,
      combineWithCoupon: input.combineWithCoupon ?? true,
      maxUses: input.maxUses ?? null,
      maxUsesPerCustomer: input.maxUsesPerCustomer ?? null,
      firstOrderOnly: input.firstOrderOnly ?? false,
      priority: input.priority ?? 0,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      isActive: input.isActive ?? true,
    };
  }

  /**
   * Evaluate a cart. `client` is PrismaService normally, or the caller's
   * transaction client from order creation — both expose the same delegates.
   * `opts.customerKey` marks the order path: per-customer caps and
   * first-order checks run only there (the public endpoint has no
   * customer identity), and capped rule rows are locked FOR UPDATE so two
   * concurrent orders cannot both slip under a cap.
   */
  async evaluateForCart(
    dto: EvaluateDiscountsDto,
    client: any = this.prisma,
    now = new Date(),
    opts: {
      couponCode?: string;
      customerKey?: { userId?: string; phone?: string };
    } = {},
  ) {
    let rules = await this.findActiveRules(now);
    if (rules.length === 0 || dto.items.length === 0) {
      const subtotal = dto.items.reduce(
        (s, i) => s + i.unitPrice * i.quantity + (i.addonAmount ?? 0),
        0,
      );
      return { subtotal, autoDiscount: 0, lines: [], byDiscount: [], skipped: [] };
    }
    const couponPresent = !!(dto.couponCode ?? opts.couponCode);
    const customerKey = opts.customerKey;
    const keyConditions: Record<string, string>[] = [];
    if (customerKey?.userId) keyConditions.push({ customerId: customerKey.userId });
    if (customerKey?.phone) keyConditions.push({ guestPhone: customerKey.phone });

    // Usage caps + first-order gate. Total caps run on every path (the
    // display may not promise a discount the order cannot honour);
    // per-customer/first-order need an identity, so they run only on the
    // order path. Rows are locked first on the order path (coupon-style
    // FOR UPDATE) so the counts below cannot race a concurrent order.
    const gated = rules.filter(
      (r) =>
        r.maxUses !== null ||
        r.maxUsesPerCustomer !== null ||
        r.firstOrderOnly,
    );
    if (gated.length > 0 && customerKey !== undefined) {
      const placeholders = gated.map((_, i) => `$${i + 1}`).join(',');
      await client.$queryRawUnsafe(
        `SELECT id FROM "Discount" WHERE id IN (${placeholders}) FOR UPDATE`,
        ...gated.map((r) => r.id),
      );
    }
    // Service-level skips (caps, first-order) join the engine's skipped
    // list in the response, so "why didn't it apply?" is answerable.
    const serviceSkipped: {
      discountId: string;
      discountTitle: string;
      reason: string;
    }[] = [];
    if (gated.length > 0) {
      const kept: DiscountRule[] = [];
      for (const rule of rules) {
        let dropReason: string | null = null;
        if (rule.maxUses !== null) {
          const used = await client.discountApplication.count({
            where: { discountId: rule.id },
          });
          if (used >= rule.maxUses) dropReason = 'usage-cap-reached';
        }
        if (!dropReason && rule.maxUsesPerCustomer !== null && keyConditions.length > 0) {
          const used = await client.discountApplication.count({
            where: {
              discountId: rule.id,
              order: { OR: keyConditions } as any,
            },
          });
          if (used >= rule.maxUsesPerCustomer) {
            dropReason = 'per-customer-cap-reached';
          }
        }
        if (!dropReason && rule.firstOrderOnly && keyConditions.length > 0) {
          const prior = await client.order.count({
            where: {
              trashedAt: null,
              OR: keyConditions,
            },
          });
          if (prior > 0) dropReason = 'not-first-order';
        }
        if (dropReason) {
          serviceSkipped.push({
            discountId: rule.id,
            discountTitle: rule.title,
            reason: dropReason,
          });
        } else {
          kept.push(rule);
        }
      }
      rules = kept;
    }

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const variantIds = [
      ...new Set(
        dto.items.map((i) => i.variantId).filter((v): v is string => !!v),
      ),
    ];
    // `client` is untyped (PrismaService or a tx client); pin the tuple
    // to any[] so the empty-`in` variant query cannot poison inference.
    const [categories, productCategories, products, variants]: any[] =
      await Promise.all([
        client.category.findMany({ select: { id: true, parentId: true } }),
        client.productCategory.findMany({
          where: { productId: { in: productIds } },
          select: { productId: true, categoryId: true },
        }),
        client.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, categoryId: true, salePrice: true, basePrice: true },
        }),
        client.productVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, productId: true, salePrice: true, price: true },
        }),
      ]);
    const catsByProduct = new Map<string, string[]>();
    for (const pc of productCategories) {
      const list = catsByProduct.get(pc.productId) ?? [];
      list.push(pc.categoryId);
      catsByProduct.set(pc.productId, list);
    }
    const productById = new Map<string, any>(
      products.map((p: any) => [p.id, p]),
    );
    for (const p of products) {
      if (p.categoryId) {
        const list = catsByProduct.get(p.id) ?? [];
        if (!list.includes(p.categoryId)) list.push(p.categoryId);
        catsByProduct.set(p.id, list);
      }
    }
    const variantById = new Map<string, any>(
      variants.map((v: any) => [v.id, v]),
    );
    const lines: DiscountLine[] = dto.items.map((i) => {
      const product = productById.get(i.productId);
      const variant =
        i.variantId && variantById.get(i.variantId)?.productId === i.productId
          ? variantById.get(i.variantId)
          : null;
      const num = (v: any): number | null =>
        v === null || v === undefined ? null : Number(v);
      return {
        productId: i.productId,
        variantId: variant ? variant.id : null,
        categoryIds: catsByProduct.get(i.productId) ?? [],
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        addonAmount: i.addonAmount ?? 0,
        isOnSale: product
          ? isOnSalePrice(
              variant
                ? {
                    salePrice: num(variant.salePrice),
                    price: num(variant.price),
                  }
                : null,
              {
                salePrice: num(product.salePrice),
                basePrice: num(product.basePrice),
              },
            )
          : false,
      };
    });
    const subtotal = lines.reduce(
      (s, l) => s + l.unitPrice * l.quantity + (l.addonAmount ?? 0),
      0,
    );
    const result = evaluateDiscounts(
      rules,
      lines,
      categories as CategoryNode[],
      now,
      { couponPresent },
    );
    return {
      subtotal,
      autoDiscount: result.totalDiscount,
      lines: result.lines,
      byDiscount: result.byDiscount,
      skipped: [...serviceSkipped, ...result.skipped],
    };
  }
}

function toRule(row: any): DiscountRule {
  return {
    id: row.id,
    title: row.title,
    scope: row.scope,
    categoryIds: row.categoryIds ?? [],
    productIds: row.productIds ?? [],
    variantIds: row.variantIds ?? [],
    type: row.type,
    value: Number(row.value),
    minOrderAmount:
      row.minOrderAmount === null || row.minOrderAmount === undefined
        ? null
        : Number(row.minOrderAmount),
    minQuantity: row.minQuantity ?? null,
    excludeSaleItems: row.excludeSaleItems ?? false,
    maxDiscountAmount:
      row.maxDiscountAmount === null || row.maxDiscountAmount === undefined
        ? null
        : Number(row.maxDiscountAmount),
    combineWithCoupon: row.combineWithCoupon ?? true,
    maxUses: row.maxUses ?? null,
    maxUsesPerCustomer: row.maxUsesPerCustomer ?? null,
    firstOrderOnly: row.firstOrderOnly ?? false,
    priority: row.priority ?? 0,
    startsAt: row.startsAt ? new Date(row.startsAt) : null,
    endsAt: row.endsAt ? new Date(row.endsAt) : null,
    isActive: row.isActive,
  };
}

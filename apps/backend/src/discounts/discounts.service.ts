import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  evaluateDiscounts,
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
 * D19 — Advanced (automatic) discounts. See the Discount model comment and
 * discount-evaluation.ts for the full rule set. This service owns CRUD plus
 * the two evaluation entry points:
 * - evaluateForCart(): the storefront-facing path (public endpoint) — the
 *   customer sees exactly what order creation will charge.
 * - computeForOrder(): the order-creation path — takes the caller's
 *   transaction client so the rule read is consistent with the order write.
 * Both funnel into the same pure engine, so display and charge can never
 * disagree.
 */
@Injectable()
export class DiscountsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.discount.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { applications: true } } },
    });
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
      startsAt: r.startsAt,
      endsAt: r.endsAt,
    }));
  }

  async create(dto: CreateDiscountDto) {
    const data = await this.validateScopeTargets(dto);
    return this.prisma.discount.create({ data });
  }

  async update(id: string, dto: UpdateDiscountDto) {
    await this.findOne(id);
    const current = await this.prisma.discount.findUnique({ where: { id } });
    const merged = {
      scope: dto.scope ?? current!.scope,
      categoryIds: dto.categoryIds ?? current!.categoryIds,
      productIds: dto.productIds ?? current!.productIds,
      type: dto.type ?? current!.type,
      value: dto.value ?? Number(current!.value),
    };
    await this.validateScopeTargets(merged);
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
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.value !== undefined ? { value: dto.value } : {}),
        ...(dto.minOrderAmount !== undefined
          ? { minOrderAmount: dto.minOrderAmount }
          : {}),
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
    type: string;
    value: number;
  }) {
    const categoryIds = input.categoryIds ?? [];
    const productIds = input.productIds ?? [];
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
    return {
      title: (input as any).title,
      scope: input.scope,
      categoryIds,
      productIds,
      type: input.type,
      value: input.value,
      minOrderAmount: (input as any).minOrderAmount ?? null,
      startsAt: (input as any).startsAt
        ? new Date((input as any).startsAt)
        : null,
      endsAt: (input as any).endsAt ? new Date((input as any).endsAt) : null,
      isActive: (input as any).isActive ?? true,
    };
  }

  /**
   * Evaluate a cart. `client` is PrismaService normally, or the caller's
   * transaction client from order creation — both expose the same delegates.
   */
  async evaluateForCart(
    dto: EvaluateDiscountsDto,
    client: any = this.prisma,
    now = new Date(),
  ) {
    const rules = await this.findActiveRules(now);
    if (rules.length === 0 || dto.items.length === 0) {
      const subtotal = dto.items.reduce(
        (s, i) => s + i.unitPrice * i.quantity + (i.addonAmount ?? 0),
        0,
      );
      return { subtotal, autoDiscount: 0, lines: [], byDiscount: [] };
    }
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const [categories, productCategories, products] = await Promise.all([
      client.category.findMany({ select: { id: true, parentId: true } }),
      client.productCategory.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, categoryId: true },
      }),
      client.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, categoryId: true },
      }),
    ]);
    const catsByProduct = new Map<string, string[]>();
    for (const pc of productCategories) {
      const list = catsByProduct.get(pc.productId) ?? [];
      list.push(pc.categoryId);
      catsByProduct.set(pc.productId, list);
    }
    for (const p of products) {
      if (p.categoryId) {
        const list = catsByProduct.get(p.id) ?? [];
        if (!list.includes(p.categoryId)) list.push(p.categoryId);
        catsByProduct.set(p.id, list);
      }
    }
    const lines: DiscountLine[] = dto.items.map((i) => ({
      productId: i.productId,
      categoryIds: catsByProduct.get(i.productId) ?? [],
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      addonAmount: i.addonAmount ?? 0,
    }));
    const subtotal = lines.reduce(
      (s, l) => s + l.unitPrice * l.quantity + (l.addonAmount ?? 0),
      0,
    );
    const result = evaluateDiscounts(
      rules,
      lines,
      subtotal,
      categories as CategoryNode[],
      now,
    );
    return {
      subtotal,
      autoDiscount: result.totalDiscount,
      lines: result.lines,
      byDiscount: result.byDiscount,
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
    type: row.type,
    value: Number(row.value),
    minOrderAmount:
      row.minOrderAmount === null || row.minOrderAmount === undefined
        ? null
        : Number(row.minOrderAmount),
    startsAt: row.startsAt ? new Date(row.startsAt) : null,
    endsAt: row.endsAt ? new Date(row.endsAt) : null,
    isActive: row.isActive,
  };
}

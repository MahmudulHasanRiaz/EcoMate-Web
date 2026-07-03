import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SearchResult {
  orders: Array<{
    id: string;
    displayId: string;
    total: number;
    status: string;
    customerName: string | null;
    phone: string | null;
  }>;
  products: Array<{
    id: string;
    name: string;
    sku: string | null;
    price: number;
  }>;
  customers: Array<{
    id: string;
    name: string;
    phone: string;
    email: string;
  }>;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(private prisma: PrismaService) {}

  async search(query: string, limit = 5): Promise<SearchResult> {
    const sanitized = query.replace(/[%_\\]/g, ' ').trim();
    if (sanitized.length < 2) {
      return { orders: [], products: [], customers: [] };
    }
    const pattern = `%${sanitized}%`;

    const [orders, products, customers] = await Promise.all([
      this.safeFetch(() => this.searchOrders(pattern, limit), 'orders'),
      this.safeFetch(() => this.searchProducts(pattern, limit), 'products'),
      this.safeFetch(() => this.searchCustomers(pattern, limit), 'customers'),
    ]);

    return { orders, products, customers };
  }

  private async safeFetch<T>(
    fn: () => Promise<T[]>,
    label: string,
  ): Promise<T[]> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(
        `Search failed for ${label}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private async searchOrders(pattern: string, limit: number) {
    type OrderRow = {
      id: string;
      displayId: string;
      total: string;
      status: string;
      customerName: string | null;
      phone: string | null;
    };
    const rows = await this.prisma.$queryRawUnsafe<OrderRow[]>(
      `SELECT o.id, o."displayId" AS "displayId", o.total::text AS total,
              os.name AS status,
              COALESCE(u."firstName" || ' ' || u."lastName", o."guestName") AS "customerName",
              COALESCE(u."phoneNumber", o."guestPhone") AS phone
       FROM "Order" o
       LEFT JOIN "OrderStatus" os ON os.id = o."statusId"
       LEFT JOIN "User" u ON u.id = o."customerId"
       WHERE o."displayId" ILIKE $1
          OR o."guestName" ILIKE $1
          OR o."guestPhone" ILIKE $1
          OR u."phoneNumber" ILIKE $1
          OR (u."firstName" || ' ' || u."lastName") ILIKE $1
       ORDER BY o."createdAt" DESC
       LIMIT $2::int`,
      pattern,
      limit,
    );
    return rows.map((r) => ({ ...r, total: Number(r.total) }));
  }

  private async searchProducts(pattern: string, limit: number) {
    type ProductRow = {
      id: string;
      name: string;
      sku: string | null;
      price: string;
    };
    const rows = await this.prisma.$queryRawUnsafe<ProductRow[]>(
      `SELECT id, name, sku,
        CASE
          WHEN type = 'variable' THEN COALESCE((SELECT MIN(COALESCE("salePrice", price)) FROM "ProductVariant" WHERE "productId" = id AND COALESCE("salePrice", price) IS NOT NULL), "basePrice")
          ELSE COALESCE("salePrice", "basePrice")
        END::text AS price
       FROM "Product"
       WHERE "isActive" = true AND (name ILIKE $1 OR sku ILIKE $1)
       ORDER BY name ASC
       LIMIT $2::int`,
      pattern,
      limit,
    );
    return rows.map((r) => ({ ...r, price: Number(r.price) }));
  }

  private async searchCustomers(pattern: string, limit: number) {
    type CustomerRow = {
      id: string;
      name: string;
      phone: string;
      email: string;
    };
    const rows = await this.prisma.$queryRawUnsafe<CustomerRow[]>(
      `SELECT id,
              "firstName" || ' ' || "lastName" AS name,
              "phoneNumber" AS phone,
              email
       FROM "User"
       WHERE role = 'customer'
         AND ("firstName" ILIKE $1
          OR "lastName" ILIKE $1
          OR ("firstName" || ' ' || "lastName") ILIKE $1
          OR email ILIKE $1
          OR "phoneNumber" ILIKE $1)
       ORDER BY "firstName" ASC
       LIMIT $2::int`,
      pattern,
      limit,
    );
    return rows;
  }
}

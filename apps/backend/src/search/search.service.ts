import { Injectable } from '@nestjs/common';
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
  constructor(private prisma: PrismaService) {}

  async search(query: string, limit = 5): Promise<SearchResult> {
    const sanitized = query.replace(/[&|!()':*]/g, ' ').trim();
    if (sanitized.length < 2) {
      return { orders: [], products: [], customers: [] };
    }
    const tsquery = sanitized
      .split(/\s+/)
      .map((w) => w + ':*')
      .join(' & ');

    const [orders, products, customers] = await Promise.all([
      this.searchOrders(tsquery, limit),
      this.searchProducts(tsquery, limit),
      this.searchCustomers(tsquery, limit),
    ]);

    return { orders, products, customers };
  }

  private async searchOrders(tsquery: string, limit: number) {
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
       WHERE o.fts @@ to_tsquery('simple', $1)
       ORDER BY ts_rank(o.fts, to_tsquery('simple', $1)) DESC
       LIMIT $2`,
      tsquery,
      limit,
    );
    return rows.map((r) => ({ ...r, total: Number(r.total) }));
  }

  private async searchProducts(tsquery: string, limit: number) {
    type ProductRow = {
      id: string;
      name: string;
      sku: string | null;
      price: string;
    };
    const rows = await this.prisma.$queryRawUnsafe<ProductRow[]>(
      `SELECT id, name, sku, COALESCE("salePrice", "basePrice")::text AS price
       FROM "Product"
       WHERE "isActive" = true AND fts @@ to_tsquery('simple', $1)
       ORDER BY ts_rank(fts, to_tsquery('simple', $1)) DESC
       LIMIT $2`,
      tsquery,
      limit,
    );
    return rows.map((r) => ({ ...r, price: Number(r.price) }));
  }

  private async searchCustomers(tsquery: string, limit: number) {
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
       WHERE role = 'customer' AND fts @@ to_tsquery('simple', $1)
       ORDER BY ts_rank(fts, to_tsquery('simple', $1)) DESC
       LIMIT $2`,
      tsquery,
      limit,
    );
    return rows;
  }
}

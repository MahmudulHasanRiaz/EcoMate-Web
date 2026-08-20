import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MarketingSnapshotService {
  constructor(private prisma: PrismaService) {}

  private range(fromDate?: string, toDate?: string) {
    const now = new Date();
    const to = toDate
      ? new Date(`${toDate}T23:59:59.999Z`)
      : new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    const from = fromDate ? new Date(`${fromDate}T00:00:00Z`) : new Date(to);
    if (!fromDate) from.setDate(from.getDate() - 29);
    return { from, to };
  }

  /**
   * Product-level daily snapshots (regenerable). Built per day from recorded
   * allocations: spend/cost are distributed per order item via the stored
   * product allocation ratio; revenue comes from the item's own price*qty
   * (never fabricated); order count is distinct orders per product. Rows are
   * upserted on (productId, date), so reruns are deterministic.
   */
  async rebuildProductSnapshots(fromDate?: string, toDate?: string) {
    const { from, to } = this.range(fromDate, toDate);

    const start = new Date(from);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setUTCHours(0, 0, 0, 0);

    const days: Date[] = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(new Date(d));
    }

    let rebuilt = 0;
    for (const day of days) {
      const dayEnd = new Date(day);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

      const allocations = await this.prisma.marketingCostAllocation.findMany({
        where: { calculatedAt: { gte: day, lt: dayEnd } },
        include: {
          productCosts: {
            include: {
              orderItem: {
                select: { productId: true, orderId: true, price: true, quantity: true },
              },
            },
          },
        },
      });

      const perProduct = new Map<
        string,
        { spend: number; cost: number; revenue: number; orders: Set<string>; quantity: number }
      >();
      for (const alloc of allocations) {
        const allocSpend = Number(alloc.allocatedSpend);
        for (const pc of alloc.productCosts) {
          const item = pc.orderItem;
          if (!item.productId) continue;
          const ratio = Number(pc.allocationRatio);
          const cur = perProduct.get(item.productId) ??
            { spend: 0, cost: 0, revenue: 0, orders: new Set(), quantity: 0 };
          cur.spend += allocSpend * ratio;
          cur.cost += Number(pc.marketingCost);
          cur.revenue += Number(item.price) * item.quantity;
          cur.orders.add(item.orderId);
          cur.quantity += item.quantity;
          perProduct.set(item.productId, cur);
        }
      }

      for (const [productId, s] of perProduct) {
        const revenue = Math.round(s.revenue * 100) / 100;
        const cost = Math.round(s.cost * 100) / 100;
        await this.prisma.marketingDailyProductCost.upsert({
          where: { productId_date: { productId, date: day } },
          update: {
            spend: Math.round(s.spend * 10000) / 10000,
            revenue,
            cost,
            profit: Math.round((revenue - cost) * 100) / 100,
            orders: s.orders.size,
            quantity: s.quantity,
          },
          create: {
            productId,
            date: day,
            spend: Math.round(s.spend * 10000) / 10000,
            revenue,
            cost,
            profit: Math.round((revenue - cost) * 100) / 100,
            orders: s.orders.size,
            quantity: s.quantity,
          },
        });
        rebuilt += 1;
      }
    }

    return { rebuilt, from: start, to: end };
  }

  /**
   * Product profitability across the window: sums the stored snapshots per
   * product, derives ROAS/margin, orders by profit desc and caps at 100.
   */
  async productSnapshotSummary(fromDate?: string, toDate?: string) {
    const { from, to } = this.range(fromDate, toDate);

    const rows = await this.prisma.marketingDailyProductCost.findMany({
      where: { date: { gte: from, lte: to } },
      include: { product: { select: { id: true, name: true } } },
      orderBy: { date: 'asc' },
    });

    const byProduct = new Map<
      string,
      {
        productId: string;
        productName: string;
        spend: number;
        revenue: number;
        cost: number;
        profit: number;
        orders: number;
        quantity: number;
      }
    >();
    for (const r of rows) {
      const cur = byProduct.get(r.productId) ?? {
        productId: r.productId,
        productName: r.product?.name ?? 'Unknown',
        spend: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        orders: 0,
        quantity: 0,
      };
      cur.spend += Number(r.spend);
      cur.revenue += Number(r.revenue ?? 0);
      cur.cost += Number(r.cost ?? 0);
      cur.profit += Number(r.profit ?? 0);
      cur.orders += r.orders;
      cur.quantity += r.quantity;
      byProduct.set(r.productId, cur);
    }

    const data = [...byProduct.values()]
      .map((p) => ({
        ...p,
        spend: Math.round(p.spend * 100) / 100,
        revenue: Math.round(p.revenue * 100) / 100,
        cost: Math.round(p.cost * 100) / 100,
        profit: Math.round(p.profit * 100) / 100,
        roas: p.spend > 0 ? Math.round((p.revenue / p.spend) * 100) / 100 : null,
        margin: p.revenue > 0 ? Math.round((p.profit / p.revenue) * 10000) / 100 : null,
      }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 100);

    return { data };
  }
}
import { PrismaService } from '../../prisma/prisma.service';
import { ITEM_PREVIEW_CAP, orderItemPreview } from '../scanner-resolver';
import { ScanItemPreview, ScanLinkedCandidate } from '../scanner.types';

/**
 * Shared linked-leg loader for the merged "Process return" task.
 *
 * Given an ORIGINAL order id, returns its ACTIVE Return rows (status !=
 * CLOSED — these include exchange returns, i.e. `type: EXCHANGE`, which keep
 * the internal `kind: 'return'` receive path and simply carry
 * `labelKind: 'exchange'` for the operator-facing picker) plus its exchange
 * order children (`kind: 'exchange'`, info-only legs).
 *
 * Bounded query count: the return rows, the exchange children and the
 * coverage denominator ride in ONE parallel round, and the product/variant
 * catalog lookups run ONLY when return legs exist. Never a per-scan N+1.
 */
export async function loadLinkedReturnCandidates(
  prisma: PrismaService,
  orderId: string,
): Promise<ScanLinkedCandidate[]> {
  const [returns, exchanges, order] = await Promise.all([
    prisma.return.findMany({
      where: { orderId, status: { not: 'CLOSED' } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.order.findMany({
      where: { exchangeOfOrderId: orderId, trashedAt: null },
      include: {
        status: true,
        items: {
          select: {
            quantity: true,
            productId: true,
            variantId: true,
            price: true,
            product: { select: { id: true, name: true, sku: true, images: true } },
            variant: {
              select: {
                id: true,
                sku: true,
                image: true,
                images: true,
                product: { select: { id: true, name: true } },
                attributeValues: {
                  select: {
                    attributeValue: {
                      select: { value: true, hexCode: true, attribute: { select: { name: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    // Coverage denominator: Σ ordered quantities — ONE query, self-contained
    // (dispatch-scan outcomes can have a null order preview).
    prisma.order.findUnique({
      where: { id: orderId },
      select: {
        displayId: true,
        items: {
          select: {
            quantity: true,
            productId: true,
            variantId: true,
            price: true,
            product: { select: { id: true, name: true, sku: true, images: true } },
            variant: {
              select: {
                id: true,
                sku: true,
                image: true,
                images: true,
                product: { select: { id: true, name: true } },
                attributeValues: {
                  select: {
                    attributeValue: {
                      select: { value: true, hexCode: true, attribute: { select: { name: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);
  const orderUnits = (Array.isArray((order as any)?.items) ? (order as any).items : []).reduce(
    (n: number, it: any) => n + (Number(it?.quantity) || 0),
    0,
  );
  const orderDisplayId = (order as any)?.displayId ?? '';

  // Catalog lookups ONLY when return legs exist (exchange legs carry their
  // own item rows from the include above). Two bounded findMany's.
  const returnRows = (returns as any[]) ?? [];
  let products = new Map<string, any>();
  let variants = new Map<string, any>();
  if (returnRows.length > 0) {
    const productIds: string[] = [];
    const variantIds: string[] = [];
    for (const r of returnRows) {
      for (const it of Array.isArray(r.items) ? r.items : []) {
        if (it?.productId) productIds.push(it.productId);
        if (it?.variantId) variantIds.push(it.variantId);
      }
    }
    const [pRows, vRows] = await Promise.all([
      productIds.length
        ? (prisma as any).product.findMany({
            where: { id: { in: [...new Set(productIds)] } },
            select: { id: true, name: true, sku: true, images: true },
          })
        : Promise.resolve([]),
      variantIds.length
        ? (prisma as any).productVariant.findMany({
            where: { id: { in: [...new Set(variantIds)] } },
            select: {
              id: true,
              sku: true,
              image: true,
              images: true,
              product: { select: { id: true, name: true, images: true } },
              attributeValues: {
                select: {
                  attributeValue: {
                    select: { value: true, hexCode: true, attribute: { select: { name: true } } },
                  },
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);
    products = new Map((pRows as any[]).map((p) => [p.id, p]));
    variants = new Map((vRows as any[]).map((v) => [v.id, v]));
  }

  const legItemsMapper = (
    items: any,
    productMap: Map<string, any>,
    variantMap: Map<string, any>,
  ): { items: ScanItemPreview[]; image: string | null } => {
    const previews = (Array.isArray(items) ? items : [])
      .slice(0, ITEM_PREVIEW_CAP) // payload stays bounded — units are computed from the full array
      .map((it: any) =>
        orderItemPreview(
          it?.variantId && variantMap.has(it.variantId)
            ? { ...it, variant: { ...variantMap.get(it.variantId) } }
            : it?.productId && productMap.has(it.productId)
              ? { ...it, product: { ...productMap.get(it.productId) } }
              : it,
        ),
      ).filter(Boolean) as ScanItemPreview[];
    const first = previews.find((p) => p.image) ?? previews[0];
    return { items: previews, image: first?.image ?? null };
  };

  const out: ScanLinkedCandidate[] = returnRows.map((r) => {
    const coversUnits = (Array.isArray(r.items) ? r.items : []).reduce(
      (n: number, it: any) => n + (Number(it?.quantity) || 0),
      0,
    );
    const alreadyReceived = r.stockReconciled || r.status === 'RESTOCKED';
    const hasConfirmedItems =
      Array.isArray(r.items) && (r.items as any[]).length > 0;
    const mapped = hasConfirmedItems
      ? legItemsMapper(r.items, products, variants)
      : legItemsMapper((order as any)?.items, new Map(), new Map());
    return {
      kind: 'return' as const,
      id: r.id,
      displayId: r.displayId,
      status: r.status,
      orderDisplayId,
      coversUnits,
      orderUnits,
      items: mapped.items,
      image: mapped.image,
      itemsConfirmed: hasConfirmedItems,
      processable: !alreadyReceived,
      reason: alreadyReceived
        ? 'Already received — stock was restored earlier. No action needed.'
        : null,
      // Exchange returns still receive through the return path (damage
      // controls); the label only tells the operator what they scanned.
      labelKind: r.type === 'EXCHANGE' ? 'exchange' : 'return',
    };
  });
  for (const ex of (exchanges as any[]) ?? []) {
    const mapped = legItemsMapper(ex.items, new Map(), new Map());
    out.push({
      kind: 'exchange' as const,
      id: ex.id,
      displayId: ex.displayId ?? ex.id,
      status: ex.status?.name ?? '',
      orderDisplayId,
      coversUnits: (Array.isArray(ex.items) ? ex.items : []).reduce(
        (n: number, it: any) => n + (Number(it?.quantity) || 0),
        0,
      ),
      orderUnits,
      items: mapped.items,
      image: mapped.image,
      // Exchange legs are info-only (fulfilled through their own order flow)
      // — always "processable" here; the backend re-checks at execute time.
      processable: true,
      reason: null,
      labelKind: 'exchange',
    });
  }
  return out;
}

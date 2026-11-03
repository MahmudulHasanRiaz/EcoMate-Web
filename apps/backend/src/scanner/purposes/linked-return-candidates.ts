import { Prisma } from '@prisma/client';
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
 * ONE exchange = ONE return (owner rule, 2026-11-04 — general, not
 * exchange-only): an exchange order whose return leg exists
 * (Return.exchangeOrderId = the exchange order's id, written in the same
 * transaction that creates the exchange) is NEVER emitted as its own
 * candidate. The leg IS the return; the Ex- order is only its context
 * (carried on the leg as `exchangeDisplayId`). Emitting both produced a
 * fake 2-option picker for a single return — staff had to guess between
 * the RTN leg (real receive) and the Ex- order (info-only, no action).
 * A LONE exchange child (no leg — legacy data) still surfaces here so
 * RETURN_RECEIVE can describe it; the Process-return purpose filters
 * candidates to Return rows itself.
 *
 * Bounded query count: the return rows, the exchange children and the
 * coverage denominator ride in ONE parallel round, and the product/variant
 * catalog lookups run ONLY when return legs exist. Never a per-scan N+1.
 */
/**
 * The shared order-line select. TYPED against the generated Prisma client so
 * a field that does not exist on the model is a COMPILE error (Product has no
 * scalar `image` — only `images`; ProductVariant does have `image`).
 */
const ORDER_ITEM_SELECT = {
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
} satisfies Prisma.OrderItemSelect;

const PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  images: true,
} satisfies Prisma.ProductSelect;

const VARIANT_SELECT = {
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
} satisfies Prisma.ProductVariantSelect;

/**
 * Picker hygiene (2026-10-28): the scanner picker renders candidates
 * verbatim, so the same leg twice is a wrong tap waiting to happen. A Return
 * row maps once and an exchange order maps once, but a repeated row (double
 * load, data anomaly) must never surface twice: dedupe by row id first, then
 * by displayId (Return.displayId is @unique, so a repeated displayId is the
 * same leg even when the row ids differ). Keep-first preserves the loader's
 * order (returns newest-first, exchanges oldest-first).
 */
export function dedupeLinkedCandidates(
  candidates: ScanLinkedCandidate[],
): ScanLinkedCandidate[] {
  const seenIds = new Set<string>();
  const seenDisplayIds = new Set<string>();
  const out: ScanLinkedCandidate[] = [];
  for (const c of candidates) {
    if (seenIds.has(c.id)) continue;
    if (c.displayId && seenDisplayIds.has(c.displayId)) continue;
    seenIds.add(c.id);
    if (c.displayId) seenDisplayIds.add(c.displayId);
    out.push(c);
  }
  return out;
}

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
          select: ORDER_ITEM_SELECT,
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
          select: ORDER_ITEM_SELECT,
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
            select: PRODUCT_SELECT,
          })
        : Promise.resolve([]),
      variantIds.length
        ? (prisma as any).productVariant.findMany({
            where: { id: { in: [...new Set(variantIds)] } },
            select: VARIANT_SELECT,
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

  const exchangeDisplayById = new Map<string, string>(
    ((exchanges as any[]) ?? []).map((ex) => [ex.id, ex.displayId ?? ex.id]),
  );

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
      exchangeOrderId: r.exchangeOrderId ?? null,
      exchangeDisplayId: r.exchangeOrderId
        ? exchangeDisplayById.get(r.exchangeOrderId)
        : undefined,
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
  // One exchange = one return: an exchange order that already has a return
  // leg in this list is the SAME return, not a second option — drop its
  // info-only face. Lone exchanges (no leg) stay for RETURN_RECEIVE.
  const leggedExchangeIds = new Set(
    returnRows
      .map((r) => r.exchangeOrderId)
      .filter((id: any): id is string => typeof id === 'string' && id.length > 0),
  );
  const faces = out.filter(
    (c) => !(c.kind === 'exchange' && leggedExchangeIds.has(c.id)),
  );
  return dedupeLinkedCandidates(faces);
}

export interface ScannedOrderReturnCandidates {
  candidates: ScanLinkedCandidate[];
  /** Display ids of exchange orders seen while resolving (context for messages — never candidates in Process return). */
  exchangeDisplayIds: string[];
  parentOrderId: string | null;
  parentDisplayId: string | null;
}

/**
 * Scan-alias normalization (owner rule, 2026-11-04): WHATEVER identifier
 * staff scanned — the original order number, an exchange order number
 * (Ex-…), or a return-order number (RTN-…) — the returns it can mean are
 * the returns of the order it belongs to. Resolves the scanned order's
 * parent pointers and loads the right candidate set:
 *
 *  - original order scan → its own linked candidates (unchanged);
 *  - exchange order scan → returns attached directly to the exchange order
 *    PLUS the parent's return leg(s) FOR THIS EXCHANGE
 *    (Return.exchangeOrderId = the scanned order) — never the parent's
 *    other returns, never the exchange order itself;
 *  - return-order (RTN order) scan → the parent original's candidates as a
 *    whole (an RTN order is 1:1 with its original's return flow).
 *
 * Bounded: at most two loader rounds (scanned + parent), each bounded.
 */
export async function loadReturnCandidatesForScannedOrder(
  prisma: PrismaService,
  scannedOrderId: string,
): Promise<ScannedOrderReturnCandidates> {
  const scanned = (await prisma.order.findUnique({
    where: { id: scannedOrderId },
    select: {
      id: true,
      displayId: true,
      exchangeOfOrderId: true,
      returnOfOrderId: true,
    },
  })) as any;
  const direct = await loadLinkedReturnCandidates(prisma, scannedOrderId);
  const exchangeDisplayIdsOf = (list: ScanLinkedCandidate[]) =>
    list.filter((c) => c.kind === 'exchange').map((c) => c.displayId);
  if (!scanned) {
    return {
      candidates: direct,
      exchangeDisplayIds: exchangeDisplayIdsOf(direct),
      parentOrderId: null,
      parentDisplayId: null,
    };
  }
  const parentOrderId =
    scanned.exchangeOfOrderId ?? scanned.returnOfOrderId ?? null;
  if (!parentOrderId) {
    return {
      candidates: direct,
      exchangeDisplayIds: exchangeDisplayIdsOf(direct),
      parentOrderId: null,
      parentDisplayId: null,
    };
  }
  const [parent, parentCandidates] = await Promise.all([
    prisma.order.findUnique({
      where: { id: parentOrderId },
      select: { displayId: true },
    }) as Promise<any>,
    loadLinkedReturnCandidates(prisma, parentOrderId),
  ]);
  // The scanned order's OWN return rows are its returns; its exchange
  // children are other orders and never this scan's returns.
  const own = direct.filter((c) => c.kind === 'return');
  const fromParent = scanned.exchangeOfOrderId
    ? parentCandidates.filter(
        (c) => c.kind === 'return' && c.exchangeOrderId === scannedOrderId,
      )
    : parentCandidates;
  return {
    candidates: dedupeLinkedCandidates([...own, ...fromParent]),
    exchangeDisplayIds: [
      ...new Set([
        ...exchangeDisplayIdsOf(direct),
        ...exchangeDisplayIdsOf(parentCandidates),
        ...(scanned.exchangeOfOrderId ? [scanned.displayId] : []),
      ]),
    ].filter(Boolean) as string[],
    parentOrderId,
    parentDisplayId: parent?.displayId ?? null,
  };
}

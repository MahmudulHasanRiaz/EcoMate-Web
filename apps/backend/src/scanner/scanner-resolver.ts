import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DispatchPreview, OrderPreview, ResolveOutcome, ScanItemPreview } from './scanner.types';

/**
 * Identifier resolution — the single backend path for EVERY scan input
 * (hardware scanner, camera, manual typing). Normalization is safe and
 * conservative: trim, uppercase, collapse whitespace. No courier-specific
 * format is hardcoded — consignment/tracking identifiers are matched
 * against the Dispatch registry across all supported couriers.
 */

const ORDER_NUMBER = /^(ORD|RTN)-\d{6}-\d{4}$/;

/**
 * If the scanned value is a storefront tracking URL (e.g. https://…/orders/ORD-260930-0001),
 * extract just the order identifier from the last path segment.
 * This makes QR codes that embed a full URL backward-compatible with every
 * scanner input path — plain displayId values are returned untouched.
 */
export function extractScanIdentifier(raw: string): string {
  const trimmed = (raw || '').trim();
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const queryId =
        url.searchParams.get('id') ||
        url.searchParams.get('displayId') ||
        url.searchParams.get('orderId') ||
        url.searchParams.get('order');
      if (queryId) return queryId.trim();

      const segments = url.pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1] ?? '';
      if (last && last.toLowerCase() !== 'orders') return last;
    }
  } catch {
    // Not a valid URL — fall through and return as-is.
  }
  return trimmed;
}

export function normalizeScanIdentifier(raw: string): string {
  return extractScanIdentifier(raw).toUpperCase().replace(/\s+/g, ' ');
}

/** Alphanumeric core — tolerates spacing/punctuation variants of one id. */
function alnumCore(identifier: string): string {
  return identifier.replace(/[^A-Z0-9]/g, '');
}

/** How many item previews ride on a preview payload (expansion shows capped count). */
export const ITEM_PREVIEW_CAP = 50;

/** Resolve an image URL from either a plain string or an object form. */
function resolveImage(img: any): string | null {
  if (typeof img === 'string') return img.trim() || null;
  if (img && typeof img === 'object') {
    return (
      (typeof img.url === 'string' && img.url.trim()) ||
      (typeof img.path === 'string' && img.path.trim()) ||
      null
    );
  }
  return null;
}

/** First resolvable image in an images-Json list. */
function firstImage(list: any): string | null {
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    const resolved = resolveImage(entry);
    if (resolved) return resolved;
  }
  return null;
}

/** Variant display label "Color: Red, Size: XL" — mirrors the admin helper. */
function variantLabelOf(avs: any): string | undefined {
  if (!Array.isArray(avs)) return undefined;
  const parts = (avs as any[])
    .map((av) => {
      const attr = av?.attributeValue?.attribute?.name;
      const value = av?.attributeValue?.value;
      if (attr && value) return `${attr}: ${value}`;
      return value || null;
    })
    .filter(Boolean) as string[];
  return parts.length ? parts.join(', ') : undefined;
}

/**
 * Line preview for staged-row expansion. Runs on rows ALREADY fetched by the
 * resolver include — zero extra queries. Image hierarchy mirrors the packing
 * queue: variant image → variant images → product image (falls back through
 * the variant.product chain when present).
 */
export function orderItemPreview(it: any): ScanItemPreview | null {
  if (!it) return null;
  const variant = it.variant ?? null;
  // Prefer the ORDER-LINE product: the nested `variant.product` select is thin
  // ({ id, name }) on the resolver + exchange includes — taking it first would
  // shadow the line's images/sku whenever the variant carries none.
  const product = it.product ?? variant?.product ?? null;
  // Product has NO scalar `image` field (only `images`), so the product image
  // always comes from images[0]. ProductVariant DOES have a scalar `image`.
  const image =
    (variant?.image && resolveImage(variant.image)) ||
    firstImage(variant?.images) ||
    firstImage(product?.images) ||
    null;
  return {
    productId: it.productId ?? variant?.productId ?? product?.id,
    variantId: it.variantId ?? variant?.id ?? null,
    name: product?.name ?? 'Unknown product',
    variantLabel: variantLabelOf(variant?.attributeValues),
    sku: variant?.sku ?? product?.sku ?? null,
    image,
    quantity: Number(it.quantity) || 0,
    maxQuantity: Number(it.maxQuantity ?? it.quantity) || 0,
    ...(it.damagedQuantity !== undefined
      ? { damagedQuantity: Number(it.damagedQuantity) || 0 }
      : {}),
    ...(it.price !== undefined && it.price !== null
      ? { price: Number(it.price) }
      : {}),
  };
}

/** Preview caps keep the resolve payload bounded at 1000+ scan sessions. */
function orderItemPreviews(items: any): ScanItemPreview[] {
  return (Array.isArray(items) ? items : [])
    .slice(0, ITEM_PREVIEW_CAP)
    .map(orderItemPreview)
    .filter(Boolean) as ScanItemPreview[];
}

/**
 * Row enrichment for staged-list display. Uses ONLY fields already present
 * on the fetched order row / requested includes — never an extra query per
 * scan (no N+1 at 1000+ staged rows). Name priority mirrors the admin
 * order-display helper: snapshot first+last → guest name → Guest.
 */
function orderRowFacts(o: any): { customerName: string; customerPhone: string; itemCount: number; orderTotal: number } {
  const full = `${o?.customerFirstName ?? ''} ${o?.customerLastName ?? ''}`.trim();
  const customerName = full || o?.guestName || 'Guest';
  const customerPhone = o?.customerPhone || o?.guestPhone || '';
  const itemCount = Array.isArray(o?.items)
    ? o.items.reduce((n: number, it: any) => n + (Number(it?.quantity) || 0), 0)
    : 0;
  return { customerName, customerPhone, itemCount, orderTotal: Number(o?.total ?? 0) || 0 };
}

export function toDispatchPreview(d: any): DispatchPreview {
  return {
    id: d.id,
    courier: d.courier,
    consignmentId: d.consignmentId,
    trackingCode: d.trackingCode ?? null,
    status: d.status,
    orderId: d.orderId,
    orderDisplayId: d.order?.displayId ?? '',
    orderStatus: d.order?.status?.name ?? '',
    orderKind: d.order?.kind ?? 'SALE',
    ...orderRowFacts(d.order),
    ...(Array.isArray(d.order?.items) && d.order.items.length
      ? { items: orderItemPreviews(d.order.items) }
      : {}),
  };
}

export function toOrderPreview(o: any, statusMap: Map<string, string>): OrderPreview {
  const next: string[] = Array.isArray(o.status?.nextStatuses)
    ? o.status.nextStatuses
    : [];
  return {
    id: o.id,
    displayId: o.displayId,
    status: o.status?.name ?? '',
    kind: o.kind ?? 'SALE',
    allowedStatuses: next
      .map((sid: string) => ({ id: sid, name: statusMap.get(sid) ?? sid }))
      .filter((s: { id: string; name: string }) => s.name),
    ...orderRowFacts(o),
    ...(Array.isArray(o.items) && o.items.length
      ? { items: orderItemPreviews(o.items) }
      : {}),
  };
}

export async function resolveScanIdentifier(
  prisma: PrismaService,
  raw: string,
): Promise<ResolveOutcome> {
  const identifier = normalizeScanIdentifier(raw);
  const base: ResolveOutcome = {
    status: 'not_found',
    identifier,
    dispatches: [],
    order: null,
  };
  if (!identifier) {
    return { ...base, message: 'Nothing to scan — the input was empty.' };
  }

  const statusMap = new Map<string, string>(
    (await prisma.orderStatus.findMany({ select: { id: true, name: true } })).map(
      (s: { id: string; name: string }) => [s.id, s.name],
    ),
  );

  // ---- A. Order number (ORD-… / RTN-…) ------------------------------------
  // Items fetch both row facts AND line previews in the same query.
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

  if (ORDER_NUMBER.test(identifier)) {
    const order = await prisma.order.findFirst({
      where: { displayId: { equals: identifier, mode: 'insensitive' } },
      include: {
        status: true,
        // Row facts + line previews for the staged list ride on this single fetch.
        items: { select: ORDER_ITEM_SELECT },
        dispatches: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order) {
      return { ...base, message: `No order found for "${identifier}".` };
    }
    const dispatches = order.dispatches.map(toDispatchPreview);
    const preview = toOrderPreview(order, statusMap);
    if (dispatches.length > 1) {
      return {
        ...base,
        status: 'selection_required',
        message: 'Multiple dispatches are linked to this order. Select the dispatch to continue.',
        dispatches,
        order: preview,
      };
    }
    return { ...base, status: 'resolved', dispatches, order: preview };
  }

  // ---- B. Courier dispatch identifier (consignment / tracking) ------------
  // Exact (case-insensitive) first; fall back to an alphanumeric-core match
  // so `SF 12345` and `SF12345` resolve identically. Never fuzzy: a core
  // shorter than 6 chars is rejected to avoid accidental collisions.
  const core = alnumCore(identifier);
  const candidates = await prisma.dispatch.findMany({
    where: {
      OR: [
        { consignmentId: { equals: identifier, mode: 'insensitive' as const } },
        { trackingCode: { equals: identifier, mode: 'insensitive' as const } },
        ...(core.length >= 6
          ? [
              { consignmentId: { contains: core, mode: 'insensitive' as const } },
              { trackingCode: { contains: core, mode: 'insensitive' as const } },
            ]
          : []),
      ],
    },
    include: { order: { include: { status: true, items: { select: ORDER_ITEM_SELECT } } } },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  // Keep only true normalized matches (defence against contains over-match).
  const matched = candidates.filter((d) => {
    const ids = [d.consignmentId, d.trackingCode].filter(Boolean) as string[];
    return ids.some(
      (id) =>
        normalizeScanIdentifier(id) === identifier ||
        alnumCore(id) === core,
    );
  });

  if (matched.length === 0) {
    return {
      ...base,
      message: `No dispatch found for "${identifier}". Check the code and try again.`,
    };
  }

  const dispatches = matched.map(toDispatchPreview);
  const order = matched[0]?.order ? toOrderPreview(matched[0].order, statusMap) : null;
  if (matched.length > 1) {
    return {
      ...base,
      status: 'selection_required',
      message: 'Multiple dispatches found. Select the dispatch to continue.',
      dispatches,
      order,
    };
  }
  return { ...base, status: 'resolved', dispatches, order };
}

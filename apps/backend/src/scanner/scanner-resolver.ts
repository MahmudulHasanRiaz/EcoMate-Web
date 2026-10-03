import { PrismaService } from '../prisma/prisma.service';
import { DispatchPreview, OrderPreview, ResolveOutcome } from './scanner.types';

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
  if (ORDER_NUMBER.test(identifier)) {
    const order = await prisma.order.findFirst({
      where: { displayId: { equals: identifier, mode: 'insensitive' } },
      include: {
        status: true,
        // Row facts for the staged list ride on this single fetch.
        items: { select: { quantity: true } },
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
    include: { order: { include: { status: true, items: { select: { quantity: true } } } } },
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

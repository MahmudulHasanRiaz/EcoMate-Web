import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { dhakaDateParts } from '../common/utils/dhaka-time';

export interface GuardReturnItem {
  productId: string;
  variantId?: string | null;
  quantity: number;
  /** Units of `quantity` that arrived damaged — never restocked. */
  damagedQuantity?: number;
  /** Persisted damage history (structured JSON on Return.items). */
  damageLog?: Array<{
    qty: number;
    at: string | Date;
    phase: 'receive' | 'later';
    by?: string | null;
  }>;
  /** Warehouse the units actually came from (physical stock write-off target). */
  warehouseId?: string | null;
}

export interface AssertReturnEligibleOptions {
  type: 'FULL' | 'PARTIAL' | 'EXCHANGE';
  items: GuardReturnItem[];
}

/**
 * Order statuses a staff FULL/PARTIAL return may be raised from (unified
 * guard: POST /returns via the unified Create-return dialog).
 *
 * COHERENT BY DESIGN (review MED status-sets): this unified guard allows
 * {Shipping, Partial, Delivered} while the staff-partial flow endpoint
 * (STAFF_PARTIAL_ALLOWED_STATUSES in orders/orders.service.ts) allows only
 * {Shipping, Partial}. Delivered partials go via this unified dialog only —
 * the flow endpoint auto-moves Shipping→Partial / marks instant-delivery,
 * which must never run on an already-Delivered order.
 */
export const RETURN_ELIGIBLE_STATUSES: readonly string[] = [
  'Shipping',
  'Partial',
  'Delivered',
];

/** Active = every Return row that is not CLOSED (incl. RESTOCKED-not-closed). */
const ACTIVE_STATUS_FILTER = { not: 'CLOSED' } as const;

/** 60s duplicate-submission window for the idempotency guard. */
export const RETURN_DUPLICATE_WINDOW_MS = 60_000;

const keyOf = (productId: string, variantId?: string | null) =>
  `${productId}::${variantId ?? ''}`;

/**
 * Shape-check shared by ReturnsService.create, the staff-partial path and the
 * guarded stock core: productId required, quantity a positive integer, no
 * duplicate lines.
 */
export function validateReturnItemsShape(items: unknown): GuardReturnItem[] {
  if (!Array.isArray(items))
    throw new BadRequestException('Return items must be an array');
  const seen = new Set<string>();
  return (items as GuardReturnItem[]).map((it, i) => {
    const productId = String((it as any)?.productId ?? '').trim();
    const variantId = (it as any)?.variantId ? String((it as any).variantId) : null;
    const quantity = Number((it as any)?.quantity);
    if (!productId)
      throw new BadRequestException(`Return items[${i}].productId is required`);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException(
        `Return items[${i}].quantity must be a positive integer`,
      );
    }
    const rawDamaged = Number((it as any)?.damagedQuantity ?? 0);
    if (!Number.isInteger(rawDamaged) || rawDamaged < 0 || rawDamaged > quantity) {
      throw new BadRequestException(
        `Return items[${i}].damagedQuantity must be an integer between 0 and quantity`,
      );
    }
    const damageLog = Array.isArray((it as any)?.damageLog)
      ? ((it as any).damageLog as any[])
          .filter((e) => e && typeof e === 'object')
          .map((e) => ({
            qty: Math.max(0, Math.floor(Number(e.qty) || 0)),
            at: e.at,
            phase: e.phase === 'later' ? ('later' as const) : ('receive' as const),
            ...(e.by ? { by: String(e.by) } : {}),
          }))
          .filter((e) => e.qty > 0)
      : [];
    const key = keyOf(productId, variantId);
    if (seen.has(key))
      throw new BadRequestException(`Duplicate return line: ${productId}`);
    seen.add(key);
    const warehouseId = (it as any)?.warehouseId
      ? String((it as any).warehouseId)
      : null;
    return {
      productId,
      variantId,
      quantity,
      damagedQuantity: rawDamaged,
      ...(damageLog.length > 0 ? { damageLog } : {}),
      ...(warehouseId ? { warehouseId } : {}),
    };
  });
}

/** Canonical idempotency key: order + type + sorted item lines. */
export function canonicalReturnKey(
  orderId: string,
  type: string,
  items: GuardReturnItem[],
): string {
  const sorted = [...(items ?? [])]
    .map((it) => ({
      productId: String(it.productId),
      variantId: it.variantId ?? null,
      quantity: Number(it.quantity),
    }))
    .sort((a, b) =>
      a.productId === b.productId
        ? String(a.variantId ?? '').localeCompare(String(b.variantId ?? ''))
        : a.productId.localeCompare(b.productId),
    );
  return createHash('sha256')
    .update(JSON.stringify({ orderId, type, items: sorted }))
    .digest('hex');
}

async function productNames(
  db: any,
  productIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    if (typeof db?.product?.findMany !== 'function') return names;
    const rows = (await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    })) as any[];
    for (const row of rows ?? []) {
      if (row?.id) names.set(row.id, row.name ?? row.id);
    }
  } catch {
    // Name lookup is cosmetic — a failure must never block the guard.
  }
  return names;
}

/**
 * SHARED GUARD — hardens Return creation (hardening item 1).
 *
 * activeReturns = returns NOT CLOSED. Rejects with 4xx:
 *  (a) FULL && any active → "Order already has an active return RTN-…; …"
 *  (b) PARTIAL && active FULL → same
 *  (c) PARTIAL && every ordered line fully returned → "Nothing left…"
 *  (d) requested qty > ordered − returned → "Only X left to return for <item>."
 *  (e) order status ∉ {Shipping, Partial, Delivered} → ineligible
 *
 * EXCHANGE skips the overlap checks: the exchange leg has its own lifecycle
 * (an exchange after a partial is legal) — the duplicate guard still applies.
 *
 * `db` is the Prisma client OR a caller's transaction client.
 */
export async function assertReturnEligible(
  db: any,
  orderId: string,
  opts: AssertReturnEligibleOptions,
): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      status: true,
      items: { select: { productId: true, variantId: true, quantity: true } },
    },
  });
  if (!order || (order as any).trashedAt) {
    throw new NotFoundException(`Order not found: ${orderId}`);
  }
  if (opts.type === 'EXCHANGE') return;

  const statusName = (order as any)?.status?.name as string | undefined;
  if (!RETURN_ELIGIBLE_STATUSES.includes(statusName as string)) {
    throw new BadRequestException(
      `Order is not eligible for return (current: ${statusName ?? 'unknown'}). ` +
        `Returns can only be created from ${RETURN_ELIGIBLE_STATUSES.join(', ')} orders.`,
    );
  }

  const active = ((await db.return.findMany({
    where: { orderId, status: ACTIVE_STATUS_FILTER },
    orderBy: { createdAt: 'desc' },
  })) ?? []) as any[];
  if (opts.type === 'FULL' && active.length > 0) {
    const first = active[0];
    throw new BadRequestException(
      `Order already has an active return ${(first as any)?.displayId ?? (first as any)?.id}; ` +
        `close or cancel it first.`,
    );
  }
  if (opts.type === 'PARTIAL') {
    const activeFull = active.find((r) => (r as any)?.type === 'FULL');
    if (activeFull) {
      throw new BadRequestException(
        `Order already has an active return ${(activeFull as any)?.displayId ?? (activeFull as any)?.id}; ` +
          `close or cancel it first.`,
      );
    }
  }

  // Ordered quantities per line (combo-expansion is unnecessary here: the
  // guard compares Return.items keys — product+variant — against the order's
  // own lines, exactly the keys staff pick from).
  const orderedQtyByKey = new Map<string, number>();
  for (const line of ((order as any).items ?? []) as any[]) {
    if (!line?.productId) continue;
    const key = keyOf(line.productId, line.variantId ?? null);
    orderedQtyByKey.set(key, (orderedQtyByKey.get(key) ?? 0) + Number(line.quantity ?? 0));
  }

  // Already-returned quantities across ACTIVE returns. Rows with an unknown
  // split (courier rows with empty items) contribute 0 — never block on what
  // the courier never reported.
  const returnedQtyByKey = new Map<string, number>();
  for (const row of active) {
    const items = Array.isArray((row as any)?.items) ? ((row as any).items as any[]) : [];
    for (const it of items) {
      if (!it?.productId) continue;
      const key = keyOf(it.productId, it.variantId ?? null);
      returnedQtyByKey.set(
        key,
        (returnedQtyByKey.get(key) ?? 0) + Math.max(0, Math.floor(Number(it.quantity ?? 0))),
      );
    }
  }

  if (opts.type === 'PARTIAL') {
    const requestItems = opts.items ?? [];
    if (requestItems.length === 0) {
      throw new BadRequestException('Select at least one product to return.');
    }
    const fullyReturned =
      orderedQtyByKey.size > 0 &&
      [...orderedQtyByKey.entries()].every(
        ([key, ordered]) => (returnedQtyByKey.get(key) ?? 0) >= ordered,
      );
    if (fullyReturned) {
      throw new BadRequestException('Nothing left to return.');
    }
    const names = await productNames(
      db,
      requestItems.map((it) => it.productId),
    );
    for (const it of requestItems) {
      const key = keyOf(it.productId, it.variantId ?? null);
      const ordered = orderedQtyByKey.get(key) ?? 0;
      const returned = returnedQtyByKey.get(key) ?? 0;
      const left = ordered - returned;
      if (it.quantity > left) {
        const label = names.get(it.productId) ?? it.productId;
        throw new BadRequestException(
          `Only ${Math.max(0, left)} left to return for ${label}.`,
        );
      }
    }
  }
}

/**
 * 60s duplicate guard: same order + type + item lines created within the last
 * 60s → 409 naming the earlier return. Idempotency key = sha256 of the
 * canonical request + a createdAt window check (computed, never stored — no
 * schema change).
 *
 * Returns the earlier return when found, null otherwise.
 */
export async function findDuplicateReturn(
  db: any,
  orderId: string,
  type: string,
  items: GuardReturnItem[],
  now: Date = new Date(),
): Promise<any | null> {
  // MED clock-skew fix: the 60s window is computed in DB (NOW() − INTERVAL),
  // never from the app Date (which skews vs DB createdAt). Falls back to the
  // app clock only when $queryRaw is unavailable (unit-test doubles).
  let windowStart: Date;
  try {
    if (typeof db?.$queryRaw === 'function') {
      const rows = (await db.$queryRaw`
        SELECT (NOW() - INTERVAL '60 seconds') AS "windowStart"
      `) as Array<{ windowStart: Date | string }>;
      const dbWindow = (rows as any)?.[0]?.windowStart;
      windowStart = dbWindow ? new Date(dbWindow) : new Date(now.getTime() - RETURN_DUPLICATE_WINDOW_MS);
    } else {
      windowStart = new Date(now.getTime() - RETURN_DUPLICATE_WINDOW_MS);
    }
  } catch {
    windowStart = new Date(now.getTime() - RETURN_DUPLICATE_WINDOW_MS);
  }
  const wanted = canonicalReturnKey(orderId, type, items);
  const recent = ((await db.return.findMany({
    where: { orderId, type: type as any, createdAt: { gte: windowStart } },
    orderBy: { createdAt: 'desc' },
  })) ?? []) as any[];
  for (const row of recent) {
    // Belt-and-braces: the query already windows by createdAt, but re-check
    // in-app so a client that ignores the filter can never false-positive.
    const createdAt = (row as any)?.createdAt ? new Date((row as any).createdAt) : null;
    if (!createdAt || createdAt < windowStart) continue;
    const rowItems = Array.isArray((row as any)?.items)
      ? (((row as any).items as unknown[]) as GuardReturnItem[])
      : [];
    if (canonicalReturnKey(orderId, (row as any)?.type ?? type, rowItems) === wanted) {
      return row;
    }
  }
  return null;
}

export async function assertNoDuplicateReturn(
  db: any,
  orderId: string,
  type: string,
  items: GuardReturnItem[],
  now: Date = new Date(),
): Promise<void> {
  const dup = await findDuplicateReturn(db, orderId, type, items, now);
  if (dup) {
    throw new ConflictException(
      `Duplicate return request — ${(dup as any)?.displayId ?? (dup as any)?.id} ` +
        `with the same items was created less than a minute ago.`,
    );
  }
}

/** RTN-YYMMDD-NNNN inside a caller's client (tx-safe: single upsert). */
export async function generateReturnDisplayId(db: any): Promise<string> {
  const { year, month, day } = dhakaDateParts();
  const yy = String(year).slice(2);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const dateStr = `${yy}${mm}${dd}`;
  const counter = await db.returnCounter.upsert({
    where: { date: dateStr },
    create: { date: dateStr, seq: 1 },
    update: { seq: { increment: 1 } },
  });
  return `RTN-${dateStr}-${String(counter.seq).padStart(4, '0')}`;
}

/**
 * Full-order item snapshot (standalone lines as-is; combo lines expanded to
 * component products) on ANY client (prisma or tx).
 */
export async function orderItemsSnapshotForClient(
  client: any,
  orderId: string,
): Promise<GuardReturnItem[]> {
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        select: { id: true, productId: true, variantId: true, quantity: true, comboId: true },
      },
    },
  });
  if (!order) throw new NotFoundException(`Order not found: ${orderId}`);
  const out: GuardReturnItem[] = [];
  for (const item of (order as any).items ?? []) {
    if (!item.comboId && item.productId) {
      out.push({ productId: item.productId, variantId: item.variantId ?? null, quantity: item.quantity });
      continue;
    }
    if (item.comboId) {
      const snaps = (await client.orderItemComboComponent.findMany({
        where: { orderItemId: item.id },
        select: { productId: true, variantId: true, totalQuantity: true },
      })) as any[];
      for (const s of snaps ?? []) {
        out.push({ productId: s.productId, variantId: s.variantId ?? null, quantity: s.totalQuantity });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// STOCK AUTHORITY (hardening item 2): single guarded restore core.
// ---------------------------------------------------------------------------

export interface RestoreStockForReturnDeps {
  db: any;
  cancelReturnStock: {
    restoreForReturnItems: (params: {
      orderId: string;
      items: GuardReturnItem[];
      returnId: string;
      performedBy?: string;
      tx: any;
    }) => Promise<unknown>;
  };
}

/**
 * Guarded restore core — the ONLY path that moves stock for a Return:
 * CLOSED → 400; already reconciled (flag or RESTOCKED) → no-op returning the
 * row as-is; empty items → 400 (the courier never reports the split, so an
 * unknown split must never restock). The RECEIVED transition, the item-level
 * movement and the stockReconciled flag commit in the CALLER's transaction —
 * a double call (retry, double-scan, webhook + scanner race) is a no-op.
 *
 * `db` is the transaction client the caller already runs in.
 */
export async function restoreStockForReturnTx(
  deps: RestoreStockForReturnDeps,
  returnId: string,
  opts?: { items?: GuardReturnItem[]; performedBy?: string },
): Promise<any> {
  const { db, cancelReturnStock } = deps;
  const ret = await db.return.findUnique({ where: { id: returnId } });
  if (!ret) throw new NotFoundException(`Return not found: ${returnId}`);
  if ((ret as any).status === 'CLOSED') {
    throw new BadRequestException('Return is CLOSED — cannot restock');
  }
  if ((ret as any).stockReconciled || (ret as any).status === 'RESTOCKED') {
    return ret;
  }
  const effectiveItems = validateReturnItemsShape(
    opts?.items ?? ((ret as any).items as unknown),
  );
  if (effectiveItems.length === 0) {
    throw new BadRequestException(
      'Return item quantities are unknown — provide items (the courier never reports the split)',
    );
  }
  const receivedAt = (ret as any).receivedAt ?? new Date();
  // Freeze the warehouse each returned unit actually came from so a later
  // damage write-off hits THAT location (never an arbitrary product default).
  const orderLines = (db as any).orderItem?.findMany
    ? await (db as any).orderItem.findMany({
        where: { orderId: (ret as any).orderId },
        select: {
          productId: true,
          variantId: true,
          sourceWarehouseId: true,
          product: { select: { warehouseId: true } },
        },
      })
    : [];
  const warehouseByKey = new Map<string, string>();
  for (const line of orderLines as any[]) {
    const key = keyOf(line.productId, line.variantId ?? undefined);
    const warehouseId = line.sourceWarehouseId ?? line.product?.warehouseId ?? null;
    if (warehouseId && !warehouseByKey.has(key)) {
      warehouseByKey.set(key, warehouseId);
    }
  }
  const receivedItems: GuardReturnItem[] = effectiveItems.map((item) => {
    const key = keyOf(item.productId, item.variantId);
    const warehouseId =
      item.warehouseId ?? warehouseByKey.get(key) ?? null;
    const damaged = Math.min(
      item.quantity,
      Math.max(0, Math.floor(Number(item.damagedQuantity ?? 0) || 0)),
    );
    if (damaged <= 0) {
      return {
        ...item,
        damagedQuantity: 0,
        ...(warehouseId ? { warehouseId } : {}),
      };
    }
    const existing = item.damageLog ?? [];
    const hasReceiveLog = existing.some(
      (e) => e.phase === 'receive' && Number(e.qty) === damaged,
    );
    return {
      ...item,
      damagedQuantity: damaged,
      ...(warehouseId ? { warehouseId } : {}),
      damageLog: hasReceiveLog
        ? existing
        : [
            ...existing,
            {
              qty: damaged,
              at: receivedAt.toISOString(),
              phase: 'receive' as const,
              by: opts?.performedBy ?? null,
            },
          ],
    };
  });
  if ((ret as any).status !== 'RECEIVED') {
    await db.return.update({
      where: { id: returnId },
      data: {
        status: 'RECEIVED',
        receivedAt,
      },
    });
  }
  await cancelReturnStock.restoreForReturnItems({
    orderId: (ret as any).orderId as string,
    items: receivedItems,
    returnId,
    performedBy: opts?.performedBy,
    tx: db,
  });
  return db.return.update({
    where: { id: returnId },
    data: {
      status: 'RESTOCKED',
      items: receivedItems as unknown as any,
      stockReconciled: true,
      stockReconciledAt: new Date(),
      receivedAt,
    },
  });
}

/**
 * Courier-driven creation skips assertReturnEligible ON PURPOSE (hardening
 * item 1 — documented here so the skip is a decision, not an oversight):
 * a courier return signal is an EXTERNAL FACT about a parcel already moving
 * back. Rejecting it would drop the fact and desync the Return record from
 * reality. Overlap abuse is impossible downstream anyway — stock only moves
 * through restoreStockForReturnTx (flag-guarded, item-scoped), and a second
 * reconcile for the same consignment re-resolves to the same row via
 * upsertCourierReturn (courier+order match, set-once courierReturnId).
 */
export const COURIER_GUARD_SKIP_REASON = 'courier-signal-is-external-fact';

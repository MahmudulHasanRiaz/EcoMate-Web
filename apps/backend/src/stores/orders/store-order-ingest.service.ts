/**
 * Store order ingest worker — central-commerce P6 (§8.5, BR-11/BR-12/BR-13/
 * BR-16/BR-17).
 *
 * Both funnels (webhook fast path, hourly reconcile safety net) resolve to
 * the SAME job identity (`store:{storeId}:order:{externalId}`) so the two
 * paths cannot double-work (BR-11/BR-12). Identity is DB-enforced:
 * `StoreOrderMapping @@unique([storeId, externalOrderId])` +
 * `Order.idempotencyKey @unique`.
 *
 * Ingest worker steps (§8.5): (1) mapping lookup → status-only reconcile
 * (totals/items never rewritten, ignored deltas noted); (2) normalizeOrder();
 * (3) SKU resolution via StoreSkuMapping → variant SKU → product SKU →
 * product-less + UNMATCHED_SKU issue + one-click map action; (4) external
 * status → internal status via StoreOrderStatusMap (seeded from the CSV
 * importer's STATUS_MAP); (5) ordersService.create(dto, undefined, internal);
 * (6) mapping + provenance + ingestFlags + SyncRunItem.
 *
 * BR-13 absolute: no blockedPolicy / reject switch exists anywhere in this
 * file — blocking is evaluated read-only inside create() for flagging only.
 * BR-16: allowStockShortfall — shortfalls flagged, never thrown. BR-17:
 * after ingest only status + storeMetadata are mutable from the store side.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../../orders/orders.service';
import { SyncRunService } from '../sync/sync-run.service';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { StoresService } from '../stores.service';
import { STATUS_MAP } from '../../import/order-import.service';
import { normalizePhone } from '../../common/utils/phone-utils';
import {
  normalizeOrder,
  buildStoreOrderIdentity,
  type NormalizedIngestOrder,
} from './normalize-order';

export type IngestTrigger = 'WEBHOOK' | 'RECONCILE' | 'MANUAL';

export interface IngestResult {
  orderId: string;
  created: boolean;
  status: string;
  /** True when this call changed the order status (create or transition). */
  statusChanged: boolean;
}

/**
 * P13 ZERO-STOCK REJECT — OPERATOR-DIRECTED DEVIATION from BR-13/BR-16.
 *
 * The plan's BR-13 ("never reject an external order") and BR-16
 * ("shortfall-flag, never discard") are EXPLICITLY SUPERSEDED for one
 * narrow case by operator direction (see
 * docs/central-commerce/P13-ERP-STOCK-PROJECTION.md, "Deviation note"):
 * when the ERP authoritative stock is ZERO (<= 0) for an ordered item, the
 * external order is REJECTED — not created — with this explicit reason code
 * plus a `ZERO_STOCK_REJECT` issue row. Rationale: ERP is the stock truth
 * and there is nothing to sell; creating the order would manufacture a
 * certain shortfall.
 *
 * Scope is deliberately narrow:
 * - per-ITEM: only items whose ERP stock is zero trigger the reject;
 * - insufficient-but-NONZERO stock keeps the BR-16 shortfall-flag behavior
 *   (flagged, never rejected) — untouched in `OrdersService.create()`;
 * - product-less (unmatched-SKU) items cannot resolve ERP stock and are
 *   never reject triggers — they keep the UNMATCHED_SKU path;
 * - native storefront/admin validation is UNCHANGED (still throws via
 *   `assertManagedAvailability` as before).
 */
export const ZERO_STOCK_REJECT = 'ZERO_STOCK_REJECT';

/** ERP authoritative stock for one ordered item (null = unresolvable). */
export interface ErpStockLevel {
  qty: number;
  mode: string | null;
}

@Injectable()
export class StoreOrderIngestService {
  private readonly logger = new Logger(StoreOrderIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Lazily resolved: StoresModule cannot statically import OrdersModule
    // (Stock/Inventory → Stores cycle). Injected directly in tests; in
    // production resolved from the container via ModuleRef on first use.
    @Optional() private readonly ordersServiceOrNull: OrdersService | null,
    private readonly runs: SyncRunService,
    private readonly registry: ProviderRegistryService,
    private readonly stores: StoresService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private ordersSvc(): OrdersService {
    if (this.ordersServiceOrNull) return this.ordersServiceOrNull;
    if (!this.moduleRef) {
      throw new Error('OrdersService unavailable (no direct instance, no ModuleRef)');
    }
    return this.moduleRef.get(OrdersService, { strict: false });
  }

  /**
   * Seed per-store status rows from the CSV importer's STATUS_MAP (§8.5 step
   * 4). Existing rows are never overwritten — operator edits win.
   */
  async ensureStatusMaps(storeId: string): Promise<number> {
    let seeded = 0;
    for (const [externalStatus, internalStatusName] of Object.entries(STATUS_MAP)) {
      const existing = await this.prisma.storeOrderStatusMap.findUnique({
        where: { storeId_externalStatus: { storeId, externalStatus } },
      });
      if (existing) continue;
      await this.prisma.storeOrderStatusMap.create({
        data: { storeId, externalStatus, internalStatusName },
      });
      seeded += 1;
    }
    return seeded;
  }

  /** External status → internal OrderStatus name (store map, then seed fallback). */
  async resolveStatusName(storeId: string, externalStatus: string): Promise<string | null> {
    const row = await this.prisma.storeOrderStatusMap.findUnique({
      where: { storeId_externalStatus: { storeId, externalStatus } },
    });
    if (row) return row.internalStatusName;
    const lower = (externalStatus ?? '').toLowerCase();
    if (STATUS_MAP[lower]) return STATUS_MAP[lower];
    return null;
  }

  /**
   * Resolve one normalized item to local ids. Precedence: StoreSkuMapping →
   * ProductVariant.sku (unique) → Product.sku (first match). Unresolved →
   * product-less (nulls) — the caller raises UNMATCHED_SKU.
   */
  async resolveSku(
    storeId: string,
    sku: string,
  ): Promise<{ productId?: string; variantId?: string; resolved: boolean }> {
    if (!sku) return { resolved: false };
    const mapped = await this.prisma.storeSkuMapping.findUnique({
      where: { storeId_sku: { storeId, sku } },
    });
    if (mapped && (mapped.productId || mapped.variantId)) {
      return {
        productId: mapped.productId ?? undefined,
        variantId: mapped.variantId ?? undefined,
        resolved: true,
      };
    }
    const variant = await this.prisma.productVariant.findUnique({
      where: { sku },
      select: { id: true, productId: true },
    });
    if (variant) {
      return { productId: variant.productId, variantId: variant.id, resolved: true };
    }
    const product = await this.prisma.product.findFirst({
      where: { sku },
      select: { id: true },
    });
    if (product) return { productId: product.id, resolved: true };
    return { resolved: false };
  }

  /**
   * Resolve the ERP authoritative stock for one ordered item — the SAME
   * truth the P13 projection pushes (INVENTORY_CONTROLLED → physical
   * available sum, else managed-stock available). Returns null when the
   * row(s) cannot be resolved (caller must NOT reject on unknown).
   */
  async erpStockForItem(
    productId: string | undefined,
    variantId: string | undefined,
  ): Promise<ErpStockLevel | null> {
    if (!productId && !variantId) return null;
    const product = productId
      ? await this.prisma.product.findUnique({
          where: { id: productId },
          select: {
            id: true,
            availabilityMode: true,
            managedStockQuantity: true,
            reservedStock: true,
          },
        })
      : null;
    // A variant-only reference resolves its parent for the mode.
    let mode: string | null = (product as any)?.availabilityMode ?? null;
    if (!product && variantId) {
      const parent = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: {
          productId: true,
          product: {
            select: { availabilityMode: true, managedStockQuantity: true, reservedStock: true },
          },
        },
      }).catch(() => null) as any;
      if (!parent) return null;
      mode = parent?.product?.availabilityMode ?? null;
      if (mode === 'INVENTORY_CONTROLLED') {
        const rows = await this.prisma.physicalInventory.findMany({
          where: { productId: parent.productId, variantId },
          select: { quantity: true, reservedQuantity: true },
        }).catch(() => null);
        if (!rows) return null;
        const qty = rows.reduce((s: number, r: any) => s + ((r.quantity ?? 0) - (r.reservedQuantity ?? 0)), 0);
        return { qty, mode };
      }
      const v = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { managedStockQuantity: true, reservedStock: true },
      }).catch(() => null) as any;
      if (!v) return null;
      return { qty: (v.managedStockQuantity ?? 0) - (v.reservedStock ?? 0), mode };
    }
    if (!product) return null;
    if (mode === 'ALWAYS_IN_STOCK') return { qty: Number.POSITIVE_INFINITY, mode };
    if (mode === 'ALWAYS_OUT_OF_STOCK') return { qty: 0, mode };
    if (mode === 'INVENTORY_CONTROLLED') {
      const rows = await this.prisma.physicalInventory.findMany({
        where: { productId: (product as any).id, variantId: variantId ?? null },
        select: { quantity: true, reservedQuantity: true },
      }).catch(() => null);
      if (!rows) return null;
      const qty = rows.reduce((s: number, r: any) => s + ((r.quantity ?? 0) - (r.reservedQuantity ?? 0)), 0);
      return { qty, mode };
    }
    // MANAGED_STOCK and any other mode (fail-closed to managed fields —
    // same rule as the projection's desiredState).
    if (variantId) {
      const v = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { managedStockQuantity: true, reservedStock: true },
      }).catch(() => null) as any;
      if (!v) return null;
      return { qty: (v.managedStockQuantity ?? 0) - (v.reservedStock ?? 0), mode };
    }
    return {
      qty: ((product as any).managedStockQuantity ?? 0) - ((product as any).reservedStock ?? 0),
      mode,
    };
  }

  /**
   * One-click map action for an UNMATCHED_SKU issue: records the operator's
   * chosen target so the NEXT order with this SKU resolves. Never rewrites
   * already-ingested items (BR-17).
   */
  async mapSku(
    storeId: string,
    sku: string,
    target: { productId?: string; variantId?: string },
  ): Promise<unknown> {
    if (!sku) throw new Error('sku is required');
    if (!target.productId && !target.variantId) {
      throw new Error('productId or variantId is required');
    }
    const row = await (this.prisma as any).storeSkuMapping.upsert({
      where: { storeId_sku: { storeId, sku } },
      create: {
        storeId,
        sku,
        productId: target.productId ?? null,
        variantId: target.variantId ?? null,
        lastVerifiedAt: new Date(),
      },
      update: {
        productId: target.productId ?? null,
        variantId: target.variantId ?? null,
        lastVerifiedAt: new Date(),
      },
    });
    await this.runs.upsertIssue({
      storeId,
      code: 'UNMATCHED_SKU',
      objectType: 'ORDER',
      objectKey: `store:${storeId}:sku:${sku}`,
      message: `SKU "${sku}" mapped by operator — future orders resolve; past items unchanged (BR-17).`,
    });
    return row;
  }

  /**
   * Ingest one raw provider order. Idempotent: webhook + reconcile + manual
   * retry of the same external order yield exactly one EcoMate order.
   */
  async ingest(
    storeId: string,
    rawOrder: Record<string, unknown>,
    trigger: { type: IngestTrigger; runId?: string; actor?: string },
  ): Promise<IngestResult> {
    const normalized = normalizeOrder(rawOrder);
    const { idempotencyKey, objectKey } = buildStoreOrderIdentity(storeId, normalized.externalId);

    // (1) Mapping lookup — existing order → status-only reconcile (BR-17:
    // totals/items never rewritten; ignored deltas recorded as a note).
    const existing = await this.prisma.storeOrderMapping.findUnique({
      where: { storeId_externalOrderId: { storeId, externalOrderId: normalized.externalId } },
      include: { order: { include: { status: true } } },
    });
    if (existing) {
      return this.reconcileStatus(storeId, existing as any, normalized, trigger);
    }

    // P2002 race net (BR-12): two funnels racing past the lookup collide on
    // the idempotency UNIQUE — the loser reconciles instead of erroring.
    try {
      return await this.createIngested(storeId, normalized, idempotencyKey, objectKey, trigger);
    } catch (err: any) {
      const isConflict =
        err?.code === 'P2002' ||
        /unique|idempotency|already exists/i.test(err?.message ?? '');
      if (!isConflict) throw err;
      const raced = await this.prisma.storeOrderMapping.findUnique({
        where: { storeId_externalOrderId: { storeId, externalOrderId: normalized.externalId } },
        include: { order: { include: { status: true } } },
      });
      if (!raced) throw err;
      this.logger.warn(`ingest race on ${objectKey} — reconciling existing order`);
      return this.reconcileStatus(storeId, raced as any, normalized, trigger);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────

  private async createIngested(
    storeId: string,
    normalized: NormalizedIngestOrder,
    idempotencyKey: string,
    objectKey: string,
    trigger: { type: IngestTrigger; runId?: string; actor?: string },
  ): Promise<IngestResult> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    const storeKind = (store as any)?.kind ?? 'CUSTOM';
    const storeName = (store as any)?.name ?? storeId;

    const statusName = await this.resolveStatusName(storeId, normalized.externalStatus);
    let initialStatusName: string | undefined;
    if (statusName) {
      const statusRow = await this.prisma.orderStatus.findFirst({ where: { name: statusName } });
      if (statusRow) initialStatusName = statusName;
    }

    // (3) SKU resolution per item.
    const unmatchedSkus: string[] = [];
    const items: Array<{
      productId?: string;
      variantId?: string;
      quantity: number;
      price: number;
    }> = [];
    for (const li of normalized.items) {
      const hit = await this.resolveSku(storeId, li.sku);
      if (!hit.resolved) {
        if (li.sku) unmatchedSkus.push(li.sku);
        items.push({ quantity: li.quantity, price: li.price });
        continue;
      }
      items.push({
        productId: hit.productId,
        variantId: hit.variantId,
        quantity: li.quantity,
        price: li.price,
      });
    }
    // P13 ZERO_STOCK_REJECT (operator-directed deviation from BR-13/BR-16 —
    // see ZERO_STOCK_REJECT above): per resolved item, when the ERP
    // authoritative stock is zero the order is NOT created. Product-less
    // (unmatched-SKU) items are unresolvable and never trigger; nonzero
    // shortfalls flow on to create() and keep the BR-16 flag behavior.
    const zeroSkus: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] as { productId?: string; variantId?: string };
      if (!it.productId && !it.variantId) continue;
      const erp = await this.erpStockForItem(it.productId, it.variantId);
      if (erp && erp.qty <= 0) {
        zeroSkus.push(normalized.items[i]?.sku || it.variantId || it.productId || `line ${i + 1}`);
      }
    }
    if (zeroSkus.length > 0) {
      const reason =
        `${ZERO_STOCK_REJECT}: external order ${normalized.externalId} not created — ` +
        `ERP authoritative stock is zero for: ${zeroSkus.join(', ')}. ` +
        `Restock in EcoMate and re-ingest (deviation from BR-13/BR-16 per P13).`;
      await this.runs.upsertIssue({
        storeId,
        code: ZERO_STOCK_REJECT,
        objectType: 'ORDER',
        objectKey,
        message: reason,
      });
      if (trigger.runId) {
        await this.runs.recordItem(trigger.runId, {
          storeId,
          objectType: 'ORDER',
          externalObjectId: normalized.externalId,
          status: 'FAILED',
          reason,
          auditLevel: 'G',
        });
      }
      // Permanent (not retryable-by-design): a retry re-resolves the same
      // zero stock and re-rejects identically — no order is ever created, no
      // mapping row is written, and the issue row is upserted (one compact
      // row, never N). The reconcile/processor catch-chain records FAILED.
      throw new Error(reason);
    }
    // An external order with zero parseable lines still ingests (BR-13/BR-16
    // spirit: never lose it) — one product-less placeholder keeps the totals.
    const createItems =
      items.length > 0
        ? items
        : [{ quantity: 1, price: normalized.externalTotal }];

    // BD-only checkout validation must not reject foreign numbers (BR-13):
    // pass the phone only when it normalizes, else keep it in metadata.
    const normalizedPhone = normalized.customerPhone
      ? normalizePhone(normalized.customerPhone)
      : null;

    // NOTE: create(dto, clientIp, user, internal) — internal is the FOURTH
    // positional arg. Passing it third lands in `user` and silently disables
    // the entire external-ingest contract (live-E2E find: product-less throw
    // + native block throw on ingested orders).
    const order = await this.ordersSvc().create(
      {
        items: createItems as any,
        guestName: normalized.customerName ?? undefined,
        guestPhone: normalizedPhone ?? undefined,
        guestEmail: normalized.customerEmail ?? undefined,
        customerNotes:
          normalizedPhone || !normalized.customerPhone
            ? undefined
            : `External customer phone (un-normalized): ${normalized.customerPhone}`,
        sourcePlatform: 'EXTERNAL_STORE',
        sourceType: `EXTERNAL_STORE:${storeKind}`,
        sourceEntity: storeName,
      } as any,
      undefined,
      undefined,
      {
        ingest: 'external_store',
        storeId,
        externalOrderId: normalized.externalId,
        initialStatusName,
        idempotencyKey,
        allowStockShortfall: true,
        skipPurchaseTracking: true,
        allowProductlessItems: true,
        storeMetadata: {
          externalStatus: normalized.externalStatus,
          currency: normalized.currency,
          externalTotal: normalized.externalTotal,
          externalCreatedAt: normalized.externalCreatedAt?.toISOString() ?? null,
          externalUpdatedAt: normalized.externalUpdatedAt?.toISOString() ?? null,
          rawPhone: normalized.customerPhone,
          itemCount: normalized.items.length,
          unmatchedSkus,
        },
      },
    );

    // (6) Mapping + issues + run item.
    await this.prisma.storeOrderMapping.create({
      data: {
        storeId,
        externalOrderId: normalized.externalId,
        orderId: (order as any).id,
        lastExternalStatus: normalized.externalStatus,
        externalUpdatedAt: normalized.externalUpdatedAt,
      },
    });

    for (const sku of new Set(unmatchedSkus)) {
      await this.runs.upsertIssue({
        storeId,
        code: 'UNMATCHED_SKU',
        objectType: 'ORDER',
        objectKey: `${objectKey}:sku:${sku}`,
        message: `SKU "${sku}" on external order ${normalized.externalId} matched no local product — item created product-less. Map it to resolve future orders (past items unchanged, BR-17).`,
      });
    }
    if (trigger.runId) {
      await this.runs.recordItem(trigger.runId, {
        storeId,
        objectType: 'ORDER',
        externalObjectId: normalized.externalId,
        status: 'SUCCESS',
        reason: `INGESTED via ${trigger.type} (idempotency ${idempotencyKey})`,
        auditLevel: 'G',
      });
    }
    return { orderId: (order as any).id, created: true, status: (order as any)?.status?.name ?? initialStatusName ?? 'Pending', statusChanged: true };
  }

  private async reconcileStatus(
    storeId: string,
    mapping: {
      orderId: string;
      externalOrderId: string;
      order: { status: { name: string }; total: unknown };
    },
    normalized: NormalizedIngestOrder,
    trigger: { type: IngestTrigger; runId?: string; actor?: string },
  ): Promise<IngestResult> {
    const currentName = mapping.order?.status?.name;
    const targetName = await this.resolveStatusName(storeId, normalized.externalStatus);

    // Totals/items are NEVER rewritten (BR-17) — a delta is only noted.
    const deltaNote =
      targetName && Number(normalized.externalTotal) !== Number((mapping.order as any)?.total)
        ? ` external total ${normalized.externalTotal} differs from ingested ${(mapping.order as any)?.total} — kept ingested values (BR-17).`
        : '';

    await this.prisma.storeOrderMapping.update({
      where: { storeId_externalOrderId: { storeId, externalOrderId: normalized.externalId } },
      data: {
        lastExternalStatus: normalized.externalStatus,
        externalUpdatedAt: normalized.externalUpdatedAt,
      },
    });

    if (!targetName || targetName === currentName) {
      if (trigger.runId) {
        await this.runs.recordItem(trigger.runId, {
          storeId,
          objectType: 'ORDER',
          externalObjectId: normalized.externalId,
          status: 'SKIPPED',
          reason: `STATUS_ONLY_RECONCILE: already "${currentName}"; totals/items untouched (BR-17).${deltaNote}`,
          auditLevel: 'G',
        });
      }
      if (deltaNote) await this.appendTimelineNote(mapping.orderId, currentName, `Reconcile note:${deltaNote}`);
      return { orderId: mapping.orderId, created: false, status: currentName, statusChanged: false };
    }

    const target = await this.prisma.orderStatus.findFirst({ where: { name: targetName } });
    if (!target) {
      if (trigger.runId) {
        await this.runs.recordItem(trigger.runId, {
          storeId,
          objectType: 'ORDER',
          externalObjectId: normalized.externalId,
          status: 'SKIPPED',
          reason: `STATUS_ONLY_RECONCILE: unknown internal status "${targetName}" — kept "${currentName}".${deltaNote}`,
          auditLevel: 'G',
        });
      }
      return { orderId: mapping.orderId, created: false, status: currentName, statusChanged: false };
    }

    const actor = trigger.actor ?? (trigger.type === 'WEBHOOK' ? 'webhook' : 'reconcile');
    try {
      await this.ordersSvc().updateStatus(
        mapping.orderId,
        { statusId: (target as any).id } as any,
        actor,
        'store-sync',
      );
      if (deltaNote) await this.appendTimelineNote(mapping.orderId, targetName, `Reconcile note:${deltaNote}`);
      if (trigger.runId) {
        await this.runs.recordItem(trigger.runId, {
          storeId,
          objectType: 'ORDER',
          externalObjectId: normalized.externalId,
          status: 'SUCCESS',
          reason: `STATUS_ONLY_RECONCILE: "${currentName}" → "${targetName}" via ${trigger.type}.${deltaNote}`,
          auditLevel: 'G',
        });
      }
      return { orderId: mapping.orderId, created: false, status: targetName, statusChanged: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.runs.upsertIssue({
        storeId,
        code: 'ORDER_STATUS_RECONCILE_FAILED',
        objectType: 'ORDER',
        objectKey: `store:${storeId}:order:${normalized.externalId}`,
        message: `Status reconcile "${currentName}" → "${targetName}" failed: ${msg}`,
      });
      if (trigger.runId) {
        await this.runs.recordItem(trigger.runId, {
          storeId,
          objectType: 'ORDER',
          externalObjectId: normalized.externalId,
          status: 'SKIPPED',
          reason: `STATUS_ONLY_RECONCILE failed ("${currentName}" → "${targetName}"): ${msg}`,
          auditLevel: 'G',
        });
      }
      return { orderId: mapping.orderId, created: false, status: currentName, statusChanged: false };
    }
  }

  private async appendTimelineNote(orderId: string, statusName: string, note: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { timeline: true },
    });
    const timeline = Array.isArray((order as any)?.timeline)
      ? [...(order as any).timeline]
      : [];
    timeline.push({ status: statusName, timestamp: new Date().toISOString(), note });
    await this.prisma.order.update({
      where: { id: orderId },
      data: { timeline: timeline as any },
    });
  }

  /** Provider handle for fetchOrders — NATIVE throws (BR-20). */
  async providerFor(storeId: string) {
    const store = await this.stores.storeWithSecrets(storeId);
    return this.registry.providerFor({ kind: (store as any).kind });
  }
}

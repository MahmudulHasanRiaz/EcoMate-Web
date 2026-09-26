/**
 * Stock projection sync — central-commerce §8.4 (P5, P13).
 *
 * P13 ERP-STOCK-PROJECTION (operator-directed — SUPERSEDES plan BR-06
 * status-only and BR-08 Shopify zero-write; see
 * docs/central-commerce/P13-ERP-STOCK-PROJECTION.md):
 * "ERP calculates the truth; every integrated store only receives a
 * controlled stock projection." ERP stock = the resolved quantity
 * (INVENTORY_CONTROLLED → inventory-controlled path, else managed-stock
 * quantity — see desiredState).
 * - Own ERP Website (NATIVE): unchanged, never a sync target (BR-20).
 * - Custom + WooCommerce (`faithful` + quantity-capable): ERP > threshold →
 *   IN_STOCK status only (no quantity ever — the remote tracks nothing
 *   countable, so oversell is impossible); 1–5 → ACTUAL quantity in real
 *   time; 0 → OUT_OF_STOCK (forced + read-back verify).
 * - Shopify (`quantized-capped`): ERP > threshold → capped quantity
 *   (threshold, default 5) via InventoryLevel (tracked, deny policy);
 *   1–5 → actual quantity real-time; 0 → quantity 0 (selling stops).
 * - `unsupported` fidelity → ZERO writes ever (BR-08 remainder); per-change
 *   exits monitor-only, the daily audit runs read-only and raises
 *   STOCK_DRIFT_MONITOR_ONLY. Zero-write now applies ONLY here.
 *
 * BR-07 banding (unchanged): `qty = 0` → forced push + read-back verify on
 * every assigned store; `0 < qty < threshold` (default 5, per-store override
 * via `Store.settings.stockLowThreshold`, product `lowStockQty` fallback) →
 * immediate push per change; `qty >= threshold` → no per-change push, the
 * daily audit owns it (including the capped band).
 *
 * Change notification: every writer in §3.8 calls
 * `notifyStockChanged()` AFTER commit inside a non-propagating guard. No
 * provider call ever happens inside a mutation (R-2) — notify only enqueues
 * (debounced 1500 ms, coalesced by
 * `jobId = stock:{storeId}:{productId}:{variantId}`); fan-out is per
 * assigned store, so a product on MULTIPLE stores projects to ALL of them.
 *
 * Race safety: the job never trusts its payload — it re-reads live state and
 * computes a monotonic version (max stock-row `updatedAt` + ledger /
 * physical timestamp). `version <= lastEvaluatedVersion` exits without
 * pushing, so a stale event can never resurrect IN_STOCK over a newer
 * OUT_OF_STOCK. The same-state cooldown is keyed on (state + wire qty), so
 * a 4→3 unit step is never suppressed as "same state". Product-level
 * versions live on `StoreProductMapping.lastEvaluatedVersion` (P4);
 * variant-level versions on `StoreVariantMapping.lastEvaluatedVersion`
 * (P5 migration).
 *
 * Combos: availability is `min(child availability)` for the audit trail;
 * combos are never pushed as products (BR-22).
 */
import {
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { SyncRunService } from './sync-run.service';
import { SyncQueuesService } from './sync-queues.service';
import { StoresService } from '../stores.service';
import { stockAuditEnabled, stockSyncEnabled } from '../store-flags';
import {
  classifyProviderError,
  MAX_SYNC_ATTEMPTS,
  RETRY_BACKOFF_MS,
} from '../providers/retry-classifier';
import type {
  CommerceProvider,
  RemoteRef,
  StockState,
  StockStatusFidelity,
  StoreWithSecrets,
} from '../providers/provider.contract';

export const STOCK_THRESHOLD_DEFAULT = 5;
export const STOCK_DEBOUNCE_MS = 1500;
export const STOCK_SAME_STATE_COOLDOWN_MS = 60_000;

/**
 * Read-back verification against eventual consistency: remotes (Shopify
 * included) may serve the pre-write value for seconds after a push. Reads
 * retry with delays before any repair, so a lagging read-back never files
 * a false STOCK_VERIFY_FAILED. Mutable for tests (delayMs = 0).
 */
export const STOCK_VERIFY = { reads: 3, delayMs: 2000 };
export const STOCK_AUDIT_CRON = '0 3 * * *';
export const STOCK_AUDIT_TZ = 'Asia/Dhaka';
export const STOCK_AUDIT_PAGE_SIZE = 100;
export const STOCK_AUDIT_CONCURRENCY = 5;
export const STOCK_AUDIT_PAGE_DELAY_MS = 250;
/** Per-store threshold override key inside `Store.settings` JSON (no migration). */
export const STORE_STOCK_THRESHOLD_KEY = 'stockLowThreshold';

export type StockEvalPath = 'zero' | 'below' | 'above' | 'always';

export interface StockChangeJob {
  storeId: string;
  productId: string;
  variantId?: string | null;
  reason?: string;
  attemptNo?: number;
}

export interface StockTargetResult {
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  pushed: boolean;
  reason: string;
}

export interface StockDesired {
  state: StockState;
  qty: number;
  path: StockEvalPath;
  threshold: number;
}

/** Threshold precedence: per-store override → product lowStockQty → default 5. */
export function thresholdFor(
  storeSettings: Record<string, unknown> | null | undefined,
  productLowStockQty?: number | null,
): number {
  const raw = storeSettings?.[STORE_STOCK_THRESHOLD_KEY];
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (Number.isFinite(n) && (n as number) > 0) return Math.floor(n as number);
  if (
    typeof productLowStockQty === 'number' &&
    Number.isFinite(productLowStockQty) &&
    productLowStockQty > 0
  ) {
    return Math.floor(productLowStockQty);
  }
  return STOCK_THRESHOLD_DEFAULT;
}

export function desiredFromQty(
  qty: number,
  threshold: number,
): { state: StockState; path: StockEvalPath } {
  if (qty <= 0) return { state: 'OUT_OF_STOCK', path: 'zero' };
  if (qty < threshold) return { state: 'IN_STOCK', path: 'below' };
  return { state: 'IN_STOCK', path: 'above' };
}

export type StockPushKind = 'status' | 'quantity';

export interface StockPushPlan {
  kind: StockPushKind;
  state: StockState;
  /**
   * Wire units when kind === 'quantity': exact ERP units for the zero/below
   * bands, the quantized cap (threshold) for the audit-owned above band on
   * `quantized-capped` providers. Meaningless (0) for status plans.
   */
  wireQty: number;
}

/**
 * P13 pure projection planner: ERP qty + band + provider capability →
 * exactly one push shape. Rules:
 * - `always` (ALWAYS_IN_STOCK, unlimited) → status-only IN, never a
 *   quantity (Infinity is not projectable).
 * - zero/below + quantity-capable → quantity (0 = no sell, else exact).
 * - above + audit + `quantized-capped` + quantity-capable → quantity at the
 *   cap (threshold — the per-store override moves the cap with the band).
 * - above + FIRST evaluation (no projection landed yet) + `quantized-capped`
 *   + quantity-capable → quantity at the cap. Later above-band evaluations
 *   stay silent (audit-owned) — but the first must project, otherwise a
 *   newly mapped product sits at remote zero/unknown until 3AM.
 * - everything else (status-only bridges, faithful above-band, undeclared
 *   quantity) → status-only.
 * `quantityCapable` = `caps.stockQuantity === true` AND the matching
 * quantity method exists on the provider (product vs variant).
 */
export function planFor(
  fidelity: StockStatusFidelity,
  quantityCapable: boolean,
  qty: number,
  path: StockEvalPath,
  threshold: number,
  audit: boolean,
  firstEvaluation = false,
): StockPushPlan {
  if (path === 'always') return { kind: 'status', state: 'IN_STOCK', wireQty: 0 };
  const finite = Number.isFinite(qty);
  const q = finite ? Math.max(0, Math.floor(qty)) : 0;
  const state: StockState = q > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';
  if (!finite) return { kind: 'status', state, wireQty: 0 };
  if ((path === 'zero' || path === 'below') && quantityCapable) {
    return { kind: 'quantity', state, wireQty: q };
  }
  if (
    path === 'above' &&
    (audit || firstEvaluation) &&
    fidelity === 'quantized-capped' &&
    quantityCapable
  ) {
    return { kind: 'quantity', state: 'IN_STOCK', wireQty: Math.max(1, Math.floor(threshold)) };
  }
  return { kind: 'status', state, wireQty: 0 };
}

/** Lexicographically comparable monotonic version. */
export function versionFor(
  rowUpdatedAt: Date | string | number,
  ledgerAt: Date | string | number | null,
): string {
  const r = new Date(rowUpdatedAt).getTime();
  const l = ledgerAt ? new Date(ledgerAt).getTime() : 0;
  const pad = (n: number) =>
    String(Number.isFinite(n) ? Math.max(0, n) : 0).padStart(15, '0');
  return `${pad(r)}:${pad(l)}`;
}

/** Stale exit: at-or-before the last evaluated version never pushes. */
export function isStale(
  version: string,
  lastEvaluated: string | null | undefined,
): boolean {
  if (!lastEvaluated) return false;
  return version <= lastEvaluated;
}

function isVariantStockUnsupported(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('VARIANT_STOCK_UNSUPPORTED');
}

async function boundedMap<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length)))
    .fill(null)
    .map(async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx] as T);
      }
    });
  await Promise.all(workers);
  return out;
}

@Injectable()
export class StockStatusSyncService implements OnModuleInit {
  private readonly logger = new Logger(StockStatusSyncService.name);
  /**
   * Per-(store|product|variant|status|wire-qty) flapping guard — recency
   * only, truth lives in the DB. The qty arm matters: a 4→3 unit step must
   * never be suppressed as "same state" (P13).
   */
  private readonly lastPush = new Map<string, { state: StockState; qty: number | null; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    @InjectQueue('store-stock-sync') private readonly stockQueue: Queue,
    @Optional() private readonly stores?: StoresService,
  ) {}

  /** Daily audit repeatable `0 3 * * *` `Asia/Dhaka`, fail-closed on the flag. */
  async onModuleInit(): Promise<void> {
    try {
      const repeats = await this.stockQueue.getRepeatableJobs();
      const existing = repeats.filter((r) => r.name === 'stock-audit');
      if (!stockAuditEnabled()) {
        for (const r of existing) {
          await this.stockQueue.removeRepeatableByKey(r.key);
        }
        return;
      }
      if (existing.length > 0) return;
      await this.stockQueue.add('stock-audit', {}, {
        repeat: { pattern: STOCK_AUDIT_CRON, tz: STOCK_AUDIT_TZ },
        removeOnComplete: 20,
        removeOnFail: 20,
      });
    } catch (err) {
      this.logger.warn(
        `stock-audit repeatable registration failed (retried on next boot): ${err}`,
      );
    }
  }

  // ── Change notification (§8.4: post-commit, non-propagating) ──────────

  async notifyStockChanged(
    productId: string,
    variantId?: string | null,
    reason = 'stock-changed',
  ): Promise<void> {
    try {
      if (!stockSyncEnabled()) return;
      if (!productId) return;
      const assignments = await this.prisma.productStoreAssignment.findMany({
        where: { productId },
        select: { storeId: true },
      });
      if (assignments.length === 0) return;
      const stores = await this.prisma.store.findMany({
        where: {
          id: { in: assignments.map((a) => a.storeId) },
          kind: { not: 'NATIVE' },
          status: 'CONNECTED',
        },
        select: { id: true },
      });
      for (const s of stores) {
        const jobId = `stock:${s.id}:${productId}:${variantId ?? '-'}`;
        // A finished record with the same id would swallow this change
        // (BullMQ id dedupe) — clear it first; pending jobs coalesce safely
        // because the worker re-reads live state.
        await this.queues.replaceFinishedJob('store-stock-sync', jobId);
        await this.queues.enqueue(
          'store-stock-sync',
          'stock-change',
          { storeId: s.id, productId, variantId: variantId ?? null, reason },
          jobId,
          { delay: STOCK_DEBOUNCE_MS },
        );
      }
    } catch {
      // Non-propagating by contract (R-2): notification can never fail or
      // slow the hot mutation path. Correctness comes from the daily audit.
    }
  }

  // ── Per-change job ────────────────────────────────────────────────────

  async handleStockChange(
    job: StockChangeJob,
  ): Promise<{ pushed: number; skipped: number; failed: number }> {
    const run = await this.runs.begin({
      scope: 'STOCK',
      triggerType: 'SYSTEM',
      storeId: job.storeId,
    });
    const runId = (run as any).id as string;
    const counts = { pushed: 0, skipped: 0, failed: 0 };
    try {
      const results = await this.evaluateProduct(
        job.storeId,
        job.productId,
        job.variantId ?? null,
        runId,
        { audit: false },
      );
      for (const r of results) {
        if (r.status === 'FAILED') counts.failed += 1;
        else if (r.pushed) counts.pushed += 1;
        else counts.skipped += 1;
      }
      await this.runs.finish(runId, {
        created: 0,
        updated: counts.pushed,
        skipped: counts.skipped,
        failed: counts.failed,
      });
      return counts;
    } catch (err) {
      // §8.1 retry ladder (engine-owned; BullMQ attempts stay 1 so permanent
      // failures never loop). BR-26: failures never resolve anything — only
      // attempt/issue rows are written here.
      const decision = classifyProviderError(err);
      const objectKey = `stock:${job.storeId}:${job.productId}:${job.variantId ?? '-'}`;
      const attemptNo = (job.attemptNo ?? 0) + 1;
      const nextDelay =
        !decision.retryable || attemptNo >= MAX_SYNC_ATTEMPTS
          ? null
          : RETRY_BACKOFF_MS[Math.min(attemptNo - 1, RETRY_BACKOFF_MS.length - 1)];
      await this.runs.recordAttempt({
        runId,
        storeId: job.storeId,
        objectType: 'PRODUCT',
        objectKey,
        productId: job.productId,
        attemptNo,
        status: nextDelay ? 'PENDING' : 'DEAD',
        errorCategory: String(decision.category),
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      if (nextDelay) {
        await this.queues.enqueue(
          'store-stock-sync',
          'stock-change',
          { ...job, attemptNo },
          `${objectKey}:retry:${attemptNo}`,
          { delay: nextDelay },
        );
      } else {
        await this.runs.upsertIssue({
          storeId: job.storeId,
          code: 'DEAD_LETTER',
          objectType: 'PRODUCT',
          objectKey,
          productId: job.productId,
          message: `Stock sync dead after ${attemptNo} attempts (${decision.category}): ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      await this.runs.finish(runId, { created: 0, updated: 0, failed: 1 });
      return { pushed: 0, skipped: 0, failed: 1 };
    }
  }

  // ── Evaluation (re-reads live state; never trusts the payload) ────────

  async evaluateProduct(
    storeId: string,
    productId: string,
    variantId: string | null,
    runId: string,
    opts: { audit: boolean },
  ): Promise<StockTargetResult[]> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.kind === 'NATIVE') {
      await this.runs.recordItem(runId, {
        storeId,
        productId,
        objectType: 'PRODUCT',
        status: 'SKIPPED',
        reason: 'NATIVE_REJECTED: NATIVE is never a sync target (BR-20)',
        auditLevel: 'G',
      });
      return [{ status: 'SKIPPED', pushed: false, reason: 'NATIVE_REJECTED' }];
    }
    if (!opts.audit && !stockSyncEnabled()) {
      await this.runs.recordItem(runId, {
        storeId,
        productId,
        objectType: 'PRODUCT',
        status: 'SKIPPED',
        reason: 'FLAG_OFF: store_stock_sync_enabled is off (fail-closed)',
        auditLevel: 'G',
      });
      return [{ status: 'SKIPPED', pushed: false, reason: 'FLAG_OFF' }];
    }
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });
    if (!product) {
      await this.runs.recordItem(runId, {
        storeId,
        productId,
        objectType: 'PRODUCT',
        status: 'SKIPPED',
        reason: 'PRODUCT_GONE: local product no longer exists',
        auditLevel: 'G',
      });
      return [{ status: 'SKIPPED', pushed: false, reason: 'PRODUCT_GONE' }];
    }
    // BR-22: combos are never pushed as products.
    if ((product as any).type === 'combo') {
      return [await this.skipCombo(storeId, product as any, runId)];
    }
    const variants = ((product as any).variants ?? []) as any[];
    if (variantId) {
      const variant =
        variants.find((v) => v.id === variantId) ??
        (await this.prisma.productVariant.findUnique({ where: { id: variantId } }));
      if (!variant || (variant as any).productId !== productId) {
        await this.runs.recordItem(runId, {
          storeId,
          productId,
          objectType: 'VARIANT',
          status: 'SKIPPED',
          reason: 'VARIANT_GONE: local variant no longer exists',
          auditLevel: 'G',
        });
        return [{ status: 'SKIPPED', pushed: false, reason: 'VARIANT_GONE' }];
      }
      return [await this.evaluateTarget(store, product, variant, runId, opts)];
    }
    if ((product as any).type === 'variable') {
      if (variants.length === 0) {
        await this.runs.recordItem(runId, {
          storeId,
          productId,
          objectType: 'PRODUCT',
          status: 'SKIPPED',
          reason: 'NO_VARIANTS: variable product has no variants to evaluate',
          auditLevel: 'G',
        });
        return [{ status: 'SKIPPED', pushed: false, reason: 'NO_VARIANTS' }];
      }
      const out: StockTargetResult[] = [];
      for (const v of variants) {
        out.push(await this.evaluateTarget(store, product, v, runId, opts));
      }
      return out;
    }
    return [await this.evaluateTarget(store, product, null, runId, opts)];
  }

  async evaluateTarget(
    store: any,
    product: any,
    variant: any | null,
    runId: string,
    opts: { audit: boolean },
  ): Promise<StockTargetResult> {
    const objectType = variant ? 'VARIANT' : 'PRODUCT';
    const objectKey = `stock:${store.id}:${product.id}:${variant?.id ?? '-'}`;
    const item = (status: string, reason: string) =>
      this.runs.recordItem(runId, {
        storeId: store.id,
        productId: product.id,
        objectType,
        status,
        reason,
        auditLevel: 'G',
      });

    const version = await this.computeVersion(product, variant);
    const mapping = variant
      ? await (this.prisma as any).storeVariantMapping.findUnique({
          where: { storeId_variantId: { storeId: store.id, variantId: variant.id } },
        })
      : await (this.prisma as any).storeProductMapping.findUnique({
          where: { storeId_productId: { storeId: store.id, productId: product.id } },
        });

    // Race safety: a stale event can never resurrect state. The audit owns
    // remote truth and always re-verifies, so it is exempt from this guard.
    if (!opts.audit && isStale(version, mapping?.lastEvaluatedVersion)) {
      await item('SKIPPED', 'STALE_EVENT: a newer evaluation already landed — never resurrect state');
      return { status: 'SKIPPED', pushed: false, reason: 'STALE_EVENT' };
    }

    const threshold = thresholdFor(
      (store.settings as Record<string, unknown> | null) ?? {},
      product.lowStockQty,
    );
    const desired = await this.desiredState(product, variant, threshold);

    const provider = this.registry.providerFor(store);
    const storeWithSecrets = await this.storeWithSecrets(store);
    const caps = await provider.resolveCapabilities(storeWithSecrets);

    // BR-08 remainder: unsupported fidelity → ZERO writes, always.
    if (caps.stockStatusFidelity !== 'faithful' && caps.stockStatusFidelity !== 'quantized-capped') {
      if (!opts.audit) {
        await this.bumpVersion(store.id, product.id, variant, version);
        await item('SKIPPED', 'UNSUPPORTED_FIDELITY: monitor-only, zero writes (BR-08)');
        return { status: 'SKIPPED', pushed: false, reason: 'UNSUPPORTED_FIDELITY' };
      }
      if (!mapping) {
        await item('SKIPPED', 'NOT_MAPPED: product sync owns mapping creation');
        return { status: 'SKIPPED', pushed: false, reason: 'NOT_MAPPED' };
      }
      const remote = await this.readRemote(provider, storeWithSecrets, store.id, product, variant, mapping);
      if (remote === null) {
        await item('SKIPPED', 'VARIANT_STOCK_UNSUPPORTED: no per-variation read on this provider');
        return { status: 'SKIPPED', pushed: false, reason: 'VARIANT_STOCK_UNSUPPORTED' };
      }
      await this.bumpVersion(store.id, product.id, variant, version);
      if (remote !== desired.state) {
        await this.runs.upsertIssue({
          storeId: store.id,
          code: 'STOCK_DRIFT_MONITOR_ONLY',
          objectType,
          objectKey,
          productId: product.id,
          field: variant?.id,
          message: `Stock drift (monitor-only, BR-08): EcoMate ${desired.state} (qty ${desired.qty}) vs remote ${remote}. No writes were made — reconcile manually in the store admin.`,
        });
        await item('FAILED', `STOCK_DRIFT_MONITOR_ONLY: EcoMate ${desired.state} vs remote ${remote} (zero writes, BR-08)`);
        return { status: 'FAILED', pushed: false, reason: 'STOCK_DRIFT_MONITOR_ONLY' };
      }
      await item('SUCCESS', `IN_SYNC_MONITORED: remote matches ${desired.state} (read-only, BR-08)`);
      return { status: 'SUCCESS', pushed: false, reason: 'IN_SYNC_MONITORED' };
    }

    // P13 projection path (faithful / quantized-capped). `unsupported`
    // exited above with zero writes.
    if (!mapping) {
      await item('SKIPPED', 'NOT_MAPPED: product sync owns mapping creation');
      return { status: 'SKIPPED', pushed: false, reason: 'NOT_MAPPED' };
    }

    // BR-07/P13: above threshold → no per-change push; the daily audit owns
    // it (including the Shopify capped band). EXCEPTION: the first-ever
    // evaluation (no projection landed yet) always executes — otherwise a
    // newly mapped product would sit at remote zero/unknown until 3AM.
    if (desired.path === 'above' && !opts.audit && mapping?.lastEvaluatedVersion) {
      await this.bumpVersion(store.id, product.id, variant, version);
      await item('SKIPPED', `ABOVE_THRESHOLD: qty ${desired.qty} ≥ threshold ${threshold} — daily audit owns it (BR-07)`);
      return { status: 'SKIPPED', pushed: false, reason: 'ABOVE_THRESHOLD' };
    }

    const quantityCapable =
      caps.stockQuantity === true &&
      (variant
        ? typeof provider.publishVariantStockQuantity === 'function'
        : typeof provider.publishStockQuantity === 'function');
    const plan = planFor(
      caps.stockStatusFidelity,
      quantityCapable,
      desired.qty,
      desired.path,
      desired.threshold,
      opts.audit,
      !mapping?.lastEvaluatedVersion,
    );
    const record = (status: string, reason: string) =>
      this.runs.recordItem(runId, {
        storeId: store.id,
        productId: product.id,
        objectType,
        status,
        reason,
        auditLevel: 'G',
      });

    try {
      if (plan.kind === 'quantity') {
        return await this.pushQuantityPlan(
          provider, storeWithSecrets, store, product, variant, mapping,
          desired, plan, version, record,
        );
      }
      return await this.pushStatusPlan(
        provider, storeWithSecrets, store, product, variant, mapping,
        desired, version, record,
      );
    } catch (err) {
      if (isVariantStockUnsupported(err)) {
        await this.runs.upsertIssue({
          storeId: store.id,
          code: 'CAPABILITY_UNSUPPORTED',
          objectType,
          objectKey,
          productId: product.id,
          field: variant?.id,
          message: 'Per-variation stock is not supported by this provider: variant stock is monitor-only here.',
        });
        await item('SKIPPED', 'VARIANT_STOCK_UNSUPPORTED: no per-variation stock on this provider');
        return { status: 'SKIPPED', pushed: false, reason: 'VARIANT_STOCK_UNSUPPORTED' };
      }
      throw err;
    }
  }

  /**
   * Legacy status-only executor (P13 above-band for `faithful` /
   * status-only bridges, and the `always` path): recheck first (zero is a
   * forced push), push only on difference, cooldown-suppressed reflaps,
   * read-back verify with one repair attempt, then STOCK_VERIFY_FAILED.
   */
  private async pushStatusPlan(
    provider: CommerceProvider,
    sws: StoreWithSecrets,
    store: any,
    product: any,
    variant: any | null,
    mapping: any,
    desired: StockDesired,
    version: string,
    record: (status: string, reason: string) => Promise<unknown>,
  ): Promise<StockTargetResult> {
    const objectKey = `stock:${store.id}:${product.id}:${variant?.id ?? '-'}`;
    const objectType = variant ? 'VARIANT' : 'PRODUCT';
    // Below threshold (and audit re-verification): recheck first, push
    // only on difference. Zero is a forced push + read-back verify.
    if (desired.path !== 'zero') {
      const remote = await this.readRemote(provider, sws, store.id, product, variant, mapping);
      if (remote === null) {
        await record('SKIPPED', 'VARIANT_STOCK_UNSUPPORTED: no per-variation read on this provider');
        return { status: 'SKIPPED', pushed: false, reason: 'VARIANT_STOCK_UNSUPPORTED' };
      }
      if (remote === desired.state) {
        await this.bumpVersion(store.id, product.id, variant, version);
        await record('SUCCESS', `IN_SYNC: remote already ${desired.state} (no write)`);
        return { status: 'SUCCESS', pushed: false, reason: 'IN_SYNC' };
      }
    }
    const cooldownKey = `${store.id}:${product.id}:${variant?.id ?? '-'}`;
    if (this.cooldownHit(cooldownKey, desired.state, null)) {
      await this.bumpVersion(store.id, product.id, variant, version);
      await record('SUCCESS', `COOLDOWN_SUPPRESSED: ${desired.state} verified <${STOCK_SAME_STATE_COOLDOWN_MS}ms ago (no flapping)`);
      return { status: 'SUCCESS', pushed: false, reason: 'COOLDOWN_SUPPRESSED' };
    }
    // P13 above-band status push carries ONLY the status (Woo: `stock_status`
    // with remote management quantities NEVER enabled; bridge: `{status}`).
    const pushed = await this.pushRemote(provider, sws, store.id, product, variant, mapping, desired.state);
    if (pushed === null) {
      await record('SKIPPED', 'VARIANT_STOCK_UNSUPPORTED: no per-variation write on this provider');
      return { status: 'SKIPPED', pushed: false, reason: 'VARIANT_STOCK_UNSUPPORTED' };
    }
    const settledState = await this.settledRead(() =>
      this.readRemote(provider, sws, store.id, product, variant, mapping),
    );
    if (settledState.values.includes(desired.state)) {
      return await this.verified(store.id, product, variant, version, cooldownKey, desired, record, objectType, 'PUSH_VERIFIED', null);
    }
    // One repair attempt, then a STOCK_VERIFY_FAILED issue.
    await this.pushRemote(provider, sws, store.id, product, variant, mapping, desired.state);
    const second = await this.readRemote(provider, sws, store.id, product, variant, mapping);
    if (second === desired.state) {
      return await this.verified(store.id, product, variant, version, cooldownKey, desired, record, objectType, 'REPAIRED_AFTER_RETRY', null);
    }
    await this.runs.upsertIssue({
      storeId: store.id,
      code: 'STOCK_VERIFY_FAILED',
      objectType,
      objectKey,
      productId: product.id,
      field: variant?.id,
      message: `Stock push unverified after repair: pushed ${desired.state} (qty ${desired.qty}) but remote reads ${second}.`,
    });
    await record('FAILED', `STOCK_VERIFY_FAILED: pushed ${desired.state} but remote reads ${second} after repair`);
    // No version bump: a later change retries the push.
    return { status: 'FAILED', pushed: true, reason: 'STOCK_VERIFY_FAILED' };
  }

  /**
   * P13 quantity executor (zero / 1–5 exact / audit-capped bands):
   * recheck-first on non-zero bands when the remote quantity is observable
   * (a matching remote is IN_SYNC_QTY with no write; an unobservable remote
   * proceeds to push), forced push on zero, cooldown keyed on
   * (state + wire qty) so unit steps are never suppressed, quantity
   * read-back verify with one repair attempt, then STOCK_VERIFY_FAILED.
   * When the quantity is unobservable after both attempts, a matching
   * status read-back still verifies (PUSH_VERIFIED_STATUS_FALLBACK) —
   * never a silent verify-pass.
   */
  private async pushQuantityPlan(
    provider: CommerceProvider,
    sws: StoreWithSecrets,
    store: any,
    product: any,
    variant: any | null,
    mapping: any,
    desired: StockDesired,
    plan: StockPushPlan,
    version: string,
    record: (status: string, reason: string) => Promise<unknown>,
  ): Promise<StockTargetResult> {
    const objectKey = `stock:${store.id}:${product.id}:${variant?.id ?? '-'}`;
    const objectType = variant ? 'VARIANT' : 'PRODUCT';
    const cooldownKey = `${store.id}:${product.id}:${variant?.id ?? '-'}`;
    const qtyDesired: StockDesired = { ...desired, state: plan.state, qty: plan.wireQty };

    if (desired.path !== 'zero') {
      const remoteQty = await this.readQuantity(provider, sws, store.id, product, variant, mapping);
      if (remoteQty === null && variant && !this.hasVariantQuantityRead(provider)) {
        await record('SKIPPED', 'VARIANT_STOCK_UNSUPPORTED: no per-variation quantity read on this provider');
        return { status: 'SKIPPED', pushed: false, reason: 'VARIANT_STOCK_UNSUPPORTED' };
      }
      if (remoteQty !== null && remoteQty === plan.wireQty) {
        await this.bumpVersion(store.id, product.id, variant, version);
        await record('SUCCESS', `IN_SYNC_QTY: remote already ${plan.wireQty} (no write)`);
        return { status: 'SUCCESS', pushed: false, reason: 'IN_SYNC_QTY' };
      }
    }
    if (this.cooldownHit(cooldownKey, plan.state, plan.wireQty)) {
      await this.bumpVersion(store.id, product.id, variant, version);
      await record('SUCCESS', `COOLDOWN_SUPPRESSED: ${plan.state}×${plan.wireQty} verified <${STOCK_SAME_STATE_COOLDOWN_MS}ms ago (no flapping)`);
      return { status: 'SUCCESS', pushed: false, reason: 'COOLDOWN_SUPPRESSED' };
    }
    const pushed = await this.pushQuantity(provider, sws, store.id, product, variant, mapping, plan.wireQty);
    if (pushed === null) {
      await record('SKIPPED', 'VARIANT_STOCK_UNSUPPORTED: no per-variation quantity write on this provider');
      return { status: 'SKIPPED', pushed: false, reason: 'VARIANT_STOCK_UNSUPPORTED' };
    }
    const settled = await this.settledRead(() =>
      this.readQuantity(provider, sws, store.id, product, variant, mapping),
    );
    if (settled.values.includes(plan.wireQty)) {
      return await this.verified(store.id, product, variant, version, cooldownKey, qtyDesired, record, objectType, 'PUSH_VERIFIED_QTY', plan.wireQty);
    }
    // One repair attempt.
    await this.pushQuantity(provider, sws, store.id, product, variant, mapping, plan.wireQty);
    const second = await this.readQuantity(provider, sws, store.id, product, variant, mapping);
    if (second === plan.wireQty) {
      return await this.verified(store.id, product, variant, version, cooldownKey, qtyDesired, record, objectType, 'REPAIRED_AFTER_RETRY_QTY', plan.wireQty);
    }
    if (settled.values.every((v) => v === null) && second === null) {
      // Quantity unobservable on this remote: a matching status still
      // verifies the projection (loud reason, never silent).
      const statusBack = await this.readRemote(provider, sws, store.id, product, variant, mapping);
      if (statusBack === plan.state) {
        return await this.verified(store.id, product, variant, version, cooldownKey, qtyDesired, record, objectType, 'PUSH_VERIFIED_STATUS_FALLBACK', plan.wireQty);
      }
    }
    await this.runs.upsertIssue({
      storeId: store.id,
      code: 'STOCK_VERIFY_FAILED',
      objectType,
      objectKey,
      productId: product.id,
      field: variant?.id,
      message: `Stock quantity push unverified after repair: pushed ${plan.wireQty} (state ${plan.state}, ERP qty ${desired.qty}) but remote reads ${second}.`,
    });
    await record('FAILED', `STOCK_VERIFY_FAILED: pushed qty ${plan.wireQty} but remote reads ${second} after repair`);
    // No version bump: a later change retries the push.
    return { status: 'FAILED', pushed: true, reason: 'STOCK_VERIFY_FAILED' };
  }

  // ── Daily audit (BullMQ repeatable `0 3 * * *` Asia/Dhaka) ────────────

  async runAudit(
    jobData: { cursor?: { storeId?: string; productId?: string } } = {},
  ): Promise<{ stores: number; evaluated: number; pushed: number; failed: number }> {
    const summary = { stores: 0, evaluated: 0, pushed: 0, failed: 0 };
    if (!stockAuditEnabled()) {
      this.logger.warn('stock audit skipped: store_stock_audit_enabled is off (fail-closed)');
      return summary;
    }
    const run = await this.runs.begin({ scope: 'STOCK', triggerType: 'SCHEDULED' });
    const runId = (run as any).id as string;
    let cursor = jobData.cursor;
    try {
      const stores = await this.prisma.store.findMany({
        where: { kind: { not: 'NATIVE' }, status: 'CONNECTED', autoSyncEnabled: true },
        orderBy: { id: 'asc' },
      });
      let storeStarted = !cursor?.storeId;
      for (const store of stores) {
        if (!storeStarted) {
          if (store.id === cursor?.storeId) storeStarted = true;
          else continue;
        }
        summary.stores += 1;
        // Cursor-resumable: the resumed store continues after its last page.
        let pageCursor: string | undefined =
          cursor?.storeId === store.id ? cursor.productId : undefined;
        for (;;) {
          const batch = await this.prisma.productStoreAssignment.findMany({
            where: {
              storeId: store.id,
              ...(pageCursor ? { productId: { gt: pageCursor } } : {}),
            },
            orderBy: { productId: 'asc' },
            take: STOCK_AUDIT_PAGE_SIZE,
            select: { productId: true },
          });
          if (batch.length === 0) break;
          const evaluated = await boundedMap(
            batch,
            STOCK_AUDIT_CONCURRENCY,
            async (a: { productId: string }) => {
              try {
                return await this.evaluateProduct(store.id, a.productId, null, runId, { audit: true });
              } catch (err) {
                await this.runs.recordAttempt({
                  runId,
                  storeId: store.id,
                  objectType: 'PRODUCT',
                  objectKey: `stock:${store.id}:${a.productId}:-`,
                  productId: a.productId,
                  status: 'FAILED',
                  errorCategory: 'AUDIT_ITEM',
                  errorMessage: err instanceof Error ? err.message : String(err),
                });
                return [{ status: 'FAILED', pushed: false, reason: 'AUDIT_ITEM_ERROR' } as StockTargetResult];
              }
            },
          );
          for (const arr of evaluated) {
            for (const r of arr) {
              summary.evaluated += 1;
              if (r.pushed) summary.pushed += 1;
              if (r.status === 'FAILED') summary.failed += 1;
            }
          }
          pageCursor = batch[batch.length - 1].productId;
          cursor = { storeId: store.id, productId: pageCursor };
          if (batch.length === STOCK_AUDIT_PAGE_SIZE) {
            await new Promise((r) => setTimeout(r, STOCK_AUDIT_PAGE_DELAY_MS));
          }
        }
      }
      const skipped = Math.max(0, summary.evaluated - summary.pushed - summary.failed);
      await this.runs.finish(runId, {
        created: 0,
        updated: summary.pushed,
        skipped,
        failed: summary.failed,
      });
      return summary;
    } catch (err) {
      await this.runs
        .finish(runId, { created: 0, updated: summary.pushed, failed: summary.failed + 1 })
        .catch(() => undefined);
      // Cursor-resumable: a fatal error re-enqueues the continuation instead
      // of restarting the whole audit from the first store.
      if (cursor) {
        await this.queues
          .enqueue('store-stock-sync', 'stock-audit', { cursor }, `stock-audit-continue:${Date.now()}`)
          .catch(() => undefined);
      }
      await this.runs
        .upsertIssue({
          storeId: cursor?.storeId ?? 'unknown',
          code: 'DEAD_LETTER',
          objectType: 'PRODUCT',
          objectKey: `stock-audit:${cursor?.storeId ?? 'all'}:${cursor?.productId ?? 'start'}`,
          message: `Stock audit aborted: ${err instanceof Error ? err.message : String(err)}`,
        })
        .catch(() => undefined);
      throw err;
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async verified(
    storeId: string,
    product: any,
    variant: any | null,
    version: string,
    cooldownKey: string,
    desired: StockDesired,
    record: (status: string, reason: string) => Promise<unknown>,
    objectType: string,
    reason: string,
    wireQty: number | null,
  ): Promise<StockTargetResult> {
    this.markPushed(cooldownKey, desired.state, wireQty);
    await this.bumpVersion(storeId, product.id, variant, version);
    const qtyNote = wireQty === null ? `(qty ${desired.qty})` : `(wire ${wireQty}, ERP ${desired.qty})`;
    await record('SUCCESS', `${reason}: remote ${desired.state} verified by read-back ${qtyNote}`);
    // Drain: a commit that landed mid-push must not wait for the audit.
    const fresh = await this.computeVersion(product, variant).catch(() => null);
    if (fresh && fresh > version) {
      await this.queues
        .enqueue(
          'store-stock-sync',
          'stock-change',
          { storeId, productId: product.id, variantId: variant?.id ?? null, reason: 'drain' },
          `stock:${storeId}:${product.id}:${variant?.id ?? '-'}:drain:${Date.now()}`,
          { delay: STOCK_DEBOUNCE_MS },
        )
        .catch(() => undefined);
    }
    return { status: 'SUCCESS', pushed: true, reason };
  }

  private async skipCombo(storeId: string, product: any, runId: string): Promise<StockTargetResult> {
    // Combos = min(child availability) for the audit trail; never pushed.
    let min: number | null = null;
    try {
      const items = await (this.prisma as any).comboItem.findMany({
        where: { productId: product.id },
        include: {
          product: { select: { id: true, availabilityMode: true, managedStockQuantity: true, reservedStock: true } },
          variant: { select: { id: true, managedStockQuantity: true, reservedStock: true } },
        },
      });
      for (const ci of items ?? []) {
        const childQty = ci.variant
          ? (ci.variant.managedStockQuantity ?? 0) - (ci.variant.reservedStock ?? 0)
          : ((ci.product?.managedStockQuantity ?? 0) - (ci.product?.reservedStock ?? 0));
        min = min === null ? childQty : Math.min(min, childQty);
      }
    } catch {
      min = null;
    }
    await this.runs.recordItem(runId, {
      storeId,
      productId: product.id,
      objectType: 'PRODUCT',
      status: 'SKIPPED',
      reason: `COMBO_MIN_AVAILABILITY:${min === null ? 'unknown' : min <= 0 ? 'OUT' : 'IN'} (min child ${min ?? 'n/a'}): combos are never pushed as products (BR-22)`,
      auditLevel: 'G',
    });
    return { status: 'SKIPPED', pushed: false, reason: 'COMBO_SKIPPED' };
  }

  async desiredState(product: any, variant: any | null, threshold: number): Promise<StockDesired> {
    const globalActive =
      product.status === 'active' &&
      product.isActive === true &&
      (variant ? variant.isActive !== false : true);
    if (!globalActive) return { state: 'OUT_OF_STOCK', qty: 0, path: 'zero', threshold };
    const mode = (product.availabilityMode ?? null) as string | null;
    if (!mode || mode === 'ALWAYS_IN_STOCK') {
      return { state: 'IN_STOCK', qty: Number.POSITIVE_INFINITY, path: 'always', threshold };
    }
    if (mode === 'ALWAYS_OUT_OF_STOCK') {
      return { state: 'OUT_OF_STOCK', qty: 0, path: 'zero', threshold };
    }
    if (mode === 'INVENTORY_CONTROLLED') {
      const where: any =
        variant || product.type !== 'variable'
          ? { productId: product.id, variantId: variant?.id ?? null }
          : { productId: product.id };
      const rows = await this.prisma.physicalInventory.findMany({
        where,
        select: { quantity: true, reservedQuantity: true },
      });
      const qty = rows.reduce((s, r) => s + ((r.quantity ?? 0) - (r.reservedQuantity ?? 0)), 0);
      return { ...desiredFromQty(qty, threshold), qty, threshold };
    }
    // MANAGED_STOCK and any unknown mode (fail-closed to managed fields).
    const qty = variant
      ? (variant.managedStockQuantity ?? 0) - (variant.reservedStock ?? 0)
      : product.type === 'variable'
        ? ((product.variants ?? []) as any[]).reduce(
            (s, v) => s + ((v.managedStockQuantity ?? 0) - (v.reservedStock ?? 0)),
            0,
          )
        : ((product.managedStockQuantity ?? 0) - (product.reservedStock ?? 0));
    return { ...desiredFromQty(qty, threshold), qty, threshold };
  }

  async computeVersion(product: any, variant: any | null): Promise<string> {
    const rowUpdatedAt = variant?.updatedAt ?? product.updatedAt;
    const ledger = await this.prisma.managedStockLedger
      .findFirst({
        where: variant
          ? { productId: product.id, variantId: variant.id }
          : { productId: product.id, variantId: null },
        orderBy: { performedAt: 'desc' },
        select: { performedAt: true },
      })
      .catch(() => null);
    let physicalAt: Date | null = null;
    if ((product.availabilityMode ?? null) === 'INVENTORY_CONTROLLED') {
      const agg = await this.prisma.physicalInventory
        .aggregate({
          where: variant
            ? { productId: product.id, variantId: variant.id }
            : { productId: product.id },
          _max: { updatedAt: true },
        })
        .catch(() => null);
      physicalAt = agg?._max?.updatedAt ?? null;
    }
    const rowMs = Math.max(
      new Date(rowUpdatedAt).getTime(),
      physicalAt ? new Date(physicalAt).getTime() : 0,
    );
    return versionFor(new Date(rowMs), ledger?.performedAt ?? null);
  }

  private async bumpVersion(
    storeId: string,
    productId: string,
    variant: any | null,
    version: string,
  ): Promise<void> {
    if (variant) {
      await (this.prisma as any).storeVariantMapping.updateMany({
        where: { storeId, variantId: variant.id },
        data: { lastEvaluatedVersion: version },
      });
    } else {
      await (this.prisma as any).storeProductMapping.updateMany({
        where: { storeId, productId },
        data: { lastEvaluatedVersion: version },
      });
    }
  }

  private async readRemote(
    provider: CommerceProvider,
    sws: StoreWithSecrets,
    storeId: string,
    product: any,
    variant: any | null,
    mapping: any,
  ): Promise<StockState | null> {
    void storeId;
    if (variant) {
      const productMapping = await (this.prisma as any).storeProductMapping.findUnique({
        where: { storeId_productId: { storeId, productId: product.id } },
      });
      if (!productMapping) return null;
      const parentRef: RemoteRef = { providerId: productMapping.externalId };
      const variantRef: RemoteRef = { providerId: mapping.externalId };
      try {
        if (typeof provider.readVariantStockState !== 'function') return null;
        return await provider.readVariantStockState(sws, parentRef, variantRef);
      } catch (err) {
        if (isVariantStockUnsupported(err)) return null;
        throw err;
      }
    }
    return provider.readStockState(sws, { providerId: mapping.externalId });
  }

  private async pushRemote(
    provider: CommerceProvider,
    sws: StoreWithSecrets,
    storeId: string,
    product: any,
    variant: any | null,
    mapping: any,
    state: StockState,
  ): Promise<boolean | null> {
    void storeId;
    if (variant) {
      const productMapping = await (this.prisma as any).storeProductMapping.findUnique({
        where: { storeId_productId: { storeId, productId: product.id } },
      });
      if (!productMapping) return null;
      const parentRef: RemoteRef = { providerId: productMapping.externalId };
      const variantRef: RemoteRef = { providerId: mapping.externalId };
      try {
        if (typeof provider.publishVariantStockState !== 'function') return null;
        await provider.publishVariantStockState(sws, parentRef, variantRef, state);
        return true;
      } catch (err) {
        if (isVariantStockUnsupported(err)) return null;
        throw err;
      }
    }
    await provider.publishStockState(sws, { providerId: mapping.externalId }, state);
    return true;
  }

  /** P13 flapping guard keyed on (state + wire qty): unit steps never suppress. */
  private cooldownHit(key: string, state: StockState, qty: number | null): boolean {
    const last = this.lastPush.get(key);
    return (
      !!last &&
      last.state === state &&
      last.qty === qty &&
      Date.now() - last.at < STOCK_SAME_STATE_COOLDOWN_MS
    );
  }

  private markPushed(key: string, state: StockState, qty: number | null): void {
    this.lastPush.set(key, { state, qty, at: Date.now() });
  }

  private hasVariantQuantityRead(provider: CommerceProvider): boolean {
    return typeof provider.readVariantStockQuantity === 'function';
  }

  /**
   * P13 quantity read-back: exact remote units when observable, null when
   * the provider cannot observe a quantity (engine falls back to a status
   * read-back — never a silent verify-pass). A variant target without a
   * variant quantity reader yields null (the caller maps it to
   * VARIANT_STOCK_UNSUPPORTED, never to a product-level quantity).
   */
  private async readQuantity(
    provider: CommerceProvider,
    sws: StoreWithSecrets,
    storeId: string,
    product: any,
    variant: any | null,
    mapping: any,
  ): Promise<number | null> {
    void storeId;
    if (variant) {
      const productMapping = await (this.prisma as any).storeProductMapping.findUnique({
        where: { storeId_productId: { storeId, productId: product.id } },
      });
      if (!productMapping) return null;
      const parentRef: RemoteRef = { providerId: productMapping.externalId };
      const variantRef: RemoteRef = { providerId: mapping.externalId };
      try {
        if (typeof provider.readVariantStockQuantity !== 'function') return null;
        return await provider.readVariantStockQuantity(sws, parentRef, variantRef);
      } catch (err) {
        if (isVariantStockUnsupported(err)) return null;
        throw err;
      }
    }
    if (typeof provider.readStockQuantity !== 'function') return null;
    return provider.readStockQuantity(sws, { providerId: mapping.externalId });
  }

  /**
   * Settled read-back: remotes serve stale values for seconds after a
   * write. Poll (reads × delay) for the expected value before concluding
   * a mismatch — a lagging read must trigger patience, not a repair push
   * plus a false STOCK_VERIFY_FAILED issue.
   */
  private async settledRead(
    read: () => Promise<StockState | number | null>,
  ): Promise<{ values: (StockState | number | null)[] }> {
    const values: (StockState | number | null)[] = [];
    for (let i = 0; i < STOCK_VERIFY.reads; i++) {
      if (i > 0 && STOCK_VERIFY.delayMs > 0) {
        await new Promise((r) => setTimeout(r, STOCK_VERIFY.delayMs));
      }
      try {
        values.push(await read());
      } catch {
        values.push(null);
      }
    }
    return { values };
  }

  /**
   * P13 quantity push: exact wire units via the provider's native shape
   * (Woo `stock_quantity`, Shopify `InventoryLevel`, bridge `quantity`).
   * Variant targets without a variant quantity writer yield null (the
   * caller maps it to VARIANT_STOCK_UNSUPPORTED).
   */
  private async pushQuantity(
    provider: CommerceProvider,
    sws: StoreWithSecrets,
    storeId: string,
    product: any,
    variant: any | null,
    mapping: any,
    qty: number,
  ): Promise<boolean | null> {
    void storeId;
    if (variant) {
      const productMapping = await (this.prisma as any).storeProductMapping.findUnique({
        where: { storeId_productId: { storeId, productId: product.id } },
      });
      if (!productMapping) return null;
      const parentRef: RemoteRef = { providerId: productMapping.externalId };
      const variantRef: RemoteRef = { providerId: mapping.externalId };
      try {
        if (typeof provider.publishVariantStockQuantity !== 'function') return null;
        await provider.publishVariantStockQuantity(sws, parentRef, variantRef, qty);
        return true;
      } catch (err) {
        if (isVariantStockUnsupported(err)) return null;
        throw err;
      }
    }
    if (typeof provider.publishStockQuantity !== 'function') return null;
    await provider.publishStockQuantity(sws, { providerId: mapping.externalId }, qty);
    return true;
  }

  private async storeWithSecrets(store: any): Promise<StoreWithSecrets> {
    if (this.stores) {
      try {
        return await this.stores.storeWithSecrets(store.id);
      } catch {
        // fall through to the settings-only shape (tests / missing creds)
      }
    }
    return {
      id: store.id,
      kind: store.kind,
      settings: (store.settings as Record<string, unknown> | null) ?? {},
      secrets: {},
    };
  }
}

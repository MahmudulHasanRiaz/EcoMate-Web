/**
 * Store order status push — central-commerce P7 (§8.6, BR-17).
 *
 * EcoMate → store direction for orders that have a `StoreOrderMapping`:
 * triggered post-commit from the order cancel/return/Delivered hooks
 * (`OrdersService` calls `notifyOrderStatusChanged`, which only enqueues —
 * never throws into the order path, R-2). The worker:
 *
 *  - re-reads mapping + live order status (never trusts the payload, so a
 *    stale enqueue after a re-hold is a `STATUS_SUPERSEDED` skip, not a push);
 *  - resolves the provider target through
 *    `capabilities.orderStatusUpdateTargets` (case-insensitive; core branches
 *    on capabilities, never on a provider slug): Cancelled → `cancelled`,
 *    Delivered → `completed`. `Returned` has no phase-1 target on any
 *    provider → explicit `NO_PUSH_TARGET_FOR_RETURNED` skip (never silent,
 *    never a wrong-status push);
 *  - is idempotent via `StoreOrderMapping.lastPushedStatus`: a repeat run
 *    with the same canonical target no-ops with zero provider calls;
 *  - verifies every push by read-back (`provider.readOrderStatus`): mismatch
 *    → exactly one repair push + re-read → still mismatched → classified
 *    failure (retry ladder) ending in an `ORDER_PUSH_VERIFY_FAILED` issue;
 *  - retries per the standard classification (§8.1 ladder, engine-owned —
 *    BullMQ attempts stay 1 so permanent failures never loop).
 *
 * BR-17: only status travels outward; totals/items/prices are never read,
 * never written. Shopify/Custom adapters stay stubbed until P9/P10 — the
 * stub throw is classified (permanent) and recorded, never swallowed.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { ProviderError, ProviderErrorCategory } from '../../marketing/ad-provider.adapter';
import { SyncRunService } from '../sync/sync-run.service';
import { SyncQueuesService } from '../sync/sync-queues.service';
import { StoresService } from '../stores.service';
import { orderPushEnabled } from '../store-flags';
import {
  classifyProviderError,
  MAX_SYNC_ATTEMPTS,
  RETRY_BACKOFF_MS,
} from '../providers/retry-classifier';
import type {
  CommerceProvider,
  RemoteRef,
} from '../providers/provider.contract';

export type OrderPushTarget = 'cancelled' | 'completed';

/** EcoMate statuses that enqueue a push job (cancel/return/Delivered hooks). */
export const PUSHABLE_ECO_STATUSES = ['Cancelled', 'Delivered', 'Returned'] as const;

/** Canonical target per EcoMate status (before capability gating). */
export const ECO_STATUS_TO_CANONICAL_TARGET: Record<string, OrderPushTarget | null> = {
  Cancelled: 'cancelled',
  Delivered: 'completed',
  // Phase-1 providers express cancel/fulfil only — a return is an explicit
  // skip, never a wrong-status push.
  Returned: null,
};

export type TargetResolution =
  | { target: OrderPushTarget }
  | { skipped: string };

/**
 * Remote-vocabulary synonyms per canonical target. The contract speaks
 * canonical `cancelled | completed`; a provider may declare its remote
 * vocabulary instead (Shopify P9: `CANCELLED/FULFILLED` per §7.1) and the
 * P9/P10 adapter renders the canonical target remotely. Core never branches
 * on a slug — acceptance is declared-data-driven.
 */
export const TARGET_SYNONYMS: Record<OrderPushTarget, string[]> = {
  cancelled: ['cancelled'],
  completed: ['completed', 'fulfilled'],
};

/**
 * Pure: EcoMate status + capability targets → canonical push target or an
 * explicit skip reason. Case-insensitive on the capability side so the
 * Shopify `['CANCELLED','FULFILLED']` declaration (P9) resolves without any
 * slug branching in core.
 */
export function targetForEcoStatus(
  ecoStatus: string,
  targets: string[],
): TargetResolution {
  const canonical = ECO_STATUS_TO_CANONICAL_TARGET[ecoStatus] ?? null;
  if (!canonical) {
    if (ecoStatus === 'Returned') return { skipped: 'NO_PUSH_TARGET_FOR_RETURNED' };
    return { skipped: `NOT_PUSHABLE_STATUS:${ecoStatus}` };
  }
  const lowered = new Set((targets ?? []).map((t) => String(t).toLowerCase()));
  const accepted = TARGET_SYNONYMS[canonical].some((syn) => lowered.has(syn));
  if (!accepted) {
    return { skipped: `UNSUPPORTED_TARGET:${canonical}` };
  }
  return { target: canonical };
}

export interface OrderPushJob {
  storeId: string;
  orderId: string;
  ecoStatus: string;
  attemptNo?: number;
}

export interface OrderPushOutcome {
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  reason: string;
}

@Injectable()
export class StoreOrderPushService {
  private readonly logger = new Logger(StoreOrderPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    @Optional() private readonly stores?: StoresService,
  ) {}

  // ── Change notification (§8.6: post-commit, non-propagating) ──────────

  /**
   * Enqueue a status-push job for a mapped order that just entered a
   * pushable status. Non-mapped orders return silently (never pushed);
   * non-pushable statuses return silently (nothing to push). Never throws
   * (R-2) — correctness comes from re-reads in the worker, not from this
   * call succeeding.
   */
  async notifyOrderStatusChanged(orderId: string): Promise<void> {
    try {
      if (!orderPushEnabled()) return;
      if (!orderId) return;
      const mapping = await (this.prisma as any).storeOrderMapping.findUnique({
        where: { orderId },
      });
      // Non-mapped (native/manual/POS) orders are never pushed.
      if (!mapping) return;
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { status: true },
      });
      const statusName = (order as any)?.status?.name;
      if (!(PUSHABLE_ECO_STATUSES as readonly string[]).includes(statusName)) return;
      await this.queues.enqueue(
        'store-order-push',
        'order-status-push',
        { storeId: mapping.storeId, orderId, ecoStatus: statusName },
        // Unique per enqueue (NOT deduplicated): bursts collapse via
        // lastPushedStatus idempotency in the worker, and a completed-job
        // id can never swallow a legitimate re-push after a re-hold.
        `order-push:${mapping.storeId}:${orderId}:${statusName}:${Date.now()}`,
      );
    } catch {
      // Non-propagating by contract (R-2).
    }
  }

  // ── Worker ────────────────────────────────────────────────────────────

  async handlePush(job: OrderPushJob): Promise<OrderPushOutcome> {
    const run = await this.runs.begin({
      scope: 'ORDER_PUSH',
      triggerType: 'SYSTEM',
      storeId: job.storeId,
    });
    const runId = (run as any).id as string;
    const objectKey = `store:${job.storeId}:order-push:${job.orderId}`;

    const skip = async (reason: string): Promise<OrderPushOutcome> => {
      await this.runs.recordItem(runId, {
        storeId: job.storeId,
        objectType: 'ORDER',
        externalObjectId: job.orderId,
        status: 'SKIPPED',
        reason,
        auditLevel: 'G',
      });
      await this.runs.finish(runId, { created: 0, updated: 0, skipped: 1, failed: 0 });
      return { status: 'SKIPPED', reason };
    };

    try {
      // (1) Mapping — gone (order hard-deleted cascades it) → explicit skip.
      const mapping = await (this.prisma as any).storeOrderMapping.findUnique({
        where: { orderId: job.orderId },
      });
      if (!mapping) return skip('MAPPING_GONE: order has no store mapping — never pushed');

      // (2) Live status — never trust the payload. A re-hold/re-transition
      // after enqueue is a supersede-skip, never a stale push.
      const order = await this.prisma.order.findUnique({
        where: { id: job.orderId },
        include: { status: true },
      });
      const liveStatus = (order as any)?.status?.name;
      if (!order || (order as any).trashedAt) return skip('ORDER_GONE: order missing or trashed');
      if (!(PUSHABLE_ECO_STATUSES as readonly string[]).includes(liveStatus)) {
        return skip(`STATUS_SUPERSEDED:${liveStatus ?? 'unknown'}: enqueue was for "${job.ecoStatus}" — no push`);
      }

      // (3) Store + provider resolution (local only — no HTTP yet).
      const store = await (this.prisma as any).store.findUnique({
        where: { id: job.storeId },
      });
      if (!store) return skip('STORE_GONE: store row missing');
      if (store.status !== 'CONNECTED') {
        return skip(`STORE_NOT_CONNECTED:${store.status}: push deferred, never attempted`);
      }
      // NATIVE throws here (BR-20) — a mapping for a NATIVE store cannot
      // exist, so this is defence-in-depth, recorded not thrown past.
      let provider: CommerceProvider;
      try {
        provider = this.registry.providerFor({ kind: store.kind });
      } catch (err) {
        return skip(`PROVIDER_UNRESOLVABLE:${err instanceof Error ? err.message : String(err)}`);
      }
      const capabilities = await provider.resolveCapabilities({
        id: store.id,
        kind: store.kind,
        settings: (store.settings as Record<string, unknown> | null) ?? {},
      });

      // (4) Capability gate: orderStatusUpdate off, or the canonical target
      // absent → explicit SKIPPED with reason (never a silent no-op).
      if (!capabilities.orderStatusUpdate) {
        return skip('ORDER_STATUS_UPDATE_UNSUPPORTED: provider cannot receive status — no writes attempted');
      }
      const resolution = targetForEcoStatus(
        liveStatus,
        capabilities.orderStatusUpdateTargets ?? [],
      );
      if ('skipped' in resolution) return skip(`${resolution.skipped}: status "${liveStatus}" not pushed`);
      const target = resolution.target;

      // (5) Idempotency: same canonical target already confirmed → no-op
      // with ZERO provider calls (asserted by call-log in tests).
      if (mapping.lastPushedStatus === target) {
        return skip(`ALREADY_PUSHED:${target}: idempotent no-op, no provider call`);
      }

      // (6) Push + read-back verification.
      const secrets = this.stores
        ? await this.stores.storeWithSecrets(job.storeId)
        : { id: job.storeId, kind: store.kind, settings: {}, secrets: {} };
      const ref: RemoteRef = { providerId: mapping.externalOrderId };
      const pushRes = await provider.pushOrderStatus(secrets as any, ref, target);
      if (pushRes && pushRes.skipped) {
        return skip(`PROVIDER_SKIPPED:${pushRes.reason ?? 'no-reason'}: adapter declined the write`);
      }
      await this.verifyReadBack(provider, secrets as any, ref, target);

      // (7) Record the confirmed target — the idempotency key for replays.
      await (this.prisma as any).storeOrderMapping.update({
        where: { id: mapping.id },
        data: { lastPushedStatus: target },
      });
      await this.runs.recordItem(runId, {
        storeId: job.storeId,
        objectType: 'ORDER',
        externalObjectId: mapping.externalOrderId,
        status: 'SUCCESS',
        reason: `PUSHED:${target} for EcoMate status "${liveStatus}" (read-back verified)`,
        auditLevel: 'G',
      });
      await this.runs.finish(runId, { created: 0, updated: 1, failed: 0 });
      return { status: 'SUCCESS', reason: `PUSHED:${target}` };
    } catch (err) {
      // §8.1 retry ladder (engine-owned; BullMQ attempts stay 1 so
      // permanent failures never loop). BR-26 spirit: failures write only
      // attempt/issue rows — order + mapping rows are untouched here.
      const decision = classifyProviderError(err);
      const attemptNo = (job.attemptNo ?? 0) + 1;
      const message = err instanceof Error ? err.message : String(err);
      const nextDelay =
        !decision.retryable || attemptNo >= MAX_SYNC_ATTEMPTS
          ? null
          : RETRY_BACKOFF_MS[Math.min(attemptNo - 1, RETRY_BACKOFF_MS.length - 1)];
      await this.runs.recordAttempt({
        runId,
        storeId: job.storeId,
        objectType: 'ORDER',
        objectKey,
        attemptNo,
        status: nextDelay ? 'PENDING' : 'DEAD',
        errorCategory: String(decision.category),
        errorMessage: message,
      });
      if (nextDelay) {
        await this.queues.enqueue(
          'store-order-push',
          'order-status-push',
          { ...job, attemptNo },
          `${objectKey}:retry:${attemptNo}`,
          { delay: nextDelay },
        );
        await this.runs.finish(runId, { created: 0, updated: 0, failed: 1 });
        return { status: 'FAILED', reason: `RETRY_SCHEDULED:${attemptNo}:${decision.category}` };
      }
      await this.runs.upsertIssue({
        storeId: job.storeId,
        code: 'ORDER_PUSH_DEAD',
        objectType: 'ORDER',
        objectKey,
        message: `Order status push dead after ${attemptNo} attempts (${decision.category}): ${message}`,
      });
      await this.runs.finish(runId, { created: 0, updated: 0, failed: 1 });
      return { status: 'FAILED', reason: `DEAD:${decision.category}:${message}` };
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /**
   * Read-back verification: the push is SUCCESS only when the remote order
   * reads back at the canonical target (case-insensitive — WC returns
   * lowercase, a future adapter may not). One repair push + re-read on
   * mismatch, then a retryable failure (remote may settle) ending DEAD +
   * issue via the caller's ladder. A missing read seam is a loud permanent
   * failure (VERIFY_UNSUPPORTED), never a silent verify-pass.
   */
  private async verifyReadBack(
    provider: CommerceProvider,
    store: { id: string; kind: string; settings?: Record<string, unknown> | null; secrets?: Record<string, unknown> | null },
    ref: RemoteRef,
    target: OrderPushTarget,
  ): Promise<void> {
    const reader = provider.readOrderStatus;
    if (typeof reader !== 'function') {
      throw new ProviderError(
        `[${provider.slug}] readOrderStatus unavailable (VERIFY_UNSUPPORTED) — push unverifiable`,
        ProviderErrorCategory.INVALID_REQUEST,
        provider.slug,
      );
    }
    const matches = (status: string) => String(status ?? '').trim().toLowerCase() === target;
    const first = await reader.call(provider, store as any, ref);
    if (matches(first.status)) return;
    // One repair attempt, then fail loud.
    await provider.pushOrderStatus(store as any, ref, target);
    const second = await reader.call(provider, store as any, ref);
    if (matches(second.status)) return;
    this.logger.warn(`order push verify failed for ${ref.providerId}: remote reads "${second.status}", want "${target}"`);
    throw new ProviderError(
      `[${provider.slug}] order status push unverified: remote reads "${second.status}", want "${target}" (ORDER_PUSH_VERIFY_FAILED)`,
      ProviderErrorCategory.TEMPORARY_FAILURE,
      provider.slug,
    );
  }
}

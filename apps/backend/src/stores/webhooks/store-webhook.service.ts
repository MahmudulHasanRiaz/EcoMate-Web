/**
 * Store webhook intake — central-commerce P6 (§8.5 webhook path, §8.7).
 *
 * Verify HMAC over the RAW body → dedupe `deliveryKey` → insert
 * `StoreWebhookDelivery` → enqueue → 200 immediately. Heavy work NEVER runs
 * in the request (BR-21). Error bodies are generic (never echo the secret or
 * the expected signature); the `store_webhook` rate-limit policy applies.
 *
 * Disconnected store → generic 401 while retaining all rows (§8.10).
 */
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { StoresService } from '../stores.service';
import { SyncRunService } from '../sync/sync-run.service';
import { SyncQueuesService } from '../sync/sync-queues.service';
import { isTimestampFresh } from '../providers/webhook-crypto';
import { buildStoreDeliveryKey } from '../orders/normalize-order';

/**
 * Order topics across providers (`orders/create` Shopify, `order.created`
 * WooCommerce, `order.*` bridge). Anything else (products/*, …) is audit
 * history, never ingestion input.
 */
export function isOrderTopic(topic: string): boolean {
  const t = topic.trim().toLowerCase();
  return t === 'orders' || t.startsWith('orders/') || t.startsWith('order.');
}
import type { ProviderSlug } from '../providers/provider.contract';

export const STORE_WEBHOOK_GENERIC_ERROR = 'Unauthorized';

/** Timestamp headers carrying replay protection, by provider. */
const TIMESTAMP_HEADERS: Record<ProviderSlug, string[]> = {
  woocommerce: ['x-wc-webhook-timestamp', 'x-ecomate-timestamp'],
  shopify: ['x-shopify-timestamp', 'x-ecomate-timestamp'],
  custom: ['x-ecomate-timestamp'],
};

/** Delivery-id headers, by provider. */
const DELIVERY_HEADERS: Record<ProviderSlug, string[]> = {
  woocommerce: ['x-wc-webhook-delivery-id'],
  shopify: ['x-shopify-webhook-id'],
  custom: ['x-ecomate-delivery-id'],
};

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

@Injectable()
export class StoreWebhookService {
  private readonly logger = new Logger(StoreWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly stores: StoresService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
  ) {}

  /**
   * Intake one webhook delivery. Returns `{ received: true, duplicate }`.
   * Throws generic 401 for: unknown store, disconnected store, bad signature,
   * missing delivery id, stale timestamp. Never leaks which check failed.
   */
  async intake(
    slug: ProviderSlug,
    storeKey: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): Promise<{ received: boolean; duplicate: boolean }> {
    const store = await this.prisma.store.findUnique({ where: { id: storeKey } });
    // Unknown store, NATIVE kind, or disconnected → identical generic 401
    // (no oracle for probing store ids or connection state).
    if (!store || (store as any).kind === 'NATIVE' || (store as any).status === 'DISCONNECTED') {
      this.logger.warn(`webhook ${slug}: rejected (unknown/disconnected/native) key=${storeKey.slice(0, 8)}…`);
      throw new UnauthorizedException(STORE_WEBHOOK_GENERIC_ERROR);
    }

    const withSecrets = await this.stores.storeWithSecrets(store.id);
    const provider = this.registry.providerFor({ kind: (store as any).kind });
    const verification = provider.verifyWebhook(withSecrets as any, headers, rawBody);
    if (!verification.valid) {
      this.logger.warn(
        `webhook ${slug}: bad signature for store ${store.id} (reason=${verification.reason})`,
      );
      throw new UnauthorizedException(STORE_WEBHOOK_GENERIC_ERROR);
    }

    // 5-minute replay window where a timestamp is supplied (§8.7). Custom
    // already enforces it in verifyWebhook; WC/Shopify enforce here when the
    // plugin/proxy supplies one. Absent timestamp → deliveryKey dedupe below
    // is the authoritative replay protection.
    for (const name of TIMESTAMP_HEADERS[slug]) {
      const ts = header(headers, name);
      if (ts !== undefined && !isTimestampFresh(ts)) {
        this.logger.warn(`webhook ${slug}: stale timestamp for store ${store.id}`);
        throw new UnauthorizedException(STORE_WEBHOOK_GENERIC_ERROR);
      }
    }

    const deliveryId =
      verification.deliveryId ?? header(headers, DELIVERY_HEADERS[slug][0]);
    if (!deliveryId) {
      this.logger.warn(`webhook ${slug}: missing delivery id for store ${store.id}`);
      throw new UnauthorizedException(STORE_WEBHOOK_GENERIC_ERROR);
    }
    const deliveryKey = buildStoreDeliveryKey(store.id, deliveryId);

    const seen = await this.prisma.storeWebhookDelivery.findUnique({
      where: { deliveryKey },
    });
    if (seen) {
      // Duplicate delivery: bump the counter, do NOT re-enqueue (BR-12).
      await this.prisma.storeWebhookDelivery.update({
        where: { deliveryKey },
        data: { occurrences: { increment: 1 } },
      });
      return { received: true, duplicate: true };
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      payload = null;
    }

    await this.prisma.storeWebhookDelivery.create({
      data: {
        storeId: store.id,
        deliveryKey,
        topic: verification.topic ?? null,
      },
    });

    // Topic routing: ONLY order topics enter order ingestion. Product (and
    // any other) topics are recorded above for audit and acknowledged —
    // feeding a product payload to order ingest fabricated phantom orders
    // (live find: products/update created orders with product ids as
    // externalOrderId and zero totals). Product-side drift is picked up by
    // the next product sync's ownership read (BR-02/BR-03), never here.
    const topic = verification.topic ?? '';
    if (!isOrderTopic(topic)) {
      this.logger.log(`webhook ${slug}: non-order topic ${topic || '(unknown)'} recorded, no order job`);
      return { received: true, duplicate: false };
    }

    const run = await this.runs.begin({
      scope: 'ORDER_INGEST' as any,
      triggerType: 'WEBHOOK',
      storeId: store.id,
    });
    const runId = (run as any).id as string;
    // Post-commit enqueue that cannot throw into the request (R-2/BR-21):
    // BullMQ jobId = delivery-scoped so a double-insert race still executes once.
    await this.queues.enqueue(
      'store-order-ingest',
      'webhook-order',
      { runId, storeId: store.id, rawOrder: payload, deliveryKey },
      `webhook:${deliveryKey}`,
    );
    return { received: true, duplicate: false };
  }

  /** Content hash helper (diagnostics only — never an event identity). */
  static contentHash(rawBody: Buffer): string {
    return createHash('sha256').update(rawBody).digest('hex');
  }
}

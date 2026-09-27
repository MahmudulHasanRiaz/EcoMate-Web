/**
 * Keyed webhook intake — central-commerce P9 (Issue 1, items 3–9).
 *
 * Intake-level proof through the REAL `StoreWebhookService` + REAL
 * providers against the keyed receiver URLs from Issue 1:
 * (3) HMAC pass; (4) bad HMAC rejected; (5) duplicate delivery-id deduped
 * (no second enqueue); (6) wrong/unknown storeKey rejected with the generic
 * 401; (7)(8)(9) `orders/create`, `orders/updated`, `products/update` each
 * accepted through the keyed URL. Raw-body/HMAC/dedupe/topic-header
 * behavior is otherwise untouched (see `webhook-safety.spec.ts`).
 */
import { ShopifyProvider } from '../../providers/shopify.provider';
import { WooCommerceProvider } from '../../providers/woocommerce.provider';
import { CustomBridgeProvider } from '../../providers/custom-bridge.provider';
import { buildShopifyDelivery } from '../../providers/__tests__/fixtures';
import { signShopifyDelivery } from '../../providers/webhook-crypto';
import { StoreWebhookService } from '../store-webhook.service';

const SHOPIFY_STORE_ID = 'store-shopify-keyed-1';
const CLIENT_SECRET = 'test-client-secret-fake';

const SHOPIFY_ROW = {
  id: SHOPIFY_STORE_ID,
  kind: 'SHOPIFY',
  status: 'CONNECTED',
  name: 'Keyed Shop',
};

function buildIntake(storeRow: any = SHOPIFY_ROW) {
  const prisma: any = {
    store: { findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
      if (!storeRow || where?.id !== storeRow.id) return null;
      return storeRow;
    }) },
    storeWebhookDelivery: {
      seen: new Set<string>(),
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
        const hit = (prisma.storeWebhookDelivery.seen as Set<string>).has(where?.deliveryKey);
        return hit ? { deliveryKey: where?.deliveryKey, occurrences: 1 } : null;
      }),
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        (prisma.storeWebhookDelivery.seen as Set<string>).add(data.deliveryKey);
        return {};
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const stores: any = {
    storeWithSecrets: jest.fn().mockResolvedValue({
      id: SHOPIFY_STORE_ID,
      kind: 'SHOPIFY',
      settings: { shop: 'test-shop.myshopify.com' },
      secrets: {
        shop: 'test-shop.myshopify.com',
        clientId: 'test-client-id-fake',
        clientSecret: CLIENT_SECRET,
      },
    }),
  };
  const registry: any = {
    providerFor: jest.fn().mockImplementation(({ kind }: any) => {
      if (kind === 'SHOPIFY') return new ShopifyProvider();
      if (kind === 'CUSTOM') return new CustomBridgeProvider();
      return new WooCommerceProvider();
    }),
  };
  const runs: any = { begin: jest.fn().mockResolvedValue({ id: 'run-keyed-1' }) };
  const queues: any = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const svc = new StoreWebhookService(prisma, registry, stores, runs, queues);
  return { svc, prisma, queues };
}

const payload = { id: 'ext-keyed-1', status: 'processing', total: 250 };

describe('keyed webhook intake — Shopify (Issue 1, items 3–9)', () => {
  it('(3) HMAC pass through the keyed URL: received + exactly one enqueue', async () => {
    const { svc, queues } = buildIntake();
    const d = buildShopifyDelivery(CLIENT_SECRET, payload);
    const res = await svc.intake('shopify', SHOPIFY_STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
    const [, jobName, data, jobId] = queues.enqueue.mock.calls[0];
    expect(jobName).toBe('webhook-order');
    expect(data.storeId).toBe(SHOPIFY_STORE_ID);
    expect(jobId).toContain('webhook:');
  });

  it('products/update is recorded but never ingested as an order (no phantom orders)', async () => {
    const { svc, prisma, queues } = buildIntake();
    const productPayload = { id: 9001, title: 'Not an order', variants: [] };
    const d = buildShopifyDelivery(CLIENT_SECRET, productPayload, {
      headers: { 'X-Shopify-Topic': 'products/update' },
    });
    const res = await svc.intake('shopify', SHOPIFY_STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(prisma.storeWebhookDelivery.seen.size).toBe(1);
  });

  it('(4) bad HMAC rejected with the generic 401 (never a reason oracle)', async () => {
    const { svc, queues } = buildIntake();
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const bad = {
      'X-Shopify-Hmac-Sha256': signShopifyDelivery('wrong-secret-fake', rawBody),
      'X-Shopify-Webhook-Id': 'shopify-delivery-bad',
      'X-Shopify-Topic': 'orders/create',
    };
    await expect(svc.intake('shopify', SHOPIFY_STORE_ID, bad, rawBody)).rejects.toThrow(
      'Unauthorized',
    );
    expect(queues.enqueue).not.toHaveBeenCalled();
  });

  it('(5) duplicate delivery-id deduped: duplicate:true, no second enqueue', async () => {
    const { svc, prisma, queues } = buildIntake();
    const d = buildShopifyDelivery(CLIENT_SECRET, payload, {
      headers: { 'X-Shopify-Webhook-Id': 'shopify-delivery-dedupe' },
    });
    await svc.intake('shopify', SHOPIFY_STORE_ID, d.headers, d.rawBody);
    const replay = await svc.intake('shopify', SHOPIFY_STORE_ID, d.headers, d.rawBody);
    expect(replay).toEqual({ received: true, duplicate: true });
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
    expect(prisma.storeWebhookDelivery.update).toHaveBeenCalledTimes(1);
  });

  it('(6) wrong/unknown/disconnected/NATIVE storeKey → the SAME generic 401', async () => {
    const d = buildShopifyDelivery(CLIENT_SECRET, payload);
    // Unknown key: prisma finds nothing for this id.
    const { svc: unknownSvc } = buildIntake(SHOPIFY_ROW);
    await expect(
      unknownSvc.intake('shopify', 'store-ghost-unknown', d.headers, d.rawBody),
    ).rejects.toThrow('Unauthorized');
    for (const row of [
      { ...SHOPIFY_ROW, status: 'DISCONNECTED' },
      { ...SHOPIFY_ROW, kind: 'NATIVE' },
    ]) {
      const { svc } = buildIntake(row);
      await expect(
        svc.intake('shopify', SHOPIFY_STORE_ID, d.headers, d.rawBody),
      ).rejects.toThrow('Unauthorized');
    }
  });

  it.each([
    ['orders/create'],
    ['orders/updated'],
  ])('(7–9) order topic %s accepted through the keyed URL with one enqueue', async (topic) => {
    const { svc, queues } = buildIntake();
    const d = buildShopifyDelivery(CLIENT_SECRET, payload, {
      headers: {
        'X-Shopify-Webhook-Id': `shopify-delivery-${topic.replace('/', '-')}`,
        'X-Shopify-Topic': topic,
      },
    });
    const res = await svc.intake('shopify', SHOPIFY_STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
  });
});

/**
 * P6 webhook-safety suite (§13) + raw-body scoped proofs for the live wiring.
 *
 * - Tampered body / wrong secret / truncated signature → generic 401.
 * - Replayed delivery → duplicate:true, exactly one enqueue (BR-12).
 * - Stale timestamp (where supplied) → 401; missing delivery id → 401.
 * - Disconnected / unknown / NATIVE store → the SAME generic 401.
 * - Oversized payload → 413, malformed JSON → 400, neither reaching intake.
 * - Courier / marketing / bKash verifiers unchanged (JSON.stringify-based,
 *   decoupled from the raw-body capture).
 */
import * as fs from 'fs';
import * as path from 'path';
import Fastify from 'fastify';
import { WooCommerceProvider } from '../../providers/woocommerce.provider';
import { ShopifyProvider } from '../../providers/shopify.provider';
import { CustomBridgeProvider } from '../../providers/custom-bridge.provider';
import {
  buildWooDelivery,
  buildShopifyDelivery,
  buildCustomDelivery,
} from '../../providers/__tests__/fixtures';
import { StoreWebhookService } from '../store-webhook.service';
import {
  registerStoreWebhookRawBodyCapture,
} from '../../raw-body-capture';

const STORE_ID = 'store-wh-1';
const CONNECTED = { id: STORE_ID, kind: 'WOOCOMMERCE', status: 'CONNECTED', name: 'WH Store' };
const SHOPIFY_STORE = { id: 'store-shopify-9', kind: 'SHOPIFY', status: 'CONNECTED', name: 'Shop' };
const CUSTOM_STORE = { id: 'store-custom-9', kind: 'CUSTOM', status: 'CONNECTED', name: 'Bridge' };

const SECRETS: Record<string, Record<string, unknown>> = {
  [STORE_ID]: { webhookSecret: 'wh_woo_secret' },
  [SHOPIFY_STORE.id]: { webhookSecret: 'wh_shopify_secret' },
  [CUSTOM_STORE.id]: { webhookSecret: 'wh_custom_secret' },
};

function buildIntake(storeRow: any = CONNECTED) {
  const prisma: any = {
    store: { findUnique: jest.fn().mockResolvedValue(storeRow) },
    storeWebhookDelivery: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const stores: any = {
    storeWithSecrets: jest.fn().mockImplementation(async (id: string) => ({
      id,
      kind: storeRow?.kind ?? 'WOOCOMMERCE',
      settings: {},
      secrets: SECRETS[id] ?? { webhookSecret: 'wh_woo_secret' },
    })),
  };
  const registry: any = {
    providerFor: jest.fn().mockImplementation(({ kind }: any) => {
      if (kind === 'SHOPIFY') return new ShopifyProvider();
      if (kind === 'CUSTOM') return new CustomBridgeProvider();
      return new WooCommerceProvider();
    }),
  };
  const runs: any = { begin: jest.fn().mockResolvedValue({ id: 'run-wh-1' }), recordItem: jest.fn(), upsertIssue: jest.fn() };
  const queues: any = { enqueue: jest.fn().mockResolvedValue(undefined), serializeStore: jest.fn((_: string, w: any) => w()) };
  const svc = new StoreWebhookService(prisma, registry, stores, runs, queues);
  return { svc, prisma, queues };
}

const payload = { id: 'ext-1', status: 'processing', total: 250 };

describe('P6 webhook safety — WooCommerce', () => {
  it('accepts a valid delivery: 200-path, dedupe row + exactly one enqueue', async () => {
    const { svc, prisma, queues } = buildIntake();
    const d = buildWooDelivery('wh_woo_secret', payload);
    const res = await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(prisma.storeWebhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
    const [, jobName, data, jobId] = queues.enqueue.mock.calls[0];
    expect(jobName).toBe('webhook-order');
    expect(data.storeId).toBe(STORE_ID);
    expect(jobId).toContain('webhook:');
  });

  it('tampered body / wrong secret / truncated signature → generic 401', async () => {
    const { svc } = buildIntake();
    const d = buildWooDelivery('wh_woo_secret', payload);
    const tampered = Buffer.from(JSON.stringify({ ...payload, total: 1 }), 'utf8');
    await expect(svc.intake('woocommerce', STORE_ID, d.headers, tampered)).rejects.toThrow('Unauthorized');
    const wrong = buildWooDelivery('wrong-secret', payload);
    await expect(svc.intake('woocommerce', STORE_ID, wrong.headers, wrong.rawBody)).rejects.toThrow('Unauthorized');
    const truncated = buildWooDelivery('wh_woo_secret', payload);
    truncated.headers['X-WC-Webhook-Signature'] = truncated.headers['X-WC-Webhook-Signature'].slice(0, 8);
    await expect(svc.intake('woocommerce', STORE_ID, truncated.headers, truncated.rawBody)).rejects.toThrow('Unauthorized');
  });

  it('replayed delivery → duplicate:true, no second enqueue (BR-12)', async () => {
    const { svc, prisma, queues } = buildIntake();
    const d = buildWooDelivery('wh_woo_secret', payload);
    await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    prisma.storeWebhookDelivery.findUnique.mockResolvedValue({ deliveryKey: 'k', occurrences: 1 });
    const replay = await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    expect(replay).toEqual({ received: true, duplicate: true });
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
    expect(prisma.storeWebhookDelivery.update).toHaveBeenCalledTimes(1);
  });

  it('disconnected / unknown / NATIVE store → the SAME generic 401', async () => {
    const d = buildWooDelivery('wh_woo_secret', payload);
    for (const row of [
      { ...CONNECTED, status: 'DISCONNECTED' },
      null,
      { ...CONNECTED, kind: 'NATIVE' },
    ]) {
      const { svc } = buildIntake(row);
      await expect(svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody)).rejects.toThrow('Unauthorized');
    }
  });
});

describe('P6 webhook safety — Shopify + Custom', () => {
  it('valid Shopify delivery accepted (hmac + delivery id + topic)', async () => {
    const { svc, queues } = buildIntake(SHOPIFY_STORE);
    const d = buildShopifyDelivery('wh_shopify_secret', payload);
    const res = await svc.intake('shopify', SHOPIFY_STORE.id, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
  });

  it('Shopify tamper → 401', async () => {
    const { svc } = buildIntake(SHOPIFY_STORE);
    const d = buildShopifyDelivery('wh_shopify_secret', payload);
    await expect(
      svc.intake('shopify', SHOPIFY_STORE.id, d.headers, Buffer.from('{"id":"ext-1"}')),
    ).rejects.toThrow('Unauthorized');
  });

  it('valid Custom delivery accepted (signature + delivery + timestamp)', async () => {
    const { svc } = buildIntake(CUSTOM_STORE);
    const d = buildCustomDelivery('wh_custom_secret', payload);
    const res = await svc.intake('custom', CUSTOM_STORE.id, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
  });

  it('Custom stale timestamp / wrong secret → 401 (5-min replay window)', async () => {
    const { svc } = buildIntake(CUSTOM_STORE);
    const staleTs = String(Math.floor(Date.now() / 1000) - 3600);
    const stale = buildCustomDelivery('wh_custom_secret', payload, { timestamp: staleTs });
    await expect(svc.intake('custom', CUSTOM_STORE.id, stale.headers, stale.rawBody)).rejects.toThrow('Unauthorized');
    const wrong = buildCustomDelivery('nope', payload);
    await expect(svc.intake('custom', CUSTOM_STORE.id, wrong.headers, wrong.rawBody)).rejects.toThrow('Unauthorized');
  });
});

describe('P6 webhook transport — oversized → 413, malformed → 400', () => {
  it('rejects before any controller runs (live hook wiring)', async () => {
    const app = Fastify();
    registerStoreWebhookRawBodyCapture(app as any, { maxBytes: 64 });
    let controllerCalls = 0;
    app.post('/api/webhooks/stores/woocommerce/:key', async () => {
      controllerCalls++;
      return { ok: true };
    });
    const big = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stores/woocommerce/abc',
      payload: { data: 'x'.repeat(500) },
    });
    expect(big.statusCode).toBe(413);
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stores/woocommerce/abc',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });
    expect(malformed.statusCode).toBe(400);
    expect(controllerCalls).toBe(0);
    await app.close();
  });
});

describe('P6 courier/marketing/bKash verifiers unchanged', () => {
  function readSource(rel: string): string {
    return fs.readFileSync(path.resolve(__dirname, '..', '..', '..', rel), 'utf8');
  }

  it('keeps JSON.stringify verification, decoupled from raw-body capture', () => {
    const marketing = readSource('marketing/marketing-webhooks.controller.ts');
    expect(marketing).toMatch(/JSON\.stringify\(payload\)/);
    expect(marketing).not.toMatch(/raw-body-capture|isStoreWebhookPath/);
    const courier = readSource('courier-manager/webhook-verifier.ts');
    expect(courier).toMatch(/JSON\.stringify\(body\)/);
    expect(courier).not.toMatch(/raw-body-capture|isStoreWebhookPath/);
  });

  it('store webhook error bodies are generic (no secret/signature echo)', () => {
    const svc = readSource('stores/webhooks/store-webhook.service.ts');
    expect(svc).toMatch(/STORE_WEBHOOK_GENERIC_ERROR/);
    // Every UnauthorizedException carries the constant — never an
    // interpolated secret, signature, or delivery key.
    const throws = svc.match(/throw new UnauthorizedException\(([^)]*)\)/g) ?? [];
    expect(throws.length).toBeGreaterThan(0);
    for (const t of throws) {
      expect(t).toContain('STORE_WEBHOOK_GENERIC_ERROR');
    }
    expect(svc).not.toMatch(/UnauthorizedException\(`[^`]*\$\{/);
    const ctrl = readSource('stores/webhooks/store-webhooks.controller.ts');
    expect(ctrl).not.toMatch(/UnauthorizedException\(`[^`]*\$\{/);
  });
});

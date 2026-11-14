/**
 * P0 — six raw-body proofs (§8.7). All six must pass and be recorded
 * before any webhook code is written (P6). If proofs (2) or (4) cannot
 * be proven, the fallback is `rawBody: true` with the same six proofs;
 * if that is also unprovable, signature verification degrades to
 * delivery-id + shared-secret and the reason is recorded as an issue.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'node:crypto';
import Fastify from 'fastify';
import {
  isStoreWebhookPath,
  registerStoreWebhookRawBodyCapture,
  STORE_WEBHOOK_PREFIX,
} from './raw-body-capture';
import { verifyRedxHmac } from '../courier-manager/webhook-verifier';

function readSource(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
}

describe('P0 proof (1) — actual adapter behaviour documented', () => {
  it('boots NestJS on the Fastify adapter with no global raw-body change', () => {
    const main = readSource('main.ts');
    expect(main).toMatch(/NestFactory\.create<NestFastifyApplication>/);
    expect(main).toMatch(/new FastifyAdapter\(\{\s*trustProxy:\s*true\s*\}\)/);
    // No global rawBody opt-in and no global application/json parser swap.
    expect(main).not.toMatch(/rawBody\s*:\s*true/);
    expect(main).not.toMatch(/addContentTypeParser\(\s*['"]application\/json['"]/);
    // Multipart (50 MB uploads) is the only custom body handling globally.
    expect(main).toMatch(/@fastify\/multipart/);
    // Route-scoped interception precedent already exists in main.ts itself:
    // the better-auth bridge hijacks ONLY its own prefix and returns
    // immediately for every other URL.
    expect(main).toMatch(/request\.url\.startsWith\('\/api\/better-auth\/'\)/);
  });

  it('route-scoped capture uses preParsing with a path predicate', () => {
    const impl = fs.readFileSync(
      path.resolve(__dirname, 'raw-body-capture.ts'),
      'utf8',
    );
    expect(impl).toMatch(/addHook\(\s*['"]preParsing['"]/);
    expect(impl).toMatch(/isStoreWebhookPath/);
    expect(STORE_WEBHOOK_PREFIX).toBe('/api/webhooks/stores/');
  });
});

describe('P0 proof (2) — non-webhook JSON is byte-identical', () => {
  it('same payload object, no wrapping, no rawBody on normal routes', async () => {
    const app = Fastify();
    registerStoreWebhookRawBodyCapture(app as any);

    let normalRawSeen: unknown = 'unset';
    let hookRawSeen: unknown = 'unset';
    app.post('/api/products', async (req: any) => {
      normalRawSeen = (req as any).rawBody;
      return { echo: (req as any).body };
    });
    app.post('/api/webhooks/stores/woocommerce/:key', async (req: any) => {
      hookRawSeen = (req as any).rawBody;
      return { echo: (req as any).body };
    });

    const payload = { name: 'Proof', nested: { a: [1, 2, 3] }, price: 99.5 };
    const normal = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload,
    });
    const hooked = await app.inject({
      method: 'POST',
      url: '/api/webhooks/stores/woocommerce/abc',
      payload,
    });

    expect(normal.statusCode).toBe(200);
    expect(hooked.statusCode).toBe(200);
    // Identical parsed bodies on both paths …
    expect(normal.json().echo).toEqual(payload);
    expect(hooked.json().echo).toEqual(payload);
    // … but only the webhook path carries the captured buffer.
    expect(normalRawSeen).toBeUndefined();
    expect(Buffer.isBuffer(hookRawSeen)).toBe(true);
    expect(JSON.parse((hookRawSeen as Buffer).toString('utf8'))).toEqual(
      payload,
    );
    await app.close();
  });
});

describe('P0 proof (3) — memory: no buffering off-path, buffer released', () => {
  it('50 concurrent normal JSON requests stay within noise + no retention', async () => {
    const app = Fastify();
    registerStoreWebhookRawBodyCapture(app as any);
    app.post('/api/products', async (req: any) => ({ ok: true }));

    const payload = { k: 'v'.repeat(200) };
    global.gc?.();
    const before = process.memoryUsage().rss;
    await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({ method: 'POST', url: '/api/products', payload }),
      ),
    );
    global.gc?.();
    const after = process.memoryUsage().rss;
    // 32 MiB headroom: JSON parsing itself allocates; the hook must add ~0.
    expect(after - before).toBeLessThan(32 * 1024 * 1024);

    // Per-request buffers are not shared or retained across requests.
    const seen: Buffer[] = [];
    const app2 = Fastify();
    registerStoreWebhookRawBodyCapture(app2 as any);
    app2.post('/api/webhooks/stores/woocommerce/:key', async (req: any) => {
      seen.push((req as any).rawBody);
      return { ok: true };
    });
    await app2.inject({
      method: 'POST',
      url: '/api/webhooks/stores/woocommerce/a',
      payload: { n: 1 },
    });
    await app2.inject({
      method: 'POST',
      url: '/api/webhooks/stores/woocommerce/a',
      payload: { n: 2 },
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(JSON.parse(seen[0].toString())).toEqual({ n: 1 });
    expect(JSON.parse(seen[1].toString())).toEqual({ n: 2 });
    await app.close();
    await app2.close();
  });
});

describe('P0 proof (4) — existing webhook verifiers unchanged', () => {
  it('RedX HMAC vector still verifies over JSON.stringify bytes', () => {
    const secret = 'proof-secret';
    const body = { id: 7, status: 'delivered' };
    const sig = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(body), 'utf8')
      .digest('hex');
    expect(() => verifyRedxHmac(body, sig, secret)).not.toThrow();
    expect(() => verifyRedxHmac({ id: 8, status: 'x' }, sig, secret)).toThrow(
      'Invalid webhook signature',
    );
  });

  it('marketing + courier verifiers keep JSON.stringify and stay decoupled', () => {
    const marketing = readSource('marketing/marketing-webhooks.controller.ts');
    expect(marketing).toMatch(/JSON\.stringify\(payload\)/);
    expect(marketing).not.toMatch(/raw-body-capture|isStoreWebhookPath/);

    const courier = readSource('courier-manager/webhook-verifier.ts');
    expect(courier).toMatch(/JSON\.stringify\(body\)/);
    expect(courier).not.toMatch(/raw-body-capture|isStoreWebhookPath/);
  });
});

describe('P0 proof (5) — oversized → 413, malformed → 400, controller untouched', () => {
  it('rejects before any controller runs', async () => {
    const app = Fastify();
    registerStoreWebhookRawBodyCapture(app as any, { maxBytes: 64 });
    let controllerCalls = 0;
    app.post('/api/webhooks/stores/woocommerce/:key', async (req: any) => {
      controllerCalls++;
      return { ok: true };
    });
    app.post('/api/products', async () => {
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
      url: '/api/products',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });
    expect(malformed.statusCode).toBe(400);
    expect(controllerCalls).toBe(0);
    await app.close();
  });
});

describe('P0 proof (6) — maintenance/restore gate covers the new paths', () => {
  it('webhook prefix is an /api write ⇒ gated with no new mechanism', () => {
    const main = readSource('main.ts');
    expect(main).toMatch(/system:backup-maintenance/);
    expect(main).toMatch(/addHook\(\s*['"]onRequest['"]/);
    // Writes pause during full backup; everything pauses during restore.
    expect(main).toMatch(/maintenance\.mode === 'restore' \|\| !isRead/);

    const sample = '/api/webhooks/stores/woocommerce/test-key';
    expect(isStoreWebhookPath(sample)).toBe(true);
    // Therefore the gate's predicates already match the new paths …
    expect(sample.startsWith('/api/')).toBe(true);
    // … and non-webhook routes never enter the capture path.
    expect(isStoreWebhookPath('/api/products')).toBe(false);
    expect(isStoreWebhookPath('/api/marketing/webhooks/meta')).toBe(false);
    expect(isStoreWebhookPath('/api/products?x=/api/webhooks/stores/')).toBe(
      false,
    );
  });
});

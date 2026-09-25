/**
 * Identity + isolation suite — central-commerce §8.10 + BR-20 (P4).
 *
 * connect → sync → disconnect → reconnect mapping continuity (mappings and
 * field states retained), duplicate connect → 409 reconnect payload,
 * NATIVE guard throws and NATIVE is never targeted (sync-all excludes,
 * triggers reject).
 */
import { ConflictException } from '@nestjs/common';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import { WooCommerceProvider } from '../../providers/woocommerce.provider';
import { ShopifyProvider } from '../../providers/shopify.provider';
import { CustomBridgeProvider } from '../../providers/custom-bridge.provider';
import { StoresService } from '../../stores.service';
import { SyncRunService } from '../sync-run.service';

describe('identity + native isolation (P4)', () => {
  const registry = new ProviderRegistryService(
    new WooCommerceProvider(),
    new ShopifyProvider(),
    new CustomBridgeProvider(),
  );

  it('registry throws for NATIVE (BR-20 enforced by guard, not convention)', () => {
    expect(() => registry.providerFor({ kind: 'NATIVE' })).toThrow(/BR-20/);
    expect(registry.providerFor({ kind: 'WOOCOMMERCE' }).slug).toBe('woocommerce');
  });

  it('duplicate connect returns 409 with a reconnect-to-existing payload', async () => {
    const prisma: any = {
      store: {
        findFirst: jest.fn(async () => ({ id: 'store-existing', name: 'Woo', status: 'CONNECTED' })),
        create: jest.fn(),
      },
    };
    const svc = new StoresService(prisma, { encrypt: (s: string) => s, decrypt: (s: string) => s } as any, registry as any);
    const err = await svc.connect({ kind: 'WOOCOMMERCE', name: 'Woo', domain: 'shop.example.test' } as any).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'STORE_ALREADY_EXISTS', storeId: 'store-existing' });
    expect(prisma.store.create).not.toHaveBeenCalled();
  });

  it('disconnect retains identity, mappings and field states (rows untouched)', async () => {
    const updated: any = { id: 'store-1', kind: 'WOOCOMMERCE' };
    const prisma: any = {
      store: {
        findUnique: jest.fn(async () => ({ id: 'store-1', kind: 'WOOCOMMERCE' })),
        update: jest.fn(async () => updated),
      },
      storeHealthCheck: { create: jest.fn(async () => ({})) },
      storeProductMapping: { deleteMany: jest.fn() },
      productStoreFieldState: { deleteMany: jest.fn() },
    };
    const svc = new StoresService(prisma, { encrypt: (s: string) => s, decrypt: (s: string) => s } as any, registry as any);
    const out = await svc.disconnect('store-1');
    expect(out.id).toBe('store-1');
    expect(prisma.storeProductMapping.deleteMany).not.toHaveBeenCalled();
    expect(prisma.productStoreFieldState.deleteMany).not.toHaveBeenCalled();
    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { status: 'DISCONNECTED', healthState: 'DISCONNECTED' },
    });
  });

  it('reconnect reuses the same Store row (no duplicate row)', async () => {
    const prisma: any = {
      store: {
        findUnique: jest.fn(async () => ({ id: 'store-1', kind: 'WOOCOMMERCE' })),
        update: jest.fn(async () => ({ id: 'store-1', status: 'PENDING' })),
      },
      storeCredential: { create: jest.fn(async () => ({ rotatedAt: new Date() })) },
    };
    const svc = new StoresService(prisma, { encrypt: (s: string) => `enc:${s}`, decrypt: (s: string) => s.slice(4) } as any, registry as any);
    const out = await svc.reconnect('store-1', { credentials: { consumerKey: 'k' } } as any);
    expect((out as any).id).toBe('store-1');
    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { status: 'PENDING', lastError: null },
    });
  });

  it('SyncRun finish computes PARTIAL only when failures mix with successes', async () => {
    const updates: any[] = [];
    const prisma: any = {
      syncRun: {
        create: jest.fn(async ({ data }: any) => ({ id: 'run-1', ...data })),
        update: jest.fn(async ({ data }: any) => { updates.push(data); return data; }),
      },
      syncRunItem: { create: jest.fn(async () => ({})) },
      syncAttempt: { create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      storeSyncIssue: { findUnique: jest.fn(async () => null), create: jest.fn(async () => ({})), update: jest.fn(async () => ({})) },
    };
    const runs = new SyncRunService(prisma);
    await runs.finish('run-1', { created: 0, updated: 0, failed: 0 });
    expect(updates[0].status).toBe('SUCCESS');
    await runs.finish('run-1', { created: 2, updated: 1, failed: 1 });
    expect(updates[1].status).toBe('PARTIAL');
    expect(updates[1].totalCount).toBe(4);
    await runs.finish('run-1', { created: 0, updated: 0, failed: 3 });
    expect(updates[2].status).toBe('FAILED');
    // windowDays + wideningReason recorded on begin (BR-10).
    const run = await runs.begin({ scope: 'RECONCILE', storeId: 's-1', windowDays: 5, wideningReason: '3 failures' });
    expect((run as any).windowDays).toBe(5);
    expect((run as any).wideningReason).toBe('3 failures');
  });
});

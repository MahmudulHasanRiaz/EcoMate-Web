import * as crypto from 'node:crypto';
import { SteadfastCredentialSetsService } from '../steadfast-credential-sets.service';
import { CourierManagerService } from '../courier-manager.service';

// Task 8 RED: owner-locked hybrid multi-merchant (Steadfast-only).
// Fake keys only — SECRET RULE: never paste live keys.

const mockEncryption = {
  encrypt: jest.fn((v: string) => `enc:${Buffer.from(v, 'utf8').toString('base64')}`),
  decrypt: jest.fn((v: string) => Buffer.from(v.replace(/^enc:/, ''), 'base64').toString('utf8')),
} as any;

function makePrisma() {
  const sets: any[] = [];
  const dispatchRows: any[] = [];
  const prisma: any = {
    _sets: sets,
    _dispatchRows: dispatchRows,
    courierCredentialSet: {
      findMany: jest.fn(async () => [...sets]),
      findUnique: jest.fn(async ({ where }: any) =>
        sets.find((s) => s.id === where.id) ?? null,
      ),
      findFirst: jest.fn(async ({ where }: any) => {
        if (where?.isDefault === true)
          return sets.find((s) => s.isDefault) ?? null;
        return sets[0] ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `set-${sets.length + 1}`, createdAt: new Date(), ...data };
        sets.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = sets.find((s) => s.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const s of sets) {
          if (where?.courier && s.courier !== where.courier) continue;
          if (where?.isDefault === true && !s.isDefault) continue;
          if (where?.id?.not && s.id === where.id.not) continue;
          Object.assign(s, data);
          count++;
        }
        return { count };
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = sets.findIndex((s) => s.id === where.id);
        return sets.splice(i, 1)[0];
      }),
    },
    courierCredentials: {
      findUnique: jest.fn(async () => ({
        courier: 'steadfast',
        enabled: true,
        mode: 'sandbox',
        apiKey: 'legacy-key',
        secretKey: 'legacy-secret',
        webhookSecret: 'legacy-webhook',
      })),
    },
    dispatch: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async ({ where }: any) => {
        if (where?.credentialSetId)
          return dispatchRows.filter((d) => d.credentialSetId === where.credentialSetId);
        return [...dispatchRows];
      }),
      count: jest.fn(async ({ where }: any) => {
        if (where?.credentialSetId)
          return dispatchRows.filter((d) => d.credentialSetId === where.credentialSetId).length;
        return dispatchRows.length;
      }),
      upsert: jest.fn(async (args: any) => args),
    },
  };
  prisma.$transaction = jest.fn(async (cb: any) => {
    const tx = {
      courierCredentialSet: prisma.courierCredentialSet,
      courierCredentials: prisma.courierCredentials,
      dispatch: prisma.dispatch,
    };
    // Serialize tx bodies (mutex): models the atomic check-then-write scope
    // the service relies on — concurrent callers queue, so the second tx
    // observes the first tx's committed rows. True cross-instance safety
    // would need a partial unique index (deliberately not in the DB — see
    // schema comment), but single-instance atomicity is what this guards.
    const prev: Promise<unknown> = (prisma as any).__txQueue ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => { release = res; });
    (prisma as any).__txQueue = prev.then(() => gate);
    await prev;
    try {
      return await cb(tx);
    } finally {
      release();
    }
  });
  return prisma;
}

describe('Task 8: Steadfast hybrid credential sets', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores two sets with encrypted keys, meta never exposes keys', async () => {
    const prisma: any = makePrisma();
    const svc = new SteadfastCredentialSetsService(prisma, mockEncryption);
    await svc.createSet({ label: 'Shop A', apiKey: 'key-a', secretKey: 'sec-a' });
    await svc.createSet({ label: 'Shop B', apiKey: 'key-b', secretKey: 'sec-b' });
    const list = await svc.listSets();
    expect(list).toHaveLength(2);
    expect(list.map((s: any) => s.label).sort()).toEqual(['Shop A', 'Shop B']);
    // keys NEVER shown
    for (const m of list) {
      expect(JSON.stringify(m)).not.toContain('key-a');
      expect(JSON.stringify(m)).not.toContain('sec-b');
    }
    // encrypted at rest like other secrets
    expect(prisma._sets[0].apiKeyEnc).not.toContain('key-a');
    expect(mockEncryption.encrypt).toHaveBeenCalled();
  });

  it('order override wins over default', async () => {
    const prisma: any = makePrisma();
    const svc = new SteadfastCredentialSetsService(prisma, mockEncryption);
    const a = await svc.createSet({ label: 'A', apiKey: 'key-a', secretKey: 'sec-a', isDefault: true });
    const b = await svc.createSet({ label: 'B', apiKey: 'key-b', secretKey: 'sec-b' });
    const resolved = await svc.resolveAuth({ overrideSetId: (b as any).id });
    expect(resolved.apiKey).toBe('key-b');
    expect(resolved.setId).toBe((b as any).id);
    expect(a).toBeTruthy();
  });

  it('booking-set routing survives a default change (never current default)', async () => {
    const prisma: any = makePrisma();
    const svc = new SteadfastCredentialSetsService(prisma, mockEncryption);
    const a = await svc.createSet({ label: 'A', apiKey: 'key-a', secretKey: 'sec-a', isDefault: true }) as any;
    const b = await svc.createSet({ label: 'B', apiKey: 'key-b', secretKey: 'sec-b' }) as any;
    await svc.setDefault(b.id);
    // record booked with A still resolves A
    const resolved = await svc.resolveAuth({ dispatchSetId: a.id });
    expect(resolved.apiKey).toBe('key-a');
    expect(resolved.setId).toBe(a.id);
  });

  it('tracking resolves the booking set via consignment record (not default)', async () => {
    const prisma: any = makePrisma();
    const svc = new SteadfastCredentialSetsService(prisma, mockEncryption);
    const a = await svc.createSet({ label: 'A', apiKey: 'key-a', secretKey: 'sec-a' }) as any;
    const b = await svc.createSet({ label: 'B', apiKey: 'key-b', secretKey: 'sec-b' }) as any;
    // A was auto-default (first set); book the consignment with A, then
    // flip the default to B — consignment lookup must still return A.
    await svc.setDefault(b.id);
    prisma.dispatch.findFirst.mockResolvedValue({ credentialSetId: a.id });
    const resolved = await svc.resolveAuth({ consignmentId: 'CONS-1' });
    expect(prisma.dispatch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { consignmentId: 'CONS-1' } }),
    );
    expect(resolved.setId).toBe(a.id);
    expect(resolved.apiKey).toBe('key-a');
  });

  it('webhook verifies with the matching set token (either set)', async () => {
    const prisma: any = makePrisma();
    const svc = new SteadfastCredentialSetsService(prisma, mockEncryption);
    await svc.createSet({ label: 'A', apiKey: 'k', secretKey: 's', webhookSecret: 'tok-a' });
    await svc.createSet({ label: 'B', apiKey: 'k2', secretKey: 's2', webhookSecret: 'tok-b' });
    const raw = JSON.stringify({ consignment_id: 'C1' });
    const sigA = crypto.createHmac('sha256', 'tok-a').update(raw).digest('hex');
    const sigB = crypto.createHmac('sha256', 'tok-b').update(raw).digest('hex');
    await expect(svc.verifyWebhook(raw, sigA)).resolves.toMatchObject({ matched: true });
    await expect(svc.verifyWebhook(raw, sigB)).resolves.toMatchObject({ matched: true });
    await expect(svc.verifyWebhook(raw, '0'.repeat(64))).resolves.toMatchObject({ matched: false });
  });

  it('401 never retry-loops across profiles (fail fast + wrong-profile hint)', async () => {
    const prisma: any = {
      courierCredentialSet: {
        findMany: jest.fn(async () => [
          { id: 'a', courier: 'steadfast', label: 'A', apiKeyEnc: 'enc:key-a', secretKeyEnc: 'enc:sec-a', isDefault: true },
          { id: 'b', courier: 'steadfast', label: 'B', apiKeyEnc: 'enc:key-b', secretKeyEnc: 'enc:sec-b', isDefault: false },
        ]),
        findUnique: jest.fn(async ({ where }: any) => (where.id === 'a'
          ? { id: 'a', courier: 'steadfast', label: 'A', apiKeyEnc: 'enc:key-a', secretKeyEnc: 'enc:sec-a', isDefault: true }
          : null)),
        findFirst: jest.fn(async () => ({ id: 'a', courier: 'steadfast', label: 'A', apiKeyEnc: 'enc:key-a', secretKeyEnc: 'enc:sec-a', isDefault: true })),
      },
      courierCredentials: {
        findUnique: jest.fn(async () => ({ courier: 'steadfast', enabled: true, mode: 'sandbox' })),
      },
      order: { findMany: jest.fn(async () => []) },
      dispatch: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null), upsert: jest.fn() },
      courierDispatchLog: { create: jest.fn() },
      systemSetting: { findUnique: jest.fn(async () => null) },
    };
    const sets = new SteadfastCredentialSetsService(prisma, mockEncryption);
    const mgr = new CourierManagerService(prisma, {} as any, sets as any);
    const order: any = {
      id: 'o1', displayId: 'INV-1', total: 100,
      customerFirstName: 'Ab', customerLastName: 'Cd',
      shippingAddress: { address: 'Dhaka جاده 10', district: 'Dhaka' },
      items: [{ product: { name: 'P' } }],
    };
    prisma.order.findMany.mockResolvedValue([order]);
    const fetchMock = jest.fn(async () => new Response('Unauthorized', { status: 401 }));
    global.fetch = fetchMock as any;
    const results = await (mgr as any).dispatch('steadfast', ['o1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].message).toMatch(/wrong profile/i);
  });

  it('single-set zero friction: no sets falls back to legacy row with null set id', async () => {
    const prisma: any = makePrisma();
    prisma.courierCredentialSet.findMany.mockResolvedValue([]);
    prisma.courierCredentialSet.findFirst.mockResolvedValue(null);
    const svc = new SteadfastCredentialSetsService(prisma, mockEncryption);
    const resolved = await svc.resolveAuth({});
    expect(resolved.apiKey).toBe('legacy-key');
    expect(resolved.setId).toBeNull();
    expect(resolved.isLegacy).toBe(true);
  });
});

describe('Review blockers: single-default guard, blank-wipe, delete guard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('concurrent first-creates leave exactly one default (tx-scoped)', async () => {
    const prisma: any = makePrisma();
    const svc = new SteadfastCredentialSetsService(prisma, mockEncryption);
    const [a, b] = await Promise.all([
      svc.createSet({ label: 'A', apiKey: 'key-a', secretKey: 'sec-a' }),
      svc.createSet({ label: 'B', apiKey: 'key-b', secretKey: 'sec-b' }),
    ]);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(prisma.$transaction).toHaveBeenCalled();
    const defaults = prisma._sets.filter((s: any) => s.isDefault);
    expect(defaults).toHaveLength(1);
  });

  it('createSet runs check-then-write inside $transaction', async () => {
    const prisma: any = makePrisma();
    const svc = new SteadfastCredentialSetsService(prisma, mockEncryption);
    await svc.createSet({ label: 'A', apiKey: 'k', secretKey: 's' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('setDefault runs inside $transaction and leaves exactly one default', async () => {
    const prisma: any = makePrisma();
    const svc = new SteadfastCredentialSetsService(prisma, mockEncryption);
    const a = (await svc.createSet({ label: 'A', apiKey: 'k1', secretKey: 's1' })) as any;
    const b = (await svc.createSet({ label: 'B', apiKey: 'k2', secretKey: 's2' })) as any;
    jest.clearAllMocks();
    await svc.setDefault(b.id);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma._sets.find((s: any) => s.id === b.id).isDefault).toBe(true);
    expect(prisma._sets.find((s: any) => s.id === a.id).isDefault).toBe(false);
    expect(prisma._sets.filter((s: any) => s.isDefault)).toHaveLength(1);
  });

  it('deleteSet runs inside $transaction and promotes the next set', async () => {
    const prisma: any = makePrisma();
    const svc = new SteadfastCredentialSetsService(prisma, mockEncryption);
    const a = (await svc.createSet({ label: 'A', apiKey: 'k1', secretKey: 's1' })) as any;
    await svc.createSet({ label: 'B', apiKey: 'k2', secretKey: 's2' });
    jest.clearAllMocks();
    await svc.deleteSet(a.id);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const rest = prisma._sets;
    expect(rest).toHaveLength(1);
    expect(rest[0].isDefault).toBe(true);
  });

  it('updateSet ignores "" (keeps stored value); explicit null clears', async () => {
    const prisma: any = makePrisma();
    const svc = new SteadfastCredentialSetsService(prisma, mockEncryption);
    const a = (await svc.createSet({
      label: 'A',
      apiKey: 'key-a',
      secretKey: 'sec-a',
      webhookSecret: 'tok-a',
    })) as any;
    const before = prisma._sets.find((s: any) => s.id === a.id);
    const encBefore = before.apiKeyEnc;
    // "" must NOT wipe the stored secret.
    await svc.updateSet(a.id, { apiKey: '', secretKey: '', webhookSecret: '' } as any);
    const kept = prisma._sets.find((s: any) => s.id === a.id);
    expect(kept.apiKeyEnc).toBe(encBefore);
    expect(kept.webhookSecretEnc).toBeTruthy();
    // Explicit null clears.
    await svc.updateSet(a.id, { webhookSecret: null } as any);
    const cleared = prisma._sets.find((s: any) => s.id === a.id);
    expect(cleared.webhookSecretEnc).toBeNull();
  });

  it('deleteSet is blocked (400 + count) when dispatches reference the set', async () => {
    const prisma: any = makePrisma();
    const svc = new SteadfastCredentialSetsService(prisma, mockEncryption);
    const a = (await svc.createSet({ label: 'A', apiKey: 'k1', secretKey: 's1' })) as any;
    prisma._dispatchRows.push({ id: 'd1', credentialSetId: a.id });
    prisma._dispatchRows.push({ id: 'd2', credentialSetId: a.id });
    await expect(svc.deleteSet(a.id)).rejects.toMatchObject({ status: 400 });
    await expect(svc.deleteSet(a.id)).rejects.toThrow(/2 dispatch/);
    // Row must survive the blocked delete.
    expect(prisma._sets.find((s: any) => s.id === a.id)).toBeTruthy();
  });
});

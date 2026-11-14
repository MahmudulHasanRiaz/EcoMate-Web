/**
 * Repeated-failure notification suite — central-commerce P11 (§12).
 *
 * Threshold: notify once at 5 occurrences, then every 10 (5, 15, 25…).
 * The service is fail-safe: no recipient / no queue / send failure never
 * throws into the sync engine.
 */
import { SyncNotifyService, shouldNotifyRepeatedFailure } from '../sync-notify.service';

describe('shouldNotifyRepeatedFailure (P11)', () => {
  it('is silent below the threshold', () => {
    expect(shouldNotifyRepeatedFailure(1)).toBe(false);
    expect(shouldNotifyRepeatedFailure(4)).toBe(false);
  });

  it('fires at 5 then every 10', () => {
    expect(shouldNotifyRepeatedFailure(5)).toBe(true);
    expect(shouldNotifyRepeatedFailure(6)).toBe(false);
    expect(shouldNotifyRepeatedFailure(15)).toBe(true);
    expect(shouldNotifyRepeatedFailure(25)).toBe(true);
    expect(shouldNotifyRepeatedFailure(16)).toBe(false);
  });
});

function issue(occurrences: number) {
  return { code: 'DEAD_LETTER', objectKey: 'store:s1:product:p1', occurrences, message: 'boom' };
}

describe('SyncNotifyService (P11)', () => {
  it('returns false below threshold without touching the queue', async () => {
    const send = jest.fn();
    const svc = new SyncNotifyService({} as any, { send } as any);
    expect(await svc.notifyIfRepeated('s1', issue(3))).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns false when no recipient resolves (never throws)', async () => {
    delete process.env['SYNC_FAILURE_NOTIFY_EMAIL'];
    delete process.env['ADMIN_EMAIL'];
    const prisma: any = { store: { findUnique: jest.fn(async () => ({ id: 's1', name: 'S' })) }, user: { findFirst: jest.fn(async () => null) } };
    const svc = new SyncNotifyService(prisma, { send: jest.fn() } as any);
    expect(await svc.notifyIfRepeated('s1', issue(5))).toBe(false);
  });

  it('sends at threshold via SYNC_FAILURE_NOTIFY_EMAIL', async () => {
    process.env['SYNC_FAILURE_NOTIFY_EMAIL'] = 'ops@example.com';
    const send = jest.fn(async () => undefined);
    const prisma: any = { store: { findUnique: jest.fn(async () => ({ id: 's1', name: 'Woo' })) } };
    const svc = new SyncNotifyService(prisma, { send } as any);
    try {
      expect(await svc.notifyIfRepeated('s1', issue(5))).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0].to).toBe('ops@example.com');
      expect(send.mock.calls[0][0].subject).toMatch(/DEAD_LETTER/);
    } finally {
      delete process.env['SYNC_FAILURE_NOTIFY_EMAIL'];
    }
  });

  it('a send failure returns false instead of throwing (R-2 style)', async () => {
    process.env['SYNC_FAILURE_NOTIFY_EMAIL'] = 'ops@example.com';
    const send = jest.fn(async () => { throw new Error('smtp down'); });
    const prisma: any = { store: { findUnique: jest.fn(async () => ({ id: 's1', name: 'Woo' })) } };
    const svc = new SyncNotifyService(prisma, { send } as any);
    try {
      expect(await svc.notifyIfRepeated('s1', issue(5))).toBe(false);
    } finally {
      delete process.env['SYNC_FAILURE_NOTIFY_EMAIL'];
    }
  });
});

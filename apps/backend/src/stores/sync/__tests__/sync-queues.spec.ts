/**
 * replaceFinishedJob: BullMQ dedupes by job id while ANY record exists, so a
 * second stock change for the same product would be swallowed by the first
 * job's completed record. Finished records are cleared first; pending jobs
 * are left alone (they re-read live state, so coalescing stays safe).
 */
import { SyncQueuesService } from '../sync-queues.service';

function stockQueue(getJob: jest.Mock) {
  return { getJob };
}

function svc(stockQ: any) {
  const q = (name: string) => {
    if (name === 'store-stock-sync') return stockQ;
    throw new Error(`unexpected queue ${name}`);
  };
  const svc = Object.create(SyncQueuesService.prototype) as any;
  svc.queueFor = q;
  svc.logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
  return svc as SyncQueuesService;
}

describe('SyncQueuesService.replaceFinishedJob', () => {
  it('removes completed and failed records, keeps pending ones', async () => {
    const completed = { remove: jest.fn(async () => undefined), isCompleted: jest.fn(async () => true), isFailed: jest.fn(async () => false) };
    const s1 = svc(stockQueue(jest.fn(async () => completed)));
    await s1.replaceFinishedJob('store-stock-sync', 'stock:s:p:-');
    expect(completed.remove).toHaveBeenCalledTimes(1);

    const failed = { remove: jest.fn(async () => undefined), isCompleted: jest.fn(async () => false), isFailed: jest.fn(async () => true) };
    const s2 = svc(stockQueue(jest.fn(async () => failed)));
    await s2.replaceFinishedJob('store-stock-sync', 'stock:s:p:-');
    expect(failed.remove).toHaveBeenCalledTimes(1);

    const pending = { remove: jest.fn(async () => undefined), isCompleted: jest.fn(async () => false), isFailed: jest.fn(async () => false) };
    const s3 = svc(stockQueue(jest.fn(async () => pending)));
    await s3.replaceFinishedJob('store-stock-sync', 'stock:s:p:-');
    expect(pending.remove).not.toHaveBeenCalled();
  });

  it('tolerates missing jobs and queue errors (best-effort, never throws)', async () => {
    const s1 = svc(stockQueue(jest.fn(async () => null)));
    await expect(s1.replaceFinishedJob('store-stock-sync', 'x')).resolves.toBeUndefined();
    const s2 = svc(stockQueue(jest.fn(async () => { throw new Error('redis down'); })));
    await expect(s2.replaceFinishedJob('store-stock-sync', 'x')).resolves.toBeUndefined();
  });
});

/**
 * Store-sync structured logger suite — central-commerce P11 (§10/§12).
 *
 * Proves `correlationIdStorage` is wired in: ambient ids flow into log
 * lines, explicit ids win, and no secrets-shaped content is special-cased
 * (the logger only renders allowlisted scalar fields).
 */
import { correlationIdStorage } from '../../../common/middleware/correlation-id.middleware';
import {
  currentCorrelationId,
  formatSyncLog,
  logSync,
  resolveCorrelationId,
  withCorrelationId,
} from '../store-sync-logger';

describe('store-sync-logger (P11)', () => {
  it('returns undefined outside any context', () => {
    expect(currentCorrelationId()).toBeUndefined();
    expect(resolveCorrelationId()).toBeUndefined();
  });

  it('explicit id wins over ambient', () => {
    correlationIdStorage.run('ambient-1', () => {
      expect(resolveCorrelationId('explicit-9')).toBe('explicit-9');
      expect(resolveCorrelationId()).toBe('ambient-1');
    });
  });

  it('withCorrelationId scopes the ambient id for workers', () => {
    const seen = withCorrelationId('worker-7', () => currentCorrelationId());
    expect(seen).toBe('worker-7');
    expect(currentCorrelationId()).toBeUndefined();
  });

  it('formatSyncLog renders the §10 fields in stable order, single-line', () => {
    const line = formatSyncLog({
      runId: 'run-1',
      storeId: 'store-1',
      provider: 'WOOCOMMERCE',
      externalObjectId: 'ext-5',
      correlationId: 'cid-1',
      durationMs: 42,
      status: 'FAILED',
      errorCategory: 'TEMPORARY_FAILURE',
      scope: 'PRODUCT',
      objectType: 'PRODUCT',
      objectKey: 'store:store-1:product:p1',
    });
    expect(line).toContain('runId=run-1');
    expect(line).toContain('storeId=store-1');
    expect(line).toContain('provider=WOOCOMMERCE');
    expect(line).toContain('externalObjectId=ext-5');
    expect(line).toContain('correlationId=cid-1');
    expect(line).toContain('durationMs=42');
    expect(line).toContain('status=FAILED');
    expect(line).toContain('errorCategory=TEMPORARY_FAILURE');
    // Stable order: runId before storeId before provider.
    expect(line.indexOf('runId=')).toBeLessThan(line.indexOf('storeId='));
    expect(line.indexOf('storeId=')).toBeLessThan(line.indexOf('provider='));
    expect(line).not.toMatch(/[\r\n]/);
  });

  it('logSync appends ambient correlation id when the caller passes none', () => {
    const calls: string[] = [];
    const logger = { log: (m: string) => calls.push(m), warn: () => undefined, error: () => undefined };
    correlationIdStorage.run('req-123', () => {
      logSync(logger, 'log', 'sync-run: begin', { runId: 'r1', status: 'RUNNING' });
    });
    expect(calls[0]).toContain('correlationId=req-123');
    expect(calls[0]).toContain('runId=r1');
  });
});

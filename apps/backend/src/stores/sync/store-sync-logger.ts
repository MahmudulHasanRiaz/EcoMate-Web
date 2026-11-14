/**
 * Store-sync structured logger — central-commerce §10 + §12 (P11, BR-25).
 *
 * Wires the existing (previously unused) `correlationIdStorage` into every
 * store-sync log line. Every run/item/attempt log carries:
 * `runId, storeId, provider, externalObjectId, correlationId, durationMs,
 * status, errorCategory` (plus scope/objectType where known).
 *
 * DB gap note (additive-only programme, no migration in P11): `SyncRun`
 * carries `correlationId` as a real column; `SyncRunItem`/`SyncAttempt`
 * have no `provider`/`correlationId` columns, so those two travel in the
 * structured log line (never silently dropped) while the DB write keeps its
 * existing columns. Sanitized: never logs secrets/credentials/tokens.
 */
import { correlationIdStorage } from '../../common/middleware/correlation-id.middleware';

export interface SyncLogFields {
  runId?: string | null;
  storeId?: string | null;
  provider?: string | null;
  externalObjectId?: string | null;
  correlationId?: string | null;
  durationMs?: number | null;
  status?: string | null;
  errorCategory?: string | null;
  scope?: string | null;
  objectType?: string | null;
  objectKey?: string | null;
}

/** Current request correlation id, when inside the middleware context. */
export function currentCorrelationId(): string | undefined {
  try {
    return correlationIdStorage.getStore() ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run `fn` with `id` as the ambient correlation id (for queue workers that
 * have no HTTP request context). Returns the function's result.
 */
export function withCorrelationId<T>(id: string, fn: () => T): T {
  return correlationIdStorage.run(id, fn);
}

/** Resolve the effective correlation id: explicit > ambient > undefined. */
export function resolveCorrelationId(explicit?: string | null): string | undefined {
  if (explicit) return explicit;
  return currentCorrelationId();
}

/**
 * Single-line `key=value` rendering (stable key order). Values are
 * allowlisted scalars only — objects are JSON-stringified and truncated.
 */
export function formatSyncLog(fields: SyncLogFields): string {
  const parts: string[] = [];
  const push = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return;
    let s: string;
    if (typeof v === 'string') s = v.length > 120 ? `${v.slice(0, 117)}...` : v;
    else if (typeof v === 'number') s = String(v);
    else {
      try {
        s = JSON.stringify(v);
      } catch {
        s = '[unserializable]';
      }
      if (s.length > 120) s = `${s.slice(0, 117)}...`;
    }
    // Single-line: strip newlines so log aggregators keep one row per event.
    parts.push(`${k}=${s.replace(/[\r\n]+/g, ' ')}`);
  };
  push('runId', fields.runId);
  push('storeId', fields.storeId);
  push('provider', fields.provider);
  push('externalObjectId', fields.externalObjectId);
  push('correlationId', fields.correlationId);
  push('durationMs', fields.durationMs);
  push('status', fields.status);
  push('errorCategory', fields.errorCategory);
  push('scope', fields.scope);
  push('objectType', fields.objectType);
  push('objectKey', fields.objectKey);
  return parts.join(' ');
}

export type SyncLoggerLike = {
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

/** Log `message` with the structured sync context appended (when non-empty). */
export function logSync(
  logger: SyncLoggerLike,
  level: 'log' | 'warn' | 'error',
  message: string,
  fields: SyncLogFields = {},
): void {
  const effective: SyncLogFields = {
    ...fields,
    correlationId: fields.correlationId ?? currentCorrelationId() ?? undefined,
  };
  const ctx = formatSyncLog(effective);
  logger[level](ctx ? `${message} | ${ctx}` : message);
}

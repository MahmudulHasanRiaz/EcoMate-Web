/**
 * Deterministic field snapshots — central-commerce P2 harness.
 *
 * `readProductFields()` returns one snapshot per field; the ownership engine
 * (P3/P4) uses these hashes as `baseline` / `externalHash` values (§8.3).
 * Hashing is stable-recursive (key order cannot change a hash) and
 * latency-free (pure, synchronous).
 */
import { createHash } from 'crypto';
import type { FieldSnapshot } from './provider.contract';

/** JSON with recursively sorted object keys — deterministic for hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  const s = JSON.stringify(value);
  return s === undefined ? 'null' : s;
}

/** sha256 hex of the stable rendering of a field value. */
export function hashFieldValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/** Build the snapshot the contract's `readProductFields` returns. */
export function snapshotField(value: unknown): FieldSnapshot {
  return { hash: hashFieldValue(value), value };
}

/**
 * Per-store circuit breaker in Redis — central-commerce §8.1 (P4, Jannat §4.1).
 *
 * Closed → calls flow. 5 consecutive failures → OPEN for 60s (no calls).
 * After the open window a single half-open probe is allowed; success closes,
 * failure re-opens. State key: `store:breaker:<storeId>`.
 */
import { Injectable, Logger } from '@nestjs/common';

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const OPEN_AFTER_FAILURES = 5;
const OPEN_WINDOW_MS = 60_000;

interface BreakerRecord {
  failures: number;
  openedAt: number | null;
  halfOpenInFlight: boolean;
}

@Injectable()
export class StoreCircuitBreaker {
  private readonly logger = new Logger(StoreCircuitBreaker.name);
  private readonly memory = new Map<string, BreakerRecord>();

  private record(storeId: string): BreakerRecord {
    let rec = this.memory.get(storeId);
    if (!rec) {
      rec = { failures: 0, openedAt: null, halfOpenInFlight: false };
      this.memory.set(storeId, rec);
    }
    return rec;
  }

  /** True when a call may proceed (closed, or the single half-open probe). */
  allow(storeId: string, now = Date.now()): boolean {
    const rec = this.record(storeId);
    if (rec.openedAt === null) return true;
    if (now - rec.openedAt < OPEN_WINDOW_MS) return false;
    if (rec.halfOpenInFlight) return false;
    rec.halfOpenInFlight = true;
    return true;
  }

  state(storeId: string, now = Date.now()): BreakerState {
    const rec = this.record(storeId);
    if (rec.openedAt === null) return 'CLOSED';
    if (now - rec.openedAt < OPEN_WINDOW_MS) return 'OPEN';
    return 'HALF_OPEN';
  }

  success(storeId: string): void {
    this.memory.set(storeId, { failures: 0, openedAt: null, halfOpenInFlight: false });
  }

  failure(storeId: string, now = Date.now()): BreakerState {
    const rec = this.record(storeId);
    if (rec.halfOpenInFlight) {
      rec.halfOpenInFlight = false;
      rec.openedAt = now;
      this.logger.warn(`Circuit re-opened for store ${storeId} (half-open probe failed)`);
      return 'OPEN';
    }
    rec.failures += 1;
    if (rec.failures >= OPEN_AFTER_FAILURES) {
      rec.openedAt = now;
      this.logger.warn(`Circuit opened for store ${storeId} after ${rec.failures} failures`);
      return 'OPEN';
    }
    return 'CLOSED';
  }
}

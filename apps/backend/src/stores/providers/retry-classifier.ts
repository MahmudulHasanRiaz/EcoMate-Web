/**
 * Pure retry classification — central-commerce §8.1 (P2).
 *
 * Returns `{ retryable, category }`. Transient failures back off
 * `[30s, 2m, 10m, 1h, 6h]` up to 5 attempts → DEAD + issue; permanent
 * failures (auth/permission/invalid) never loop. Only known-transient
 * errors are retryable; everything else is fail-closed (single attempt).
 */
import {
  ProviderError,
  ProviderErrorCategory,
} from '../../marketing/ad-provider.adapter';

export interface RetryDecision {
  retryable: boolean;
  category: ProviderErrorCategory;
  reason?: string;
}

/** §8.1 backoff ladder and attempt cap (owned here; queues consume in P4). */
export const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
export const MAX_SYNC_ATTEMPTS = 5;

/** Network-layer failure codes that are always transient. */
const TRANSIENT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function isNetworkLike(err: any): boolean {
  if (!err || typeof err !== 'object') return false;
  if (typeof err.code === 'string' && TRANSIENT_CODES.has(err.code)) return true;
  // Undici / native fetch surface network failures as TypeError.
  if (err instanceof TypeError && typeof err.message === 'string') {
    return /fetch failed|network|socket|timeout|econn|enotfound|eai_again/i.test(
      err.message,
    );
  }
  return false;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Classify an HTTP status code. Any response at all implies reachability. */
export function classifyHttpStatus(status: number): RetryDecision {
  if (status === 401) {
    return {
      retryable: false,
      category: ProviderErrorCategory.AUTHENTICATION_FAILED,
      reason: 'http-401',
    };
  }
  if (status === 403) {
    return {
      retryable: false,
      category: ProviderErrorCategory.INVALID_REQUEST,
      reason: 'http-403-permission',
    };
  }
  if (status === 404) {
    return {
      retryable: false,
      category: ProviderErrorCategory.REMOTE_NOT_FOUND,
      reason: 'http-404',
    };
  }
  if (status === 429) {
    return {
      retryable: true,
      category: ProviderErrorCategory.RATE_LIMITED,
      reason: 'http-429',
    };
  }
  if (status === 408 || status >= 500) {
    return {
      retryable: true,
      category: ProviderErrorCategory.TEMPORARY_FAILURE,
      reason: `http-${status}`,
    };
  }
  if (status >= 400) {
    return {
      retryable: false,
      category: ProviderErrorCategory.INVALID_REQUEST,
      reason: `http-${status}`,
    };
  }
  return {
    retryable: false,
    category: ProviderErrorCategory.UNKNOWN,
    reason: `http-${status}`,
  };
}

/** Classify any thrown error into a retry decision (pure). */
export function classifyProviderError(err: unknown): RetryDecision {
  if (err instanceof ProviderError) {
    switch (err.category) {
      case ProviderErrorCategory.RATE_LIMITED:
      case ProviderErrorCategory.TEMPORARY_FAILURE:
        return { retryable: true, category: err.category };
      default:
        return {
          retryable: false,
          category: err.category,
          reason: errorMessage(err),
        };
    }
  }
  if (isNetworkLike(err)) {
    return {
      retryable: true,
      category: ProviderErrorCategory.TEMPORARY_FAILURE,
      reason: errorMessage(err),
    };
  }
  if (err && typeof err === 'object' && typeof (err as any).status === 'number') {
    return classifyHttpStatus((err as any).status);
  }
  return {
    retryable: false,
    category: ProviderErrorCategory.UNKNOWN,
    reason: errorMessage(err),
  };
}

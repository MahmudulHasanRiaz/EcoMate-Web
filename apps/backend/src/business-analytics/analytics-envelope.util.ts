/**
 * Business analytics response envelope (P2, §6 auditability + empty-vs-zero).
 *
 * Every response carries meta + KpiValue envelopes. null never renders as 0;
 * not_applicable renders "—" and stays visually distinct from unavailable.
 */
import type { CostState } from './metric-contract';
import type { AnalyticsRange } from './analytics-range.util';
import type { AnalyticsFilterDto } from './analytics-filter.dto';
import type { ResolvedAnalyticsContext } from './analytics-filter.service';

export const FORMULA_VERSION = 'analytics-p2/1.0';

export type KpiState =
  | 'ok'
  | 'zero'
  | 'no_data'
  | 'not_applicable'
  | 'unavailable'
  | 'estimated';

export interface KpiValue<T = number> {
  value: T | null;
  state: KpiState;
  reason?: string;
  basis?: 'direct' | 'allocated' | 'attributed';
  dateBasis?: string;
  estimatedReference?: { label: string; excludedFromTotal: true };
}

export function kpiOk<T>(
  value: T,
  opts: Pick<KpiValue<T>, 'basis' | 'dateBasis' | 'reason'> = {},
): KpiValue<T> {
  return { value, state: 'ok', ...opts };
}

export function kpiZero(reason: string): KpiValue<number> {
  return { value: 0, state: 'zero', reason };
}

export function kpiNoData(reason: string): KpiValue<number> {
  return { value: null, state: 'no_data', reason };
}

export function kpiNotApplicable(reason: string): KpiValue<number> {
  return { value: null, state: 'not_applicable', reason };
}

export function kpiUnavailable(reason: string): KpiValue<number> {
  return { value: null, state: 'unavailable', reason };
}

export function kpiEstimated(
  value: number,
  reason: string,
  estimatedReference?: { label: string; excludedFromTotal: true },
): KpiValue<number> {
  return { value, state: 'estimated', reason, estimatedReference };
}

export interface AnalyticsMeta {
  range: { start: string; end: string; periodDays: number };
  comparison: { prevStart: string; prevEnd: string };
  filters: AnalyticsFilterDto;
  granularity: AnalyticsRange['granularity'];
  generatedAt: string;
  dataAsOf: string;
  formulaVersion: string;
  recognition: 'delivered-only';
  costCoverage: Record<string, unknown>;
  ladderState: CostState;
  thresholds: Record<string, unknown>;
  dateBasis: string;
}

export function buildMeta(
  ctx: ResolvedAnalyticsContext,
  filters: AnalyticsFilterDto,
  extra: {
    recognition: 'delivered-only';
    costCoverage: Record<string, unknown>;
    ladderState: CostState;
    thresholds: Record<string, unknown>;
    dateBasis: string;
  },
): AnalyticsMeta {
  const now = new Date();
  return {
    range: {
      start: ctx.range.start.toISOString(),
      end: ctx.range.end.toISOString(),
      periodDays: ctx.range.periodDays,
    },
    comparison: {
      prevStart: ctx.range.comparison.prevStart.toISOString(),
      prevEnd: ctx.range.comparison.prevEnd.toISOString(),
    },
    filters,
    granularity: ctx.range.granularity,
    generatedAt: now.toISOString(),
    dataAsOf: now.toISOString(),
    formulaVersion: FORMULA_VERSION,
    recognition: extra.recognition,
    costCoverage: extra.costCoverage,
    ladderState: extra.ladderState,
    thresholds: extra.thresholds,
    dateBasis: extra.dateBasis,
  };
}

/** 60s for live ranges, 15min for closed ranges (§6 performance). */
export const LIVE_TTL_MS = 60_000;
export const CLOSED_TTL_MS = 15 * 60_000;

export function analyticsCacheTtlMs(range: Pick<AnalyticsRange, 'end'>): number {
  const live = range.end.getTime() >= Date.now() - 5 * 60_000;
  return live ? LIVE_TTL_MS : CLOSED_TTL_MS;
}

/**
 * Cache key on the endpoint + filter signature.
 *
 * Cross-service invalidation IS wired in P2: order / payment / refund /
 * expense / expense-category / marketing-consumption / dispatch mutations
 * call `invalidateByPrefix('analytics:')` via an @Optional CacheService
 * (no-op in unit tests, resilient — a cache failure never breaks the
 * mutation). The short TTLs below bound any residual staleness. No summary
 * tables; revisit trigger per §6 (p95 > 1.5s or > 500k orders).
 */
export function analyticsCacheKey(
  endpoint: string,
  filters: AnalyticsFilterDto,
): string {
  const entries = Object.entries(filters ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `analytics:${endpoint}:${JSON.stringify(entries)}`;
}

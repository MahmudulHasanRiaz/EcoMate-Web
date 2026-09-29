import type {
  PosAnalyticsPreset,
  PosAnalyticsRangeParams,
  PosAnalyticsTransactionParams,
} from '../api/client';

/** Preset buttons in spec §3 order. Values follow the backend analytics
 *  house idiom (snake_case); `previous_month` extends the same pattern. */
export const ANALYTICS_PRESETS: { value: PosAnalyticsPreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'last_30_days', label: 'Last 30 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'previous_month', label: 'Previous Month' },
  { value: 'custom', label: 'Custom' },
];

export function presetLabel(preset: PosAnalyticsPreset): string {
  return ANALYTICS_PRESETS.find((p) => p.value === preset)?.label ?? preset;
}

/** Local YYYY-MM-DD for `<input type="date">` defaults. */
export function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Default custom window: last 7 local days through today. */
export function defaultCustomRange(): { from: string; to: string } {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  return { from: toDateInputValue(weekAgo), to: toDateInputValue(now) };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Client-side mirror of the server's custom-range rules (spec §3:
 *  YYYY-MM-DD, from <= to, capped at 366 days). Returns an error message
 *  or null when valid. */
export function validateCustomRange(from: string, to: string): string | null {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return 'Custom range needs both From and To dates (YYYY-MM-DD).';
  }
  if (from > to) {
    return 'From date must be on or before To date.';
  }
  const days =
    Math.round(
      (new Date(to + 'T00:00:00Z').getTime() - new Date(from + 'T00:00:00Z').getTime()) /
        (24 * 60 * 60 * 1000),
    ) + 1;
  if (days > 366) {
    return 'Custom range is capped at 366 days.';
  }
  return null;
}

/** Human range chip, e.g. "Today" or "Custom: 2026-09-01 → 2026-09-29". */
export function rangeLabel(preset: PosAnalyticsPreset, from?: string, to?: string): string {
  if (preset === 'custom' && from && to) return `Custom: ${from} → ${to}`;
  return presetLabel(preset);
}

export function formatBDT(amount: number): string {
  return `৳${Number(amount || 0).toLocaleString('en-BD', { minimumFractionDigits: 0 })}`;
}

export function formatReportDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '—', time: '' };
  return {
    date: d.toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' }),
  };
}

export function sanitizeFilenamePart(s: string): string {
  const cleaned = (s || 'showroom').replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return cleaned || 'showroom';
}

/** Prefer the server's Content-Disposition filename; fall back to the
 *  spec §5 pattern `POS-Sales-<Showroom>-<from>_<to>.xlsx`. */
export function resolveExportFilename(opts: {
  contentDisposition?: string;
  showroomName: string | null;
  from?: string;
  to?: string;
  preset: PosAnalyticsPreset;
}): string {
  const cd = opts.contentDisposition || '';
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd)?.[1];
  const plain = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i.exec(cd)?.slice(1).find(Boolean);
  const raw = star ?? plain;
  if (raw) {
    try {
      return decodeURIComponent(raw.trim());
    } catch {
      return raw.trim();
    }
  }
  const showroom = sanitizeFilenamePart(opts.showroomName || 'showroom');
  const period =
    opts.preset === 'custom' && opts.from && opts.to
      ? `${opts.from}_${opts.to}`
      : opts.preset;
  return `POS-Sales-${showroom}-${period}.xlsx`;
}

/** Builds the query object for analytics endpoints. Pure (unit-tested). */
export function buildAnalyticsQuery(
  params: PosAnalyticsRangeParams | PosAnalyticsTransactionParams,
): Record<string, string | number> {
  const { scope, preset, ...rest } = params as PosAnalyticsTransactionParams;
  const query: Record<string, string | number> = { scope, preset };
  // Custom dates ride along only for the custom preset; presets are
  // server-aggregated so sending from/to alongside them could conflict.
  if (preset === 'custom' && rest.from && rest.to) {
    query.from = rest.from;
    query.to = rest.to;
  }
  for (const k of ['page', 'pageSize', 'sort', 'order'] as const) {
    const v = rest[k];
    if (v !== undefined) query[k] = v;
  }
  return query;
}

/** Pull `page/pageSize/total/totalPages` out of the transactions envelope
 *  meta, tolerating missing fields. */
export function parseTransactionsMeta(meta: Record<string, unknown> | undefined): {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
} {
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    page: num(meta?.page, 1),
    pageSize: num(meta?.pageSize, 20),
    total: num(meta?.total, 0),
    totalPages: num(meta?.totalPages, 0),
  };
}

/**
 * Immutable per-order attribution snapshot.
 *
 * The order row keeps its own copy of where the order came from. Everything the
 * storefront (or a staff member) supplied at checkout, plus whatever the journey
 * session knew server-side, is frozen into `Order.attribution` when the order is
 * created — so later session overwrites, session pruning, or a missing campaign
 * match can never erase the answer to "which ad/search/direct brought this".
 *
 * Precedence, per field: the order payload wins, then the journey session.
 * A session is only consulted as a fallback — it must never override what the
 * customer's own request carried.
 *
 * Pure function: no DB, no clock except the injected `now`.
 */

/** Raw journey-session values used as a server-side fallback. */
export interface AttributionSessionFallback {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
  landingUrl?: string | null;
  clickId?: string | null;
  fbclid?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Device/technical context collected by the storefront (P2). */
export interface DeviceContextInput {
  screen?: string | null;
  viewport?: string | null;
  pixelRatio?: number | null;
  timezone?: string | null;
  language?: string | null;
  platform?: string | null;
  browser?: string | null;
  os?: string | null;
  deviceType?: string | null;
  touch?: boolean | null;
  connection?: string | null;
}

export interface OrderAttributionSnapshot {
  version: number;
  capturedAt: string;
  sessionToken: string | null;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
  landingUrl: string | null;
  utm: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    content: string | null;
    term: string | null;
  };
  clickIds: Record<string, string> | null;
  device: DeviceContextInput | null;
  resolved: { platform: string; type: string } | null;
  /**
   * Touch model, recorded — NOT applied. `firstSeenAt` is when the journey
   * session started, `lastTouchAt` is this order; `withinWindow` says whether
   * the gap still falls inside the configured attribution window. Which touch a
   * campaign is credited to stays a report-side decision: changing it here would
   * silently rewrite historical attribution.
   */
  touch: {
    firstSeenAt: string | null;
    lastTouchAt: string;
    ageDays: number | null;
    windowDays: number;
    withinWindow: boolean | null;
  };
}

export const ATTRIBUTION_SNAPSHOT_VERSION = 1;

/** Default attribution window in days, used when the setting is absent. */
export const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 30;

/** The click-id keys the snapshot preserves verbatim, in resolver precedence. */
export const SNAPSHOT_CLICK_ID_KEYS = [
  'clickId',
  'click_id',
  'fbclid',
  'fb_click_id',
  'gclid',
  'wbraid',
  'gbraid',
  'msclkid',
  'ttclid',
  'twclid',
  'igshid',
] as const;

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function pick(primary: unknown, fallback: unknown): string | null {
  return str(primary) ?? str(fallback);
}

/** JSON-safe: drops empty keys so a snapshot never grows a wall of nulls. */
function compactClickIds(raw: Record<string, unknown>): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const key of SNAPSHOT_CLICK_ID_KEYS) {
    const value = str(raw[key]);
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function compactDevice(device?: DeviceContextInput | null): DeviceContextInput | null {
  if (!device || typeof device !== 'object') return null;
  const out: DeviceContextInput = {};
  for (const [key, value] of Object.entries(device)) {
    if (value === undefined || value === null || value === '') continue;
    (out as any)[key] = typeof value === 'string' ? value.trim().slice(0, 200) : value;
  }
  return Object.keys(out).length ? out : null;
}

export interface BuildSnapshotInput {
  /** Raw `dto.attribution` from the order payload. */
  attribution?: Record<string, any> | null;
  /** Raw `dto.device` from the order payload (P2). */
  device?: DeviceContextInput | null;
  /** Journey session token (`dto.trackingSessionId`). */
  sessionToken?: string | null;
  /** Request IP (proxy-resolved). */
  ip?: string | null;
  /** Request user-agent header. */
  userAgent?: string | null;
  /** Journey session row, when one exists for the token. */
  session?: AttributionSessionFallback | null;
  /** Resolved platform/type (`resolveWebAttribution`). */
  resolved?: { sourcePlatform: string; sourceType: string } | null;
  /** When the journey session started (first touch). */
  sessionStartedAt?: Date | string | null;
  /** Attribution window in days; defaults to DEFAULT_ATTRIBUTION_WINDOW_DAYS. */
  attributionWindowDays?: number | null;
  now?: Date;
}

/**
 * Build the snapshot, or null when the order carries no signal at all (a pure
 * staff entry with no session and no technical context) — a null column then
 * honestly means "nothing was known", not "empty object".
 */
export function buildOrderAttributionSnapshot(
  input: BuildSnapshotInput,
): OrderAttributionSnapshot | null {
  const a = input.attribution ?? {};
  const s = input.session ?? null;

  const utm = {
    source: pick(a.utmSource ?? a.utm_source, s?.utmSource),
    medium: pick(a.utmMedium ?? a.utm_medium, s?.utmMedium),
    campaign: pick(a.utmCampaign ?? a.utm_campaign, s?.utmCampaign),
    content: pick(a.utmContent ?? a.utm_content, s?.utmContent),
    term: pick(a.utmTerm ?? a.utm_term, s?.utmTerm),
  };

  const clickIds = compactClickIds({ ...(s ?? {}), ...a });
  const device = compactDevice(input.device);
  const referrer = pick(a.referrer, s?.referrer);
  const landingUrl = pick(a.landingUrl ?? a.landing_url, s?.landingUrl);
  const ip = pick(input.ip, s?.ip);
  const userAgent = pick(input.userAgent, s?.userAgent);

  const hasSignal =
    !!clickIds ||
    !!device ||
    !!referrer ||
    !!landingUrl ||
    !!ip ||
    !!userAgent ||
    Object.values(utm).some(Boolean);
  if (!hasSignal) return null;

  const now = input.now ?? new Date();
  const windowDays =
    typeof input.attributionWindowDays === 'number' && input.attributionWindowDays > 0
      ? input.attributionWindowDays
      : DEFAULT_ATTRIBUTION_WINDOW_DAYS;
  const firstSeen = input.sessionStartedAt ? new Date(input.sessionStartedAt) : null;
  const firstSeenValid = firstSeen && !Number.isNaN(firstSeen.getTime()) ? firstSeen : null;
  const ageDays = firstSeenValid
    ? Math.floor((now.getTime() - firstSeenValid.getTime()) / 86_400_000)
    : null;
  const withinWindow = ageDays === null ? null : ageDays <= windowDays;

  return {
    version: ATTRIBUTION_SNAPSHOT_VERSION,
    capturedAt: now.toISOString(),
    sessionToken: str(input.sessionToken),
    ip,
    userAgent,
    referrer,
    landingUrl,
    utm,
    clickIds,
    device,
    resolved: input.resolved
      ? { platform: input.resolved.sourcePlatform, type: input.resolved.sourceType }
      : null,
    touch: {
      firstSeenAt: firstSeenValid ? firstSeenValid.toISOString() : null,
      lastTouchAt: now.toISOString(),
      ageDays,
      windowDays,
      withinWindow,
    },
  };
}

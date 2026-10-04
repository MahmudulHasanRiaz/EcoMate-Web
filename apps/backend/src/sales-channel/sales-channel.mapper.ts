/**
 * Deterministic legacy → canonical mapping.
 *
 * ONE function, shared by the backfill script and the runtime write path, so
 * a historical order and a newly created order can never be mapped by two
 * different sets of rules.
 *
 * Two invariants this module exists to enforce:
 *
 *  1. NO FABRICATION. Where the legacy data does not prove something, the
 *     answer is NULL (or UNKNOWN when a classification was genuinely
 *     attempted). A Channel never implies a Source, and neither ever implies
 *     an AcquisitionType. `PHONE_CALL → ORGANIC` and `POS → ORGANIC` do not
 *     exist as rules because they would invent a marketing fact.
 *
 *  2. DIRECT ≠ ORGANIC. `web-attribution.ts` emits sourceType='DIRECT' as a
 *     distinct resolver outcome, and its no-signal default is literally
 *     ('DIRECT','DIRECT'). Collapsing that into ORGANIC would report "no
 *     marketing referrer was established" as "organic search brought this".
 *
 * Pure module: no DB, no clock, no side effects.
 */
import {
  LEGACY_CHANNEL_TO_SOURCE,
  LEGACY_PLATFORM_TO_SLUG,
  NON_PLATFORM_SOURCE_VALUES,
  type AcquisitionType,
  type SalesChannelV2,
} from './sales-channel.constants';

export interface LegacyOrderShape {
  source?: string | null;
  salesChannel?: string | null;
  sourcePlatform?: string | null;
  sourceType?: string | null;
  sourceEntity?: string | null;
  /** Frozen Order.attribution JSON, for utm_medium corroboration. */
  attribution?: unknown;
  /** Resolved OrderAttribution.method, when a row exists. */
  attributionMethod?: string | null;
}

export interface CanonicalMapping {
  channel: SalesChannelV2 | null;
  channelEntity: string | null;
  sourceSlug: string | null;
  acquisitionType: AcquisitionType | null;
  /** Why this outcome — recorded in the backfill report so it can be audited. */
  reason: string;
}

const NONE = (reason: string): CanonicalMapping => ({
  channel: null,
  channelEntity: null,
  sourceSlug: null,
  acquisitionType: null,
  reason,
});

/** Attribution methods that count as corroborated marketing evidence. */
const PAID_ATTRIBUTION_METHODS = new Set(['click_id', 'utm', 'conversion_api', 'pixel']);

/** UTM mediums that mean paid, mirroring web-attribution.ts PAID_MEDIUMS. */
const PAID_UTM_MEDIA = new Set([
  'cpc', 'ppc', 'paid', 'cpm', 'cpe', 'cpv', 'cpa',
]);

function readUtmMedium(attribution: unknown): string | null {
  if (!attribution || typeof attribution !== 'object') return null;
  const utm = (attribution as any)?.utm;
  const medium = utm?.medium;
  return typeof medium === 'string' ? medium.trim().toLowerCase() || null : null;
}

function entity(value?: string | null): string | null {
  const v = (value ?? '').trim();
  return v ? v : null;
}

/**
 * Resolve a legacy `sourcePlatform` to a registry slug.
 * Operational values (POS/PHONE/EXTERNAL_STORE/LEAD) and unknown strings
 * resolve to NULL — they are NOT marketing platforms, and writing one into
 * the FK column would either violate the FK or assert a false platform.
 * `DIRECT` resolves to the `direct` source slug (no marketing referrer
 * established) — a SOURCE, never an acquisition classification.
 */
export function resolveSourceSlug(legacyPlatform?: string | null): string | null {
  const raw = (legacyPlatform ?? '').trim();
  if (!raw) return null;
  if (NON_PLATFORM_SOURCE_VALUES.has(raw.toUpperCase())) return null;
  return LEGACY_PLATFORM_TO_SLUG[raw.toUpperCase()] ?? null;
}

/**
 * The backfill work set.
 *
 * A row belongs to it when it has never been mapped AND it existed at or
 * before the captured boundary. Note what is deliberately absent: `channel`.
 *
 * `channel IS NULL` is NOT a valid "not yet migrated" marker, because a NULL
 * channel is the CORRECT mapping for most historical orders — 278 of 449 in
 * the measured dataset. Guarding on it would either skip them forever or
 * reprocess them on every run. `channelMappedAt` is the marker precisely
 * because it is not business data.
 */
export function isInBackfillWorkSet(
  row: { channelMappedAt: Date | null; createdAt: Date },
  boundary: Date,
): boolean {
  if (row.channelMappedAt !== null) return false;
  return row.createdAt.getTime() <= boundary.getTime();
}

export function mapOrderToCanonical(order: LegacyOrderShape): CanonicalMapping {
  const platform = (order.sourcePlatform ?? '').trim().toUpperCase();
  const type = (order.sourceType ?? '').trim().toUpperCase();
  const channel = (order.salesChannel ?? '').trim().toUpperCase();
  const ent = entity(order.sourceEntity);

  // ── Stronger evidence first: these override the salesChannel table below ──

  // Showroom evidence — the venue and its origin are both explicit.
  if (platform === 'POS' && type === 'SHOWROOM') {
    return {
      channel: 'POS', channelEntity: ent, sourceSlug: null, acquisitionType: null,
      reason: 'showroom evidence (sourcePlatform=POS, sourceType=SHOWROOM)',
    };
  }
  if (type === 'SHOWROOM') {
    return {
      channel: 'POS', channelEntity: ent, sourceSlug: null, acquisitionType: null,
      reason: 'showroom evidence (sourceType=SHOWROOM)',
    };
  }

  // An external store is an INTEGRATION, not a marketing platform. Its name is
  // the entity; asserting a Source here would invent a platform claim.
  if (platform === 'EXTERNAL_STORE') {
    return {
      channel: 'WEBSITE', channelEntity: ent, sourceSlug: null, acquisitionType: null,
      reason: 'external store integration (not a marketing platform)',
    };
  }

  // ── Acquisition classification (never derived from the channel) ──────────

  if (type === 'AD') {
    // sourceType=AD is itself explicit paid evidence. A resolved attribution
    // row and/or a paid utm medium corroborate it, which is recorded so a
    // reviewer can see how strong the evidence was — the verdict is PAID either
    // way because the order says so.
    const method = (order.attributionMethod ?? '').trim().toLowerCase();
    const medium = readUtmMedium(order.attribution);
    const corroboration =
      PAID_ATTRIBUTION_METHODS.has(method) ? `+ ${method} attribution`
        : medium && PAID_UTM_MEDIA.has(medium) ? `+ utm medium '${medium}'`
        : null;
    return {
      channel: 'WEBSITE',
      channelEntity: ent,
      sourceSlug: resolveSourceSlug(order.sourcePlatform),
      acquisitionType: 'PAID',
      reason: `paid evidence (sourceType=AD${corroboration ? ` ${corroboration}` : ''})`,
    };
  }

  if (type === 'DIRECT') {
    const slug = resolveSourceSlug(order.sourcePlatform);
    // 'direct' is a SOURCE (no marketing referrer established), not a
    // referrer platform — it must take the no-signal path below, never the
    // ORGANIC path. Only a genuine referrer platform (google, facebook, …)
    // counts as organic evidence.
    if (slug && slug !== 'direct') {
      // A KNOWN referrer platform brought this, unpaid → genuinely organic.
      return {
        channel: channel === 'CALL' ? 'PHONE_CALL' : 'WEBSITE',
        channelEntity: ent,
        sourceSlug: slug,
        acquisitionType: 'ORGANIC',
        reason: 'known referrer platform, unpaid (sourceType=DIRECT)',
      };
    }
    // sourcePlatform is 'DIRECT'/absent — this is the resolver's NO-SIGNAL
    // default. The source is Direct (no marketing referrer), NOT an acquisition type.
    return {
      channel: channel === 'CALL' ? 'PHONE_CALL' : 'WEBSITE',
      channelEntity: ent,
      sourceSlug: 'direct',
      acquisitionType: null,
      reason: 'no marketing referrer established (sourceType=DIRECT, no platform)',
    };
  }

  if (type === 'CHAT') {
    const slug = resolveSourceSlug(order.sourcePlatform);
    return {
      channel: 'MESSAGING',
      channelEntity: ent,
      sourceSlug: slug,
      acquisitionType: null,
      reason: 'chat entry evidence (sourceType=CHAT)',
    };
  }

  // ── salesChannel table: every legacy value has an explicit fate ──────────

  switch (channel) {
    case 'WEBSITE':
      return {
        channel: 'WEBSITE', channelEntity: ent, sourceSlug: null,
        acquisitionType: 'UNKNOWN',
        reason: 'venue explicit; resolver ran and matched no platform',
      };

    case 'POS':
      // Venue explicit, showroom name only when it was recorded. Acquisition
      // stays NULL — POS is never ORGANIC.
      return {
        channel: 'POS', channelEntity: ent, sourceSlug: null, acquisitionType: null,
        reason: 'venue explicit (POS); no acquisition evidence',
      };

    case 'CALL':
      // Channel is NEVER an acquisition signal.
      return {
        channel: 'PHONE_CALL', channelEntity: ent, sourceSlug: null, acquisitionType: null,
        reason: 'venue explicit (phone call); no acquisition evidence',
      };

    case 'FACEBOOK':
    case 'INSTAGRAM':
    case 'TIKTOK':
    case 'MESSENGER':
    case 'WHATSAPP':
    case 'THREADS': {
      // These legacy values were platform names, not venues.
      return {
        channel: 'MESSAGING',
        channelEntity: ent,
        sourceSlug: LEGACY_CHANNEL_TO_SOURCE[channel] ?? null,
        acquisitionType: null,
        reason: `legacy salesChannel '${channel}' named a platform, not a venue`,
      };
    }

    case 'WALK_IN':
      // Forbidden to map to POS: existing data does not prove a walk-in was POS.
      return NONE(`insufficient evidence: 'WALK_IN' does not establish a venue (not mapped to POS)`);

    case 'OFFLINE':
      // 'OFFLINE' names no venue. M3 (sourceType=CHAT) already returned above
      // for the orders that DO have chat evidence.
      return NONE(`insufficient evidence: 'OFFLINE' names no venue and no chat evidence`);

    case 'OTHER':
      return NONE(`insufficient evidence: 'OTHER' states nothing about the venue`);

    default:
      return NONE(`insufficient evidence: no channel recorded (salesChannel=${channel || 'NULL'})`);
  }
}

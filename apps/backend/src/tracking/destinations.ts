/**
 * Multi-destination Meta delivery model (Step 3).
 *
 * ONE business event → ONE TrackingSnapshot → ONE TrackingOutbox → N
 * TrackingDispatch rows, one per (provider, destination). The canonical business
 * event identity (e.g. `purchase_{orderId}`) is NEVER per-destination: Meta's
 * dedup namespace is (event_name + event_id) WITHIN one dataset, so the same
 * event_id must reach every dataset — a per-destination id would break the
 * Pixel↔CAPI dedup inside each pixel rather than protect anything.
 *
 * This module is the SINGLE source of truth for the destination shape, shared by
 * the server dispatcher (TrackingSettingsService) and the public storefront
 * config mapper (SystemSettingsController). Two implementations would drift, and
 * a drift here means the browser initializes a pixel the server does not deliver
 * to (or worse, a token reaches the browser).
 *
 * SECURITY: `accessToken` is a server-only secret. Nothing in this module's
 * `publicMetaDestinations()` output may ever carry it — that projection is the
 * only shape allowed to reach the storefront or a non-admin API response.
 */

/** Hard cap on Meta destinations (enforced server-side, not only in the UI). */
export const MAX_META_DESTINATIONS = 10;

/**
 * Destination id used for dispatches created before destinations existed, and for
 * the synthesized destination when only the legacy single-pixel settings are
 * present. It is a real destination id: immutable, and never reused for a newly
 * created destination.
 */
export const LEGACY_DESTINATION_ID = 'default';

/** System-setting key holding the destination array (JSON). */
export const META_DESTINATIONS_SETTING_KEY = 'tracking_meta_destinations';

/** Slug-safe, stable, immutable destination id. */
export const DESTINATION_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** A Meta destination = one pixel/dataset plus the credential that delivers to it. */
export interface TrackingDestination {
  /** Immutable identity; the DB key component. Never reused, even after removal. */
  id: string;
  /** Display only. */
  label: string;
  /** Public by nature — safe to expose to the browser. */
  pixelId: string;
  /** SECRET. Server-only; never to the browser, configSnapshot, archive, or logs. */
  accessToken: string;
  /** Destination-level kill switch. Affects future captures, not in-flight events. */
  enabled: boolean;
  /** Whether this destination also has a browser Pixel initialized. */
  browserPixelEnabled: boolean;
  /** Honoured only when `testMode` is true. */
  testEventCode: string;
  testMode: boolean;
  createdAt: string;
  updatedAt: string;
  /** Soft-removal marker. A removed destination keeps its id (never reused). */
  removedAt: string | null;
}

/**
 * The browser-safe projection. The storefront receives ONLY this: it must be able
 * to initialize a pixel without being able to deliver to the dataset.
 */
export interface PublicMetaDestination {
  id: string;
  label: string;
  pixelId: string;
}

/** Which destinations a captured event is eligible for (recorded at capture time). */
export interface CapturedDestinationRef {
  provider: string;
  destinationId: string;
  /** Pinned delivery identity — NOT the credential (rotation must keep working). */
  pixelId: string;
  /**
   * Purchase timing mode this destination follows for THIS event.
   *
   * Recorded per destination rather than read from a provider-level setting at
   * dispatch time, which is what makes a future per-destination mode
   * (Pixel A = instant, Pixel B = validated) a pure settings change: the
   * dispatcher already gates per reference, so only the ref builder changes.
   * Today every destination of a provider is populated with that provider's
   * `tracking_<provider>_purchase_mode`, preserving existing behaviour exactly.
   */
  purchaseMode: string;
}

export interface DestinationValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  value: TrackingDestination[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Coerce one raw settings entry into a TrackingDestination. Returns null when the
 * entry has no usable id (a destination without a stable identity cannot be a
 * dispatch key).
 */
function coerceDestination(
  raw: unknown,
  now: string,
): TrackingDestination | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = asString(r.id).trim();
  if (!DESTINATION_ID_RE.test(id)) return null;
  const removedAt = asString(r.removedAt).trim();
  return {
    id,
    label: asString(r.label).trim(),
    pixelId: asString(r.pixelId).trim(),
    accessToken: asString(r.accessToken),
    enabled: asBool(r.enabled, true),
    browserPixelEnabled: asBool(r.browserPixelEnabled, true),
    testEventCode: asString(r.testEventCode).trim(),
    testMode: asBool(r.testMode, false),
    createdAt: asString(r.createdAt) || now,
    updatedAt: asString(r.updatedAt) || asString(r.createdAt) || now,
    removedAt: removedAt || null,
  };
}

/**
 * Normalize an arbitrary parsed value into a destination list: coerce, drop
 * unusable entries, de-duplicate by id (first wins — an id is an identity, so a
 * later duplicate is either a copy-paste error or an attempted reuse), and cap.
 * Order is preserved as stored — it is deterministic and admin-controlled.
 */
export function normalizeDestinations(
  input: unknown,
  now = new Date().toISOString(),
): TrackingDestination[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: TrackingDestination[] = [];
  for (const raw of input) {
    const dest = coerceDestination(raw, now);
    if (!dest || seen.has(dest.id)) continue;
    seen.add(dest.id);
    out.push(dest);
    if (out.length >= MAX_META_DESTINATIONS) break;
  }
  return out;
}

/**
 * Synthesize the single legacy destination from the pre-Step-3 single-pixel
 * settings. Returns [] when there is no legacy pixel id configured, so the caller
 * naturally falls through to "no Meta destinations".
 */
export function synthesizeLegacyDestination(
  pixelId: string | null | undefined,
  accessToken: string | null | undefined,
  now = new Date().toISOString(),
): TrackingDestination[] {
  const id = (pixelId || '').trim();
  if (!id) return [];
  return [
    {
      id: LEGACY_DESTINATION_ID,
      label: 'Default',
      pixelId: id,
      accessToken: accessToken || '',
      // The provider-level `tracking_meta_enabled` flag governs whether Meta
      // dispatches at all; a legacy install has no per-destination override, so
      // both destination switches mirror today's behaviour (pixel id present =>
      // browser init + CAPI delivery).
      enabled: true,
      browserPixelEnabled: true,
      testEventCode: '',
      testMode: false,
      createdAt: now,
      updatedAt: now,
      removedAt: null,
    },
  ];
}

/**
 * Resolve the effective destination list: the configured array when present and
 * non-empty, otherwise the legacy single-pixel synthesis. This is the ONE
 * migration/fallback rule — both the dispatcher and the storefront config mapper
 * call it.
 */
export function resolveMetaDestinations(
  rawDestinations: string | null | undefined,
  legacyPixelId: string | null | undefined,
  legacyAccessToken: string | null | undefined,
  now = new Date().toISOString(),
): TrackingDestination[] {
  if (rawDestinations) {
    try {
      const parsed = JSON.parse(rawDestinations);
      const normalized = normalizeDestinations(parsed, now);
      if (normalized.length) return normalized;
    } catch {
      // Malformed JSON — fall through to legacy rather than dropping delivery.
    }
  }
  return synthesizeLegacyDestination(legacyPixelId, legacyAccessToken, now);
}

/** Destinations eligible for a NEW capture: not removed and enabled. */
export function activeDestinations(
  destinations: TrackingDestination[],
): TrackingDestination[] {
  return destinations.filter((d) => !d.removedAt && d.enabled);
}

/**
 * Destinations the browser may initialize: enabled, not removed, browser-enabled,
 * and carrying a pixel id. Pixel ids are public; tokens never reach this path.
 */
export function publicMetaDestinations(
  destinations: TrackingDestination[],
): PublicMetaDestination[] {
  return activeDestinations(destinations)
    .filter((d) => d.browserPixelEnabled && d.pixelId)
    .map((d) => ({ id: d.id, label: d.label, pixelId: d.pixelId }));
}

/** Look up one destination by its immutable id. */
export function findDestination(
  destinations: TrackingDestination[],
  id: string,
): TrackingDestination | undefined {
  return destinations.find((d) => d.id === id);
}

/**
 * Whether an already-captured event may still be delivered to a destination.
 *
 * Only REMOVAL blocks delivery. A destination that is merely `enabled: false`
 * still receives events that were captured while it was enabled — disabling is
 * forward-looking and must never retroactively drop an in-flight event. A
 * destination that has disappeared entirely from the list counts as removed
 * (its identity can no longer be resolved), which is why the check is
 * "exists AND not removed" rather than "not removed".
 */
export function isDestinationDeliverable(
  destinations: TrackingDestination[],
  destinationId: string,
): boolean {
  const dest = findDestination(destinations, destinationId);
  return !!dest && !dest.removedAt;
}

/**
 * Server-side validation for a destination array submitted by the admin API.
 *
 * Deliberately NOT blocking duplicate pixel ids: two destinations pointing at the
 * same dataset is wasteful (the same canonical event_id reaches one dataset twice
 * and Meta dedups it) but it is not incorrect, and the existing product has no
 * rule forbidding it. It surfaces as a warning instead.
 */
export function validateMetaDestinations(
  input: unknown,
  now = new Date().toISOString(),
): DestinationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(input)) {
    return {
      ok: false,
      errors: ['Destinations must be an array'],
      warnings,
      value: [],
    };
  }
  if (input.length > MAX_META_DESTINATIONS) {
    errors.push(`At most ${MAX_META_DESTINATIONS} Meta destinations are allowed`);
  }

  const value: TrackingDestination[] = [];
  const seenIds = new Set<string>();
  const pixelIdToIds = new Map<string, string[]>();

  input.forEach((raw, index) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = asString(r.id).trim();
    if (!DESTINATION_ID_RE.test(id)) {
      errors.push(
        `Destination #${index + 1}: id must match ${DESTINATION_ID_RE} (got ${JSON.stringify(id)})`,
      );
      return;
    }
    if (seenIds.has(id)) {
      // An id IS the delivery identity. Reusing one would silently repoint
      // historical dispatch rows at a different dataset.
      errors.push(`Duplicate destination id '${id}' — ids are immutable and never reused`);
      return;
    }
    seenIds.add(id);

    const dest = coerceDestination({ ...r, id }, now)!;
    const removed = dest.removedAt !== null;
    if (!removed) {
      if (!dest.pixelId) {
        errors.push(`Destination '${id}': pixelId is required`);
      }
      if (dest.enabled && !dest.accessToken) {
        errors.push(`Destination '${id}': accessToken is required when the destination is enabled`);
      }
    }
    if (dest.pixelId) {
      const list = pixelIdToIds.get(dest.pixelId) ?? [];
      list.push(dest.id);
      pixelIdToIds.set(dest.pixelId, list);
    }
    value.push(dest);
  });

  for (const [pixelId, ids] of pixelIdToIds) {
    if (ids.length > 1) {
      warnings.push(
        `Pixel id ${pixelId} is used by multiple destinations (${ids.join(', ')}) — the same canonical event will be delivered to that dataset more than once and deduplicated there`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings, value };
}

/**
 * Capture-time eligibility projection recorded on the outbox `configSnapshot`.
 * Non-secret by construction: destinationId + pixelId only, never the token —
 * `configSnapshot` is copied verbatim into the 2-year TrackingReplayArchive.
 *
 * `purchaseMode` is the provider-level mode today (all destinations of a provider
 * share it). It is stored per reference so a future per-destination mode needs no
 * schema or dispatcher redesign.
 */
export function capturedDestinationRefs(
  destinations: TrackingDestination[],
  purchaseMode: string,
): CapturedDestinationRef[] {
  return activeDestinations(destinations).map((d) => ({
    provider: 'meta',
    destinationId: d.id,
    pixelId: d.pixelId,
    purchaseMode,
  }));
}

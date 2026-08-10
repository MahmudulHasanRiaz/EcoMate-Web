import {
  TrackingContextView,
  TrackingSnapshotPayload,
} from '../tracking-snapshot.types';
import { TrackingNormalizer } from '../tracking.normalizer';

/** Outcome of a single provider dispatch attempt. */
export interface DispatchResult {
  ok: boolean;
  retryable: boolean;
  providerEventId?: string;
  httpStatus?: number;
  rawResponse?: string;
}

/** Provider-bound payload produced by an adapter's build() step. */
export interface ProviderPayload {
  eventName: string;
  eventId: string;
  eventTime: number;
  eventType: string;
  /**
   * Informational match-quality flags set by an adapter's build() (never
   * persisted on the dispatch row; surfaced as a TrackingDispatchEvent message
   * and visible in the monitoring timeline). Example: ['NO_EM_PH'] when the
   * payload has no em/ph contact key but still carries other identity
   * (external_id/fbp/fbc/ip/ua) — Meta accepts such events with lower EMQ.
   */
  qualityFlags?: string[];
  /**
   * Set by build() when the payload MUST NOT be sent because the provider
   * guarantees rejection (e.g. Meta 2804050 when user_data has no identity
   * parameter at all). The dispatcher records a terminal SKIPPED dispatch row
   * carrying this reason instead of POSTing a doomed request.
   */
  skipReason?: string;
  [key: string]: any;
}

/** Raw provider config (api key, pixel id, …) resolved at dispatch time. */
export interface ProviderConfig {
  [key: string]: string | undefined;
}

/**
 * Optional per-dispatch gate hints (design §4.6). Passed to supports() by the
 * dispatcher when it knows the event's provenance beyond the snapshot type.
 */
export interface AdapterSupportsOptions {
  /**
   * GA4: the event is validated/offline with no browser-fired counterpart
   * (driven by the provider's `ga4Server` config flag). Allows server
   * Measurement Protocol dispatch even for event types the browser fires via
   * gtag in instant mode (e.g. Purchase) — otherwise suppressed to avoid the
   * double-count a duplicate client_id would cause.
   */
  serverOnly?: boolean;
}

/**
 * Versioned provider adapter contract (design §4.2). Each provider ships one
 * adapter per supported API version; dispatch routes to the newest registered
 * version unless an older one is explicitly requested (replay).
 */
export interface TrackingProviderAdapter {
  readonly provider: string;
  readonly version: number;
  readonly providerApiVersion: string;
  supports(eventType: string, opts?: AdapterSupportsOptions): boolean;
  build(
    snapshot: TrackingSnapshotPayload,
    ctx: TrackingContextView,
    normalizer: TrackingNormalizer,
  ): ProviderPayload | null;
  send(payload: ProviderPayload, cfg: ProviderConfig): Promise<DispatchResult>;
}

/** provider → registered adapter versions, newest last. */
const registry = new Map<string, TrackingProviderAdapter[]>();

/** Append an adapter to its provider's version list (newest last). */
export function registerAdapter(adapter: TrackingProviderAdapter): void {
  const versions = registry.get(adapter.provider) ?? [];
  // One adapter per provider+version keeps the list invariant sound. A second
  // registration at the same provider+version OVERWRITES (later registration
  // wins) so a stale/partial adapter is never silently kept.
  const existing = versions.findIndex((a) => a.version === adapter.version);
  if (existing >= 0) {
    versions[existing] = adapter;
  } else {
    versions.push(adapter);
  }
  versions.sort((a, b) => a.version - b.version);
  registry.set(adapter.provider, versions);
}

/**
 * Resolve an adapter. `version` selects that exact adapter version; otherwise
 * (or if the requested version is not registered) the newest is returned.
 */
export function getAdapter(
  provider: string,
  version?: number,
): TrackingProviderAdapter | undefined {
  const versions = registry.get(provider);
  if (!versions || versions.length === 0) return undefined;
  if (version !== undefined) {
    const match = versions.find((a) => a.version === version);
    if (match) return match;
  }
  return versions[versions.length - 1];
}

/** All registered adapters across every provider. */
export function listAdapters(): TrackingProviderAdapter[] {
  return Array.from(registry.values()).flat();
}

/**
 * Legacy SalesChannel → canonical Channel, for the analytics fallback path.
 *
 * Derived from the mapper's rules rather than restating them, so the two can
 * never disagree. `WALK_IN`, `OFFLINE` and `OTHER` are deliberately absent:
 * they map to NULL in the canonical model (insufficient evidence), so no
 * legacy row can satisfy a canonical channel filter through them.
 */
import { mapOrderToCanonical } from './sales-channel.mapper';

function translate(legacy: string): string | null {
  return mapOrderToCanonical({ salesChannel: legacy }).channel;
}

const LEGACY_VALUES_WITH_A_CANONICAL_EQUIVALENT: string[] = [
  'WEBSITE', 'POS', 'CALL',
  'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'MESSENGER', 'WHATSAPP', 'THREADS',
];

export const LEGACY_CHANNEL_TO_V2: Record<string, string> = {};
for (const legacy of LEGACY_VALUES_WITH_A_CANONICAL_EQUIVALENT) {
  const v2 = translate(legacy);
  // A legacy value that maps to NULL (WALK_IN / OFFLINE / OTHER) is
  // deliberately absent: no canonical filter may match it.
  if (v2 !== null) LEGACY_CHANNEL_TO_V2[legacy] = v2;
}

/** Reverse lookup, used when a legacy consumer must express a canonical value. */
export const V2_TO_LEGACY_CHANNELS: Record<string, string[]> = (() => {
  const acc: Record<string, string[]> = {};
  for (const [legacy, v2] of Object.entries(LEGACY_CHANNEL_TO_V2)) {
    (acc[v2] ??= []).push(legacy);
  }
  return acc;
})();

/**
 * Channel ⇄ Source compatibility, enforced server-side.
 *
 * UI filtering is a convenience, not a control — any client can post
 * `channel=MESSAGING&sourceSlug=google`. Google is not a messaging platform,
 * so accepting that combination would assert something false about the order.
 *
 * But an order must NEVER be rejected over an attribution field. An
 * incompatible or unknown source is therefore cleared and reported back as a
 * warning, rather than enforced: the sale happened, and refusing to record it
 * because of a mis-tagged marketing field would lose a real order.
 *
 * Pure function so the whole matrix is unit-testable without a database.
 */
import type { SalesChannelV2 } from './sales-channel.constants';

export interface SourceCheckInput {
  channel: SalesChannelV2 | null;
  sourceSlug: string | null | undefined;
  /** Enabled registry slugs. */
  knownSlugs: Set<string>;
  /** Capabilities per slug. */
  capabilitiesBySlug: Map<string, string[]>;
}

export type SourceCheckResult =
  | { ok: true; sourceSlug: null }
  | { ok: true; sourceSlug: string }
  | { ok: false; sourceSlug: null; warning: string };

/**
 * Which capability, if any, a channel requires of its source.
 * WEBSITE and POS accept any registered platform; POS normally has none.
 */
export function requiredCapabilityFor(
  channel: SalesChannelV2 | null,
): 'MESSAGING' | null {
  return channel === 'MESSAGING' ? 'MESSAGING' : null;
}

export function validateSourceForChannel(input: SourceCheckInput): SourceCheckResult {
  const raw = (input.sourceSlug ?? '').trim();
  // Omitted is always fine — attribution is optional by design.
  if (!raw) return { ok: true, sourceSlug: null };

  const slug = raw.toLowerCase();

  if (!input.knownSlugs.has(slug)) {
    return {
      ok: false,
      sourceSlug: null,
      warning: `Source '${raw}' is not a registered platform; source cleared.`,
    };
  }

  const required = requiredCapabilityFor(input.channel);
  if (required) {
    const caps = input.capabilitiesBySlug.get(slug) ?? [];
    if (!caps.includes(required)) {
      return {
        ok: false,
        sourceSlug: null,
        warning: `Source '${raw}' is not valid for ${input.channel}; source cleared.`,
      };
    }
  }

  return { ok: true, sourceSlug: slug };
}

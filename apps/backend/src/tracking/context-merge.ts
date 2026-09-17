export interface ProviderIdentifier {
  value: string;
  firstSeenAt: string;
  lastSeenAt?: string;
}
export interface IncomingIdentifiers {
  [provider: string]: { [key: string]: string | undefined };
}
export interface StoredIdentifiers {
  [provider: string]: { [key: string]: ProviderIdentifier };
}
export interface ContextInput {
  identifiers?: IncomingIdentifiers;
  url?: string;
  referrer?: string;
}
export interface ContextMerged {
  identifiers: StoredIdentifiers;
  url?: string;
  referrer?: string;
}

/** Cookie-based identifiers rotate across sessions: replace-when-newer, never clear. */
const ROTATING = new Set(['fbp', 'fbc', 'gclid', 'ttclid', '_ga', 'gaClientId', 'fbclid', '_ttp']);

/**
 * Synthesize a Meta `fbc` cookie value from a `fbclid` URL parameter (Meta's
 * documented format: `fb.1.<firstObservedAt milliseconds>.<fbclid>` — the
 * creationTime is MILLISECONDS since epoch, matching Meta's own cookie
 * writer; a seconds value triggers Meta's "do not modify creationTime"
 * diagnostic). A fbclid that is already in `fb.…` format (Meta sometimes
 * passes the full cookie value) is passed through verbatim — never
 * double-wrapped, never lowercased, never re-timestamped.
 *
 * The timestamp should be when EcoMate FIRST observed the fbclid (the browser
 * sets the cookie once at landing, so its Date.now() is first-observed by
 * construction). Server-side synthesis is a last-resort fallback when no
 * cookie/context value exists — callers must prefer an existing value first.
 */
export function synthesizeFbc(fbclid: string, nowMs = Date.now()): string {
  const value = fbclid.trim();
  if (!value) return '';
  if (value.startsWith('fb.')) return value;
  return `fb.1.${Math.floor(nowMs)}.${value}`;
}

export function mergeContext(
  existing: ContextMerged | null,
  incoming: ContextInput,
): ContextMerged {
  const out: ContextMerged = {
    identifiers: structuredClone(existing?.identifiers) ?? {},
    url: existing?.url,
    referrer: existing?.referrer,
  };
  const now = new Date().toISOString();

  for (const [provider, keys] of Object.entries(incoming.identifiers ?? {})) {
    if (typeof keys !== 'object' || keys === null) continue; // guard: non-object iterates as chars
    out.identifiers[provider] = out.identifiers[provider] ?? {};
    for (const [key, value] of Object.entries(keys)) {
      if (typeof value !== 'string' || !value) continue; // empty never clears
      const prev = out.identifiers[provider][key];
      if (!prev) {
        out.identifiers[provider][key] = { value, firstSeenAt: now, lastSeenAt: now };
      } else if (ROTATING.has(key) && prev.value !== value) {
        out.identifiers[provider][key] = { value, firstSeenAt: prev.firstSeenAt, lastSeenAt: now };
      }
      // static ids: first non-empty wins
    }
  }

  if (incoming.url) out.url = incoming.url;
  if (incoming.referrer) out.referrer = incoming.referrer;
  return out;
}
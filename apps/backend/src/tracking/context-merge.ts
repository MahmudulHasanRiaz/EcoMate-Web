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
const ROTATING = new Set(['fbp', 'fbc', 'gclid', 'ttclid', '_ga', 'fbclid', '_ttp']);

export function mergeContext(
  existing: ContextMerged | null,
  incoming: ContextInput,
): ContextMerged {
  const out: ContextMerged = {
    identifiers: existing?.identifiers ?? {},
    url: existing?.url,
    referrer: existing?.referrer,
  };
  const now = new Date().toISOString();

  for (const [provider, keys] of Object.entries(incoming.identifiers ?? {})) {
    out.identifiers[provider] = out.identifiers[provider] ?? {};
    for (const [key, value] of Object.entries(keys)) {
      if (!value) continue; // empty never clears
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
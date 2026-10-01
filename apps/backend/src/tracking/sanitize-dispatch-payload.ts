/**
 * Sanitized + bounded snapshot of a provider-bound payload.
 *
 * This is NOT the exact wire payload. A denylist alone is not enough, so the
 * walker enforces explicit structural bounds and REPORTS what it did:
 * `truncated` tells the caller the snapshot is incomplete, and `redactedPaths`
 * tells it what was removed without revealing the value.
 *
 * Presenting a silently-cut payload as though it were whole is its own form of
 * dishonesty, so the truncation state travels with the value everywhere.
 */

/** Documented limits. Changing these changes the stored shape's meaning. */
export const SANITIZE_LIMITS = {
  /** Max serialized bytes of the sanitized value. */
  MAX_SERIALIZED_BYTES: 64 * 1024,
  MAX_DEPTH: 8,
  MAX_ARRAY_LENGTH: 200,
  MAX_STRING_LENGTH: 2 * 1024,
  MAX_REDACTED_PATHS: 100,
} as const;

export const REDACTED = '[REDACTED]';
const TRUNCATION_MARKER = '…[truncated]';

/**
 * Key names that must never be persisted. Matched case-insensitively against
 * the whole key at any depth.
 */
const SECRET_KEY_PATTERN =
  /^(access_?token|refresh_?token|api_?key|api_?secret|secret|secret_?key|password|passwd|authorization|auth|client_?secret|app_?secret|appsecret|cookie|set_?cookie|bearer|credential|credentials|private_?key|signing_?key|signature|session_?token|webhook_?secret|business_?verification_?token)$/i;

/**
 * Substrings that mark a credential-shaped key even when the exact name is not
 * in the list above. Broader than the exact list on purpose: a provider that
 * nests a token under `meta_access_token` or `pixel_credentials` must still be
 * caught, and a false positive here only redacts a value we would not want to
 * store in a debugging artifact anyway.
 */
const SECRET_KEY_SUBSTRING =
  /(pass(word|wd)?|secret|token|api_?key|credential|private_?key|signature|authorization|cookie)/i;

export interface SanitizeResult<T = unknown> {
  value: T;
  /** True when any structural or size bound was hit. */
  truncated: boolean;
  /** Dotted paths of removed values. Capped, with a marker entry when capped. */
  redactedPaths: string[];
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key) || SECRET_KEY_SUBSTRING.test(key);
}

export function sanitizeDispatchPayload(input: unknown): SanitizeResult {
  const redactedPaths: string[] = [];
  let truncated = false;
  let pathCount = 0;

  const noteRedaction = (path: string) => {
    pathCount += 1;
    if (redactedPaths.length < SANITIZE_LIMITS.MAX_REDACTED_PATHS) redactedPaths.push(path);
  };
  const noteTruncation = () => {
    truncated = true;
  };

  const walk = (node: unknown, depth: number, path: string): unknown => {
    if (depth > SANITIZE_LIMITS.MAX_DEPTH) {
      noteTruncation();
      return TRUNCATION_MARKER;
    }

    if (node === null || node === undefined) return node ?? null;

    if (typeof node === 'string') {
      if (node.length > SANITIZE_LIMITS.MAX_STRING_LENGTH) {
        noteTruncation();
        return node.slice(0, SANITIZE_LIMITS.MAX_STRING_LENGTH) + TRUNCATION_MARKER;
      }
      return node;
    }

    if (typeof node === 'number' || typeof node === 'boolean') return node;
    if (typeof node === 'bigint') return node.toString();
    if (typeof node === 'function' || typeof node === 'symbol') return null;

    if (Array.isArray(node)) {
      const sliced = node.slice(0, SANITIZE_LIMITS.MAX_ARRAY_LENGTH);
      if (node.length > sliced.length) noteTruncation();
      return sliced.map((item, i) => walk(item, depth + 1, `${path}[${i}]`));
    }

    if (typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key;
        if (isSecretKey(key)) {
          noteRedaction(childPath);
          out[key] = REDACTED;
          continue;
        }
        out[key] = walk(value, depth + 1, childPath);
      }
      return out;
    }

    return String(node);
  };

  let value = walk(input, 0, '') as unknown;

  // Size is computed AFTER redaction, so a secret can never be revealed by the
  // size check overshooting into a partially-serialised structure.
  const checkSize = () => {
    const json = JSON.stringify(value) ?? '';
    if (Buffer.byteLength(json, 'utf8') > SANITIZE_LIMITS.MAX_SERIALIZED_BYTES) {
      noteTruncation();
      return false;
    }
    return true;
  };

  if (!checkSize()) {
    // Halve until it fits. Bounded so a pathological payload cannot loop.
    for (let i = 0; i < 12 && !checkSize(); i++) {
      if (Array.isArray(value)) {
        value = value.slice(0, Math.floor(value.length / 2));
      } else if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        const keep = Math.max(1, Math.floor(entries.length / 2));
        value = Object.fromEntries(entries.slice(0, keep));
      } else {
        break;
      }
    }
  }

  if (redactedPaths.length >= SANITIZE_LIMITS.MAX_REDACTED_PATHS) {
    redactedPaths.push(`…[${pathCount - SANITIZE_LIMITS.MAX_REDACTED_PATHS} more removed]`);
  }

  return { value, truncated, redactedPaths };
}

/**
 * Normalize a stored payloadSnapshot for presentation.
 *
 * Defence in depth: the dispatcher always writes an already-sanitized value,
 * but a row written by an older build, a manual repair, or an import could hold
 * something else. Re-sanitizing means a secret cannot reach the UI merely
 * because it was already sitting in the database when we read it.
 */
export function sanitizeStoredPayload(stored: unknown): SanitizeResult | null {
  if (stored === null || stored === undefined) return null;
  // Already in the {value, truncated, redactedPaths} wrapper — re-run on the
  // value so a hand-edited or legacy row is still cleaned.
  if (typeof stored === 'object' && !Array.isArray(stored) && 'value' in (stored as any)) {
    const wrapper = stored as SanitizeResult;
    const out = sanitizeDispatchPayload(wrapper.value);
    return {
      value: out.value,
      truncated: wrapper.truncated === true || out.truncated,
      redactedPaths: [
        ...(wrapper.redactedPaths ?? []),
        ...out.redactedPaths,
      ].slice(0, SANITIZE_LIMITS.MAX_REDACTED_PATHS),
    };
  }
  return sanitizeDispatchPayload(stored);
}

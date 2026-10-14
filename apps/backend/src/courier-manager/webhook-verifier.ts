import * as crypto from 'node:crypto';

/**
 * Constant-time string comparison that never throws on length mismatch
 * (timingSafeEqual requires equal-length buffers — pad via length check
 * that still runs in constant time relative to the inputs).
 */
export function timingSafeEqualText(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Task 4: verify HMAC-SHA256 over the RAW request body bytes.
 *
 * The HMAC input MUST be the exact bytes the courier signed — never
 * JSON.stringify(body): re-serialization changes key order/whitespace and
 * breaks (or, worse, could be coerced into accepting) verification.
 * Callers pass the stashed raw body captured by the preParsing hook
 * (WebhookRawBodyCapture); tests may pass the literal sent bytes.
 *
 * Throws '…not configured' when no secret is set (caller maps to
 * accept-with-warning, never 401) and 'Invalid webhook signature' for
 * every other failure (caller maps to 401).
 */
export function verifyRawHmacSha256Hex(
  rawBody: string | Buffer | undefined,
  signature: unknown,
  webhookSecret: string | undefined,
  opts?: { missingSecretMessage?: string },
): void {
  if (!webhookSecret) {
    // Safe to log server-side only — never expose to the caller directly.
    throw new Error(opts?.missingSecretMessage || 'Webhook secret not configured');
  }

  // Accept as unknown; require exactly a non-empty string.
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new Error('Invalid webhook signature');
  }

  // Must be exactly 64 hex characters (HMAC-SHA256 hex output).
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) {
    throw new Error('Invalid webhook signature');
  }

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(typeof rawBody === 'string' || Buffer.isBuffer(rawBody) ? rawBody : '')
    .digest(); // raw Buffer, not hex

  const sigBuf = Buffer.from(signature, 'hex');

  // Both are now 32-byte buffers. timingSafeEqual requires equal length,
  // but our hex pattern check guarantees 64 hex chars = 32 bytes, and
  // SHA-256 HMAC always produces 32 bytes.
  if (!crypto.timingSafeEqual(sigBuf, expected)) {
    throw new Error('Invalid webhook signature');
  }
}

/**
 * Legacy wrapper kept for backwards compatibility (pinned by
 * batch2-repaired.spec.ts). Signs JSON.stringify(body) — new code MUST use
 * verifyRawHmacSha256Hex with the exact raw request bytes instead.
 * @deprecated Use verifyRawHmacSha256Hex(rawBody, signature, secret).
 */
export function verifyRedxHmac(
  body: unknown,
  signature: unknown,
  webhookSecret: string | undefined,
): void {
  if (!webhookSecret) {
    throw new Error('RedX webhook not configured');
  }
  verifyRawHmacSha256Hex(JSON.stringify(body), signature, webhookSecret);
}

/**
 * Task 4: verbatim-secret comparison (Pathao / Carrybee).
 * These couriers send the merchant-registered secret itself in the header
 * (no HMAC per their docs) — compare in constant time so validity is not
 * leaked byte-by-byte. Same throw contract as verifyRawHmacSha256Hex.
 */
export function verifyVerbatimSecret(
  provided: string | undefined,
  expectedSecret: string | undefined,
  opts?: { missingSecretMessage?: string },
): void {
  if (!expectedSecret) {
    throw new Error(opts?.missingSecretMessage || 'Webhook secret not configured');
  }
  if (typeof provided !== 'string' || provided.length === 0) {
    throw new Error('Invalid webhook signature');
  }
  if (!timingSafeEqualText(provided, expectedSecret)) {
    throw new Error('Invalid webhook signature');
  }
}

import * as crypto from 'node:crypto';

/**
 * Verify a RedX webhook HMAC signature.
 *
 * The caller provides the signature as a raw string from the header.
 * This function:
 * 1. Rejects absent/empty secret or signature.
 * 2. Requires exactly 64 hex characters (32 bytes → 64 hex).
 * 3. Decodes both to 32-byte buffers for constant-time comparison.
 * 4. Compares with timingSafeEqual.
 *
 * JSON.stringify(body) must match the provider's signing input. The
 * actual signing-byte contract is unverified — see deployment gate.
 *
 * Error messages distinguish "not configured" (for safe server logging)
 * from "invalid" (mapped to a generic Unauthorized for the caller).
 *
 * @returns { valid: true } | throws Error
 */
export function verifyRedxHmac(
  body: unknown,
  signature: unknown,
  webhookSecret: string | undefined,
): void {
  if (!webhookSecret) {
    // Safe to log server-side only — never expose the error to caller directly
    throw new Error('RedX webhook not configured');
  }

  // Accept as unknown; require exactly a non-empty string
  if (typeof signature !== 'string' || signature.length === 0) {
    // Generic — don't leak what was missing
    throw new Error('Invalid webhook signature');
  }

  // Must be exactly 64 hex characters (HMAC-SHA256 hex output)
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) {
    throw new Error('Invalid webhook signature');
  }

  const payload = JSON.stringify(body);
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload, 'utf8')
    .digest(); // raw Buffer, not hex

  const sigBuf = Buffer.from(signature, 'hex');

  // Both are now 32-byte buffers. timingSafeEqual requires equal length,
  // but our hex pattern check guarantees 64 hex chars = 32 bytes, and
  // SHA-256 HMAC always produces 32 bytes.
  if (!crypto.timingSafeEqual(sigBuf, expected)) {
    throw new Error('Invalid webhook signature');
  }
}

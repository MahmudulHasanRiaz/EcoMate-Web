/**
 * Shared webhook HMAC helpers — central-commerce P2 (§8.7).
 *
 * One implementation for all three providers (WC base64, Shopify base64,
 * Custom hex) plus the timestamp replay window. The `__tests__/fixtures`
 * signing helpers delegate here so provider verification and fixture
 * signing can never drift apart.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export function hmacSha256Base64(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

export function hmacSha256Hex(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Length-mismatch-safe string comparison (never throws on length). */
export function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Case-insensitive single-value header read (first value wins for arrays). */
export function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) {
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

/**
 * Replay-window check (plan §8.7: 5-minute window where a timestamp is
 * supplied). `timestampHeader` is epoch seconds. Missing/unparseable →
 * invalid; caller decides the reason string.
 */
export function isTimestampFresh(
  timestampHeader: string | undefined,
  nowMs: number = Date.now(),
  windowMs: number = 5 * 60 * 1000,
): boolean {
  if (!timestampHeader) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs - ts * 1000) <= windowMs;
}

/** Fixture/test signing — WooCommerce delivery. */
export function signWooDelivery(secret: string, rawBody: Buffer): string {
  return hmacSha256Base64(secret, rawBody);
}

/** Fixture/test signing — Shopify delivery. */
export function signShopifyDelivery(secret: string, rawBody: Buffer): string {
  return hmacSha256Base64(secret, rawBody);
}

/**
 * Fixture/test signing — Custom bridge delivery. The signature covers
 * `deliveryId + '.' + timestamp + '.' + rawBody` so a signed payload
 * cannot be transplanted onto another delivery or replayed later.
 */
export function signCustomDelivery(
  secret: string,
  deliveryId: string,
  timestamp: string,
  rawBody: Buffer,
): string {
  return createHmac('sha256', secret)
    .update(`${deliveryId}.${timestamp}.`)
    .update(rawBody)
    .digest('hex');
}

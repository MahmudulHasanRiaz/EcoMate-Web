/**
 * P8 channel-model runtime flag (§9, §12).
 *
 * `newSalesChannelModelEnabled` gates every canonical-dimension READ behind
 * a fail-closed runtime flag (missing ⇒ off). Dual-write is unconditional
 * (both models are written in the same transaction from day one); only the
 * read path branches, so analytics numbers are byte-identical with the flag
 * off. Pure function over an explicit env record (unit-testable, no DB).
 */

export const NEW_SALES_CHANNEL_MODEL_KEY = 'NEW_SALES_CHANNEL_MODEL_ENABLED';

export function newSalesChannelModelEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[NEW_SALES_CHANNEL_MODEL_KEY] === 'true';
}

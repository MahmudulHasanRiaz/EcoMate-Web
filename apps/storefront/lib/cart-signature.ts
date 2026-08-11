/**
 * Material cart signature (spec §8 / D1 fix).
 *
 * Stable fingerprint of the logical checkout contents — content_ids set/order,
 * per-item quantities, and effective subtotal. Extracted as a pure helper so it
 * is unit-testable without a full component render.
 */
export function computeCartSignature(items: Array<{ id: string; quantity: number; price: number }>): string {
  const ids = items.map(i => i.id).join(',');
  const qtys = items.map(i => `${i.id}:${i.quantity}`).join('|');
  const value = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
  return `${ids}::${qtys}::${value.toFixed(2)}`;
}

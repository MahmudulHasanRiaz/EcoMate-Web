/**
 * Courier settlement source seam (§2.10.4, D11).
 *
 * No courier settlement / remittance / collected-cash model exists (F11), so
 * COD collection is genuinely unknowable today. Analytics reads COD
 * collection through this interface; the ONLY implementation shipped now is
 * UnavailableSettlementSource. When the courier settlement / CSV import is
 * built, a second adapter becomes the authoritative implementation — a single
 * wiring change, no metric redefinition. No settlement tables in P2.
 */
import { NO_COURIER_SETTLEMENT_SOURCE } from './metric-contract';

export type CollectionKind = 'online' | 'cod' | 'unknown';

/**
 * COD iff the order was placed cash-on-delivery. NULL/anything else that is
 * not an explicit online option is 'unknown' — never guessed online
 * (D11-strict: unknown collection is unavailable, not inferred).
 */
export function collectionKindOf(
  paymentOptionType?: string | null,
): CollectionKind {
  if (paymentOptionType === 'CASH_ON_DELIVERY') return 'cod';
  if (
    paymentOptionType === 'FULL_PAYMENT' ||
    paymentOptionType === 'PARTIAL_PAYMENT'
  ) {
    return 'online';
  }
  return 'unknown';
}

export interface CodCollection {
  state: 'unavailable';
  reason: typeof NO_COURIER_SETTLEMENT_SOURCE;
  amountCollected: null;
  amountRetained: null;
  deliveryChargeRetained: null;
  fulfillmentMargin: null;
}

export interface SettlementSource {
  /**
   * Authoritative collection figures for a COD order. Today: always
   * unavailable. The future settlement import implements actual figures here.
   */
  getCodCollection(order: { id: string }): CodCollection;
}

export class UnavailableSettlementSource implements SettlementSource {
  getCodCollection(_order: { id: string }): CodCollection {
    return {
      state: 'unavailable',
      reason: NO_COURIER_SETTLEMENT_SOURCE,
      amountCollected: null,
      amountRetained: null,
      deliveryChargeRetained: null,
      fulfillmentMargin: null,
    };
  }
}

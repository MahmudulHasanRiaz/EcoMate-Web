/**
 * Courier settlement source seam (§2.10.4, D11).
 *
 * COD collection is unknowable without a settlement document. This module
 * ships TWO implementations:
 *   - UnavailableSettlementSource — the honest default when no finalized
 *     courier settlement row backs an order.
 *   - ActualCodSettlement — the authoritative figures once a finalized
 *     Courier Settlement invoice exists (amountCollected/amountRetained/
 *     deliveryChargeRetained/fulfillmentMargin become `actual`).
 * Analytics reads COD collection through this interface; wiring a real
 * settlement changes the figures, never the metric definition.
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

/** Authoritative COD collection from a finalized settlement. */
export interface ActualCodCollection {
  state: 'actual' | 'partial';
  amountCollected: number;
  amountRetained: number;
  deliveryChargeRetained: number | null;
  fulfillmentMargin: number | null;
  reason?: string;
}

export type CodCollectionResult = CodCollection | ActualCodCollection;

export interface SettlementSource {
  /**
   * Authoritative collection figures for a COD order. The default is
   * `unavailable`; a wiring with finalized settlement rows returns actuals.
   */
  getCodCollection(order: { id: string }): CodCollectionResult;
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

/** Pre-loaded settlement figures for one order (superseded rows excluded). */
export interface OrderSettlementInput {
  /** Σ effectiveCollected over finalized non-superseded DATA rows. */
  collected: number;
  /** Σ effectiveCharges. */
  charges: number;
  /** Σ effectiveNet (signed). */
  net: number;
  /** signed codPosition = expectedCod − charges − net. */
  codPosition: number;
  /** Order.shippingCharge — claimed as DCR only when fully settled. */
  shippingCharge: number;
  /** true when at least one finalized settlement row exists. */
  hasFinalizedRow: boolean;
}

/**
 * Pure conversion of loaded settlement figures into the analytics shape.
 * `deliveryChargeRetained` is claimed (= Order.shippingCharge) ONLY when fully
 * settled (|codPosition| ≤ 0.01); otherwise it is `null` + state `partial`.
 */
export function actualCodSettlement(input: OrderSettlementInput): ActualCodCollection {
  const settled = Math.abs(input.codPosition) <= 0.01;
  const retained = round2(input.collected - input.charges);
  return {
    state: settled ? 'actual' : 'partial',
    amountCollected: round2(input.collected),
    amountRetained: round2(retained),
    deliveryChargeRetained: settled ? round2(input.shippingCharge) : null,
    fulfillmentMargin: settled ? round2(input.shippingCharge - input.charges) : null,
    reason: settled ? undefined : 'partially settled',
  };
}

function round2(n: number): number {
  return Math.round(((Number.isFinite(n) ? n : 0) + Number.EPSILON) * 100) / 100;
}
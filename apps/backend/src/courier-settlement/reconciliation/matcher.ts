// ── Row → Order/Dispatch matcher (PRD §9) — pure, index-driven.
//
// Matching is a lookup against pre-built maps (no query per row → no N+1).
// Resolution follows the provider descriptor's identifier order and records an
// explanation so the Reconciliation UI can show *how* a row was matched.
// An unresolved row is `NONE` → the RED `NO_MATCH` rule blocks finalization.
//
// LIMITATION (settlement-blind, Steadfast multi-account): this matcher is
// consignment-only and carries NO credential context — multi-business payout
// files share one ledger. A payout row matches by consignment/tracking/
// displayId only; it never records which Steadfast credential set booked the
// parcel (see SteadfastCredentialSetsService header). Do NOT add per-set
// filtering here without a credential-aware payout key.

import type { MatchMethod } from '../parsing/types';

export interface MatchIdentifier {
  rowNumber: number;
  consignmentId?: string | null;
  displayId?: string | null;
  trackingCode?: string | null;
}

export interface OrderRef {
  id: string;
}
export interface DispatchRef {
  id: string;
  orderId: string;
}

export interface MatchIndexes {
  dispatchByConsignment: Map<string, DispatchRef>;
  dispatchByTracking: Map<string, DispatchRef>;
  orderByDisplayId: Map<string, OrderRef>;
  orderByExternalId: Map<string, OrderRef>;
  orderByConsignment: Map<string, OrderRef>;
  orderByTracking: Map<string, OrderRef>;
}

export interface MatchResult {
  orderId?: string;
  dispatchId?: string;
  matchMethod: MatchMethod;
  matchContext: Record<string, unknown>;
}

export type IdentifierField = 'consignmentId' | 'displayId' | 'trackingCode' | 'orderId';

export function emptyIndexes(): MatchIndexes {
  return {
    dispatchByConsignment: new Map(),
    dispatchByTracking: new Map(),
    orderByDisplayId: new Map(),
    orderByExternalId: new Map(),
    orderByConsignment: new Map(),
    orderByTracking: new Map(),
  };
}

/**
 * Resolve one row. `identifierOrder` is the descriptor's declared precedence.
 * `dispatchByConsignment` is tried first because a dispatch binds a parcel to a
 * specific order; an order-level fallback is only used when no dispatch exists.
 */
export function matchRow(
  row: MatchIdentifier,
  identifierOrder: IdentifierField[],
  indexes: MatchIndexes,
): MatchResult {
  const order: IdentifierField[] =
    identifierOrder.length > 0 ? identifierOrder : ['consignmentId', 'displayId', 'trackingCode'];

  for (const field of order) {
    if (field === 'consignmentId' && row.consignmentId) {
      const key = norm(row.consignmentId);
      const dispatch = indexes.dispatchByConsignment.get(key);
      if (dispatch) {
        return {
          orderId: dispatch.orderId,
          dispatchId: dispatch.id,
          matchMethod: 'BY_CONSIGNMENT',
          matchContext: { field: 'consignmentId', value: row.consignmentId, via: 'dispatch' },
        };
      }
      const byOrder = indexes.orderByConsignment.get(key);
      if (byOrder) {
        return {
          orderId: byOrder.id,
          matchMethod: 'BY_CONSIGNMENT',
          matchContext: { field: 'consignmentId', value: row.consignmentId, via: 'order' },
        };
      }
    }

    if ((field === 'displayId' || field === 'orderId') && row.displayId) {
      const key = norm(row.displayId);
      const byDisplay = indexes.orderByDisplayId.get(key);
      if (byDisplay) {
        return {
          orderId: byDisplay.id,
          matchMethod: 'BY_ORDER_DISPLAYID',
          matchContext: { field: 'displayId', value: row.displayId },
        };
      }
      const byExternal = indexes.orderByExternalId.get(key);
      if (byExternal) {
        return {
          orderId: byExternal.id,
          matchMethod: 'BY_ORDER_EXTERNALID',
          matchContext: { field: 'displayId→externalOrderId', value: row.displayId },
        };
      }
    }

    if (field === 'trackingCode' && row.trackingCode) {
      const key = norm(row.trackingCode);
      const dispatch = indexes.dispatchByTracking.get(key);
      if (dispatch) {
        return {
          orderId: dispatch.orderId,
          dispatchId: dispatch.id,
          matchMethod: 'BY_TRACKING',
          matchContext: { field: 'trackingCode', value: row.trackingCode, via: 'dispatch' },
        };
      }
      const byOrder = indexes.orderByTracking.get(key);
      if (byOrder) {
        return {
          orderId: byOrder.id,
          matchMethod: 'BY_TRACKING',
          matchContext: { field: 'trackingCode', value: row.trackingCode, via: 'order' },
        };
      }
    }
  }

  return { matchMethod: 'NONE', matchContext: { attemptedOrder: order } };
}

/** Normalise a candidate identifier for map lookup (trim; case-insensitive). */
export function norm(value: string): string {
  return String(value).trim().toLowerCase();
}
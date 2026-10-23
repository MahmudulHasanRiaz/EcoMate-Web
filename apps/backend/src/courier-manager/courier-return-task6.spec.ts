import {
  mapCourierStatusToDispatchStatus,
  mapSteadfastReturnStatus,
} from './courier-status-mapper';

/**
 * Task 6 (Fix 13 §§17.1–17.3): the 6 Steadfast return statuses
 * (GET /status_with_return_status_by_cid vocabulary, doc §"Return statuses").
 *
 * Sheet rows 39–44, doc order:
 *   39 partial_delivered_return_proccessing (doc-literal spelling)
 *   40 partial_delivered_return_rider_assigned
 *   41 partial_delivered_return_received
 *   42 cancelled_return_proccessing (doc-literal spelling)
 *   43 cancelled_return_rider_assigned
 *   44 cancelled_return_received
 * (+ the corrected `..._processing` spellings, accepted alongside the
 * doc-literal `..._proccessing` ones).
 *
 * Owner-locked outcomes:
 * - Rows 39–40 → dispatch RETURN_PENDING + order Partial, BOTH maps (the
 *   parcel is on its way back — no longer a plain PARTIAL hold; the order
 *   keeps its Partial outcome, never Delivered).
 * - Row 44 → dispatch RETURN_PENDING (sheet Rule 2/25: never RETURNED on a
 *   courier signal) + order 'Return Pending' (the parcel is back; the order
 *   must surface for staff confirmation). The Return STAGE becomes DELIVERED.
 * - Rows 41–43 → verified + locked (unchanged).
 * - Stock ONLY on *_received. COD always false (no return status ever settles).
 */
describe('Task 6 — 6 Steadfast return statuses (Fix 13)', () => {
  describe('rows 39–40: partial in-progress → RETURN_PENDING + Partial (BOTH maps)', () => {
    it.each([
      'partial_delivered_return_proccessing',
      'partial_delivered_return_processing',
      'partial_delivered_return_rider_assigned',
    ])('return map: %s → RETURN_PENDING + Partial, no stock, no COD', (label) => {
      expect(mapSteadfastReturnStatus(label)).toEqual(
        expect.objectContaining({
          dispatchStatus: 'RETURN_PENDING',
          advanceOrder: 'Partial',
          reconcileStock: false,
          codOwed: false,
        }),
      );
    });

    it.each([
      'partial_delivered_return_proccessing',
      'partial_delivered_return_processing',
      'partial_delivered_return_rider_assigned',
    ])('tracking map: %s → RETURN_PENDING', (label) => {
      expect(mapCourierStatusToDispatchStatus('steadfast', label)).toBe('RETURN_PENDING');
    });
  });

  describe('row 44: cancelled_return_received → RETURN_PENDING + Return Pending', () => {
    it('return map advances the order to Return Pending (was null)', () => {
      expect(mapSteadfastReturnStatus('cancelled_return_received')).toEqual(
        expect.objectContaining({
          dispatchStatus: 'RETURN_PENDING',
          advanceOrder: 'Return Pending',
          reconcileStock: true,
          codOwed: false,
        }),
      );
    });

    it('tracking map caps at RETURN_PENDING (RETURNED is staff-only)', () => {
      expect(mapCourierStatusToDispatchStatus('steadfast', 'cancelled_return_received')).toBe(
        'RETURN_PENDING',
      );
    });
  });

  describe('rows 41–43: verified + locked', () => {
    it('partial received stays PARTIAL + Partial + stock, no COD', () => {
      expect(mapSteadfastReturnStatus('partial_delivered_return_received')).toEqual(
        expect.objectContaining({
          dispatchStatus: 'PARTIAL',
          advanceOrder: 'Partial',
          reconcileStock: true,
          codOwed: false,
        }),
      );
      expect(
        mapCourierStatusToDispatchStatus('steadfast', 'partial_delivered_return_received'),
      ).toBe('PARTIAL');
    });

    it.each(['cancelled_return_proccessing', 'cancelled_return_processing', 'cancelled_return_rider_assigned'])(
      'cancelled in-progress %s stays RETURN_PENDING + Return Pending, no stock, no COD',
      (label) => {
        expect(mapSteadfastReturnStatus(label)).toEqual(
          expect.objectContaining({
            dispatchStatus: 'RETURN_PENDING',
            advanceOrder: 'Return Pending',
            reconcileStock: false,
            codOwed: false,
          }),
        );
      },
    );
  });

  describe('COD is false and stock is received-only across all six', () => {
    const allSix = [
      'partial_delivered_return_proccessing',
      'partial_delivered_return_processing',
      'partial_delivered_return_rider_assigned',
      'partial_delivered_return_received',
      'cancelled_return_proccessing',
      'cancelled_return_processing',
      'cancelled_return_rider_assigned',
      'cancelled_return_received',
    ];
    it.each(allSix)('%s never settles (codOwed false)', (label) => {
      expect(mapSteadfastReturnStatus(label)).toEqual(
        expect.objectContaining({ codOwed: false }),
      );
    });

    it('only the two *_received labels reconcile stock', () => {
      const withStock = allSix.filter((l) => mapSteadfastReturnStatus(l)?.reconcileStock);
      expect(withStock.sort()).toEqual(
        ['cancelled_return_received', 'partial_delivered_return_received'].sort(),
      );
    });
  });
});

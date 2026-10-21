/**
 * Scan purpose registry — typed application-level registry (NOT a dynamic
 * database plugin system). Each purpose declares its label, identifier
 * requirements, resolution strategy, eligibility validation, execution
 * handler and result formatting. A future purpose (e.g. a new print flow)
 * is added by writing another handler class and registering it in the
 * module — the engine never changes.
 */

export type ScanPurposeId =
  | 'DISPATCH_HANDED_OVER'
  | 'DISPATCH_RETURN'
  | 'ORDER_STATUS'
  | 'STICKER_PRINT'
  | 'RETURN_RECEIVE';

export interface ScanActor {
  userId: string;
  email: string;
}

export interface DispatchPreview {
  id: string;
  courier: string;
  consignmentId: string;
  trackingCode: string | null;
  status: string;
  orderId: string;
  orderDisplayId: string;
  orderStatus: string;
  orderKind: string;
  /** Immutable order-time customer snapshot (first+last, else guest, else Guest). */
  customerName: string;
  /** Snapshot phone (else guest phone, else empty) — shown when the name is Guest. */
  customerPhone: string;
  /** Sum of order line quantities (units). */
  itemCount: number;
  /** Order grand total (already fetched on the order row — no extra query). */
  orderTotal: number;
  /** Order line previews from the SAME fetched order row (capped). */
  items?: ScanItemPreview[];
  /** Stage-time validation for DISPATCH_RETURN (false → attention row). */
  processable?: boolean;
  reason?: string | null;
}

/**
 * One cheap line preview for staged-row expansion. Rides on rows already
 * fetched by the resolver / purpose — never an extra request per expand.
 */
export interface ScanItemPreview {
  productId?: string;
  variantId?: string | null;
  name: string;
  /** "Color: Red, Size: XL" — mirrors the admin variantLabel helper. */
  variantLabel?: string;
  sku?: string | null;
  image?: string | null;
  quantity: number;
  /** Maximum confirmable quantity (return line / order line). */
  maxQuantity?: number;
  price?: number;
  /** Units already known to be damaged (return legs). */
  damagedQuantity?: number;
}

export interface OrderPreview {
  id: string;
  displayId: string;
  status: string;
  kind: string;
  allowedStatuses: { id: string; name: string }[];
  /** Immutable order-time customer snapshot (first+last, else guest, else Guest). */
  customerName: string;
  /** Snapshot phone (else guest phone, else empty) — shown when the name is Guest. */
  customerPhone: string;
  /** Sum of order line quantities (units). */
  itemCount: number;
  /** Order grand total (already fetched on the order row — no extra query). */
  orderTotal: number;
  /**
   * Line-item previews (name/sku/variantLabel/image/qty/price) mapped from the
   * SAME fetched order row — staging rows expand into these with zero extra
   * requests (capped, cheap, from the resolver's existing include).
   */
  items?: ScanItemPreview[];
}

export interface ResolveOutcome {
  status: 'resolved' | 'selection_required' | 'not_found';
  identifier: string;
  message?: string;
  dispatches: DispatchPreview[];
  order: OrderPreview | null;
  /**
   * Hardening (3): linked returns/exchanges for an order barcode. Exactly
   * one → the receiver; several → the phase-2 picker list; absent on
   * not_found. The order itself is never a candidate — it is never marked.
   */
  linked?: ScanLinkedCandidate[];
}

/** One linked return or exchange leg offered to the phase-2 picker/staging. */
export interface ScanLinkedCandidate {
  kind: 'return' | 'exchange';
  /**
   * Operator-facing plain kind for the picker: a Return row of type EXCHANGE
   * keeps `kind: 'return'` (receive path with damage controls) but is
   * labelled "Exchange RTN-…". Absent → derives from `kind`.
   */
  labelKind?: 'return' | 'exchange';
  id: string;
  displayId: string;
  status: string;
  /** Original order display id (return rows) — staged rows link back. */
  orderDisplayId?: string;
  /** Σ returned units for this leg; "covers X" / Σ order lines ("of Y"). */
  coversUnits?: number;
  orderUnits?: number;
  /** Returned-goods previews (return legs) or exchange-order previews (exchange legs). */
  items?: ScanItemPreview[];
  /** Headline item image (first returned line) for the compact staged row. */
  image?: string | null;
  /** Stage-time validation: false → the operator should see the reason BEFORE processing. */
  processable?: boolean;
  reason?: string | null;
  /** False when the courier left Return.items empty — staff confirm quantities now. */
  itemsConfirmed?: boolean;
}

export type ScanResultStatus = 'success' | 'warning' | 'error' | 'duplicate';

export interface ScanResult {
  status: ScanResultStatus;
  identifier: string;
  title: string;
  message: string;
  courier?: string;
  oldState?: string;
  newState?: string;
  details?: Record<string, any>;
}

export interface ScanPurposeHandler {
  readonly purpose: ScanPurposeId;
  readonly label: string;
  readonly description: string;
  /** Preview/selection phase — NEVER mutates. */
  resolve(identifier: string): Promise<ResolveOutcome>;
  /** Execution phase — eligibility-validated, idempotent, audited. */
  execute(
    params: {
      identifier: string;
      dispatchId?: string;
      orderId?: string;
      targetStatusId?: string;
      returnId?: string;
      exchangeId?: string;
      items?: Array<{
        productId: string;
        variantId?: string | null;
        quantity: number;
        damagedQuantity?: number;
      }>;
    },
    actor: ScanActor,
  ): Promise<ScanResult>;
}

export interface ScanPurposeDescriptor {
  purpose: ScanPurposeId;
  label: string;
  description: string;
}

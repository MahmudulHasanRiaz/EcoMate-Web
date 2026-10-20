import { apiClient } from '@/lib/api-client'

export interface OrderResponse {
  id: string; displayId: string; customerId?: string | null; statusId: string;
  warnings?: string[];
  kind?: 'SALE' | 'RETURN' | 'EXCHANGE';
  /** Badge flags from the list response (server-counted, no extra fetches). */
  hasActiveReturn?: boolean;
  activeReturnCount?: number;
  hasActiveExchange?: boolean;
  activeExchangeCount?: number;
  /** Exchange scope decided at creation (FULL/PARTIAL); null = unknown. */
  exchangeScope?: string | null;
  returnOfOrderId?: string | null;
  returnOfOrder?: { id: string; displayId: string; status: { id: string; name: string } } | null;
  exchangeOfOrderId?: string | null;
  exchangeOfOrder?: { id: string; displayId: string } | null;
  returnedAt?: string | null;
  stockRestored?: boolean;
  subtotal: number | string; shippingCharge: number | string; discount: number | string;
  discountType: string; total: number | string;
  /** Server-derived: received returns value + shared due formula. */
  receivedReturnValue?: number | string | null;
  due?: number | string | null;
  shippingAddress: any; customerNotes?: string | null; officeNotes?: string | null; timeline: any[];
  courierService?: string | null; courierStatus?: string | null;
  courierTrackingCode?: string | null; courierConsignmentId?: string | null;
  trackingUrl?: string | null;
  assignedToId?: string | null; assignedAt?: string | null;
  assignee?: { id: string; firstName: string; lastName: string } | null;
  guestName?: string | null;
  guestPhone?: string | null;
  secondaryPhone?: string | null;
  /** Order-time customer snapshot (D-A source of truth; also mirrored into `customer` by GET). */
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  viewToken?: string | null;
  paymentMethod?: string | null;
  paymentMode?: string | null;
  paymentOptionType?: 'FULL_PAYMENT' | 'PARTIAL_PAYMENT' | 'CASH_ON_DELIVERY' | null;
  paymentStatus?: 'PAYMENT_PENDING' | 'PENDING' | 'PAID' | 'PARTIAL_PAID' | 'UNPAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | null;
  partialAmount?: number | string | null;
  dispatchLogs?: {
    id: string; courier: string; status: string; message?: string | null;
    consignmentId?: string | null; trackingCode?: string | null;
    createdAt: string;
  }[];
  dispatches?: {
    id: string;
    courier: string;
    consignmentId: string | null;
    trackingCode: string | null;
    trackingUrl?: string | null;
    status: string;
    productMapping: any;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  selectedShippingOptionId?: string | null;
  shippingChargeOverridden?: boolean;
  /** Actual fulfillment/courier cost (BDT). null = not recorded. */
  shippingCost?: number | string | null;
  /** 'manual' (actual) | 'courier_default' (estimated). */
  shippingCostSource?: string | null;
  salesChannel?: string | null;
  sourcePlatform?: string | null;
  sourceType?: string | null;
  sourceEntity?: string | null;
  // ── Canonical sales-attribution dimensions ──────────────────────────────
  // Four independent facts. `channelMappedAt` is a migration marker and is
  // deliberately NOT exposed to the client.
  channel?: string | null;
  channelEntity?: string | null;
  sourceSlug?: string | null;
  acquisitionType?: string | null;
  /** Joined display name for `sourceSlug`, resolved from the registry. */
  sourcePlatformName?: string | null;
  trashedAt?: string | null;
  createdAt: string; updatedAt: string;
  customer: { id: string; firstName: string; lastName: string; email: string; phoneNumber: string; name?: string; phone?: string } | null;
  status: { id: string; name: string; color: string; nextStatuses: string[] };
  items: { id: string; productId: string; variantId?: string | null; quantity: number; price: number | string; product: { id: string; name: string; images: any; slug?: string } }[];
  /** Append-only payment ledger rows (Task 11: account/actor/recordedAt). */
  payments: {
    id: string; method?: string; gatewayCode?: string; amount: number | string; status: string;
    transactionId?: string | null; account?: string | null;
    recordedBy?: string | null; submittedBy?: string | null; recordedAt?: string | null;
    verifiedBy?: string | null; verifiedAt?: string | null; notes?: string | null;
    createdAt?: string;
  }[];
  shipment?: { id: string; trackingNo?: string | null; courier?: string | null; status: string } | null;
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
    statusCounts?: Record<string, number>
  }
}

export interface RtnOrderPreview {
  id: string
  displayId: string
  status: string
  itemCount: number
}

export interface RtnOrderResponse {
  id: string
  displayId: string
  status: { id: string; name: string; color: string }
  returnOfOrderId: string | null
  returnOfOrder: { id: string; displayId: string; status: { id: string; name: string } } | null
  items: { id: string; productId: string; variantId?: string | null; comboId?: string | null; quantity: number; price: number | string; product: { id: string; name: string; sku?: string } | null; variant?: { id: string; sku?: string } | null; combo?: { id: string; name: string } | null }[]
  returnedAt: string | null
  stockRestored: boolean
  createdAt: string
  updatedAt: string
}

export interface ScanPurposeDescriptor {
  purpose: 'DISPATCH_HANDED_OVER' | 'DISPATCH_RETURN' | 'ORDER_STATUS' | 'STICKER_PRINT' | 'RETURN_RECEIVE'
  label: string
  description: string
}

/** One cheap line preview for staged-row expansion (mirrors the backend
 *  scanner): rides on rows already fetched by resolve — never an extra
 *  request per expand. */
export interface ScanItemPreview {
  name: string
  /** "Color: Red, Size: XL" — mirrors the admin variantLabel helper. */
  variantLabel?: string
  sku?: string | null
  image?: string | null
  /** Units on this line. */
  quantity: number
  price?: number
}

export interface ScanDispatchPreview {
  id: string
  courier: string
  consignmentId: string | null
  trackingCode: string | null
  status: string
  orderId: string
  orderDisplayId: string
  orderStatus: string
  orderKind: string
  customerName: string
  customerPhone: string
  itemCount: number
  orderTotal: number
  /** Order line previews from the SAME fetched order row (capped). */
  items?: ScanItemPreview[]
}

export interface ScanOrderPreview {
  id: string
  displayId: string
  status: string
  kind: string
  allowedStatuses: { id: string; name: string }[]
  customerName: string
  customerPhone: string
  itemCount: number
  orderTotal: number
  /** Line-item previews mapped from the SAME fetched order row — staged rows
   *  expand into these with zero extra requests. */
  items?: ScanItemPreview[]
}

export interface ScanLinkedCandidate {
  kind: 'return' | 'exchange'
  id: string
  displayId: string
  status: string
  /** Original order display id (return rows) — staged rows link back. */
  orderDisplayId?: string
  /** Σ returned units for this leg; "covers X" / Σ order line units ("of Y"). */
  coversUnits?: number
  orderUnits?: number
  /** Returned-goods previews (return legs) or exchange-order previews. */
  items?: ScanItemPreview[]
  /** Headline item image (first returned line) for the compact staged row. */
  image?: string | null
  /** Stage-time validation: false → the operator sees the reason BEFORE processing. */
  processable?: boolean
  reason?: string | null
}

export interface ScanResolveOutcome {
  status: 'resolved' | 'selection_required' | 'not_found'
  identifier: string
  message?: string
  dispatches: ScanDispatchPreview[]
  order: ScanOrderPreview | null
  /** Linked returns/exchanges for an order barcode (RETURN_RECEIVE). */
  linked?: ScanLinkedCandidate[]
}

export interface ScanResult {
  status: 'success' | 'warning' | 'error' | 'duplicate'
  identifier: string
  title: string
  message: string
  courier?: string
  oldState?: string
  newState?: string
  details?: Record<string, any>
}

export type OthersFieldState =
  | 'present'
  | 'missing'
  | 'not_collected'
  | 'not_applicable'
  | 'null';

export interface OthersField {
  key: string;
  label: string;
  value: unknown;
  state: OthersFieldState;
  group?: string;
}

export interface OthersDiffRow {
  key: string;
  label: string;
  snapshotValue: unknown;
  currentValue: unknown;
}

export interface CustomerAddressView {
  id: string;
  type: 'SHIPPING' | 'BILLING';
  label: string | null;
  isDefault: boolean;
  fullName: string;
  phone: string;
  addressLine: string;
  area: string | null;
  thana: string | null;
  district: string | null;
  division: string | null;
  postalCode: string | null;
  country: string;
  sourceOrderId: string | null;
  createdAt: string;
}

/**
 * Delivery evidence for one (provider, destination) pair.
 *
 * `attempts` (attempt-level, increments on retry) and `dispatched`
 * (row-level, always 0 or 1) are deliberately separate axes. There is
 * deliberately NO `attempts - accepted` field: attempts is a counter and
 * accepted is a row-level outcome, so subtracting them produces a number with
 * no meaning.
 */
export interface DispatchRow {
  provider: string;
  destinationId: string;
  pixelId: string | null;
  status: string;
  dispatched: 0 | 1;
  attempts: number;
  accepted: 0 | 1;
  rejected: 0 | 1;
  unknown: 0 | 1;
  acceptanceBasis: 'accepted' | 'rejected' | 'http_accepted' | 'unknown';
  failed: 0 | 1;
  skipped: 0 | 1;
  /** Attempt-level, a different axis from the row counts. NULL when the
   *  transition log has been purged — NOT 0, which would falsely imply that
   *  no attempt ever failed. */
  failedAttempts: number | null;
  failedAttemptsAvailable: boolean;
  httpStatus: number | null;
  providerEventId: string | null;
  errorMsg: string | null;
  lastAttemptAt: string;
}

export interface SanitizedPayload {
  value: unknown;
  truncated: boolean;
  redactedPaths: string[];
}

export interface PurchaseEventView {
  eventId: string;
  eventType: string;
  eventTime: string;
  actionSource: string | null;
  triggerMode: string | null;
  acceptanceColumnLabel: string;
  dispatches: DispatchRow[];
  outbox: { dead: number };
  timeline: {
    at: string;
    provider: string | null;
    fromStatus: string | null;
    toStatus: string;
    attempt: number | null;
    message: string | null;
  }[];
  transitionLogAvailable: boolean;
  payloadCaptured: unknown;
  payloadSent: (SanitizedPayload & { provider: string; destinationId: string })[];
  coverage: { field: string; value: string | null; state: 'present' | 'missing' }[];
}

export interface OrderOthersInfoResponse {
  orderId: string;
  displayId: string;
  createdAt: string;
  retention: {
    transitionLogAvailable: boolean;
    transitionLogPurgeDays: number;
    dispatchRetentionDays: number;
  };
  sections: {
    snapshot: OthersField[];
    customerProfile: OthersField[];
    device: OthersField[];
    attributionRaw: OthersField[];
    attributionResolved: OthersField[];
    trackingIdentifiers: OthersField[];
  };
  customerProfile: ({
    id: string;
    name: string;
    phone: string;
    email: string | null;
    createdAt: string;
    lastOrderAt: string | null;
    lastOrderIp: string | null;
    lastOrder: { displayId: string; createdAt: string; total: unknown } | null;
    addresses: CustomerAddressView[];
    fieldDiffs: OthersDiffRow[];
  } | null);
  purchase: { events: PurchaseEventView[] };
  raw: unknown;
  rawMeta: { truncated: boolean; redactedPaths: string[] };
}

export interface CodMismatchAlert {
  id: string
  orderId: string
  courier: string
  consignmentId: string
  courierAmount: number | string
  systemDue: number | string
  status: 'open' | 'resolved' | 'cleared'
  resolvedBy?: string | null
  resolvedAt?: string | null
  createdAt: string
  updatedAt?: string
}

export const codAlertsApi = {
  list: (orderId: string) =>
    apiClient.get<CodMismatchAlert[]>(`/orders/${orderId}/cod-alerts`).then(r => r.data),
  resolve: (orderId: string, alertId: string) =>
    apiClient.post(`/orders/${orderId}/cod-alerts/${alertId}/resolve`).then(r => r.data),
}

export const ordersApi = {
  list: (query?: any) => apiClient.get<PaginatedResponse<OrderResponse>>('/orders', { params: query }),  get: (id: string) => apiClient.get<OrderResponse>(`/orders/${id}`),
  /**
   * Others Information — order snapshot, current customer profile, device /
   * request context, raw + resolved attribution, tracking identifiers and
   * Purchase delivery evidence.
   *
   * Access is `superadmin` + `admin` only; managers are rejected by the API,
   * not merely hidden in the UI.
   */
  othersInfo: (id: string) => apiClient.get<OrderOthersInfoResponse>(`/orders/${id}/others-info`),
  create: (data: any) => apiClient.post<OrderResponse>('/orders', data),
  updateOrder: (id: string, data: any) => apiClient.put<OrderResponse>(`/orders/${id}`, data),
  updateStatus: (id: string, statusId: string, note?: string) => apiClient.put(`/orders/${id}/status`, { statusId, note }),
  addNote: (orderId: string, note: string, visibility: 'public' | 'private') => apiClient.post(`/orders/${orderId}/note`, { note, visibility }),
  addItem: (orderId: string, data: { productId: string; quantity: number; price: number; variantId?: string }) => apiClient.post(`/orders/${orderId}/items`, data),
  removeItem: (orderId: string, itemId: string) => apiClient.delete(`/orders/${orderId}/items/${itemId}`),
  bulkAssign: (ids: string[], assignedToId: string | null) => apiClient.post('/orders/bulk/assign', { ids, assignedToId }),
  rotateViewToken: (orderId: string) => apiClient.post<{ id: string; viewToken: string; displayId: string }>(`/orders/${orderId}/rotate-view-token`),
  /**
   * Task 5 (Fix 9, Rule 15): staff-partial flow — creates Return(PARTIAL,
   * items) + moves the order to Partial (or Delivered with instantDelivery),
   * dispatch UNCHANGED. Replaces the direct /returns POST for the Plus-menu
   * partial entry (T4 rows are adopted as-is, same record shape).
   */
  createStaffPartialReturn: (id: string, data: {
    items: { productId: string; variantId?: string | null; quantity: number }[]
    reason?: string
    instantDelivery?: boolean
  }) => apiClient.post<{ return: ReturnRecord; order: OrderResponse }>(`/orders/${id}/staff-partial-return`, data).then(r => r.data),
  backfillViewTokens: () => apiClient.post<{ updated: number; total: number }>('/orders/backfill-view-tokens'),
  trash: (id: string) => apiClient.post(`/orders/${id}/trash`),
  restore: (id: string) => apiClient.post(`/orders/${id}/restore`),
}

export const rtnApi = {
  forOrder: (orderId: string) => apiClient.get<RtnOrderPreview | null>(`/rtn/order/${orderId}`).then(r => r.data),
  /** Every return order ever raised against an original (newest first). */
  allForOrder: (orderId: string) =>
    apiClient
      .get<{ id: string; displayId: string; status: string; itemCount: number; createdAt: string; isOpen: boolean }[]>(
        `/rtn/order/${orderId}/all`,
      )
      .then(r => r.data),
  get: (id: string) => apiClient.get<RtnOrderResponse>(`/rtn/${id}`).then(r => r.data),
  create: (orderId: string, items: { orderItemId: string; quantity: number }[], extra?: {
    reason?: string
    adjustOriginalDiscount?: number
    adjustOriginalDiscountType?: 'flat' | 'percentage'
    adjustOriginalShippingCharge?: number
    deliverRemainingImmediately?: boolean
  }) =>
    apiClient
      .post<RtnOrderResponse>(`/rtn/from-order/${orderId}`, { items, ...(extra ?? {}) })
      .then(r => r.data),
  finalizeDispatch: (dispatchId: string) =>
    apiClient.post(`/rtn/dispatch/${dispatchId}/finalize-return`).then(r => r.data),
}

export interface ExchangeSettlement {
  originalPaid: number
  /** Recorded Σ PAID before any dialog adjustment (phase-1 paidConfirmed). */
  recordedPaid?: number
  /** Dialog-confirmed figure, or null when the recorded figure was used. */
  paidConfirmed?: number | null
  /** Why the confirmed figure differs (null when it does not). */
  paidAdjustmentReason?: string | null
  availableCredit: number
  exchangeTotal: number
  creditApplied: number
  delta: number
  status: 'SETTLED_DUE' | 'SETTLED_EXACT' | 'SETTLED_REFUND'
  refundId: string | null
}

export const exchangeApi = {
  /** What the customer already paid, minus what sibling exchanges consumed. */
  settlementPreview: (orderId: string) =>
    apiClient
      .get<{ orderId: string; displayId: string; orderTotal: number; originalPaid: number; creditAvailable: number }>(
        `/exchange/settlement-preview/${orderId}`,
      )
      .then(r => r.data),
  /**
   * Task 4 (Fix 8): BOTH signals for confirming the original Returned —
   * exchange-delivered AND return-arrived. Drives the order-detail hint; the
   * updateStatus path enforces the same check server-side.
   */
  readiness: (orderId: string) =>
    apiClient
      .get<{
        orderId: string
        linked: boolean
        exchanges: { id: string; displayId: string; delivered: boolean }[]
        returns: { id: string; displayId: string; status: string }[]
        exchangeDelivered: boolean
        returnArrived: boolean
        canConfirmReturned: boolean
        blockReason: string | null
      }>(
        `/exchange/readiness/${orderId}`,
      )
      .then(r => r.data),
  create: (orderId: string, data: {
    mode?: 'FULL' | 'PARTIAL'
    returningItems?: { productId: string; variantId?: string | null; quantity: number }[]
    returnReason?: string
    items: { productId: string; variantId?: string; quantity: number; price: number }[]
    discount?: number
    discountType?: 'flat' | 'percentage'
    shippingCharge?: number
    customerNotes?: string
    officeNotes?: string
    /**
     * Phase-1 hardening: what the customer confirmed they paid on the
     * ORIGINAL (the dialog confirms it). Drives settlement instead of the
     * recorded Σ when present. When it differs from recorded payments,
     * paidAdjustmentReason is required (enforced server-side).
     */
    paidConfirmed?: number
    /** Why paidConfirmed differs from the recorded payments (max 500 chars). */
    paidAdjustmentReason?: string
  }) =>
    apiClient
      .post<{ exchange: OrderResponse; settlement: ExchangeSettlement; mode: 'FULL' | 'PARTIAL'; returnRecord: ReturnRecord | null }>(
        `/exchange/from-order/${orderId}`,
        data,
      )
      .then(r => r.data),
}

export interface ReturnRecord {
  id: string
  displayId: string
  orderId: string
  type: 'FULL' | 'PARTIAL' | 'EXCHANGE'
  status: string
  source: string
  items: { productId: string; variantId?: string | null; quantity: number }[]
  reason?: string | null
  courier?: string | null
  courierReturnId?: string | null
  exchangeOrderId?: string | null
}

/**
 * Single-record reads for the order-detail flows. Creation lives in
 * `@/features/returns/api` (the unified Create-return dialog) — staff
 * returns are NEVER posted one-click from a menu.
 */
export const returnsApi = {
  get: (id: string) => apiClient.get<ReturnRecord>(`/returns/${id}`).then(r => r.data),
}

export const scannerApi = {
  purposes: () => apiClient.get<ScanPurposeDescriptor[]>('/scanner/purposes').then(r => r.data),
  resolve: (identifier: string, purpose?: string) =>
    apiClient.post<ScanResolveOutcome>('/scanner/resolve', { identifier, purpose }).then(r => r.data),
  scan: (payload: {
    purpose: string
    identifier: string
    dispatchId?: string
    dispatchIds?: string[]
    orderId?: string
    orderIds?: string[]
    targetStatusId?: string
    /** Linked return leg selected by the picker (RETURN_RECEIVE). */
    returnId?: string
    /** Linked exchange selected by the picker (RETURN_RECEIVE, info-only). */
    exchangeId?: string
  }) => apiClient.post<ScanResult>('/scanner/scan', payload).then(r => r.data),
}

export { appUrl as mediaUrl } from '@/lib/utils'

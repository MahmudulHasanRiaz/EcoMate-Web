import { apiClient } from '@/lib/api-client';

export interface PaymentVerificationOrder {
  id: string;
  displayId: string;
  paymentStatus: string;
  paymentProof: { transactionId?: string; screenshot?: string } | null;
  guestName?: string;
  guestPhone?: string;
  total: number;
  status?: { name: string };
}

export interface PaymentRow {
  id: string
  orderId: string
  gatewayCode: string
  amount: number
  status: string
  transactionId?: string | null
  /** Receiving account for manual gateways (Task 11 ledger). */
  account?: string | null
  /** `staff:<userId>` for staff entries, null for customer-submitted. */
  recordedBy?: string | null
  submittedBy?: string | null
  /**
   * B: resolved staff actor for `staff:<userId>` recordedBy tags — same shape
   * as `verifier`, so the row renders the shared user chip. Null for
   * customer-submitted rows / deleted users.
   */
  recorder?: { id: string; firstName: string; lastName: string } | null
  /** Server-set (D4) — the only date shown in the ledger. */
  recordedAt?: string | null
  notes?: string | null
  verifiedBy?: string | null
  verifiedAt?: string | null
  /**
   * B: how the row got PAID — 'auto' (S1 staff auto-verify / gateway
   * callback), 'manual' (a human approved), null (still PENDING or legacy).
   */
  verificationSource?: 'auto' | 'manual' | null
  createdAt: string
  order?: { displayId: string }
  verifier?: { id: string; firstName: string; lastName: string } | null
  /**
   * D-B: refunds linked to THIS row (Refund.sourcePaymentId). The Refunded
   * badge + per-row remainder are DERIVED from these — no extra fetch.
   */
  sourceRefunds?: { id: string; amount: number; status: string }[]
}

export const paymentsApi = {
  listVerifying: () =>
    apiClient.get<{ data: PaymentVerificationOrder[] }>('/orders', {
      params: { paymentStatus: 'PAYMENT_VERIFYING' },
    }).then(r => r.data.data),
  verify: (id: string, verified: boolean, note?: string, feeAmount?: number) =>
    apiClient.post(`/orders/${id}/verify-payment`, { verified, note, feeAmount }),
  list: (params?: { page?: number; perPage?: number; gatewayCode?: string; status?: string; orderId?: string; orderNumber?: string }) =>
    apiClient.get<{ data: PaymentRow[]; meta: { total: number; page: number; perPage: number; totalPages: number } }>('/payments', { params }).then(r => r.data),
  /**
   * A: truthful approval-queue count — PENDING ledger rows (perPage 1: only
   * meta.total is used). The header badge and the All Payments tab count read
   * from this, NOT from the smaller proof-verification order queue.
   */
  pendingCount: () =>
    apiClient.get<{ data: PaymentRow[]; meta: { total: number } }>('/payments', {
      params: { page: 1, perPage: 1, status: 'PENDING' },
    }).then(r => r.data.meta.total),
  /** D: canonical effective settings (global + per-gateway tri-state). */
  getEffectiveSettings: () =>
    apiClient.get<EffectivePaymentSettingsResponse>('/payments/settings').then(r => r.data),
  /**
   * Staff record a ledger entry (Task 11). The backend derives isStaff from
   * the authenticated non-customer actor — S1 auto-verification and manual
   * account/txn validation apply server-side; the UI mirrors them only to
   * avoid predictable 400s.
   */
  record: (orderId: string, dto: { gatewayCode: string; amount: number; account?: string; transactionId?: string; notes?: string }) =>
    apiClient.post(`/payments/${orderId}`, dto),
  /**
   * Per-row verify (Task 11 ledger). PAID approves, FAILED rejects.
   * The backend blocks self-approval (recordedBy is self → 403); the UI
   * disables those buttons with a hint instead of letting staff hit the 403.
   */
  verifyRow: (id: string, dto: { status: 'PAID' | 'FAILED'; notes?: string }) =>
    apiClient.put(`/payments/${id}/verify`, dto),
};

/** D: effective settings response shape of GET /payments/settings. */
export interface EffectiveGatewaySettings {
  code: string
  name: string
  type: string
  staffAutoVerifiedOverride: boolean | null
  editAllowedOverride: boolean | null
  effective: { staffAutoVerified: boolean; editAllowed: boolean }
}

export interface EffectivePaymentSettingsResponse {
  global: { staffAutoVerified: boolean; editAllowed: boolean }
  gateways: EffectiveGatewaySettings[]
}

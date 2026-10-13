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
  /** Server-set (D4) — the only date shown in the ledger. */
  recordedAt?: string | null
  notes?: string | null
  verifiedBy?: string | null
  verifiedAt?: string | null
  createdAt: string
  order?: { displayId: string }
  verifier?: { id: string; firstName: string; lastName: string } | null
}

export const paymentsApi = {
  listVerifying: () =>
    apiClient.get<{ data: PaymentVerificationOrder[] }>('/orders', {
      params: { paymentStatus: 'PAYMENT_VERIFYING' },
    }).then(r => r.data.data),
  verify: (id: string, verified: boolean, note?: string, feeAmount?: number) =>
    apiClient.post(`/orders/${id}/verify-payment`, { verified, note, feeAmount }),
  list: (params?: { page?: number; perPage?: number; gatewayCode?: string; status?: string; orderId?: string }) =>
    apiClient.get<{ data: PaymentRow[]; meta: { total: number; page: number; perPage: number; totalPages: number } }>('/payments', { params }).then(r => r.data),
  /**
   * Staff record a ledger entry (Task 11). The backend derives isStaff from
   * the authenticated non-customer actor — S1 auto-verification and manual
   * account/txn validation apply server-side; the UI mirrors them only to
   * avoid predictable 400s.
   */
  record: (orderId: string, dto: { gatewayCode: string; amount: number; account?: string; transactionId?: string; notes?: string }) =>
    apiClient.post(`/payments/${orderId}`, dto),
};

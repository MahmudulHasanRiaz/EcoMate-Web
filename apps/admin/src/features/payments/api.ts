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
};

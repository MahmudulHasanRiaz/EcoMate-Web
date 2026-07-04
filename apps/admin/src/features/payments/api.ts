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

export const paymentsApi = {
  listVerifying: () =>
    apiClient.get<PaymentVerificationOrder[]>('/orders', {
      params: { paymentStatus: 'PAYMENT_VERIFYING' },
    }).then(r => r.data?.data || r.data),
  verify: (id: string, verified: boolean, note?: string) =>
    apiClient.post(`/orders/${id}/verify-payment`, { verified, note }),
};

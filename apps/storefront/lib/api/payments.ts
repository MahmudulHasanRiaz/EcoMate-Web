import apiClient from "../api-client";

export interface SubmitPaymentData {
  method: string;
  amount: number;
  transactionId?: string;
  notes?: string;
}

export async function submitPayment(orderId: string, data: SubmitPaymentData) {
  const { data: res } = await apiClient.post(`/payments/${orderId}`, data);
  return res;
}

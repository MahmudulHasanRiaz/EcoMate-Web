import { apiClient } from '@/lib/api-client'

export interface CreateRefundInput {
  orderId: string
  amount: number
  /** Stored label for the destination (gateway name, e.g. "bKash"). */
  method: string
  /** Part 4: configured gateway code backing the destination. */
  gatewayCode?: string
  /** Part 4: eligible CoA asset leaf that received the money. */
  accountId?: string
  /** Human reason. Required — doubles as the negative ledger row's notes. */
  reason: string
  /** Atomic cancel-too (D5): same $transaction refunds AND cancels. */
  cancelToo?: boolean
  /**
   * D-B: refund via payment-list selection — the exact PAID payment rows the
   * money comes back from. Same-order + PAID-only + per-row remainder cap are
   * enforced server-side; the total is split across the rows in order.
   */
  sourcePaymentIds?: string[]
  notes?: string
}

export const refundsApi = {
  list: (q: any) => apiClient.get('/refunds', { params: q }),
  create: (d: CreateRefundInput) => apiClient.post('/refunds', d),
  updateStatus: (id: string, status: string) => apiClient.put(`/refunds/${id}/status`, { status }),
}

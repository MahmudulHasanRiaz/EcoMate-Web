import { apiClient } from '@/lib/api-client'

export interface PlatformResponse {
  id: string
  name: string
  slug: string
  status: string
  _count?: { connections: number }
}

export interface ConnectionResponse {
  id: string
  providerUserId?: string | null
  providerBusinessId?: string | null
  tokenType?: string | null
  tokenExpiry?: string | null
  status: string
  lastSyncAt?: string | null
  lastError?: string | null
  createdAt: string
  updatedAt: string
  platform: PlatformResponse
  _count?: { adAccounts: number }
}

export interface AdAccountResponse {
  id: string
  connectionId: string
  providerAccountId: string
  name: string
  currency: string
  timezone?: string | null
  status: string
  isActive: boolean
  lastSyncAt?: string | null
  lastError?: string | null
  connection: { id: string; platform: PlatformResponse }
  syncStatus?: SyncStatusResponse | null
  _count?: { campaigns: number }
}

export interface CampaignResponse {
  id: string
  adAccountId: string
  providerCampaignId: string
  name: string
  objective?: string | null
  status: string
  effectiveStatus?: string | null
  dailyBudget?: string | number | null
  lifetimeBudget?: string | number | null
  isArchived: boolean
  lastSyncedAt?: string | null
  adAccount?: { id: string; name: string; providerAccountId: string }
  _count?: { adSets: number; orderAttributions: number }
}

export interface InsightResponse {
  id: string
  campaignId: string
  campaign: { id: string; name: string }
  date: string
  impressions: number
  clicks: number
  spend: number
  purchases: number
  purchaseValue?: number | null
  roas?: number | null
  ctr?: number | null
  cpc?: number | null
}

export interface FundingEntryResponse {
  id: string
  platform: string
  adAccountId: string
  adAccount: AdAccountResponse
  fundingSource: string
  fundingDate: string
  currency: string
  currencyAmount: string | number
  baseCurrency: string
  baseAmount: string | number
  effectiveRate: string | number
  reference?: string | null
  remarks?: string | null
  journalEntryId?: string | null
  status: string
  postedAt?: string | null
  ledger: Array<{ id: string; remainingAmount: string | number; status: string }>
}

export interface AttributionResponse {
  id: string
  orderId: string
  order: { id: string; displayId: string; total: string | number; createdAt: string }
  campaign?: { id: string; name: string } | null
  confidence: number
  method: string
  explanation?: string | null
  attributedAt: string
}

export interface SessionResponse {
  id: string
  sessionToken: string
  clickId?: string | null
  /** @deprecated Use clickId */
  fbclid?: string | null
  utmSource?: string | null
  utmCampaign?: string | null
  referrer?: string | null
  campaign?: { id: string; name: string } | null
  createdAt: string
}

export interface MarketingPaymentResponse {
  id: string
  adAccountId: string
  providerPaymentId?: string | null
  platformAmount: string | number
  platformCurrency: string
  actualCost?: string | number | null
  baseCurrency: string
  effectiveRate?: string | number | null
  feeAmount?: string | number | null
  taxAmount?: string | number | null
  processingFee?: string | number | null
  sourceAccountId?: string | null
  paymentDate: string
  status: string
  notes?: string | null
  journalEntryId?: string | null
  reconciledAt?: string | null
  createdAt: string
  adAccount: AdAccountResponse
  sourceAccount?: { id: string; code: string; name: string; type: string } | null
  journalEntry?: { id: string; entryNo: string; description: string } | null
}

export interface CreditDueResponse {
  adAccountId: string
  adAccountName: string
  currency: string
  paidFunded: number
  paidConsumed: number
  paidCredit: number
  promoFunded: number
  promoConsumed: number
  promotionalCredit: number
  totalFunded: number
  totalConsumed: number
  totalCredit: number
  totalPaid: number
  billed: number
  due: number
  netPosition: number
}

export interface SyncStatusResponse {
  id: string
  status: string
  stage?: string | null
  progressPct: number
  lastRunAt?: string | null
  lastSuccessAt?: string | null
  lastError?: string | null
  recordsImported: number
  recordsUpdated: number
}

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface KpisResponse {
  range: { from: string; to: string }
  platform: {
    spend: number
    impressions: number
    clicks: number
    purchases: number
    purchaseValue: number
    roas: number | null
    aov: number | null
  }
  store: {
    orders: number
    revenue: number
    marketingCost: number
    grossProfit: number
    roas: number | null
    aov: number | null
  }
}

export interface OverviewResponse {
  current: { spend: number; revenue: number; marketingCost: number; profit: number; orders: number; roas: number | null }
  previous: { spend: number; revenue: number; marketingCost: number; profit: number; orders: number; roas: number | null }
  deltas: { spend: number | null; revenue: number | null; profit: number | null; orders: number | null }
  series: Array<{ date: string; spend: number; revenue: number; marketingCost: number; profit: number }>
}

export interface ProfitabilityResponse {
  range: { from: string; to: string }
  storeRevenue: number
  marketingCost: number
  grossProfit: number
  grossMargin: number | null
  platformSpend: number
  platformOrders: number
  platformPurchaseValue: number
  attributedOrders: number
}

export interface CampaignPerformanceResponse {
  campaign: { id: string; name: string; status: string }
  verdict: 'profitable' | 'near_break_even' | 'loss_making' | 'insufficient_data'
  platform: {
    spend: number; impressions: number; clicks: number; purchases: number; purchaseValue: number; roas: number | null
  }
  store: {
    orders: number; revenue: number; marketingCost: number; profit: number; roas: number | null; aov: number | null
  }
}

export const marketingApi = {
  platforms: () => apiClient.get<PlatformResponse[]>('/marketing/platforms'),
  connections: {
    list: () => apiClient.get<ConnectionResponse[]>('/marketing/connections'),
    create: (data: { provider: string; name?: string; accessToken: string; refreshToken?: string; tokenExpiry?: string; providerUserId?: string }) =>
      apiClient.post<ConnectionResponse>('/marketing/connections', data),
    update: (id: string, data: Partial<{ accessToken: string; refreshToken: string; tokenExpiry: string; providerUserId: string }>) =>
      apiClient.put<ConnectionResponse>(`/marketing/connections/${id}`, data),
    disconnect: (id: string) => apiClient.post(`/marketing/connections/${id}/disconnect`),
    refresh: (id: string) => apiClient.post<ConnectionResponse>(`/marketing/connections/${id}/refresh`),
    remove: (id: string) => apiClient.delete(`/marketing/connections/${id}`),
  },
  adAccounts: {
    list: (params?: { page?: number; perPage?: number; connectionId?: string }) =>
      apiClient.get<Paginated<AdAccountResponse>>('/marketing/ad-accounts', { params }),
    create: (data: { connectionId: string; providerAccountId: string; name: string; currency?: string; timezone?: string; status?: string }) =>
      apiClient.post<AdAccountResponse>('/marketing/ad-accounts', data),
    discover: (connectionId: string) => apiClient.post('/marketing/ad-accounts/discover', { connectionId }),
    get: (id: string) => apiClient.get<AdAccountResponse & { campaigns: CampaignResponse[] }>(`/marketing/ad-accounts/${id}`),
    update: (id: string, data: Partial<{ name: string; status: string; isActive: boolean }>) =>
      apiClient.put<AdAccountResponse>(`/marketing/ad-accounts/${id}`, data),
    sync: (id: string) => apiClient.post(`/marketing/ad-accounts/${id}/sync`),
    refresh: (id: string) => apiClient.post(`/marketing/ad-accounts/${id}/refresh`),
    remove: (id: string) => apiClient.delete(`/marketing/ad-accounts/${id}`),
  },
  campaigns: {
    list: (params?: { page?: number; perPage?: number; adAccountId?: string; status?: string; search?: string }) =>
      apiClient.get<Paginated<CampaignResponse>>('/marketing/campaigns', { params }),
    get: (id: string) => apiClient.get<CampaignResponse>(`/marketing/campaigns/${id}`),
    update: (id: string, data: Partial<{ name: string; isArchived: boolean }>) =>
      apiClient.put<CampaignResponse>(`/marketing/campaigns/${id}`, data),
    pause: (id: string) => apiClient.post<{ ok: boolean; status: string }>(`/marketing/campaigns/${id}/pause`),
    resume: (id: string) => apiClient.post<{ ok: boolean; status: string }>(`/marketing/campaigns/${id}/resume`),
    performance: (id: string, params?: { fromDate?: string; toDate?: string }) =>
      apiClient.get(`/marketing/analysis/campaigns/${id}/performance`, { params }),
  },
  insights: (params?: { campaignId?: string; adAccountId?: string; fromDate?: string; toDate?: string; page?: number; perPage?: number }) =>
    apiClient.get<Paginated<InsightResponse>>('/marketing/insights', { params }),
  funding: {
    list: (params?: { page?: number; perPage?: number; adAccountId?: string }) =>
      apiClient.get<Paginated<FundingEntryResponse>>('/marketing/funding', { params }),
    summary: () => apiClient.get<Array<{ adAccountId: string; adAccountName: string | null; remainingAmount: number; receivedAmount: number; consumedAmount: number }>>('/marketing/funding/summary'),
    create: (data: {
      adAccountId: string
      fundingSource: string
      fundingDate: string
      currency?: string
      currencyAmount: number
      baseCurrency?: string
      baseAmount?: number
      effectiveRate?: number
      reference?: string
      remarks?: string
    }) => apiClient.post('/marketing/funding', data),
    confirm: (id: string) => apiClient.post(`/marketing/funding/${id}/confirm`),
    post: (id: string, fundingAccountId: string) => apiClient.post(`/marketing/funding/${id}/post`, { fundingAccountId }),
    archive: (id: string) => apiClient.post(`/marketing/funding/${id}/archive`),
    remove: (id: string) => apiClient.delete(`/marketing/funding/${id}`),
    consume: (data: { campaignId: string; amount: number; source?: string }) => apiClient.post('/marketing/funding/consume', data),
  },
  payments: {
    list: (params?: { page?: number; perPage?: number; adAccountId?: string; status?: string }) =>
      apiClient.get<Paginated<MarketingPaymentResponse>>('/marketing/payments', { params }),
    get: (id: string) => apiClient.get<MarketingPaymentResponse>(`/marketing/payments/${id}`),
    create: (data: {
      adAccountId: string
      providerPaymentId?: string
      platformAmount: number
      platformCurrency?: string
      paymentDate: string
      notes?: string
      sourceAccountId?: string
    }) => apiClient.post<MarketingPaymentResponse>('/marketing/payments', data),
    reconcile: (id: string, data: {
      actualCost: number
      baseCurrency?: string
      feeAmount?: number
      taxAmount?: number
      processingFee?: number
    }) => apiClient.post<MarketingPaymentResponse>(`/marketing/payments/${id}/reconcile`, data),
    post: (id: string) => apiClient.post<MarketingPaymentResponse>(`/marketing/payments/${id}/post`),
    creditDue: (adAccountId?: string) =>
      apiClient.get<CreditDueResponse[]>('/marketing/payments/credit-due', { params: adAccountId ? { adAccountId } : undefined }),
  },
  accounts: {
    list: () => apiClient.get<Array<{ id: string; code: string; name: string; type: string; isGroup: boolean; isActive: boolean }>>('/accounts'),
  },
  attribution: {
    list: (params?: { page?: number; perPage?: number; campaignId?: string }) =>
      apiClient.get<Paginated<AttributionResponse>>('/marketing/attributions', { params }),
    rebuild: (data: { fromDate?: string; toDate?: string }) => apiClient.post('/marketing/attribution/rebuild', data),
    sessions: (params?: { page?: number; perPage?: number; utmCampaign?: string }) =>
      apiClient.get<Paginated<SessionResponse>>('/marketing/sessions', { params }),
  },
  analysis: {
    kpis: (params?: { fromDate?: string; toDate?: string }) =>
      apiClient.get<KpisResponse>('/marketing/analysis/kpis', { params }),
    overview: (params?: { fromDate?: string; toDate?: string }) =>
      apiClient.get<OverviewResponse>('/marketing/analysis/overview', { params }),
    profitability: (params?: { fromDate?: string; toDate?: string }) =>
      apiClient.get<ProfitabilityResponse>('/marketing/analysis/profitability', { params }),
    fundingPnL: (params?: { fromDate?: string; toDate?: string }) =>
      apiClient.get<{ entries: Array<{ id: string; entryNo: string; entryDate: string; description: string; totalDebit: number }>; total: number }>('/marketing/analysis/funding-pnl', { params }),
    recalculate: (params?: { fromDate?: string; toDate?: string }) =>
      apiClient.post('/marketing/analysis/summaries/recalculate', null, { params }),
    rebuildAllocations: (params?: { fromDate?: string; toDate?: string }) =>
      apiClient.post('/marketing/analysis/allocations/rebuild', null, { params }),
    syncAll: (force = false) => apiClient.post(`/marketing/analysis/sync`, null, { params: { force: String(force) } }),
  },
  audit: (params?: { page?: number; perPage?: number }) =>
    apiClient.get<Paginated<{ id: string; action: string; entityType: string; entityId: string; actorEmail?: string | null; metadata?: any; createdAt: string }>>('/marketing/audit', { params }),
}

export function money(n: number | string | null | undefined, currency = 'BDT') {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0)
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(v)
}

export function fmtDate(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
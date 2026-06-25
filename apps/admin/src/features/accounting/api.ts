import { apiClient } from '@/lib/api-client'

export interface AccountResponse {
  id: string
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  parentId: string | null
  isActive: boolean
  isGroup: boolean
  children?: AccountResponse[]
}

export interface FinancialPeriodResponse {
  id: string
  name: string
  startDate: string
  endDate: string
  isClosed: boolean
}

export interface JournalEntryResponse {
  id: string
  entryNo: string
  periodId: string
  entryDate: string
  description: string
  totalDebit: number
  totalCredit: number
  isOpening: boolean
  referenceNo: string | null
  lines?: JournalEntryLineResponse[]
  period?: FinancialPeriodResponse
}

export interface JournalEntryLineResponse {
  id: string
  entryId: string
  accountId: string
  debit: number
  credit: number
  description: string | null
  account?: AccountResponse
}

export interface TrialBalanceRow {
  type: string
  account_id: string
  account_code: string
  account_name: string
  total_debit: string
  total_credit: string
}

export interface TrialBalanceResponse {
  accounts: TrialBalanceRow[]
  totalDebit: number
  totalCredit: number
}

export interface PLRow {
  type: string
  account_id: string
  account_code: string
  account_name: string
  balance: number
}

export interface PLResponse {
  incomeAccounts: PLRow[]
  expenseAccounts: PLRow[]
  totalIncome: number
  totalExpense: number
  netProfit: number
}

export interface BSRow {
  type: string
  account_id: string
  account_code: string
  account_name: string
  balance: number
}

export interface BalanceSheetResponse {
  assetAccounts: BSRow[]
  liabilityAccounts: BSRow[]
  equityAccounts: BSRow[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
}

export interface LedgerEntry {
  id: string
  entryId: string
  accountId: string
  debit: number
  credit: number
  description: string | null
  entry: { entryNo: string; entryDate: string; description: string }
}

export interface LedgerResponse {
  account: { id: string; code: string; name: string; type: string }
  entries: LedgerEntry[]
  totalDebit: number
  totalCredit: number
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export const accountingApi = {
  getAccountTree: () => apiClient.get<AccountResponse[]>('/accounts/tree'),

  listAccounts: (params?: { page?: number; perPage?: number }) =>
    apiClient.get<PaginatedResponse<AccountResponse>>('/accounts', { params }),

  createAccount: (data: { code: string; name: string; type: string; parentId?: string | null; isGroup?: boolean }) =>
    apiClient.post<AccountResponse>('/accounts', data),

  updateAccount: (id: string, data: { code?: string; name?: string; type?: string; parentId?: string | null; isGroup?: boolean; isActive?: boolean }) =>
    apiClient.put<AccountResponse>(`/accounts/${id}`, data),

  deleteAccount: (id: string) => apiClient.delete(`/accounts/${id}`),

  listFinancialPeriods: (params?: { page?: number; perPage?: number }) =>
    apiClient.get<PaginatedResponse<FinancialPeriodResponse>>('/financial-periods', { params }),

  createFinancialPeriod: (data: { name: string; startDate: string; endDate: string }) =>
    apiClient.post<FinancialPeriodResponse>('/financial-periods', data),

  closePeriod: (id: string) => apiClient.patch<FinancialPeriodResponse>(`/financial-periods/${id}/close`),

  openPeriod: (id: string) => apiClient.patch<FinancialPeriodResponse>(`/financial-periods/${id}/open`),

  setOpeningBalance: (data: { periodId: string; accountId: string; debit: number; credit: number }) =>
    apiClient.post('/opening-balances', data),

  getOpeningBalances: (periodId: string) =>
    apiClient.get(`/opening-balances/${periodId}`),

  listJournalEntries: (params?: { page?: number; perPage?: number; periodId?: string }) =>
    apiClient.get<PaginatedResponse<JournalEntryResponse>>('/accounting/entries', { params }),

  getJournalEntry: (id: string) =>
    apiClient.get<JournalEntryResponse>(`/accounting/entries/${id}`),

  createJournalEntry: (data: {
    periodId: string
    entryDate: string
    description: string
    referenceNo?: string
    lines: { accountId: string; debit: number; credit: number; description?: string }[]
  }) => apiClient.post<JournalEntryResponse>('/accounting/entries', data),

  deleteJournalEntry: (id: string) => apiClient.delete(`/accounting/entries/${id}`),

  trialBalance: (periodId: string) =>
    apiClient.get<TrialBalanceResponse>('/accounting/reports/trial-balance', { params: { periodId } }),

  profitAndLoss: (periodId: string) =>
    apiClient.get<PLResponse>('/accounting/reports/profit-and-loss', { params: { periodId } }),

  balanceSheet: (periodId: string) =>
    apiClient.get<BalanceSheetResponse>('/accounting/reports/balance-sheet', { params: { periodId } }),

  accountLedger: (accountId: string, periodId?: string) =>
    apiClient.get<LedgerResponse>(`/accounting/reports/ledger/${accountId}`, { params: periodId ? { periodId } : {} }),
}

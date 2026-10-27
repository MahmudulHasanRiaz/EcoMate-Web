import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BankAccountManager } from './bank-account-manager'

const listBankAccounts = vi.hoisted(() => vi.fn())
const createBankAccount = vi.hoisted(() => vi.fn())
const updateBankAccount = vi.hoisted(() => vi.fn())
const deleteBankAccount = vi.hoisted(() => vi.fn())

vi.mock('./api', () => ({
  gatewayApi: {
    listBankAccounts,
    createBankAccount,
    updateBankAccount,
    deleteBankAccount,
  },
}))

const account = {
  id: 'ba-1',
  bankName: 'Dutch-Bangla Bank',
  accountHolderName: 'EcoMate Ltd',
  accountNumber: '1234567890',
  branchName: 'Motijheel',
  routingNumber: '090123456',
  accountType: 'SAVINGS' as const,
  isActive: true,
  sortOrder: 0,
}

function renderManager() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <BankAccountManager />
    </QueryClientProvider>,
  )
}

describe('BankAccountManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listBankAccounts.mockResolvedValue({ data: [account] })
    createBankAccount.mockResolvedValue({ data: account })
    updateBankAccount.mockResolvedValue({ data: account })
    deleteBankAccount.mockResolvedValue({ data: { deleted: true } })
  })

  it('lists configured accounts with their NPSB details', async () => {
    const ui = await renderManager()
    await expect.element(ui.getByText('Dutch-Bangla Bank')).toBeInTheDocument()
    await expect.element(ui.getByText(/A\/C: 1234567890/)).toBeInTheDocument()
    await expect.element(ui.getByText(/Routing: 090123456/)).toBeInTheDocument()
    await expect.element(ui.getByText(/EcoMate Ltd · Savings · Motijheel branch/)).toBeInTheDocument()
  })

  it('shows an empty state when no account is configured', async () => {
    listBankAccounts.mockResolvedValue({ data: [] })
    const ui = await renderManager()
    await expect.element(ui.getByText(/No bank accounts yet/)).toBeInTheDocument()
  })

  it('creates an account from the add form', async () => {
    const ui = await renderManager()
    await expect.element(ui.getByText('Dutch-Bangla Bank')).toBeInTheDocument()
    await userEvent.click(ui.getByRole('button', { name: 'Add Account' }))
    await userEvent.fill(ui.getByLabelText('Bank Name'), 'Islami Bank')
    await userEvent.fill(ui.getByLabelText('Account Holder Name'), 'EcoMate Ltd')
    await userEvent.fill(ui.getByLabelText('Account Number'), '9876543210')
    await userEvent.fill(ui.getByLabelText('Branch Name'), 'Dhanmondi')
    await userEvent.fill(ui.getByLabelText('Routing Number'), '125123456')
    await userEvent.click(ui.getByRole('button', { name: 'Save Account' }))
    expect(createBankAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        bankName: 'Islami Bank',
        accountHolderName: 'EcoMate Ltd',
        accountNumber: '9876543210',
        branchName: 'Dhanmondi',
        routingNumber: '125123456',
        accountType: 'SAVINGS',
        isActive: true,
      }),
    )
  })

  it('deletes an account after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const ui = await renderManager()
    await expect.element(ui.getByText('Dutch-Bangla Bank')).toBeInTheDocument()
    await userEvent.click(ui.getByRole('button', { name: 'Delete account' }))
    expect(deleteBankAccount).toHaveBeenCalledWith('ba-1')
  })
})

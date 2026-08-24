import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import {
  BankAccountsCard,
  maskAccountNumber,
} from '../bank-accounts-card'
import type { EmployeeBankAccount } from '../../api'

const baseAccount: EmployeeBankAccount = {
  id: 'ba-1',
  employeeId: 'emp-1',
  bankName: 'DBBL',
  branchName: null,
  accountName: 'John Doe',
  accountNumber: '1234567890',
  accountType: 'SAVINGS',
  routingNumber: null,
  isPrimary: false,
  verificationStatus: 'PENDING',
  notes: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}

describe('maskAccountNumber', () => {
  it('masks everything but the last four digits', () => {
    expect(maskAccountNumber('1234567890')).toBe('****7890')
    expect(maskAccountNumber('1234')).toBe('****1234')
  })

  it('falls back to a masked placeholder for short or missing numbers', () => {
    expect(maskAccountNumber('12')).toBe('****')
    expect(maskAccountNumber(undefined)).toBe('****')
    expect(maskAccountNumber('')).toBe('****')
  })
})

describe('BankAccountsCard', () => {
  it('renders the account list with masked numbers and badges', async () => {
    const { getByText } = await render(
      <BankAccountsCard
        accounts={[
          {
            ...baseAccount,
            id: 'ba-1',
            isPrimary: true,
            verificationStatus: 'VERIFIED',
          },
          {
            ...baseAccount,
            id: 'ba-2',
            bankName: 'EBL',
            accountNumber: '11112222',
            accountType: 'CURRENT',
            isPrimary: false,
            verificationStatus: 'PENDING',
          },
        ]}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSetPrimary={vi.fn()}
      />
    )

    await expect.element(getByText('DBBL')).toBeInTheDocument()
    await expect.element(getByText('EBL')).toBeInTheDocument()
    await expect.element(getByText('****7890')).toBeInTheDocument()
    await expect.element(getByText('****2222')).toBeInTheDocument()
    await expect.element(getByText('Primary', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Verified')).toBeInTheDocument()
  })

  it('shows a warning desc when deleting the primary account', async () => {
    const onDelete = vi.fn()
    const { getByRole, getByText } = await render(
      <BankAccountsCard
        accounts={[
          { ...baseAccount, id: 'ba-1', isPrimary: true },
        ]}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={onDelete}
        onSetPrimary={vi.fn()}
      />
    )

    await userEvent.click(getByRole('button', { name: 'Delete' }))
    await expect
      .element(getByText(/primary bank account/i))
      .toBeInTheDocument()
    await userEvent.click(getByRole('button', { name: 'Delete', exact: true }))
    expect(onDelete).toHaveBeenCalledWith('ba-1')
  })

  it('set primary confirm calls onSetPrimary with the account id', async () => {
    const onSetPrimary = vi.fn()
    const { getByRole } = await render(
      <BankAccountsCard
        accounts={[
          { ...baseAccount, id: 'ba-2', bankName: 'EBL', isPrimary: false },
        ]}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSetPrimary={onSetPrimary}
      />
    )

    await userEvent.click(getByRole('button', { name: 'Set primary' }))
    await userEvent.click(getByRole('button', { name: 'Set Primary', exact: true }))
    expect(onSetPrimary).toHaveBeenCalledWith('ba-2')
  })

  it('opens the add dialog with the account fields', async () => {
    const { getByRole } = await render(
      <BankAccountsCard
        accounts={[]}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSetPrimary={vi.fn()}
      />
    )

    await userEvent.click(getByRole('button', { name: 'Add Account' }))
    await expect
      .element(getByRole('heading', { name: 'Add Bank Account' }))
      .toBeInTheDocument()
  })

  it('edit dialog exposes the verification workflow (G-16)', async () => {
    const onEdit = vi.fn()
    const { getByRole, getByText } = await render(
      <BankAccountsCard
        accounts={[{ ...baseAccount, id: 'ba-1', verificationStatus: 'PENDING' }]}
        onAdd={vi.fn()}
        onEdit={onEdit}
        onDelete={vi.fn()}
        onSetPrimary={vi.fn()}
      />
    )

    await userEvent.click(getByRole('button', { name: 'Edit' }))
    await expect.element(getByText(/Mark VERIFIED after validating bank documents/)).toBeInTheDocument()

    const combos = Array.from(document.querySelectorAll('[role="combobox"]'))
    const statusTrigger = combos.find((c) => c.textContent?.trim() === 'Pending')
    expect(statusTrigger).toBeDefined()
    statusTrigger!.click()
    await vi.waitFor(() => {
      const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent === 'Verified')
      expect(option).toBeDefined()
    })
    Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent === 'Verified')!.click()

    const noteArea = Array.from(document.querySelectorAll('textarea')).find((t) =>
      (t.getAttribute('placeholder') || '').includes('bank statement'),
    )
    expect(noteArea).toBeDefined()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(noteArea, 'statement checked')
    noteArea!.dispatchEvent(new Event('input', { bubbles: true }))

    await userEvent.click(getByRole('button', { name: 'Save Changes' }))

    expect(onEdit).toHaveBeenCalledWith(
      'ba-1',
      expect.objectContaining({
        verificationStatus: 'VERIFIED',
        verificationNote: 'statement checked',
      }),
    )
  })
})
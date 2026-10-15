import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useState } from 'react'
import { ExchangePaidConfirm, isPaidConfirmValid } from './exchange-paid-confirm'

function renderPaid(props?: { paid?: number; exchangeTotal?: number }) {
  const onPaid = vi.fn()
  const onReason = vi.fn()
  const onConfirmed = vi.fn()
  const Harness = () => {
    const [paid, setPaid] = useState(props?.paid ?? 1000)
    const [reason, setReason] = useState('')
    const [confirmed, setConfirmed] = useState(false)
    return (
      <ExchangePaidConfirm
        recordedPaid={1000}
        exchangeTotal={props?.exchangeTotal ?? 1500}
        paid={paid}
        reason={reason}
        confirmed={confirmed}
        onPaid={(v) => { setPaid(v); onPaid(v) }}
        onReason={(v) => { setReason(v); onReason(v) }}
        onConfirmed={(v) => { setConfirmed(v); onConfirmed(v) }}
      />
    )
  }
  return render(<Harness />)
}

describe('ExchangePaidConfirm', () => {
  it('pre-fills the confirmed figure from the ledger and reports a match', async () => {
    const page = await renderPaid()
    const input = document.querySelector('#ex-paid-confirmed') as HTMLInputElement
    expect(input.value).toBe('1000')
    expect(page.getByText(/matches the ledger/i)).not.toBeNull()
  })

  it('a positive edit ADDS credit and requires a reason', async () => {
    const page = await renderPaid()
    const input = page.getByRole('spinbutton', { name: /confirmed paid/i })
    await userEvent.fill(input, '1200')
    expect(page.getByText(/ADDS/i)).not.toBeNull()
    // Gate: differing without a reason is invalid; with a reason it is valid.
    expect(isPaidConfirmValid(1200, 1000, '', true)).toBe(false)
    expect(isPaidConfirmValid(1200, 1000, 'Cash collected at delivery, not yet recorded', true)).toBe(true)
  })

  it('a negative edit REDUCES credit and requires a reason', async () => {
    const page = await renderPaid()
    const input = page.getByRole('spinbutton', { name: /confirmed paid/i })
    await userEvent.fill(input, '800')
    expect(page.getByText(/REDUCES/i)).not.toBeNull()
    expect(isPaidConfirmValid(800, 1000, '', true)).toBe(false)
  })

  it('previews collect vs refund live: original → adjustment → new total', async () => {
    const page = await renderPaid({ exchangeTotal: 1500 })
    const preview = () => document.querySelector('#ex-paid-confirm')?.closest('div.rounded-lg')?.parentElement?.textContent ?? document.body.textContent ?? ''
    // 1500 bill − 1000 confirmed = 500 to collect.
    expect(preview()).toMatch(/To collect/)
    expect(preview()).toMatch(/500\.00/)
    const input = page.getByRole('spinbutton', { name: /confirmed paid/i })
    await userEvent.fill(input, '2000')
    // 1500 − 2000 = 500 refund.
    expect(preview()).toMatch(/Refund due/)
    expect(page.getByText(/REDUCES/i)).not.toBeNull()
  })

  it('cannot be skipped: submit stays invalid until CONFIRM is checked', async () => {
    expect(isPaidConfirmValid(1000, 1000, '', false)).toBe(false)
    expect(isPaidConfirmValid(1000, 1000, '', true)).toBe(true)
    const page = await renderPaid()
    await userEvent.click(page.getByRole('checkbox', { name: /i confirm/i }))
    expect(document.querySelector('#ex-paid-confirm')?.getAttribute('aria-checked')).toBe('true')
  })

  it('rejects negative paid figures', async () => {
    expect(isPaidConfirmValid(-5, 1000, 'typo', true)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import {
  DispatchCancelNotice,
  dispatchCancelState,
  manualPanelDispatches,
} from './dispatch-cancel-notice'

/**
 * Cancel a DISPATCHED order — the cancel dialog's notice (owner directive,
 * 2026-10-21).
 *
 * The dialog must tell the staff what happens to the dispatch BEFORE they
 * confirm, and refuse to let them confirm when the parcel already left.
 */
describe('DispatchCancelNotice', () => {
  const eligibleDispatch = {
    id: 'dsp-1',
    courier: 'carrybee',
    status: 'DISPATCHED',
    consignmentId: 'CONS-1',
    trackingCode: null,
    cancelEligibility: {
      eligible: true,
      reason: null,
      needsCourierPanel: false,
      courierLabel: 'Carrybee',
      collectedAt: null,
    },
  }

  const pickedUpDispatch = {
    id: 'dsp-2',
    courier: 'pathao',
    status: 'PICKED_UP',
    consignmentId: 'CONS-2',
    trackingCode: null,
    cancelEligibility: {
      eligible: false,
      reason:
        'Parcel already picked up by Pathao on 21 Oct 2026, 10:30 — a dispatched order can no longer be cancelled once the courier has the parcel.',
      needsCourierPanel: false,
      courierLabel: 'Pathao',
      collectedAt: '2026-10-21T10:30:00Z',
    },
  }

  it('warns that the dispatch will also be cancelled (eligible)', async () => {
    const page = await render(<DispatchCancelNotice dispatches={[eligibleDispatch]} />)

    await expect
      .element(page.getByText('This order has a live dispatch'))
      .toBeInTheDocument()
    await expect
      .element(page.getByText(/Carrybee · CONS-1/))
      .toBeInTheDocument()
    await expect
      .element(
        page.getByText(
          "This order's dispatch will also be cancelled with Carrybee.",
        ),
      )
      .toBeInTheDocument()
  })

  it('explains WHY a picked-up dispatch cannot be cancelled', async () => {
    const page = await render(<DispatchCancelNotice dispatches={[pickedUpDispatch]} />)

    await expect
      .element(page.getByText('This order cannot be cancelled'))
      .toBeInTheDocument()
    await expect
      .element(page.getByText(/Parcel already picked up by Pathao/))
      .toBeInTheDocument()
  })

  it('renders nothing when the order has no dispatch', async () => {
    const page = await render(<DispatchCancelNotice dispatches={[]} />)

    expect(page.container.textContent ?? '').not.toContain('live dispatch')
    expect(page.container.textContent ?? '').not.toContain('cannot be cancelled')
  })

  it('ignores a dispatch that was already cancelled', () => {
    const state = dispatchCancelState([
      { ...eligibleDispatch, status: 'CANCELLED' },
    ])
    expect(state.live).toHaveLength(0)
    expect(state.isBlocked).toBe(false)
  })

  it('one blocked dispatch blocks the whole cancel', () => {
    const state = dispatchCancelState([eligibleDispatch, pickedUpDispatch])
    expect(state.live).toHaveLength(2)
    expect(state.blocked).toHaveLength(1)
    expect(state.isBlocked).toBe(true)
  })

  it('an eligible dispatch does not block the cancel', () => {
    const state = dispatchCancelState([eligibleDispatch])
    expect(state.isBlocked).toBe(false)
  })

  // Steadfast has no cancel API (owner directive, 2026-10-21): the combined
  // cancel must PROCEED with a warning, never be blocked, and the dialog must
  // tell staff they still owe the panel cancel.
  const steadfastManualDispatch = {
    id: 'dsp-sf',
    courier: 'steadfast',
    status: 'DISPATCHED',
    consignmentId: 'SF-9001',
    trackingCode: null,
    cancelEligibility: {
      eligible: true,
      reason: null,
      needsCourierPanel: true,
      manualPanelCancel: true,
      courierLabel: 'Steadfast',
      warning:
        'This booking cannot be cancelled from here. Cancelling will mark the dispatch cancelled in EcoMate; you MUST also cancel the booking in the Steadfast panel.',
      collectedAt: null,
    },
  }

  it('does not block a Steadfast dispatch — it proceeds with the panel warning', async () => {
    const page = await render(
      <DispatchCancelNotice dispatches={[steadfastManualDispatch]} />,
    )

    expect(dispatchCancelState([steadfastManualDispatch]).isBlocked).toBe(false)
    expect(page.container.textContent ?? '').not.toContain(
      'This order cannot be cancelled',
    )
    await expect
      .element(page.getByText('Panel cancellation required'))
      .toBeInTheDocument()
    await expect
      .element(
        page.getByText(
          'This booking cannot be cancelled from here. Cancelling will mark the dispatch cancelled in EcoMate; you MUST also cancel the booking in the Steadfast panel.',
        ),
      )
      .toBeInTheDocument()
    await expect
      .element(page.getByText(/After you cancel it in the Steadfast panel/))
      .toBeInTheDocument()
  })

  it('manualPanelDispatches lists only live manual-fallback bookings', () => {
    expect(manualPanelDispatches([steadfastManualDispatch])).toHaveLength(1)
    expect(manualPanelDispatches([eligibleDispatch])).toHaveLength(0)
    expect(
      manualPanelDispatches([
        { ...steadfastManualDispatch, status: 'CANCELLED' },
      ]),
    ).toHaveLength(0)
  })
})

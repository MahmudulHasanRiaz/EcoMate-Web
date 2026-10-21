import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { DispatchTable } from './dispatch-table'
import type { DispatchResponse } from './api'

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: any) => sel({ auth: { user: { role: 'admin' } } }),
}))

/**
 * Cancel a DISPATCHED order — the dispatch list must show the MANUAL
 * panel-cancel debt (Steadfast) until a staff member confirms it.
 */
const manualCancelled: DispatchResponse = {
  id: 'dsp-manual-1',
  orderId: 'order-1',
  courier: 'steadfast',
  consignmentId: 'SF-9001',
  trackingCode: null,
  trackingUrl: null,
  status: 'CANCELLED',
  courierStatus: null,
  courierStatusAt: null,
  lastSyncedAt: null,
  handedOverAt: null,
  pickedUpAt: null,
  deliveredAt: null,
  productMapping: {},
  notes: null,
  courierCancelMode: 'MANUAL',
  courierCancelRef: 'SF-9001',
  courierCancelAt: '2026-10-21T10:00:00.000Z',
  panelCancelPending: true,
  panelCancelConfirmedAt: null,
  panelCancelConfirmedBy: null,
  createdAt: '2026-10-21T09:00:00.000Z',
  updatedAt: '2026-10-21T10:00:00.000Z',
  order: { displayId: 'ORD-001', total: 1200 },
}

const apiCancelled: DispatchResponse = {
  ...manualCancelled,
  id: 'dsp-api-1',
  courier: 'pathao',
  courierCancelMode: 'API',
  panelCancelPending: false,
}

function renderTable(
  data: DispatchResponse[],
  onConfirmPanelCancel = vi.fn(),
) {
  return render(
    <DispatchTable
      data={data}
      total={data.length}
      pagination={{ pageIndex: 0, pageSize: 10 }}
      onPaginationChange={() => {}}
      search=''
      onSearchChange={() => {}}
      statusFilter=''
      onStatusFilterChange={() => {}}
      courierFilter=''
      onCourierFilterChange={() => {}}
      activeFilterCount={0}
      onResetFilters={() => {}}
      onDelete={() => {}}
      onSyncSelected={() => {}}
      onConfirmPanelCancel={onConfirmPanelCancel}
      confirmingId={null}
    />,
  )
}

describe('DispatchTable — panel cancellation pending', () => {
  it('shows the pending marker only for an unconfirmed MANUAL cancel', async () => {
    const page = await renderTable([manualCancelled, apiCancelled])

    await expect
      .element(page.getByText('Panel cancellation pending'))
      .toBeInTheDocument()
    expect(page.container.textContent?.match(/Panel cancellation pending/g))
      .toHaveLength(1)
  })

  it('confirms the panel cancellation for the clicked dispatch', async () => {
    const onConfirm = vi.fn()
    const page = await renderTable([manualCancelled], onConfirm)

    await page.getByRole('button', { name: /Confirm panel cancellation/i }).click()

    expect(onConfirm).toHaveBeenCalledWith('dsp-manual-1')
  })

  it('offers no confirm action when nothing is pending', async () => {
    const page = await renderTable([apiCancelled])

    expect(page.container.textContent ?? '').not.toContain(
      'Panel cancellation pending',
    )
    expect(
      page.container.textContent ?? '',
    ).not.toContain('Confirm panel cancellation')
  })
})

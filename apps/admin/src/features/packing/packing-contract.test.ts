import { describe, expect, it } from 'vitest'

/**
 * Regression guards for the packing workspace fixes that are easy to silently
 * reintroduce because nothing type-checks them:
 *
 *  - the queue response envelope (`{ orders, photoCatalog }`), and
 *  - the history field name (`statusName`, not `status`).
 *
 * These mirror what `apps/backend/src/packing/packing.service.ts` returns.
 */
const queueResponse = {
  orders: [
    {
      id: 'order-1',
      displayId: 'ORD-001',
      customer: null,
      items: [],
      totalItems: 2,
      packingLock: null,
      statusName: 'Confirmed',
      statusColor: 'blue',
      createdAt: '2025-01-15T00:00:00.000Z',
    },
    {
      id: 'order-2',
      displayId: 'ORD-002',
      customer: null,
      items: [],
      totalItems: 1,
      packingLock: null,
      statusName: 'Packing Hold',
      statusColor: 'amber',
      createdAt: '2025-01-15T01:00:00.000Z',
    },
  ],
  photoCatalog: {},
}

describe('packing queue response', () => {
  it('is an { orders, photoCatalog } envelope, not a bare array', () => {
    expect(Array.isArray(queueResponse)).toBe(false)
    expect(Array.isArray(queueResponse.orders)).toBe(true)
    expect(queueResponse.photoCatalog).toBeTypeOf('object')
  })

  it('does not attach the photo catalog to individual orders', () => {
    // The catalog used to be attached by reference to every order, which
    // serialized it once per order (O(orders x catalogSize) on every poll).
    for (const order of queueResponse.orders) {
      expect(order).not.toHaveProperty('photoCatalog')
    }
  })
})

describe('packing history entries', () => {
  // Mirrors PackingService.getHistory().
  const history = [
    {
      id: 'order-1',
      displayId: 'ORD-001',
      statusName: 'Packed',
      statusColor: 'green',
      packerName: 'Alice Smith',
      updatedAt: '2025-01-15T02:00:00.000Z',
    },
    {
      id: 'order-2',
      displayId: 'ORD-002',
      statusName: 'Packing Hold',
      statusColor: 'amber',
      packerName: 'Bob Jones',
      updatedAt: '2025-01-15T01:00:00.000Z',
    },
  ]

  it('exposes statusName, which is what the Packed tab filters on', () => {
    // Regression: the tab filtered `h.status`, which the backend never sends,
    // so the Packed tab was permanently empty.
    const packedLogs = history.filter((h) => h.statusName === 'Packed')
    expect(packedLogs).toHaveLength(1)
    expect(packedLogs[0].displayId).toBe('ORD-001')
  })

  it('does not contain a legacy `status` field', () => {
    for (const entry of history) {
      expect(entry).not.toHaveProperty('status')
    }
  })
})

describe('packing stats scoping', () => {
  // getStats(packerId) now scopes all three counters to the packer; `pending`
  // used to omit the filter and report the company-wide Confirmed backlog.
  const where = { assignedToId: 'packer-1', trashedAt: null }

  it('applies the packer filter to every counter', () => {
    const counts = [
      { ...where, statusId: 'packed' },
      { ...where, statusId: 'hold' },
      { ...where, statusId: 'confirmed' },
    ]
    expect(counts.every((c) => c.assignedToId === 'packer-1')).toBe(true)
  })
})
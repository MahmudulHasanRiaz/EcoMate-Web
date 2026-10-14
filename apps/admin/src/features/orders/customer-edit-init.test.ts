import { describe, it, expect } from 'vitest'
import { resolveCustomerEditInitial } from './customer-edit-sheet'

describe('resolveCustomerEditInitial (D-A write parity)', () => {
  it('inits from snapshot fields, not the stale profile', () => {
    const order = {
      customerFirstName: 'MR',
      customerLastName: 'Joy',
      customerPhone: '01711111111',
      customerEmail: 'new@example.com',
      customer: { firstName: 'OLD', lastName: 'PROFILE', phoneNumber: 'STALE', email: 'old@example.com' },
    }
    expect(resolveCustomerEditInitial(order)).toEqual({
      firstName: 'MR',
      lastName: 'Joy',
      phone: '01711111111',
      email: 'new@example.com',
    })
  })

  it('falls back to guest phone when snapshot phone is absent', () => {
    const order = { guestPhone: '01822222222', customer: null }
    expect(resolveCustomerEditInitial(order).phone).toBe('01822222222')
  })

  it('falls back to the GET-mapped customer only when snapshot is absent', () => {
    const order = {
      customer: { firstName: 'Mapped', lastName: 'Snap', phoneNumber: '01900000000', email: 'm@example.com' },
    }
    expect(resolveCustomerEditInitial(order)).toEqual({
      firstName: 'Mapped',
      lastName: 'Snap',
      phone: '01900000000',
      email: 'm@example.com',
    })
  })

  it('returns empty strings when the order carries no identity', () => {
    expect(resolveCustomerEditInitial({ customer: null })).toEqual({
      firstName: '',
      lastName: '',
      phone: '',
      email: '',
    })
  })
})

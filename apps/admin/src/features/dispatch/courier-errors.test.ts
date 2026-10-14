import { describe, expect, it } from 'vitest'
import {
  formatCourierDispatchToast,
  formatCourierFieldLines,
} from './courier-errors'

describe('courier-errors — Fix 5 field-level UI errors', () => {
  it('splits a shaped message into head + exact field+rule lines (no duplication)', () => {
    const lines = formatCourierFieldLines({
      id: 'order-1',
      ok: false,
      courier: 'steadfast',
      status: 400,
      message:
        "Steadfast: request rejected — field 'recipient_name' The name is too long.",
      errors: { recipient_name: ['The name is too long.'] },
    } as any)
    expect(lines[0]).toBe('Steadfast: request rejected')
    expect(lines).toContain("field 'recipient_name' The name is too long.")
    // The errors object must not produce a second copy of the same field line.
    expect(lines.filter((l) => l.includes('recipient_name'))).toHaveLength(1)
  })

  it('keeps bulk raw codes alongside the readable rule', () => {
    const toast = formatCourierDispatchToast({
      orderId: 'ORD-1-DUP',
      courier: 'steadfast',
      message:
        "Steadfast [ORD-1-DUP]: field 'invoice' already booked — safe to skip, a retry will not double-book (THIS_INVOICE_ALREADY_EXISTS)",
      errors: { codes: ['THIS_INVOICE_ALREADY_EXISTS'], invoice: 'ORD-1-DUP' },
    } as any)
    expect(toast).toContain("field 'invoice'")
    expect(toast).toContain('codes: THIS_INVOICE_ALREADY_EXISTS')
  })

  it('passes plain messages through untouched', () => {
    expect(formatCourierFieldLines({ message: 'Already dispatched' } as any)).toEqual([
      'Already dispatched',
    ])
  })

  it('derives field lines from the errors object when the message names none', () => {
    const lines = formatCourierFieldLines({
      message: 'Carrybee: Validation error',
      errors: { mobile: [{ type: 'invalid_format', attribute: {} }] },
    } as any)
    expect(lines[0]).toBe('Carrybee: Validation error')
    expect(lines).toContain("field 'mobile' invalid_format")
  })

  it('falls back to a generic line when both message and errors are missing', () => {
    expect(formatCourierFieldLines({} as any)).toEqual(['Dispatch failed'])
  })
})

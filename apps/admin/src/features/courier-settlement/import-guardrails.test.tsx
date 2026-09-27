import { describe, expect, it } from 'vitest'
import { SUPPORTED_COURIERS } from './import-wizard'
import { DRAFT_STATES } from './invoices-table'

/**
 * Import guardrails: the wizard may only offer couriers that have a parser AND
 * an approved financial rule, and the Invoices tab must recognise exactly the
 * draft states the backend can resume (anything else would offer a "Continue"
 * button that the API answers with 409.
 */
describe('courier settlement import guardrails', () => {
  it('offers exactly the four supported couriers', () => {
    expect([...SUPPORTED_COURIERS].sort()).toEqual(['carrybee', 'pathao', 'redx', 'steadfast'])
    expect(SUPPORTED_COURIERS).not.toContain('paperfly')
    expect(SUPPORTED_COURIERS).not.toContain('ecourier')
  })

  it('treats only backend draft states as resumable', () => {
    expect([...DRAFT_STATES].sort()).toEqual(['ANALYZED', 'MAPPING_REQUIRED', 'UPLOADED'])
    expect(DRAFT_STATES).not.toContain('IMPORTING')
    expect(DRAFT_STATES).not.toContain('ISSUE_FOUND')
  })
})

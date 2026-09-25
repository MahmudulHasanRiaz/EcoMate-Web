import { describe, it, expect } from 'vitest'
import { runStatusTone, syncPollInterval, failureSummary, shortHash } from './sync-api'

describe('sync-api helpers (P4 Sync Center)', () => {
  it('runStatusTone maps run status to badge tones', () => {
    expect(runStatusTone('SUCCESS')).toBe('success')
    expect(runStatusTone('PARTIAL')).toBe('warning')
    expect(runStatusTone('FAILED')).toBe('destructive')
    expect(runStatusTone('RUNNING')).toBe('info')
    expect(runStatusTone('CANCELLED')).toBe('muted')
  })

  it('syncPollInterval is 5s while a run is RUNNING, 30s otherwise', () => {
    expect(syncPollInterval(undefined)).toBe(30000)
    expect(syncPollInterval([])).toBe(30000)
    expect(
      syncPollInterval([{ status: 'SUCCESS' } as never]),
    ).toBe(30000)
    expect(
      syncPollInterval([{ status: 'SUCCESS' }, { status: 'RUNNING' }] as never),
    ).toBe(5000)
  })

  it('failureSummary leads with a business sentence and a primary action', () => {
    const partial = failureSummary(
      { status: 'PARTIAL', failedCount: 2, totalCount: 10 } as never,
      'Woo Store',
    )
    expect(partial.sentence).toMatch(/Woo Store.*partially failed/)
    expect(partial.action).toBe('Review failed items')
    const failed = failureSummary({ status: 'FAILED' } as never)
    expect(failed.action).toBe('Reconnect Store')
  })

  it('shortHash truncates 64-hex baselines, passes through short values', () => {
    expect(shortHash(null)).toBe('—')
    expect(shortHash('abc')).toBe('abc')
    expect(shortHash('a'.repeat(64))).toBe(`${'a'.repeat(8)}…aaaa`)
  })
})

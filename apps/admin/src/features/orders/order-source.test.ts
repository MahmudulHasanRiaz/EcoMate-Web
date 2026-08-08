import { describe, expect, it } from 'vitest'
import { resolveOrderSource, ORDER_SOURCE_LABELS } from './order-source'

describe('resolveOrderSource', () => {
  it.each([
    ['WEBSITE', 'Website', true],
    ['TIKTOK', 'TikTok', true],
    ['FACEBOOK', 'Facebook', true],
    ['INSTAGRAM', 'Instagram', true],
    ['MESSENGER', 'Messenger', true],
    ['WHATSAPP', 'WhatsApp', true],
    ['THREADS', 'Threads', true],
    ['CALL', 'Call', true],
    ['WALK_IN', 'Walk-in', true],
    ['OTHER', 'Other', true],
  ])('maps enum value %s → "%s" badge (known)', (raw, expectedLabel, known) => {
    const resolved = resolveOrderSource(raw)
    expect(resolved).not.toBeNull()
    expect(resolved?.label).toBe(expectedLabel)
    expect(resolved?.known).toBe(known)
    expect(ORDER_SOURCE_LABELS[raw]).toBe(expectedLabel)
  })

  it('maps legacy "TikTok Chat" to a graceful fallback badge, not a hardcoded one', () => {
    const resolved = resolveOrderSource('TikTok Chat')
    expect(resolved).not.toBeNull()
    expect(resolved?.label).toBe('TikTok Chat')
    expect(resolved?.known).toBe(false)
  })

  it('maps legacy "Instagram Chat" to a graceful fallback badge', () => {
    const resolved = resolveOrderSource('Instagram Chat')
    expect(resolved?.label).toBe('Instagram Chat')
    expect(resolved?.known).toBe(false)
  })

  it('maps legacy "Facebook Chat" to a graceful fallback badge', () => {
    const resolved = resolveOrderSource('Facebook Chat')
    expect(resolved?.label).toBe('Facebook Chat')
    expect(resolved?.known).toBe(false)
  })

  it('is case-insensitive for enum values', () => {
    expect(resolveOrderSource('website')?.label).toBe('Website')
    expect(resolveOrderSource('whatsapp')?.label).toBe('WhatsApp')
  })

  it('humanizes unknown snake_case values', () => {
    const resolved = resolveOrderSource('WEBSITE_MANUAL')
    expect(resolved?.label).toBe('Website Manual')
    expect(resolved?.known).toBe(false)
  })

  it('returns null for null/undefined/empty source', () => {
    expect(resolveOrderSource(null)).toBeNull()
    expect(resolveOrderSource(undefined)).toBeNull()
    expect(resolveOrderSource('')).toBeNull()
    expect(resolveOrderSource('   ')).toBeNull()
  })
})
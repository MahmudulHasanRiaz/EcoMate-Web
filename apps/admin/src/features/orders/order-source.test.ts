import { describe, expect, it } from 'vitest'
import { resolveOrderSource, resolveOrderAttribution, ORDER_SOURCE_LABELS } from './order-source'

describe('resolveOrderAttribution', () => {
  it('shows the platform badge alongside the entity badge', () => {
    const badges = resolveOrderAttribution({
      salesChannel: 'WEBSITE',
      sourcePlatform: 'FACEBOOK',
      sourceType: 'AD',
      sourceEntity: 'EcoMate Store',
    })

    expect(badges.map(b => b.label)).toEqual(['Website', 'EcoMate Store', 'Facebook · Ad'])
  })

  it('shows the platform badge alone when no entity is recorded', () => {
    const badges = resolveOrderAttribution({
      salesChannel: 'WEBSITE',
      sourcePlatform: 'GOOGLE',
      sourceType: 'AD',
    })

    expect(badges.map(b => b.label)).toEqual(['Website', 'Google · Ad'])
  })

  it('renders a Google organic visit as Direct, not as an ad', () => {
    const badges = resolveOrderAttribution({
      salesChannel: 'WEBSITE',
      sourcePlatform: 'GOOGLE',
      sourceType: 'DIRECT',
    })

    expect(badges.map(b => b.label)).toEqual(['Website', 'Google · Direct'])
  })

  it('returns nothing when the order carries no attribution', () => {
    expect(resolveOrderAttribution({})).toEqual([])
  })

  it('prefers the canonical channel over the legacy salesChannel', () => {
    const badges = resolveOrderAttribution({
      salesChannel: 'FACEBOOK',
      channel: 'MESSAGING',
      sourceSlug: 'direct',
    })

    expect(badges.map(b => b.label)).toEqual(['Messaging', 'Direct'])
    expect(badges.map(b => b.label)).not.toContain('Facebook')
    expect(badges[0].kind).toBe('channel')
  })

  it('renders the sourceSlug "direct" as a Direct badge', () => {
    const badges = resolveOrderAttribution({ channel: 'WEBSITE', sourceSlug: 'direct' })

    expect(badges.map(b => b.label)).toEqual(['Website', 'Direct'])
    expect(badges[1].kind).toBe('source')
  })
})

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
    ['GOOGLE', 'Google', true],
    ['YOUTUBE', 'YouTube', true],
    ['BING', 'Bing', true],
    ['SNAPCHAT', 'Snapchat', true],
    ['PINTEREST', 'Pinterest', true],
    ['LINKEDIN', 'LinkedIn', true],
    ['TWITTER', 'X (Twitter)', true],
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
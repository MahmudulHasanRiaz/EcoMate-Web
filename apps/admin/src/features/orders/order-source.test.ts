import { describe, expect, it } from 'vitest'
import {
  resolveOrderSource,
  ORDER_SOURCE_LABELS,
  resolveMarketingChannel,
  resolveSalesChannelType,
  resolveOrderAttribution,
} from './order-source'

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

describe('P8 canonical badges (§9.2, BR-18)', () => {
  it.each([
    ['FACEBOOK', 'Facebook'],
    ['MESSENGER', 'Messenger'],
    ['INSTAGRAM', 'Instagram'],
    ['INSTAGRAM_INBOX', 'Instagram Inbox'],
    ['TIKTOK', 'TikTok'],
    ['TIKTOK_INBOX', 'TikTok Inbox'],
    ['WHATSAPP', 'WhatsApp'],
    ['THREADS', 'Threads'],
    ['OTHER', 'Other'],
  ])('maps MarketingChannel %s → "%s"', (raw, label) => {
    expect(resolveMarketingChannel(raw)?.label).toBe(label)
  })

  it('CALL is not a marketing channel (order origin, never platform)', () => {
    expect(resolveMarketingChannel('CALL')).toBeNull()
    expect(resolveMarketingChannel('PHONE')).toBeNull()
    expect(resolveMarketingChannel('DIRECT')).toBeNull()
    expect(resolveMarketingChannel(null)).toBeNull()
    expect(resolveMarketingChannel('BOGUS')).toBeNull()
  })

  it('maps sales-channel types', () => {
    expect(resolveSalesChannelType('ONLINE')?.label).toBe('Online')
    expect(resolveSalesChannelType('OFFLINE')?.label).toBe('Offline')
    expect(resolveSalesChannelType(null)).toBeNull()
  })

  it('appends canonical badges after legacy ones, legacy-only rows unchanged', () => {
    const legacyOnly = resolveOrderAttribution({ salesChannel: 'WEBSITE' })
    expect(legacyOnly).toHaveLength(1)
    expect(legacyOnly[0].label).toBe('Website')

    const full = resolveOrderAttribution({
      salesChannel: 'POS',
      sourcePlatform: 'POS',
      sourceType: 'SHOWROOM',
      sourceEntity: 'Dhanmondi Showroom',
      salesChannelType: 'OFFLINE',
      marketingChannel: null,
      showroomName: 'Dhanmondi Showroom',
    })
    const labels = full.map((b) => b.label)
    expect(labels[0]).toBe('POS')
    expect(labels).toContain('Offline')
    expect(labels).toContain('Dhanmondi Showroom')
  })

  it('renders inbox-variant marketing badges', () => {
    const badges = resolveOrderAttribution({
      salesChannel: 'OFFLINE',
      sourceType: 'CHAT',
      sourcePlatform: 'TIKTOK',
      salesChannelType: 'OFFLINE',
      marketingChannel: 'TIKTOK_INBOX',
    })
    expect(badges.map((b) => b.label)).toContain('TikTok Inbox')
  })
})
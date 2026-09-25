import { Globe, Store, Phone, MessageCircle, Tag, Megaphone, MousePointerClick, type LucideIcon } from 'lucide-react'

export interface ResolvedOrderSource {
  label: string
  Icon: LucideIcon
  known: boolean
  tone: string
}

export const ORDER_SOURCE_LABELS: Record<string, string> = {
  WEBSITE: 'Website',
  POS: 'POS',
  WALK_IN: 'Walk-in',
  OFFLINE: 'Offline',
  TIKTOK: 'TikTok',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  MESSENGER: 'Messenger',
  WHATSAPP: 'WhatsApp',
  THREADS: 'Threads',
  CALL: 'Call',
  DIRECT: 'Direct',
  PHONE: 'Phone',
  OTHER: 'Other',
}

const ICONS: Record<string, LucideIcon> = {
  WEBSITE: Globe,
  POS: Store,
  WALK_IN: Store,
  OFFLINE: Tag,
  CALL: Phone,
  PHONE: Phone,
  DIRECT: MousePointerClick,
  OTHER: Tag,
}

const TONES: Record<string, string> = {
  WEBSITE: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  POS: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  WALK_IN: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  OFFLINE: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  TIKTOK: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  FACEBOOK: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  INSTAGRAM: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  MESSENGER: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  WHATSAPP: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  THREADS: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  CALL: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  PHONE: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  DIRECT: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  OTHER: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
}

const CHAT_ICON = MessageCircle
const AD_ICON = Megaphone
const FALLBACK_ICON = Tag
const FALLBACK_TONE = 'bg-slate-500/10 text-slate-600 dark:text-slate-400'

/** Printable labels for the sourceType dimension (shown in source badges). */
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  DIRECT: 'Direct',
  AD: 'Ad',
  CHAT: 'Chat',
  CALL: 'Call',
  SHOWROOM: 'Showroom',
}

/**
 * P8 canonical labels (§9.2, BR-18). The canonical MarketingChannel enum has
 * no CALL — a phone call is an order origin, never a marketing platform.
 */
export const MARKETING_CHANNEL_LABELS: Record<string, string> = {
  FACEBOOK: 'Facebook',
  MESSENGER: 'Messenger',
  INSTAGRAM: 'Instagram',
  INSTAGRAM_INBOX: 'Instagram Inbox',
  TIKTOK: 'TikTok',
  TIKTOK_INBOX: 'TikTok Inbox',
  WHATSAPP: 'WhatsApp',
  THREADS: 'Threads',
  OTHER: 'Other',
}

const MARKETING_TONES: Record<string, string> = {
  FACEBOOK: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  MESSENGER: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  INSTAGRAM: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  INSTAGRAM_INBOX: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  TIKTOK: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  TIKTOK_INBOX: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  WHATSAPP: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  THREADS: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  OTHER: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
}

export const SALES_CHANNEL_TYPE_LABELS: Record<string, string> = {
  ONLINE: 'Online',
  OFFLINE: 'Offline',
}

/** Resolves a canonical marketing channel to a badge (null when absent). */
export function resolveMarketingChannel(raw: string | null | undefined): ResolvedOrderSource | null {
  if (!raw || !raw.trim()) return null
  const key = raw.trim().toUpperCase()
  if (!(key in MARKETING_CHANNEL_LABELS)) return null
  return {
    label: MARKETING_CHANNEL_LABELS[key],
    Icon: CHAT_ICON,
    known: true,
    tone: MARKETING_TONES[key] ?? FALLBACK_TONE,
  }
}

/** Resolves a canonical sales-channel type to a badge (null when absent). */
export function resolveSalesChannelType(raw: string | null | undefined): ResolvedOrderSource | null {
  if (!raw || !raw.trim()) return null
  const key = raw.trim().toUpperCase()
  if (!(key in SALES_CHANNEL_TYPE_LABELS)) return null
  return {
    label: SALES_CHANNEL_TYPE_LABELS[key],
    Icon: key === 'ONLINE' ? Globe : Store,
    known: true,
    tone: key === 'ONLINE'
      ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
      : 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  }
}

function titleCase(input: string): string {
  const trimmed = input.trim()
  const normalized = trimmed === trimmed.toUpperCase() ? trimmed.toLowerCase() : trimmed
  return normalized.replace(/_+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim()
}

/**
 * Resolves the authoritative order source (`Order.salesChannel`) into a
 * display label + icon + tone. Known enum values map to their platform label.
 * Unknown/legacy values (e.g. legacy free-form strings like "TikTok Chat")
 * fall back gracefully to a humanized label with neutral styling.
 * Returns null when there is no source at all.
 */
export function resolveOrderSource(raw: string | null | undefined): ResolvedOrderSource | null {
  if (!raw || !raw.trim()) return null
  const key = raw.trim().toUpperCase()
  const known = key in ORDER_SOURCE_LABELS
  return {
    label: known ? ORDER_SOURCE_LABELS[key] : titleCase(raw.trim()),
    Icon: known ? ICONS[key] ?? CHAT_ICON : FALLBACK_ICON,
    known,
    tone: known ? TONES[key] ?? FALLBACK_TONE : FALLBACK_TONE,
  }
}

export interface OrderAttribution {
  salesChannel?: string | null
  sourcePlatform?: string | null
  sourceType?: string | null
  sourceEntity?: string | null
  // P8 canonical dimensions (§9, BR-18). Optional: badges render whenever
  // present; legacy-only orders render exactly as before.
  salesChannelType?: 'ONLINE' | 'OFFLINE' | string | null
  marketingChannel?: string | null
  showroomName?: string | null
}

export interface AttributionBadge {
  label: string
  Icon: LucideIcon
  tone: string
  /** Use to distinguish the primary channel badge from the secondary source badge. */
  kind: 'channel' | 'source'
}

/**
 * Builds the compact attribution badge set (lightweight Shopify-style) for an
 * order. Primary badge = the sales channel ("where the sale completed");
 * secondary badge = source entity when present (storefront/showroom identity),
 * otherwise `Platform · Type` (e.g. "Facebook · Ad", "WhatsApp · Chat").
 *
 * P8 additive: when canonical dimensions are present (salesChannelType,
 * marketingChannel, showroomName), matching badges are appended AFTER the
 * legacy ones — legacy-only orders render exactly as before.
 */
export function resolveOrderAttribution(
  attribution: OrderAttribution,
): AttributionBadge[] {
  const badges: AttributionBadge[] = []

  const salesChannel = (attribution.salesChannel || '').trim()
  const channel = resolveOrderSource(salesChannel)
  if (channel) {
    badges.push({
      label: channel.label,
      Icon: channel.Icon,
      tone: channel.tone,
      kind: 'channel',
    })
  }

  const platform = (attribution.sourcePlatform || '').trim()
  const type = (attribution.sourceType || '').trim()
  const entity = (attribution.sourceEntity || '').trim()

  if (entity) {
    // Showroom / storefront identity — the strongest source signal.
    badges.push({
      label: entity,
      Icon: Store,
      tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
      kind: 'source',
    })
  } else if (platform || type) {
    const platformKey = platform.toUpperCase()
    const platformLabel = platformKey in ORDER_SOURCE_LABELS ? ORDER_SOURCE_LABELS[platformKey] : titleCase(platform)
    const typeLabel = type ? (SOURCE_TYPE_LABELS[type.toUpperCase()] ?? titleCase(type)) : ''
    const label = [platformLabel, typeLabel].filter(Boolean).join(' · ')
    const Icon =
      type.toUpperCase() === 'AD'
        ? AD_ICON
        : type.toUpperCase() === 'CHAT'
          ? CHAT_ICON
          : platformKey in ICONS
            ? ICONS[platformKey]
            : FALLBACK_ICON
    badges.push({
      label,
      Icon,
      tone: platformKey in TONES ? TONES[platformKey] : FALLBACK_TONE,
      kind: 'source',
    })
  }

  // P8 canonical badges (additive, after legacy): sales type, marketing
  // platform (incl. inbox variants), showroom name.
  const salesType = resolveSalesChannelType(attribution.salesChannelType)
  if (salesType) {
    badges.push({ label: salesType.label, Icon: salesType.Icon, tone: salesType.tone, kind: 'channel' })
  }
  const marketing = resolveMarketingChannel(attribution.marketingChannel)
  if (marketing) {
    badges.push({ label: marketing.label, Icon: marketing.Icon, tone: marketing.tone, kind: 'source' })
  }
  const showroom = (attribution.showroomName || '').trim()
  if (showroom) {
    badges.push({
      label: showroom,
      Icon: Store,
      tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
      kind: 'source',
    })
  }

  return badges
}
import { Globe, Store, Phone, MessageCircle, Tag, Megaphone, MousePointerClick, Search, Ghost, Pin, type LucideIcon } from 'lucide-react'

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
  GOOGLE: 'Google',
  YOUTUBE: 'YouTube',
  BING: 'Bing',
  SNAPCHAT: 'Snapchat',
  PINTEREST: 'Pinterest',
  LINKEDIN: 'LinkedIn',
  TWITTER: 'X (Twitter)',
  YAHOO: 'Yahoo',
  DUCKDUCKGO: 'DuckDuckGo',
  YANDEX: 'Yandex',
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
  GOOGLE: Search,
  BING: Search,
  YAHOO: Search,
  DUCKDUCKGO: Search,
  YANDEX: Search,
  YOUTUBE: Globe,
  LINKEDIN: Globe,
  SNAPCHAT: Ghost,
  PINTEREST: Pin,
  TWITTER: MessageCircle,
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
  GOOGLE: 'bg-red-500/10 text-red-600 dark:text-red-400',
  YOUTUBE: 'bg-red-500/10 text-red-600 dark:text-red-400',
  BING: 'bg-green-500/10 text-green-600 dark:text-green-400',
  SNAPCHAT: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  PINTEREST: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  LINKEDIN: 'bg-sky-700/10 text-sky-700 dark:text-sky-400',
  TWITTER: 'bg-slate-700/10 text-slate-700 dark:text-slate-300',
  YAHOO: 'bg-purple-600/10 text-purple-700 dark:text-purple-300',
  DUCKDUCKGO: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  YANDEX: 'bg-red-600/10 text-red-700 dark:text-red-300',
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
  channel?: string | null
  channelEntity?: string | null
  sourceSlug?: string | null
  acquisitionType?: string | null
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
 * order. Primary badge = the canonical channel ("where the sale completed");
 * secondary badge = source platform when present (e.g. "Facebook · Ad"),
 * otherwise the channel entity.
 */
export function resolveOrderAttribution(
  attribution: OrderAttribution,
): AttributionBadge[] {
  const badges: AttributionBadge[] = []

  // Canonical channel (preferred) — the four venues.
  const channel = (attribution.channel || '').trim()
  if (channel) {
    const channelKey = channel.toUpperCase()
    const channelLabel = channelKey in ORDER_SOURCE_LABELS ? ORDER_SOURCE_LABELS[channelKey] : titleCase(channel)
    badges.push({
      label: channelLabel,
      Icon: ICONS[channelKey] ?? FALLBACK_ICON,
      tone: TONES[channelKey] ?? FALLBACK_TONE,
      kind: 'channel',
    })
  }

  // Legacy salesChannel — only when the canonical channel is absent.
  if (!channel) {
    const salesChannel = (attribution.salesChannel || '').trim()
    const legacy = resolveOrderSource(salesChannel)
    if (legacy) {
      badges.push({
        label: legacy.label,
        Icon: legacy.Icon,
        tone: legacy.tone,
        kind: 'channel',
      })
    }
  }

  // Channel entity — the specific origin within a venue.
  const channelEntity = (attribution.channelEntity || '').trim()
  if (channelEntity) {
    badges.push({
      label: channelEntity,
      Icon: Store,
      tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
      kind: 'source',
    })
  }

  // Source platform — the marketing platform that brought the order.
  const sourceSlug = (attribution.sourceSlug || '').trim()
  const platform = (attribution.sourcePlatform || '').trim()
  const type = (attribution.sourceType || '').trim()
  const entity = (attribution.sourceEntity || '').trim()

  if (sourceSlug) {
    const slugLabel = titleCase(sourceSlug)
    badges.push({
      label: slugLabel,
      Icon: FALLBACK_ICON,
      tone: FALLBACK_TONE,
      kind: 'source',
    })
  } else if (entity) {
    badges.push({
      label: entity,
      Icon: Store,
      tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
      kind: 'source',
    })
  }

  if (platform || type) {
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

  return badges
}
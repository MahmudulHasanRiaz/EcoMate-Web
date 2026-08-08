import { Globe, Store, Phone, MessageCircle, Tag, type LucideIcon } from 'lucide-react'

export interface ResolvedOrderSource {
  label: string
  Icon: LucideIcon
  known: boolean
  tone: string
}

export const ORDER_SOURCE_LABELS: Record<string, string> = {
  WEBSITE: 'Website',
  TIKTOK: 'TikTok',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  MESSENGER: 'Messenger',
  WHATSAPP: 'WhatsApp',
  THREADS: 'Threads',
  CALL: 'Call',
  WALK_IN: 'Walk-in',
  OTHER: 'Other',
}

const ICONS: Record<string, LucideIcon> = {
  WEBSITE: Globe,
  WALK_IN: Store,
  CALL: Phone,
  OTHER: Tag,
}

const TONES: Record<string, string> = {
  WEBSITE: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  TIKTOK: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  FACEBOOK: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  INSTAGRAM: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  MESSENGER: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  WHATSAPP: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  THREADS: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  CALL: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  WALK_IN: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  OTHER: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
}

const CHAT_ICON = MessageCircle
const FALLBACK_ICON = Tag
const FALLBACK_TONE = 'bg-slate-500/10 text-slate-600 dark:text-slate-400'

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
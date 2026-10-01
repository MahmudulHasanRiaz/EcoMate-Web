import { Globe, MessageCircle, Phone, Store, Megaphone, Search, CircleSlash } from 'lucide-react'
import { CHANNEL_LABELS, displayValue, type ChannelV2 } from './sales-channel-options'

const CHANNEL_ICON: Record<ChannelV2, typeof Globe> = {
  WEBSITE: Globe,
  MESSAGING: MessageCircle,
  PHONE_CALL: Phone,
  POS: Store,
}

const ACQUISITION_ICON: Record<string, typeof Megaphone> = {
  PAID: Megaphone,
  ORGANIC: Search,
  DIRECT: CircleSlash,
  UNKNOWN: CircleSlash,
}

/**
 * Canonical Channel · Entity · Source · Acquisition.
 *
 * Four independent dimensions shown as four distinct facts — Channel ≠ Source
 * ≠ Acquisition is the whole point, so they are never collapsed into one
 * badge. An empty value renders as an em dash, which reflects a genuine NULL:
 * nothing is invented to fill the gap.
 */
export function CanonicalAttributionBadges(props: {
  channel?: ChannelV2 | string | null
  channelEntity?: string | null
  sourceSlug?: string | null
  acquisitionType?: string | null
  sourceLabel?: string | null
}) {
  const { channel, channelEntity, sourceSlug, acquisitionType, sourceLabel } = props
  const ch = channel as ChannelV2 | null
  const ChIcon = ch && ch in CHANNEL_ICON ? CHANNEL_ICON[ch] : null;
  const AcqIcon = acquisitionType ? ACQUISITION_ICON[acquisitionType] : null;

  return (
    <span className='inline-flex flex-wrap items-center gap-1'>
      {ch && ChIcon ? (
        <span className='inline-flex items-center gap-1 rounded border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground'>
          <ChIcon className='size-2.5' />
          {CHANNEL_LABELS[ch] ?? ch}
        </span>
      ) : null}

      {channelEntity ? (
        <span className='inline-flex items-center gap-1 rounded border border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 text-[10px] font-medium'>
          {displayValue(channelEntity)}
        </span>
      ) : null}

      {sourceSlug ? (
        <span className='inline-flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 text-[10px] font-medium'>
          {sourceLabel ?? sourceSlug}
        </span>
      ) : null}

      {acquisitionType ? (
        <span className='inline-flex items-center gap-1 rounded border border-border/70 bg-muted/40 text-muted-foreground px-1.5 py-0.5 text-[10px] font-medium'>
          {AcqIcon ? <AcqIcon className='size-2.5' /> : null}
          {acquisitionType}
        </span>
      ) : null}
    </span>
  )
}

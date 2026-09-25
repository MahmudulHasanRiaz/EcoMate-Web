/**
 * Centralized Meta `action_source` resolver (spec §11).
 *
 * The business attribution model (salesChannel / sourcePlatform / sourceType)
 * and the Meta transport field are related but NOT interchangeable. This is the
 * one place that maps an order's sales/source context onto the Meta CAPI
 * enum. Values are verified against the current CAPI specification:
 *
 *   website, email, app, phone_call, chat, physical_store, system_generated,
 *   business_messaging, other
 *
 * Business mapping (spec §11 minimums):
 *   WEBSITE     -> 'website'
 *   POS/WALK_IN -> 'physical_store'
 *   CALL        -> 'phone_call'
 *   CHAT        -> 'chat'            (social/offline chat: Messenger, WhatsApp, TikTok chat)
 *
 * A centralized resolver is required so the same mapping is used by normal
 * Purchase, validated Purchase, POS Purchase, manual/offline Purchase and
 * Refund — never a `salesChannel === 'WEBSITE' ? 'website' : 'physical_store'`
 * binary baked into each call site.
 */

import { newSalesChannelModelEnabled } from '../orders/channels/channel-flags';

export type MetaActionSource =
  | 'email'
  | 'website'
  | 'app'
  | 'phone_call'
  | 'chat'
  | 'physical_store'
  | 'system_generated'
  | 'business_messaging'
  | 'other';

export const META_ACTION_SOURCES: readonly MetaActionSource[] = [
  'email',
  'website',
  'app',
  'phone_call',
  'chat',
  'physical_store',
  'system_generated',
  'business_messaging',
  'other',
];

export function isMetaActionSource(value: string): value is MetaActionSource {
  return (META_ACTION_SOURCES as readonly string[]).includes(value);
}

const PLATFORM_CHAT = new Set([
  'FACEBOOK',
  'INSTAGRAM',
  'TIKTOK',
  'MESSENGER',
  'WHATSAPP',
  'THREADS',
]);

export interface OrderAttributionContext {
  salesChannel?: string | null;
  sourcePlatform?: string | null;
  sourceType?: string | null;
  // P8 additive (§9.3 dual-read): canonical dimensions. Read only with the
  // new-channel model flag on; legacy fields drive the result when off.
  salesChannelType?: string | null;
  marketingChannel?: string | null;
  storeId?: string | null;
}

export const DEFAULT_ACTION_SOURCE: MetaActionSource = 'website';

/**
 * Canonical chat platforms (P8 MarketingChannel set). With the flag on, a
 * resolved canonical marketing channel decides 'chat' directly — this also
 * fixes legacy `*_CHAT` channel strings (e.g. 'TikTok Chat'), which the
 * legacy platform set below never matched and fell through to
 * 'physical_store'.
 */
const CANONICAL_CHAT = new Set([
  'FACEBOOK',
  'MESSENGER',
  'INSTAGRAM',
  'INSTAGRAM_INBOX',
  'TIKTOK',
  'TIKTOK_INBOX',
  'WHATSAPP',
  'THREADS',
]);

/**
 * Resolve the Meta CAPI action_source for an order from its attribution
 * context. Order of precedence: explicit sourceType/salesChannel intent wins
 * over platform heuristics; unknown channels fall back to the platform-derived
 * default.
 *
 * P8 §9.3 dual-read: with the new-channel model flag off this function
 * reads ONLY the legacy fields (identical to pre-P8). With the flag on, a
 * canonical chat marketing channel short-circuits to 'chat' first; every
 * other case falls through to the unchanged legacy logic (legacy columns
 * are dual-written, so they agree).
 */
export function resolveActionSource(
  order: OrderAttributionContext,
): MetaActionSource {
  if (newSalesChannelModelEnabled()) {
    const canonical = (order.marketingChannel || '').trim().toUpperCase();
    if (CANONICAL_CHAT.has(canonical)) return 'chat';
  }

  const channel = (order.salesChannel || '').trim().toUpperCase();
  const platform = (order.sourcePlatform || '').trim().toUpperCase();
  const type = (order.sourceType || '').trim().toUpperCase();

  if (!channel && !platform && !type) return DEFAULT_ACTION_SOURCE;

  // Explicit sourceType is the strongest signal.
  if (type === 'CALL') return 'phone_call';
  if (type === 'SHOWROOM') return 'physical_store';
  if (type === 'CHAT') return 'chat';
  if (type === 'AD' || type === 'DIRECT') return 'website';

  // salesChannel = where the sale completed.
  switch (channel) {
    case 'WEBSITE':
      return 'website';
    case 'POS':
    case 'WALK_IN':
      return 'physical_store';
    case 'CALL':
      return 'phone_call';
    case 'OFFLINE':
    case 'OTHER':
      // OFFLINE without an explicit sourceType: infer from platform.
      if (PLATFORM_CHAT.has(platform)) return 'chat';
      if (platform === 'PHONE') return 'phone_call';
      return 'physical_store';
    default:
      break;
  }

  // Legacy channels (FACEBOOK, WHATSAPP, MESSENGER, ...) were chat/platform
  // origins; they are handled as chat unless a sourceType refines them.
  if (PLATFORM_CHAT.has(channel)) return 'chat';

  return 'physical_store';
}
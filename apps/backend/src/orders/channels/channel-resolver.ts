/**
 * ChannelResolver — central-commerce P8 (§9.2, BR-18).
 *
 * The SINGLE deterministic mapping from legacy provenance
 * (`salesChannel` / `source` / `sourcePlatform` / `sourceType` /
 * `sourceEntity` / `MarketingSession.utmSource`) onto the canonical
 * dimensions (`salesChannelType` ONLINE|OFFLINE, `showroomName` candidate,
 * `marketingChannel`). No scattered conditionals: every writer (storefront
 * create, POS create, lead conversion, external ingest) and the backfill go
 * through here.
 *
 * Binding rules (§9.2 + additional rules):
 * - Legacy `salesChannel` is never repurposed; the resolver only READS it.
 * - `CALL`, `PHONE` and `DIRECT` never produce a marketing channel.
 * - `sourceType = 'CHAT'` with a platform maps to the inbox variants
 *   (`FACEBOOK_CHAT` → `FACEBOOK`, `INSTAGRAM_CHAT` → `INSTAGRAM_INBOX`,
 *   `TIKTOK_CHAT` → `TIKTOK_INBOX`).
 * - The canonical enum is FACEBOOK, MESSENGER, INSTAGRAM, INSTAGRAM_INBOX,
 *   TIKTOK, TIKTOK_INBOX, WHATSAPP, THREADS, OTHER — `CALL` is not a member.
 * - `storeId` (P6 provenance, null = native) is never touched here.
 * - Showroom resolution is name-based; this pure function returns the
 *   candidate name and the service resolves it to a Warehouse id.
 */

export type SalesChannelTypeValue = 'ONLINE' | 'OFFLINE';

export type MarketingChannelValue =
  | 'FACEBOOK'
  | 'MESSENGER'
  | 'INSTAGRAM'
  | 'INSTAGRAM_INBOX'
  | 'TIKTOK'
  | 'TIKTOK_INBOX'
  | 'WHATSAPP'
  | 'THREADS'
  | 'OTHER';

export interface ChannelResolverInput {
  salesChannel?: string | null;
  /** OrderSource: POS | ECOMMERCE | MANUAL (nullable for pre-enum rows). */
  source?: string | null;
  sourcePlatform?: string | null;
  sourceType?: string | null;
  sourceEntity?: string | null;
  /** MarketingSession.utmSource for WEBSITE rows (null when no session). */
  utmSource?: string | null;
}

export interface ResolvedChannels {
  salesChannelType: SalesChannelTypeValue;
  /** Candidate Warehouse(type='showroom') name; null = no showroom. */
  showroomName: string | null;
  marketingChannel: MarketingChannelValue | null;
}

/** Canonical marketing set (§9.2: no CALL). */
export const MARKETING_CHANNELS: readonly MarketingChannelValue[] = [
  'FACEBOOK',
  'MESSENGER',
  'INSTAGRAM',
  'INSTAGRAM_INBOX',
  'TIKTOK',
  'TIKTOK_INBOX',
  'WHATSAPP',
  'THREADS',
  'OTHER',
] as const;

/** Tokens that can never yield a marketing channel (additional rules). */
const NEVER_MARKETING = new Set(['CALL', 'PHONE', 'DIRECT']);

/** Normalize a legacy token: trim, upper-case, spaces/dashes → underscores. */
export function normalizeChannelToken(raw: string | null | undefined): string {
  return (raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/__+/g, '_');
}

/** Exact canonical match (platform-bearing), excluding NEVER_MARKETING. */
function platformBearingMatch(token: string): MarketingChannelValue | null {
  if (!token || NEVER_MARKETING.has(token)) return null;
  return (MARKETING_CHANNELS as readonly string[]).includes(token)
    ? (token as MarketingChannelValue)
    : null;
}

/**
 * Inbox-variant mapping for `sourceType = 'CHAT'` rows and legacy
 * `*_CHAT` tokens. FACEBOOK_CHAT → FACEBOOK (no inbox variant exists);
 * INSTAGRAM_CHAT → INSTAGRAM_INBOX; TIKTOK_CHAT → TIKTOK_INBOX.
 */
function inboxVariantOf(
  platformToken: string,
): MarketingChannelValue | null {
  const base = platformToken.replace(/_CHAT$/, '');
  switch (base) {
    case 'FACEBOOK':
      return 'FACEBOOK';
    case 'INSTAGRAM':
      return 'INSTAGRAM_INBOX';
    case 'TIKTOK':
      return 'TIKTOK_INBOX';
    case 'MESSENGER':
      return 'MESSENGER';
    case 'WHATSAPP':
      return 'WHATSAPP';
    case 'THREADS':
      return 'THREADS';
    case 'OTHER':
      return 'OTHER';
    default:
      return null;
  }
}

/**
 * CHAT refinement: `sourceType = 'CHAT'` with a platform maps to the inbox
 * variants. CALL/PHONE/DIRECT platforms still yield NULL. Unknown or missing
 * platforms yield OTHER (a chat conversation genuinely indicates a messaging
 * platform); a non-CHAT sourceType yields null (no refinement).
 */
function chatRefinement(
  sourceType: string,
  sourcePlatform: string,
): MarketingChannelValue | null {
  if (sourceType !== 'CHAT') return null;
  if (!sourcePlatform || NEVER_MARKETING.has(sourcePlatform)) return null;
  return (
    inboxVariantOf(sourcePlatform) ??
    platformBearingMatch(sourcePlatform) ??
    'OTHER'
  );
}

/** `sourcePlatform` when platform-bearing, else NULL. */
function platformBearing(sourcePlatform: string): MarketingChannelValue | null {
  if (!sourcePlatform || NEVER_MARKETING.has(sourcePlatform)) return null;
  if (sourcePlatform.endsWith('_CHAT')) {
    return inboxVariantOf(sourcePlatform);
  }
  return platformBearingMatch(sourcePlatform);
}

/** Short utm aliases seen in the wild (tight allowlist, never fabricated). */
const UTM_ALIASES: Record<string, MarketingChannelValue> = {
  FB: 'FACEBOOK',
  IG: 'INSTAGRAM',
  TT: 'TIKTOK',
  WA: 'WHATSAPP',
};

/** WEBSITE marketing: `MarketingSession.utmSource` when a known platform. */
function marketingFromUtm(utmSource: string): MarketingChannelValue | null {
  if (!utmSource || NEVER_MARKETING.has(utmSource)) return null;
  return (
    platformBearingMatch(utmSource) ?? UTM_ALIASES[utmSource] ?? null
  );
}

function showroomCandidate(sourceEntity: string | null | undefined): string | null {
  const name = (sourceEntity ?? '').trim();
  return name ? name : null;
}

/**
 * Resolve one order's legacy provenance onto the canonical dimensions.
 * Total (every input yields exactly one result) and deterministic (same
 * input → same output, no I/O, no clock).
 */
export function resolveChannels(
  input: ChannelResolverInput,
): ResolvedChannels {
  const channel = normalizeChannelToken(input.salesChannel);
  const source = normalizeChannelToken(input.source);
  const platform = normalizeChannelToken(input.sourcePlatform);
  const type = normalizeChannelToken(input.sourceType);
  const chat = chatRefinement(type, platform);

  // Legacy `*_CHAT` salesChannel values (proven by order-source.test.ts):
  // they ARE the chat signal even when sourceType is not 'CHAT'.
  if (channel.endsWith('_CHAT') && channel.length > '_CHAT'.length) {
    return {
      salesChannelType: 'OFFLINE',
      showroomName: null,
      marketingChannel: inboxVariantOf(channel) ?? chat ?? 'OTHER',
    };
  }

  switch (channel) {
    case 'WEBSITE':
      return {
        salesChannelType: 'ONLINE',
        showroomName: null,
        marketingChannel: marketingFromUtm(
          normalizeChannelToken(input.utmSource),
        ),
      };
    case 'POS':
      return {
        salesChannelType: 'OFFLINE',
        showroomName: showroomCandidate(input.sourceEntity),
        marketingChannel: chat ?? platformBearing(platform),
      };
    case 'WALK_IN':
      return {
        salesChannelType: 'OFFLINE',
        showroomName: showroomCandidate(input.sourceEntity),
        marketingChannel: null,
      };
    case 'CALL':
      return { salesChannelType: 'OFFLINE', showroomName: null, marketingChannel: null };
    case 'OFFLINE':
      return {
        salesChannelType: 'OFFLINE',
        showroomName: null,
        marketingChannel: chat ?? platformBearing(platform),
      };
    case 'OTHER':
      return {
        salesChannelType: 'OFFLINE',
        showroomName: null,
        // OTHER only when a platform is genuinely indicated (§9.2).
        marketingChannel: chat ?? platformBearing(platform) ?? 'OTHER',
      };
    case 'FACEBOOK':
    case 'MESSENGER':
    case 'INSTAGRAM':
    case 'TIKTOK':
    case 'WHATSAPP':
    case 'THREADS':
      return {
        salesChannelType: 'OFFLINE',
        showroomName: null,
        // A CHAT sourceType refines Instagram/TikTok to their inbox
        // variants; all other platforms keep the table value.
        marketingChannel:
          chat && (channel === 'INSTAGRAM' || channel === 'TIKTOK')
            ? chat
            : (channel as MarketingChannelValue),
      };
    case '':
    default: {
      // NULL / unknown legacy channel: derive from `source`
      // (POS → OFFLINE, ECOMMERCE → ONLINE, MANUAL → OFFLINE). Both NULL →
      // ONLINE (Order.source defaults to ECOMMERCE; native storefront).
      if (source === 'POS') {
        return {
          salesChannelType: 'OFFLINE',
          showroomName: showroomCandidate(input.sourceEntity),
          marketingChannel: chat ?? platformBearing(platform),
        };
      }
      if (source === 'MANUAL') {
        return {
          salesChannelType: 'OFFLINE',
          showroomName: null,
          marketingChannel: chat ?? platformBearing(platform),
        };
      }
      return {
        salesChannelType: 'ONLINE',
        showroomName: null,
        marketingChannel:
          chat ??
          marketingFromUtm(normalizeChannelToken(input.utmSource)) ??
          platformBearing(platform),
      };
    }
  }
}

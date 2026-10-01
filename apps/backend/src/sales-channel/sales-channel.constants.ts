/**
 * Canonical sales-attribution constants and the seeded source registry.
 *
 * The registry is DATA, not an enum: a new platform is added by inserting a
 * row, never by a schema migration. Seeded defaults are inserted with
 * `skipDuplicates`, which is insert-only and therefore can never overwrite an
 * operator's customisation of an existing row.
 */

export type SalesChannelV2 = 'WEBSITE' | 'MESSAGING' | 'PHONE_CALL' | 'POS';
export type AcquisitionType = 'PAID' | 'ORGANIC' | 'DIRECT' | 'UNKNOWN';

export const CHANNELS: SalesChannelV2[] = ['WEBSITE', 'MESSAGING', 'PHONE_CALL', 'POS'];

/**
 * Manual-order creation ordering (Messaging and Phone Call first), as required.
 * All four are retained — Website and POS remain available for exceptional
 * operational use, they are simply not the first suggestion.
 */
export const MANUAL_CHANNEL_ORDER: SalesChannelV2[] = [
  'MESSAGING',
  'PHONE_CALL',
  'WEBSITE',
  'POS',
];

export const CHANNEL_LABELS: Record<SalesChannelV2, string> = {
  WEBSITE: 'Website',
  MESSAGING: 'Messaging',
  PHONE_CALL: 'Phone Call',
  POS: 'POS',
};

export const ACQUISITION_LABELS: Record<AcquisitionType, string> = {
  PAID: 'Paid',
  ORGANIC: 'Organic',
  DIRECT: 'Direct',
  UNKNOWN: 'Unknown',
};

/** NULL is a database NULL, never a stored string — see AcquisitionType. */
export const ACQUISITION_VALUES: AcquisitionType[] = ['PAID', 'ORGANIC', 'DIRECT', 'UNKNOWN'];

export type SourceCapability =
  | 'MARKETING_SOURCE'
  | 'MESSAGING'
  | 'SOCIAL'
  | 'AD_PLATFORM'
  | 'AI_ASSISTANT';

export interface SourcePlatformSeed {
  slug: string;
  displayName: string;
  capabilities: SourceCapability[];
  sortOrder: number;
}

/**
 * Seeded registry defaults.
 *
 * MESSAGING is granted only to platforms that genuinely carry a conversation:
 * `google` is DELIBERATELY ABSENT because Google Business Profile's native
 * chat was discontinued on 2024-07-31. `chatgpt` is a marketing/AI source but
 * is NOT a messaging platform, so it can never appear in a Messaging
 * dropdown. `tiktok` and `telegram` carry MESSAGING so the architecture
 * supports them — being registered is explicitly not the same as being
 * connected as an integration.
 */
export const SOURCE_PLATFORM_SEEDS: SourcePlatformSeed[] = [
  { slug: 'facebook', displayName: 'Facebook', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 10 },
  { slug: 'messenger', displayName: 'Messenger', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL'], sortOrder: 15 },
  { slug: 'instagram', displayName: 'Instagram', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 20 },
  { slug: 'whatsapp', displayName: 'WhatsApp', capabilities: ['MARKETING_SOURCE', 'MESSAGING'], sortOrder: 25 },
  { slug: 'tiktok', displayName: 'TikTok', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 30 },
  { slug: 'telegram', displayName: 'Telegram', capabilities: ['MARKETING_SOURCE', 'MESSAGING'], sortOrder: 35 },
  { slug: 'threads', displayName: 'Threads', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL'], sortOrder: 40 },
  { slug: 'google', displayName: 'Google', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 50 },
  { slug: 'youtube', displayName: 'YouTube', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 55 },
  { slug: 'bing', displayName: 'Bing', capabilities: ['MARKETING_SOURCE', 'AD_PLATFORM'], sortOrder: 60 },
  { slug: 'pinterest', displayName: 'Pinterest', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 65 },
  { slug: 'linkedin', displayName: 'LinkedIn', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 70 },
  { slug: 'x', displayName: 'X', capabilities: ['MARKETING_SOURCE', 'SOCIAL'], sortOrder: 75 },
  { slug: 'snapchat', displayName: 'Snapchat', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 80 },
  { slug: 'reddit', displayName: 'Reddit', capabilities: ['MARKETING_SOURCE', 'SOCIAL'], sortOrder: 85 },
  // Marketing/AI source, deliberately NOT MESSAGING.
  { slug: 'chatgpt', displayName: 'ChatGPT', capabilities: ['MARKETING_SOURCE', 'AI_ASSISTANT'], sortOrder: 90 },
  { slug: 'other', displayName: 'Other / Custom', capabilities: ['MARKETING_SOURCE'], sortOrder: 999 },
];

/**
 * Legacy `sourcePlatform` values that are OPERATIONAL, not marketing
 * platforms. They must never be written into `sourceSlug` (an FK to
 * SourcePlatform) — their meaning belongs to another dimension.
 */
export const NON_PLATFORM_SOURCE_VALUES = new Set([
  'POS',        // operational venue   → Channel
  'PHONE',      // contact modality    → Channel
  'LEAD',       // lead origin         → Channel
  'EXTERNAL_STORE', // integration    → Channel + Entity
  'DIRECT',     // no platform established → Acquisition
]);

/** Legacy `SalesChannel` values that were really platform names, not venues. */
export const LEGACY_CHANNEL_TO_SOURCE: Record<string, string> = {
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok',
  MESSENGER: 'facebook',
  WHATSAPP: 'whatsapp',
  THREADS: 'threads',
};

/** Legacy `sourcePlatform` → registry slug, for values that are real platforms. */
export const LEGACY_PLATFORM_TO_SLUG: Record<string, string> = {
  GOOGLE: 'google',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok',
  WHATSAPP: 'whatsapp',
  THREADS: 'threads',
  MESSENGER: 'messenger',
  TELEGRAM: 'telegram',
  YOUTUBE: 'youtube',
  BING: 'bing',
  PINTEREST: 'pinterest',
  LINKEDIN: 'linkedin',
  TWITTER: 'x',
  X: 'x',
  SNAPCHAT: 'snapchat',
  REDDIT: 'reddit',
  CHATGPT: 'chatgpt',
};

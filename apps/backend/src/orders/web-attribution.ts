/**
 * Canonical website attribution resolver (spec §21, §20).
 *
 * Converts legitimate first-party landing signals collected by the storefront
 * (UTM params, platform click ids, referrer) into the approved attribution
 * dimensions. This is the ONLY place platform/type inference happens for
 * website orders — the storefront collects raw signals, the backend resolves.
 *
 * Precedence (strongest explicit signal wins; never overwrite a caller-supplied
 * explicit sourcePlatform/sourceType):
 *   1. recognized utm_source  → platform; medium=cpc/cpm/…/paid → AD else DIRECT
 *   2. platform click id      → platform + AD  (a click id only exists on a paid click)
 *   3. known referrer         → platform + DIRECT (organic search/social)
 *   4. nothing                → DIRECT / DIRECT (never claim an unknown source)
 *
 * Unknown utm_source / referrer are deliberately NOT claimed as direct or as a
 * platform — they fall through to the DIRECT default only when no signal maps
 * (the order of checks below keeps an unknown utm_source from being silently
 * reported as DIRECT, but it also never fabricates a platform).
 *
 * Covered platforms: Meta (Facebook/Instagram/Threads/Messenger/WhatsApp),
 * TikTok, Google (Search/Ads/YouTube), Microsoft/Bing, Snapchat, Pinterest,
 * LinkedIn, X/Twitter, plus search engines as organic referrers.
 */

export interface WebAttributionInput {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  msclkid?: string | null;
  ttclid?: string | null;
  twclid?: string | null;
  igshid?: string | null;
}

export interface ResolvedWebAttribution {
  sourcePlatform: string;
  sourceType: 'AD' | 'DIRECT';
}

/** Recognized platform names (spec §16) normalized as project enum spellings. */
const UTM_TO_PLATFORM: Record<string, string> = {
  facebook: 'FACEBOOK',
  fb: 'FACEBOOK',
  meta: 'FACEBOOK',
  instagram: 'INSTAGRAM',
  ig: 'INSTAGRAM',
  tiktok: 'TIKTOK',
  threads: 'THREADS',
  messenger: 'MESSENGER',
  whatsapp: 'WHATSAPP',
  google: 'GOOGLE',
  googleads: 'GOOGLE',
  adwords: 'GOOGLE',
  youtube: 'YOUTUBE',
  yt: 'YOUTUBE',
  bing: 'BING',
  microsoft: 'BING',
  msn: 'BING',
  snapchat: 'SNAPCHAT',
  snap: 'SNAPCHAT',
  pinterest: 'PINTEREST',
  linkedin: 'LINKEDIN',
  twitter: 'TWITTER',
};
// NOTE: channel-shaped utm_source values (`email`, `newsletter`) are
// deliberately absent — `sourcePlatform` names an advertising/social platform,
// and the resolver must never fabricate one for owned traffic. Those orders
// stay DIRECT, which is the honest answer.

/**
 * Platforms that can actually run paid ads. A paid medium on any other
 * platform (a chat link with utm_medium=cpc, an email blast) is still
 * organic/owned traffic — classifying it as AD would inflate paid reporting.
 */
const AD_PLATFORMS = new Set([
  'FACEBOOK',
  'INSTAGRAM',
  'THREADS',
  'TIKTOK',
  'GOOGLE',
  'YOUTUBE',
  'BING',
  'SNAPCHAT',
  'PINTEREST',
  'LINKEDIN',
  'TWITTER',
]);

/** Paid-media indicators; everything else is treated as organic/other (`DIRECT`). */
const PAID_MEDIUMS = new Set([
  'cpc',
  'cpm',
  'cpa',
  'cpv',
  'cpp',
  'ppc',
  'paid',
  'ads',
  'ad',
  'display',
  'paid_social',
  'paidsocial',
  'paid_search',
  'pmax',
  'retargeting',
]);

/**
 * Platform click ids, strongest signal first. A click id only ever appears on a
 * paid click, so it implies `AD` regardless of the UTM parameters.
 */
const CLICK_ID_PLATFORMS: Array<[keyof WebAttributionInput, string]> = [
  ['fbclid', 'FACEBOOK'],
  ['gclid', 'GOOGLE'],
  ['wbraid', 'GOOGLE'],
  ['gbraid', 'GOOGLE'],
  ['msclkid', 'BING'],
  ['ttclid', 'TIKTOK'],
  ['twclid', 'TWITTER'],
  ['igshid', 'INSTAGRAM'],
];

/**
 * Referrer hosts → platform. Matched against the referrer hostname, so
 * subdomains (`www.google.com`, `m.facebook.com`, `google.com.bd`) hit too.
 * Search engines land here as organic (DIRECT) traffic.
 */
const REFERRER_PLATFORMS: Array<[RegExp, string]> = [
  [/(^|\.)google\./, 'GOOGLE'],
  [/(^|\.)bing\.com$/, 'BING'],
  [/(^|\.)youtube\.com$/, 'YOUTUBE'],
  [/(^|\.)yahoo\./, 'YAHOO'],
  [/(^|\.)duckduckgo\.com$/, 'DUCKDUCKGO'],
  [/(^|\.)yandex\./, 'YANDEX'],
  [/(^|\.)facebook\.com$/, 'FACEBOOK'],
  [/(^|\.)fb\.com$/, 'FACEBOOK'],
  [/(^|\.)instagram\.com$/, 'INSTAGRAM'],
  [/(^|\.)tiktok\.com$/, 'TIKTOK'],
  [/(^|\.)threads\.(net|com)$/, 'THREADS'],
  [/(^|\.)messenger\.com$/, 'MESSENGER'],
  [/(^|\.)whatsapp\.com$/, 'WHATSAPP'],
  [/(^|\.)pinterest\./, 'PINTEREST'],
  [/(^|\.)snapchat\.com$/, 'SNAPCHAT'],
  [/(^|\.)linkedin\.com$/, 'LINKEDIN'],
  [/(^|\.)(twitter|x)\.com$/, 'TWITTER'],
  [/(^|\.)t\.co$/, 'TWITTER'],
];

function norm(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function knownPlatform(normalized: string): string | undefined {
  return UTM_TO_PLATFORM[normalized];
}

function platformFromReferrer(referrer?: string | null): string | undefined {
  if (!referrer) return undefined;
  try {
    const hostname = new URL(referrer).hostname.toLowerCase();
    for (const [re, platform] of REFERRER_PLATFORMS) {
      if (re.test(hostname)) return platform;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Resolve website attribution from raw landing signals. Returns null only when
 * there is nothing to resolve (never called / empty). Direct traffic is
 * returned as DIRECT/DIRECT so the order default stays consistent.
 */
export function resolveWebAttribution(
  attribution?: WebAttributionInput | null,
): ResolvedWebAttribution | null {
  if (!attribution) return null;

  const utmSource = norm(attribution.utmSource);
  const utmMedium = norm(attribution.utmMedium);

  // 1. Recognized utm_source → platform; medium decides AD vs DIRECT.
  if (utmSource) {
    const platform = knownPlatform(utmSource);
    const isPaid = PAID_MEDIUMS.has(utmMedium) && AD_PLATFORMS.has(platform ?? '');
    // A recognized platform is authoritative; an unknown utm_source is never
    // claimed (fall through to click-id/referrer, else DIRECT).
    if (platform) {
      return { sourcePlatform: platform, sourceType: isPaid ? 'AD' : 'DIRECT' };
    }
  }

  // 2. Platform click ids — all imply ad-driven clicks.
  for (const [field, platform] of CLICK_ID_PLATFORMS) {
    if (attribution[field]) return { sourcePlatform: platform, sourceType: 'AD' };
  }

  // 3. Known organic/search/social referrer.
  const refPlatform = platformFromReferrer(attribution.referrer);
  if (refPlatform) return { sourcePlatform: refPlatform, sourceType: 'DIRECT' };

  // 4. Explicit direct (utm_source=direct or nothing).
  return { sourcePlatform: 'DIRECT', sourceType: 'DIRECT' };
}

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
 *   2. platform click id      → platform + AD  (fbclid/ttclid/igshid are ad clicks)
 *   3. known referrer         → platform + DIRECT (organic social)
 *   4. nothing                → DIRECT / DIRECT (never claim an unknown source)
 *
 * Unknown utm_source / referrer are deliberately NOT claimed as direct or as a
 * platform — they fall through to the DIRECT default only when no signal maps
 * (the order of checks below keeps an unknown utm_source from being silently
 * reported as DIRECT, but it also never fabricates a platform).
 */

export interface WebAttributionInput {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
  fbclid?: string | null;
  ttclid?: string | null;
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
  instagram: 'INSTAGRAM',
  ig: 'INSTAGRAM',
  tiktok: 'TIKTOK',
  threads: 'THREADS',
  messenger: 'MESSENGER',
  whatsapp: 'WHATSAPP',
};

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
  'email',
  'display',
]);

const REFERRER_PLATFORMS: Array<[RegExp, string]> = [
  [/facebook\.com$/i, 'FACEBOOK'],
  [/instagram\.com$/i, 'INSTAGRAM'],
  [/tiktok\.com$/i, 'TIKTOK'],
  [/threads\.net$/i, 'THREADS'],
  [/messenger\.com$/i, 'MESSENGER'],
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
    const hostname = new URL(referrer).hostname;
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
    const type = PAID_MEDIUMS.has(utmMedium) ? 'AD' : 'DIRECT';
    // A recognized platform is authoritative; an unknown utm_source is never
    // claimed (fall through to click-id/referrer, else DIRECT).
    if (platform) {
      return { sourcePlatform: platform, sourceType: type };
    }
  }

  // 2. Platform click ids — all imply ad-driven clicks.
  if (attribution.fbclid) return { sourcePlatform: 'FACEBOOK', sourceType: 'AD' };
  if (attribution.ttclid) return { sourcePlatform: 'TIKTOK', sourceType: 'AD' };
  if (attribution.igshid) return { sourcePlatform: 'INSTAGRAM', sourceType: 'AD' };

  // 3. Known organic/social referrer.
  const refPlatform = platformFromReferrer(attribution.referrer);
  if (refPlatform) return { sourcePlatform: refPlatform, sourceType: 'DIRECT' };

  // 4. Explicit direct (utm_source=direct or nothing).
  if (utmSource === 'direct') {
    return { sourcePlatform: 'DIRECT', sourceType: 'DIRECT' };
  }

  return { sourcePlatform: 'DIRECT', sourceType: 'DIRECT' };
}
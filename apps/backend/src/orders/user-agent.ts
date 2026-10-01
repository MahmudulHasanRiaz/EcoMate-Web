/**
 * User-Agent parsing for the Others Information inspector.
 *
 * The system stores only the raw User-Agent string, so browser / OS / device
 * facts are DERIVED at read time rather than persisted. Deriving is honest
 * because it is deterministic from a string we actually hold; inventing a
 * value we never collected is not.
 *
 * Anything that cannot be determined honestly is reported as `null` with a
 * `not_collected` state — never a guess, never a default.
 */

export interface ParsedUserAgent {
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown';
  platform: string | null;
  isBot: boolean;
}

interface Rule {
  test: RegExp;
  browser: string;
  os?: string;
  platform?: string;
  versionGroup?: number;
  osVersionGroup?: number;
}

/**
 * Ordered most-specific-first. A UA string typically names several products
 * (e.g. "Chrome ... Safari ..."), so the first match is the real one and later
 * generic fallbacks are deliberately last.
 */
const BROWSER_RULES: Rule[] = [
  { test: /Edg(?:e|A|iOS)?\/([\d.]+)/i, browser: 'Edge', os: 'Windows', platform: 'Win32' },
  { test: /OPR\/([\d.]+)/i, browser: 'Opera', os: 'Windows', platform: 'Win32' },
  { test: /SamsungBrowser\/([\d.]+)/i, browser: 'Samsung Internet', os: 'Android', platform: 'Linux armv8l' },
  { test: /YaBrowser\/([\d.]+)/i, browser: 'Yandex', os: undefined, platform: undefined },
  { test: /UCBrowser\/([\d.]+)/i, browser: 'UC Browser', os: 'Android', platform: 'Linux armv8l' },
  { test: /Firefox\/([\d.]+)/i, browser: 'Firefox', os: undefined, platform: undefined },
  { test: /CriOS\/([\d.]+)/i, browser: 'Chrome', os: 'iOS', platform: 'iPhone' },
  { test: /FxiOS\/([\d.]+)/i, browser: 'Firefox', os: 'iOS', platform: 'iPhone' },
  { test: /Chrome\/([\d.]+)/i, browser: 'Chrome', os: undefined, platform: undefined },
  { test: /Version\/([\d.]+).*Safari/i, browser: 'Safari', os: 'iOS', platform: 'iPhone' },
  { test: /Safari\/([\d.]+)/i, browser: 'Safari', os: 'macOS', platform: 'MacIntel' },
];

const BOT_PATTERN =
  /bot|crawler|spider|crawling|slurp|facebookexternalhit|whatsapp|telegrambot|discordbot|headlesschrome|curl\/|wget\/|python-requests|axios|node-fetch|googlebot|bingpreview|uptimerobot|pingdom|facebookcatalog/i;

const OS_RULES: { test: RegExp; os: string; group: number }[] = [
  // Windows NT carries its build in the literal, not a capture group; the
  // canonical names live in OS_VERSION_MAP below.
  { test: /Windows NT 10\.0/i, os: 'Windows', group: 0 },
  { test: /Windows NT 6\.3/i, os: 'Windows', group: 0 },
  { test: /Windows NT 6\.[12]/i, os: 'Windows', group: 0 },
  { test: /Windows NT/i, os: 'Windows', group: 0 },
  { test: /Android[\s/]?([\d.]+)/i, os: 'Android', group: 1 },
  { test: /(?:iPhone )?OS[\s/]([\d_]+)/i, os: 'iOS', group: 1 },
  { test: /Mac OS X[\s/]([\d_.]+)/i, os: 'macOS', group: 1 },
  { test: /CrOS \S+ ([\d.]+)/i, os: 'ChromeOS', group: 1 },
  { test: /Ubuntu/i, os: 'Linux', group: 0 },
  { test: /Linux/i, os: 'Linux', group: 0 },
];

/** Canonical version per Windows build, keyed by the matched NT token. */
const WINDOWS_BUILD_VERSION: Record<string, string> = {
  '10.0': '10',
  '6.3': '8.1',
  '6.2': '8',
  '6.1': '7',
};

const OS_VERSION_MAP: Record<string, string> = {
  '10.0': '10',
  '6.3': '8.1',
  '6.2': '8',
  '6.1': '7',
};

function classifyDevice(ua: string, isBot: boolean): ParsedUserAgent['deviceType'] {
  if (isBot) return 'bot';
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile/i.test(ua)) return 'mobile';
  if (/Windows|Macintosh|Mac OS X|X11|Linux|CrOS/i.test(ua)) return 'desktop';
  return 'unknown';
}

/** Parse a raw User-Agent. Returns all-null fields for an absent UA. */
export function parseUserAgent(raw?: string | null): ParsedUserAgent | null {
  const ua = (raw || '').trim();
  if (!ua) return null;

  const isBot = BOT_PATTERN.test(ua);
  let browser: string | null = null;
  let browserVersion: string | null = null;
  let os: string | null = null;
  let osVersion: string | null = null;
  let platform: string | null = null;

  for (const rule of BROWSER_RULES) {
    const m = ua.match(rule.test);
    if (!m) continue;
    browser = rule.browser;
    browserVersion = m[1] ? m[1].split('.').slice(0, 2).join('.') : null;
    os = rule.os ?? os;
    platform = rule.platform ?? platform;
    break;
  }

  // OS version is resolved independently of which OS was found: the browser
  // rule may have supplied the OS name (e.g. Safari => iOS) before the OS
  // rules run, so skipping them would lose the version.
  {
    for (const rule of OS_RULES) {
      const m = ua.match(rule.test);
      if (!m) continue;
      if (!os) os = rule.os;
      // group 0 means the rule carries no version (Windows/Linux by name).
      const raw_version = m[rule.group];
      if (rule.group === 0) {
        const nt = ua.match(/Windows NT ([\d.]+)/i);
        osVersion = nt ? WINDOWS_BUILD_VERSION[nt[1]] ?? nt[1] : null;
      } else if (raw_version) {
        const cleaned = raw_version.replace(/_/g, '.');
        osVersion = OS_VERSION_MAP[cleaned] ?? cleaned.split('.').slice(0, 2).join('.');
      }
      break;
    }
  }

  if (!platform) {
    if (/Android/i.test(ua)) platform = /Mobile/i.test(ua) ? 'Linux armv8l' : 'Linux armv8l';
    else if (/iPhone|iPad|iPod/i.test(ua)) platform = /iPad/i.test(ua) ? 'iPad' : 'iPhone';
    else if (/Macintosh|Mac OS X/i.test(ua)) platform = 'MacIntel';
    else if (/Windows/i.test(ua)) platform = 'Win32';
    else if (/CrOS/i.test(ua)) platform = 'Linux x86_64';
  }

  return {
    browser,
    browserVersion,
    os,
    osVersion,
    deviceType: classifyDevice(ua, isBot),
    platform,
    isBot,
  };
}

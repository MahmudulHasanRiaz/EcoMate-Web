/**
 * First-party device / technical context for a storefront order (analytics only).
 *
 * Deliberately narrow: display geometry, locale, and the coarse platform
 * classification the user-agent already exposes. Nothing here is a fingerprint —
 * no canvas/font/audio probes, no hardware identifiers, no stable per-device id.
 * The values travel with the order so questions like "do our ads convert better
 * on mobile or desktop, Android or iOS, which locale" can be answered from the
 * order row itself instead of being guessed later.
 *
 * Client-only and never throws: if a value is unavailable it is simply omitted.
 */

export interface DeviceContext {
  /** Screen geometry, e.g. "390x844". */
  screen?: string;
  /** Layout viewport, e.g. "390x664". */
  viewport?: string;
  pixelRatio?: number;
  /** IANA zone name, e.g. "Asia/Dhaka". */
  timezone?: string;
  /** Primary UI language, e.g. "bn-BD". */
  language?: string;
  /** "iOS" | "Android" | "Windows" | "macOS" | "Linux" | "Other". */
  platform?: string;
  /** Coarse browser family, e.g. "Chrome". */
  browser?: string;
  /** OS family, e.g. "Android". */
  os?: string;
  /** "mobile" | "tablet" | "desktop". */
  deviceType?: string;
  touch?: boolean;
  /** Effective connection type when the browser exposes it, e.g. "4g". */
  connection?: string;
}

function detectOs(ua: string): string | undefined {
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipod/i.test(ua)) return 'iOS';
  if (/ipad/i.test(ua)) return 'iPadOS';
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os x|macintosh/i.test(ua)) return 'macOS';
  if (/cros/i.test(ua)) return 'ChromeOS';
  if (/linux/i.test(ua)) return 'Linux';
  return undefined;
}

function detectBrowser(ua: string): string | undefined {
  // Order matters: Edge/Opera/Samsung all carry "Chrome" in their UA too.
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/samsungbrowser/i.test(ua)) return 'Samsung Internet';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/safari/i.test(ua)) return 'Safari';
  return undefined;
}

function detectDeviceType(ua: string, screenWidth?: number): string | undefined {
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile/i.test(ua)) return 'mobile';
  if (/android/i.test(ua)) return 'tablet';
  if (typeof screenWidth === 'number') {
    if (screenWidth <= 767) return 'mobile';
    if (screenWidth <= 1023) return 'tablet';
    return 'desktop';
  }
  return undefined;
}

export function collectDeviceContext(): DeviceContext | undefined {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return undefined;
  const ua = navigator.userAgent || '';
  const screenWidth = typeof window.screen?.width === 'number' ? window.screen.width : undefined;
  const screenHeight = typeof window.screen?.height === 'number' ? window.screen.height : undefined;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const device: DeviceContext = {
    screen: screenWidth && screenHeight ? `${screenWidth}x${screenHeight}` : undefined,
    viewport: viewportWidth && viewportHeight ? `${viewportWidth}x${viewportHeight}` : undefined,
    pixelRatio: typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : undefined,
    timezone: (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      } catch {
        return undefined;
      }
    })(),
    language: navigator.language || undefined,
    os: detectOs(ua),
    browser: detectBrowser(ua),
    deviceType: detectDeviceType(ua, screenWidth),
    touch: typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints > 0 : undefined,
    connection: (() => {
      const conn = (navigator as any).connection;
      const type = conn?.effectiveType;
      return typeof type === 'string' ? type : undefined;
    })(),
  };
  device.platform = device.os;

  // Drop undefined entries so the payload stays small and the backend snapshot
  // compactor has nothing to strip.
  const compact = Object.fromEntries(
    Object.entries(device).filter(([, value]) => value !== undefined),
  ) as DeviceContext;
  return Object.keys(compact).length ? compact : undefined;
}

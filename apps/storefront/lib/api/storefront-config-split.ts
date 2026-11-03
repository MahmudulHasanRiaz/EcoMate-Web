import type { StorefrontConfig } from "./storefront-config";

/**
 * P2 (speed plan §5) — StorefrontConfig delivery split.
 *
 * Before P2 the ENTIRE config was serialized into every page TWICE:
 * once as the `__INITIAL_CONFIG__` inline JSON script and once as the
 * StorefrontConfigProvider's `initialConfig` RSC prop. Measured on a
 * representative config (see storefront-config-split.test.ts), that is
 * 2 × ~11 KB before any page content.
 *
 * After P2 it is serialized ONCE, and only the first-paint subset:
 *
 * CRITICAL (inline, via the provider prop — read synchronously during
 * SSR / first paint):
 *  - store / currency / branding / seo / social / order — layout
 *    metadata + JSON-LD, header, footer, floating widgets
 *  - menu (header/mobile/footer trees) — header + footer render them
 *  - hero — homepage hero is above the fold
 *  - meta / tiktok — TrackingScripts injects pixels on mount
 *  - features / licenseFeatures / delivery / systems /
 *    catalogImageRatio — gates + announcement bar + card aspect ratio
 *    are all first-paint decisions
 *  - footer / hours / company — footer renders them
 *  - _mediaMeta — hero/category imagery derivatives for first paint
 *  - _licenseActive / _licenseMessage — layout gate (server-only
 *    extras riding on the config object)
 *
 * DEFERRED (NOT inlined; the provider fetches the full config once on
 * mount through the existing cached `getStorefrontConfig()` client
 * fetch and merges these in — consumers are route-specific and none
 * are needed for the first paint of a generic page):
 *  - districtCharges, shippingMode, shippingOptions, shippingZones,
 *    checkout — checkout page only
 *  - deliveryInfo — PDP buy box only
 *  - thankYou — thank-you page only
 *  - faq, about, shipping, payment — static info pages
 *  - homepageSections — consumed SERVER-side only (homepage page.tsx
 *    reads it from getStorefrontConfigServer, never from the provider)
 *  - playStoreUrl, appStoreUrl — PWA/install surfaces, post-paint
 *
 * While the deferred fetch is in flight, deferred fields hold their
 * empty defaults (see DEFERRED_DEFAULTS) — exactly the values the
 * provider's DEFAULT_CONFIG already used pre-P2 for a not-yet-loaded
 * config, so no consumer can crash on a missing field.
 */

export const DEFERRED_CONFIG_KEYS = [
  'districtCharges',
  'shippingMode',
  'shippingOptions',
  'shippingZones',
  'checkout',
  'deliveryInfo',
  'thankYou',
  'faq',
  'about',
  'shipping',
  'payment',
  'homepageSections',
  'playStoreUrl',
  'appStoreUrl',
] as const;

export type DeferredConfigKey = (typeof DEFERRED_CONFIG_KEYS)[number];

/** Empty defaults for deferred fields (mirror of the provider defaults). */
export const DEFERRED_CONFIG_DEFAULTS: Pick<StorefrontConfig, DeferredConfigKey> = {
  districtCharges: {},
  shippingMode: 'options',
  shippingOptions: [],
  shippingZones: [],
  checkout: {
    districtEnabled: true,
    thanaEnabled: true,
    districtRequired: false,
    thanaRequired: false,
    emailEnabled: true,
    emailRequired: false,
  },
  deliveryInfo: { enabled: true, title: '', rows: [] },
  thankYou: { title: '', subtitle: '', description: '' },
  faq: { items: [] },
  about: { text: '' },
  shipping: { info: '' },
  payment: { info: '' },
  homepageSections: [],
  playStoreUrl: '',
  appStoreUrl: '',
};

/**
 * The subset the root layout inlines (provider prop). Deferred fields
 * are present but emptied, so the object always satisfies
 * StorefrontConfig and consumers never see `undefined`.
 */
export function pickCriticalConfig(config: StorefrontConfig): StorefrontConfig {
  const critical: StorefrontConfig = { ...config };
  for (const key of DEFERRED_CONFIG_KEYS) {
    (critical as any)[key] = DEFERRED_CONFIG_DEFAULTS[key];
  }
  return critical;
}

/** Merge a full config's deferred fields over a critical-only config. */
export function mergeDeferredConfig(
  critical: StorefrontConfig,
  full: StorefrontConfig,
): StorefrontConfig {
  const merged: StorefrontConfig = { ...full, ...critical };
  for (const key of DEFERRED_CONFIG_KEYS) {
    (merged as any)[key] = (full as any)[key] ?? DEFERRED_CONFIG_DEFAULTS[key];
  }
  return merged;
}

import { describe, it, expect } from 'vitest';
import type { StorefrontConfig } from '../api/storefront-config';
import {
  DEFERRED_CONFIG_KEYS,
  pickCriticalConfig,
  mergeDeferredConfig,
} from '../api/storefront-config-split';

/** Representative config: heavy checkout/shipping + FAQ payloads. */
function fullConfig(): StorefrontConfig {
  const districts: Record<string, number> = {};
  for (let i = 0; i < 64; i++) districts[`District ${i}`] = 60 + i;
  return {
    store: { name: 'FixedPlus', tagline: 'Gadgets', email: 'a@b.c', phone: '0123', address: 'Dhaka' },
    systems: [],
    currency: { code: 'BDT', symbol: '৳' },
    delivery: { charge: 60, freeDeliveryMin: 1000 },
    deliveryInfo: { enabled: true, title: 'Delivery', rows: [{ label: 'Inside', value: '60' }] },
    hero: { slides: [{ image: '/hero.jpg' }], secondaryBanner: '', secondaryBannerAlt: '' },
    social: { facebook: 'fb', instagram: '', youtube: '', whatsapp: '8801', messengerUsername: '' },
    order: { whatsapp: '8801', callNumber: '0123', blockedPhoneMessage: 'blocked' },
    branding: {
      storefrontFavicon: '', storefrontOgImage: '', storeLogo: '/logo.png', adminTitle: '', adminFavicon: '', adminTagline: '',
      colors: { primary: '#0089CD', primaryDark: '#006da3', accent: '#E77250', text: '#0a0a0a', background: '#fff', success: '#22C55E', danger: '#EF4444', border: '#E5E7EB', shadowSoft: '', shadowStrong: '' },
    },
    seo: { title: 'Shop', description: 'Desc', keywords: 'a,b' },
    footer: { description: 'Footer text', copyright: '©' },
    about: { text: 'About '.repeat(50) },
    shipping: { info: 'Shipping '.repeat(50) },
    payment: { info: 'Payment '.repeat(50) },
    meta: { pixelEnabled: true, pixelId: '123', pixelIds: ['123'], purchaseMode: 'instant', validatedStatus: '' },
    tiktok: { pixelEnabled: false, pixelCode: '', purchaseMode: 'instant', validatedStatus: '' },
    menu: {
      header: { mode: 'include', showAllCategories: false, excludedCategories: [], items: [{ label: 'Home' }] },
      mobile: { mode: 'include', showAllCategories: false, excludedCategories: [], items: [{ label: 'Home' }] },
      footer: { columns: [{ title: 'Links', items: [{ label: 'FAQ' }] }] },
    },
    faq: { items: Array.from({ length: 12 }, (_, i) => ({ question: `Q${i}`, answer: 'Answer '.repeat(20) })) },
    hours: { label: '9-9', details: [] },
    company: { name: 'Co', registration: '', certifications: '', teamSize: '', ceoName: '' },
    checkout: { districtEnabled: true, thanaEnabled: true, districtRequired: false, thanaRequired: false, emailEnabled: true, emailRequired: false },
    districtCharges: districts,
    shippingMode: 'options',
    shippingOptions: [{ id: 's1', name: 'Standard', amount: 60, sortOrder: 1 }],
    shippingZones: [{ id: 'z1', type: 'custom_amount', amount: 120, districts: Object.keys(districts), label: null }],
    features: { sizeChart: false, hideOosFromArchive: false, maintenanceMode: false, defaultVariantSelected: true, showReviews: true },
    thankYou: { title: 'Thanks', subtitle: '', description: '' },
    licenseFeatures: ['*'],
    playStoreUrl: 'https://play.example',
    appStoreUrl: '',
    homepageSections: [{ id: '1', title: 'Featured', type: 'featured', limit: 4, enabled: true }],
    searchIndexingEnabled: true,
  } as StorefrontConfig;
}

describe('P2 storefront config split', () => {
  it('critical subset keeps first-paint fields intact', () => {
    const full = fullConfig();
    const critical = pickCriticalConfig(full);
    expect(critical.store).toEqual(full.store);
    expect(critical.menu).toEqual(full.menu);
    expect(critical.branding).toEqual(full.branding);
    expect(critical.meta).toEqual(full.meta);
    expect(critical.hero).toEqual(full.hero);
    expect(critical.currency).toEqual(full.currency);
    expect(critical.licenseFeatures).toEqual(full.licenseFeatures);
  });

  it('critical subset empties every deferred field (never undefined)', () => {
    const critical = pickCriticalConfig(fullConfig());
    for (const key of DEFERRED_CONFIG_KEYS) {
      const v: any = (critical as any)[key];
      expect(v, key).toBeDefined();
      if (Array.isArray(v)) expect(v).toHaveLength(0);
    }
    expect(critical.districtCharges).toEqual({});
    expect(critical.shippingOptions).toEqual([]);
    expect(critical.faq.items).toEqual([]);
    expect(critical.homepageSections).toEqual([]);
  });

  it('mergeDeferredConfig restores deferred fields and keeps critical ones', () => {
    const full = fullConfig();
    const critical = pickCriticalConfig(full);
    const merged = mergeDeferredConfig(critical, full);
    expect(merged.districtCharges).toEqual(full.districtCharges);
    expect(merged.shippingZones).toEqual(full.shippingZones);
    expect(merged.faq).toEqual(full.faq);
    expect(merged.checkout).toEqual(full.checkout);
    expect(merged.store).toEqual(full.store);
    expect(merged.menu).toEqual(full.menu);
  });

  it('payload measurement: serialized once + critical-only vs twice + full', () => {
    const full = JSON.stringify(fullConfig());
    const critical = JSON.stringify(pickCriticalConfig(fullConfig()));
    console.log(
      `CONFIG_MEASURE before=${full.length * 2}B (2x ${full.length}) after=${critical.length}B`,
    );
    expect(critical.length).toBeLessThan(full.length);
    expect(critical.length).toBeLessThan(full.length * 0.75);
  });
});

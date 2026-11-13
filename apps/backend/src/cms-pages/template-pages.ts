// The fixed "system pages" the storefront renders with special designs.
// ensureTemplatePages() creates a CmsPage row per entry so admins can toggle
// each page on/off and edit only its specific content fields.
//
// defaultConfig is TENANT-NEUTRAL and EMPTY: empty strings, empty arrays, no
// invented business names, people, jobs, stores, charges, dates or copy. A
// fresh tenant ships empty pages with honest empty states — never fake
// tenant data. Dummy/demo content lives ONLY behind the demo-import path
// (prisma/seed.ts, SEED_DUMMY_DATA=true) and seed.ts never creates CmsPage
// rows, so nothing fake can ever be seeded here on normal boot.
// settingsKeys maps SystemSetting keys into config fields so live production
// content is preserved on first creation.

export interface TemplatePageDefinition {
  key: string;
  slug: string;
  title: string;
  defaultConfig: Record<string, any>;
  settingsKeys?: Record<string, string[]>;
}

export const templatePages: TemplatePageDefinition[] = [
  {
    key: 'careers',
    slug: 'careers',
    title: 'Careers',
    defaultConfig: {
      hero: { title: '', subtitle: '', image: '' },
      jobs: [],
      benefits: [],
      application: { email: '', ctaText: 'Send Spontaneous CV' },
    },
  },
  {
    key: 'about',
    slug: 'about',
    title: 'About Us',
    defaultConfig: {
      story: '',
      tagline: '',
      values: [],
      image: '',
    },
    settingsKeys: { story: ['about_us_text'] },
  },
  {
    key: 'company',
    slug: 'company',
    title: 'Company',
    defaultConfig: {
      name: '',
      registration: '',
      certifications: '',
      teamSize: '',
      ceoName: '',
      established: '',
      tagline: '',
      philosophy: '',
      vision: '',
      impact: '',
      image: '',
    },
    settingsKeys: {
      registration: ['company_registration'],
      certifications: ['company_certifications'],
      teamSize: ['company_team_size'],
      ceoName: ['company_ceo_name'],
    },
  },
  {
    key: 'faq',
    slug: 'faq',
    title: 'FAQ',
    defaultConfig: {
      items: [],
    },
    settingsKeys: { items: ['faq_items'] },
  },
  {
    key: 'contact',
    slug: 'support',
    title: 'Contact / Support',
    defaultConfig: {
      phone: '',
      email: '',
      address: '',
      whatsapp: '',
      hours: [],
    },
    settingsKeys: {
      phone: ['store_phone'],
      email: ['store_email'],
      address: ['store_address'],
      whatsapp: ['social_whatsapp'],
      hours: ['hours_details'],
    },
  },
  {
    key: 'stores',
    slug: 'stores',
    title: 'Stores',
    defaultConfig: {
      stores: [],
    },
  },
  {
    key: 'delivery-areas',
    slug: 'delivery-areas',
    title: 'Delivery Areas',
    defaultConfig: {
      areas: [],
      freeDeliveryMin: 0,
    },
  },
  {
    key: 'terms-conditions',
    slug: 'terms-conditions',
    title: 'Terms & Conditions',
    defaultConfig: {
      intro: '',
      sections: [],
    },
  },
  {
    key: 'privacy-policy',
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    defaultConfig: {
      intro: '',
      sections: [],
    },
  },
  {
    key: 'refund-policy',
    slug: 'refund-policy',
    title: 'Refund Policy',
    defaultConfig: {
      intro: '',
      sections: [],
      notice: { title: '', body: '' },
      contactEmail: '',
    },
  },
  {
    key: 'exchange-policy',
    slug: 'exchange-policy',
    title: 'Exchange Policy',
    defaultConfig: {
      intro: '',
      quote: '',
      sections: [],
    },
  },
  {
    key: 'shipping-policy',
    slug: 'shipping-policy',
    title: 'Shipping Policy',
    defaultConfig: {
      intro: '',
      sections: [],
      deliveryCharge: 0,
      freeDeliveryMin: 0,
    },
    settingsKeys: { sections: ['shipping_info'] },
  },
  {
    key: 'download',
    slug: 'download',
    title: 'Download App',
    defaultConfig: {
      androidUrl: '',
      iosUrl: '',
      heading: '',
      description: '',
      image: '',
      features: [],
      qrCodeUrl: '',
      version: '',
      apkUrl: '',
    },
  },
];

// Field schemas that drive the "System Pages" settings form in the CMS Pages UI.

export type SimpleFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'image' | 'richText' | 'select'

export interface SimpleFieldDef {
  key: string
  label: string
  type: SimpleFieldType
  placeholder?: string
  help?: string
  /** Options for 'select' fields — values are selected, never typed. */
  options?: { value: string; label: string }[]
}

export interface ObjectArrayFieldDef {
  key: string
  label: string
  type: 'array'
  itemLabel: string
  fields: TemplateFieldDef[]
}

export interface ObjectFieldDef {
  key: string
  label: string
  type: 'object'
  fields: SimpleFieldDef[]
}

export interface StringArrayFieldDef {
  key: string
  label: string
  type: 'stringArray'
  itemLabel: string
  placeholder?: string
}

export type TemplateFieldDef = SimpleFieldDef | ObjectArrayFieldDef | ObjectFieldDef | StringArrayFieldDef

export interface TemplatePageSchema {
  key: string
  slug: string
  title: string
  description: string
  fields: TemplateFieldDef[]
}

const heroFields: SimpleFieldDef[] = [
  { key: 'title', label: 'Hero Title', type: 'text' },
  { key: 'subtitle', label: 'Hero Subtitle', type: 'textarea' },
  { key: 'image', label: 'Hero Image', type: 'image' },
]

/**
 * Policy content sections. Bodies are rich text (not plain textareas) so a
 * policy can carry real formatted prose. `id` is the section's stable
 * identifier — the storefront keys icons/anchor links off it, so renaming a
 * heading never silently changes the icon or breaks a link. `extra` holds
 * per-page semantic controls (exchange `kind`, terms `highlight`).
 */
function policySectionsField(extraFields: TemplateFieldDef[] = []): ObjectArrayFieldDef {
  return {
    key: 'sections',
    label: 'Content Sections',
    itemLabel: 'Section',
    type: 'array',
    fields: [
      { key: 'id', label: 'Section ID', type: 'text', placeholder: 'e.g. data-collection', help: 'Stable identifier for the section icon and anchor link. Set once; renaming the heading keeps the icon and link working.' },
      { key: 'heading', label: 'Heading', type: 'text' },
      { key: 'body', label: 'Body', type: 'richText' },
      ...extraFields,
    ],
  }
}

const sectionsField = policySectionsField()

export const templatePageSchemas: Record<string, TemplatePageSchema> = {
  careers: {
    key: 'careers',
    slug: 'careers',
    title: 'Careers',
    description: 'Job openings, benefits, and how to apply.',
    fields: [
      { key: 'hero', label: 'Hero', type: 'object', fields: heroFields },
      // NOTE: the old `jobs[]` array is dropped — job postings are managed
      // in the HR panel (JobPosting model) and listed from the API. Do not
      // re-add a jobs array here; the 4 fake seed jobs are not migrated.
      { key: 'benefits', label: 'Benefits', itemLabel: 'Benefit', type: 'stringArray', placeholder: 'e.g. Health Insurance' },
      { key: 'application', label: 'Application', type: 'object', fields: [
        { key: 'email', label: 'Apply Email', type: 'text' },
        { key: 'ctaText', label: 'Apply Button Text', type: 'text' },
      ] },
    ],
  },
  about: {
    key: 'about',
    slug: 'about',
    title: 'About Us',
    description: 'Our story, values, and mission.',
    fields: [
      { key: 'story', label: 'Story', type: 'textarea', help: 'Separate paragraphs with a blank line.' },
      { key: 'tagline', label: 'Hero Tagline', type: 'textarea', help: 'Shown under the store name in the hero. Leave empty to hide it.' },
      {
        key: 'values',
        label: 'Core Values',
        itemLabel: 'Value',
        type: 'array',
        fields: [
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'description', label: 'Description', type: 'textarea' },
        ],
      },
      { key: 'image', label: 'Hero Image', type: 'image' },
    ],
  },
  company: {
    key: 'company',
    slug: 'company',
    title: 'Company',
    description: 'Corporate details, certifications, and leadership.',
    fields: [
      { key: 'name', label: 'Corporate Name', type: 'text' },
      { key: 'registration', label: 'Registration No.', type: 'text' },
      { key: 'certifications', label: 'Certifications', type: 'text' },
      { key: 'teamSize', label: 'Team Size', type: 'text' },
      { key: 'ceoName', label: 'CEO / Founder', type: 'text' },
      { key: 'established', label: 'Established Year', type: 'text' },
      { key: 'tagline', label: 'Hero Tagline', type: 'textarea', help: 'Shown in the hero panel. Leave empty to hide it.' },
      { key: 'philosophy', label: 'Philosophy', type: 'textarea' },
      { key: 'vision', label: 'Vision', type: 'textarea' },
      { key: 'impact', label: 'Impact', type: 'textarea' },
      { key: 'image', label: 'Office Image', type: 'image' },
    ],
  },
  faq: {
    key: 'faq',
    slug: 'faq',
    title: 'FAQ',
    description: 'Frequently asked questions and answers.',
    fields: [
      {
        key: 'items',
        label: 'Questions & Answers',
        itemLabel: 'FAQ',
        type: 'array',
        fields: [
          { key: 'question', label: 'Question', type: 'textarea' },
          { key: 'answer', label: 'Answer', type: 'textarea' },
          { key: 'category', label: 'Category', type: 'text', placeholder: 'e.g. Orders', help: 'Groups questions under the category filter on the storefront.' },
        ],
      },
    ],
  },
  contact: {
    key: 'contact',
    slug: 'support',
    title: 'Contact / Support',
    description: 'Support phone, email, address, WhatsApp, and operating hours.',
    fields: [
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'whatsapp', label: 'WhatsApp Number', type: 'text' },
      { key: 'hours', label: 'Operating Hours', itemLabel: 'Slot', type: 'array', fields: [
        { key: 'days', label: 'Days', type: 'text' },
        { key: 'time', label: 'Time', type: 'text' },
      ] },
    ],
  },
  stores: {
    key: 'stores',
    slug: 'stores',
    title: 'Stores',
    description: 'Physical store locations, hours, and map links.',
    fields: [
      {
        key: 'stores',
        label: 'Store Locations',
        itemLabel: 'Store',
        type: 'array',
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'address', label: 'Address / Note', type: 'textarea' },
          { key: 'phone', label: 'Phone', type: 'text' },
          { key: 'hours', label: 'Hours', type: 'text' },
          { key: 'mapLink', label: 'Map / Directions Link', type: 'text' },
          { key: 'comingSoon', label: 'Coming Soon', type: 'boolean' },
        ],
      },
    ],
  },
  'delivery-areas': {
    key: 'delivery-areas',
    slug: 'delivery-areas',
    title: 'Delivery Areas',
    description: 'Delivery zones, charges, and timeframes.',
    fields: [
      { key: 'freeDeliveryMin', label: 'Free Delivery Minimum', type: 'number', help: '0 hides the free-delivery banner.' },
      {
        key: 'areas',
        label: 'Delivery Zones',
        itemLabel: 'Zone',
        type: 'array',
        fields: [
          { key: 'zone', label: 'Zone Name', type: 'text' },
          { key: 'charge', label: 'Charge', type: 'text' },
          { key: 'deliveryTime', label: 'Delivery Time', type: 'text' },
          { key: 'areas', label: 'Areas / Districts', itemLabel: 'Area', type: 'stringArray' },
        ],
      },
    ],
  },
  'terms-conditions': {
    key: 'terms-conditions',
    slug: 'terms-conditions',
    title: 'Terms & Conditions',
    description: 'Terms of service document.',
    fields: [
      { key: 'intro', label: 'Introduction', type: 'textarea', help: 'Shown under the page title. Leave empty to hide it.' },
      policySectionsField([
        { key: 'highlight', label: 'Highlight as callout', type: 'boolean', help: 'Show this section in the highlighted callout card instead of the main list.' },
      ]),
    ],
  },
  'privacy-policy': {
    key: 'privacy-policy',
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    description: 'Privacy and data handling policy.',
    fields: [
      { key: 'intro', label: 'Introduction', type: 'textarea', help: 'Shown under the page title. Leave empty to hide it.' },
      sectionsField,
    ],
  },
  'refund-policy': {
    key: 'refund-policy',
    slug: 'refund-policy',
    title: 'Refund Policy',
    description: 'Returns, refunds, and eligibility.',
    fields: [
      { key: 'intro', label: 'Introduction', type: 'textarea', help: 'Shown under the page title. Leave empty to hide it.' },
      sectionsField,
      { key: 'notice', label: 'Important Notice', type: 'object', fields: [
        { key: 'title', label: 'Notice Title', type: 'text' },
        { key: 'body', label: 'Notice Text', type: 'textarea', help: 'Shown in the amber notice box. Leave empty to hide the box entirely.' },
      ] },
      { key: 'contactEmail', label: 'Contact Email', type: 'text' },
    ],
  },
  'exchange-policy': {
    key: 'exchange-policy',
    slug: 'exchange-policy',
    title: 'Exchange Policy',
    description: 'Product exchange conditions.',
    fields: [
      { key: 'intro', label: 'Introduction', type: 'textarea', help: 'Shown under the page title. Leave empty to hide it.' },
      { key: 'quote', label: 'Quote', type: 'textarea', help: 'Shown in the quote card. Leave empty to hide the card.' },
      policySectionsField([
        { key: 'kind', label: 'Role', type: 'select', options: [
          { value: 'step', label: 'Step — shown as a step card' },
          { value: 'condition', label: 'Condition — shown in the conditions list' },
        ], help: 'How this section is presented on the page.' },
      ]),
    ],
  },
  'shipping-policy': {
    key: 'shipping-policy',
    slug: 'shipping-policy',
    title: 'Shipping Policy',
    description: 'Shipping times, charges, and delivery information.',
    fields: [
      { key: 'intro', label: 'Introduction', type: 'textarea', help: 'Shown under the page title. Leave empty to hide it.' },
      sectionsField,
      { key: 'deliveryCharge', label: 'Inside Dhaka Delivery Charge', type: 'number' },
      { key: 'freeDeliveryMin', label: 'Free Delivery Minimum', type: 'number' },
    ],
  },
  download: {
    key: 'download',
    slug: 'download',
    title: 'Download App',
    description: 'Mobile app download links and features.',
    fields: [
      { key: 'androidUrl', label: 'Android / Play Store URL', type: 'text' },
      { key: 'iosUrl', label: 'iOS / App Store URL', type: 'text' },
      { key: 'heading', label: 'Heading', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'image', label: 'App Image', type: 'image' },
      { key: 'features', label: 'Feature Highlights', itemLabel: 'Feature', type: 'stringArray' },
      { key: 'qrCodeUrl', label: 'QR Code Image URL', type: 'image', help: 'QR code shown on the download page. Leave empty to hide it.' },
      { key: 'version', label: 'App Version', type: 'text', placeholder: 'e.g. 1.4.0' },
      { key: 'apkUrl', label: 'Direct APK Download URL', type: 'text', help: 'Shown only when set.' },
    ],
  },
}

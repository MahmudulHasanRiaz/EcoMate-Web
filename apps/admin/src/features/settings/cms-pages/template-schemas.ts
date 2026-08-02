// Field schemas that drive the "System Pages" settings form in the CMS Pages UI.

export type SimpleFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'image' | 'richText'

export interface SimpleFieldDef {
  key: string
  label: string
  type: SimpleFieldType
  placeholder?: string
  help?: string
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

const sectionsField: ObjectArrayFieldDef = {
  key: 'sections',
  label: 'Content Sections',
  itemLabel: 'Section',
  type: 'array',
  fields: [
    { key: 'heading', label: 'Heading', type: 'text' },
    { key: 'body', label: 'Body', type: 'textarea' },
  ],
}

export const templatePageSchemas: Record<string, TemplatePageSchema> = {
  careers: {
    key: 'careers',
    slug: 'careers',
    title: 'Careers',
    description: 'Job openings, benefits, and how to apply.',
    fields: [
      { key: 'hero', label: 'Hero', type: 'object', fields: heroFields },
      {
        key: 'jobs',
        label: 'Open Positions',
        itemLabel: 'Job',
        type: 'array',
        fields: [
          { key: 'title', label: 'Job Title', type: 'text' },
          { key: 'department', label: 'Department', type: 'text' },
          { key: 'location', label: 'Location', type: 'text' },
          { key: 'type', label: 'Employment Type', type: 'text' },
          { key: 'salary', label: 'Salary', type: 'text' },
          { key: 'description', label: 'Description', type: 'textarea' },
        ],
      },
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
    fields: [sectionsField],
  },
  'privacy-policy': {
    key: 'privacy-policy',
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    description: 'Privacy and data handling policy.',
    fields: [sectionsField],
  },
  'refund-policy': {
    key: 'refund-policy',
    slug: 'refund-policy',
    title: 'Refund Policy',
    description: 'Returns, refunds, and eligibility.',
    fields: [sectionsField, { key: 'contactEmail', label: 'Contact Email', type: 'text' }],
  },
  'exchange-policy': {
    key: 'exchange-policy',
    slug: 'exchange-policy',
    title: 'Exchange Policy',
    description: 'Product exchange conditions.',
    fields: [sectionsField],
  },
  'shipping-policy': {
    key: 'shipping-policy',
    slug: 'shipping-policy',
    title: 'Shipping Policy',
    description: 'Shipping times, charges, and delivery information.',
    fields: [
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
    ],
  },
}

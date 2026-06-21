import {
  Store, Palette, ImageIcon, Layout, List, HelpCircle, Clock, Info,
  Search, Share2, ShoppingCart, Phone, Settings,
  type LucideIcon,
} from 'lucide-react'

export type SectionId =
  | 'general'
  | 'identity-store'
  | 'identity-brands'
  | 'visuals-hero'
  | 'visuals-footer'
  | 'content-faq'
  | 'content-hours'
  | 'content-about'
  | 'discovery-seo'
  | 'discovery-social'
  | 'commerce-checkout'
  | 'commerce-order'
  | 'catalog-display'

export interface SectionMeta {
  id: SectionId
  categoryId: CategoryId
  title: string
  description: string
  icon: LucideIcon
  fields: string[]
}

export type CategoryId =
  | 'identity'
  | 'visuals'
  | 'content'
  | 'discovery'
  | 'commerce'

export interface CategoryMeta {
  id: CategoryId
  label: string
  description: string
  sections: SectionId[]
}

export const CATEGORIES: CategoryMeta[] = [
  {
    id: 'identity',
    label: 'Identity',
    description: 'Brand basics: name, contact, currency',
    sections: ['identity-store', 'identity-brands'],
  },
  {
    id: 'visuals',
    label: 'Visuals',
    description: 'Hero banner, footer appearance',
    sections: ['visuals-hero', 'visuals-footer'],
  },
  {
    id: 'content',
    label: 'Content',
    description: 'FAQ, hours, and about page content settings',
    sections: ['content-faq', 'content-hours', 'content-about'],
  },
  {
    id: 'discovery',
    label: 'Discovery',
    description: 'SEO defaults and social media links',
    sections: ['discovery-seo', 'discovery-social'],
  },
  {
    id: 'commerce',
    label: 'Commerce',
    description: 'Checkout form fields and order contact',
    sections: ['commerce-checkout', 'commerce-order', 'catalog-display'],
  },
]

export const SECTIONS: Record<SectionId, SectionMeta> = {
  'general': {
    id: 'general',
    categoryId: 'identity',
    title: 'General',
    description: 'General system-level configuration for your application.',
    icon: Settings,
    fields: [
      'app_name', 'app_url', 'default_timezone', 'default_locale',
      'maintenance_mode', 'admin_email', 'pagination_default',
    ],
  },
  'identity-store': {
    id: 'identity-store',
    categoryId: 'identity',
    title: 'Store Identity',
    description: 'Basic information that appears across your storefront.',
    icon: Store,
    fields: [
      'store_name', 'store_tagline', 'store_email', 'store_phone',
      'store_address', 'currency', 'currency_symbol',
    ],
  },
  'identity-brands': {
    id: 'identity-brands',
    categoryId: 'identity',
    title: 'Brands & Systems',
    description: 'Manage brand systems shown in the storefront header and footer.',
    icon: Palette,
    fields: ['store_systems'],
  },
  'visuals-hero': {
    id: 'visuals-hero',
    categoryId: 'visuals',
    title: 'Hero Banner',
    description: 'Slider images and secondary banner on the homepage.',
    icon: ImageIcon,
    fields: ['hero_slides', 'hero_secondary_banner', 'hero_secondary_banner_alt'],
  },
  'visuals-footer': {
    id: 'visuals-footer',
    categoryId: 'visuals',
    title: 'Footer Content',
    description: 'Text and copyright shown in the storefront footer.',
    icon: Layout,
    fields: ['footer_description', 'footer_copyright'],
  },
  'content-faq': {
    id: 'content-faq',
    categoryId: 'content',
    title: 'FAQ Items',
    description: 'Frequently asked questions on the FAQ page.',
    icon: HelpCircle,
    fields: ['faq_items'],
  },
  'content-hours': {
    id: 'content-hours',
    categoryId: 'content',
    title: 'Operating Hours',
    description: 'Store hours displayed on support and stores pages.',
    icon: Clock,
    fields: ['hours_label', 'hours_details'],
  },
  'content-about': {
    id: 'content-about',
    categoryId: 'content',
    title: 'About & Company',
    description: 'About-us text, payment & shipping policy, company information.',
    icon: Info,
    fields: [
      'about_us_text', 'payment_info', 'shipping_info',
      'company_name', 'company_registration', 'company_certifications',
      'company_team_size', 'company_ceo_name',
    ],
  },
  'discovery-seo': {
    id: 'discovery-seo',
    categoryId: 'discovery',
    title: 'SEO Defaults',
    description: 'Default meta tags for search engine optimization.',
    icon: Search,
    fields: ['seo_title', 'seo_description', 'seo_keywords'],
  },
  'discovery-social': {
    id: 'discovery-social',
    categoryId: 'discovery',
    title: 'Social Links',
    description: 'Social media URLs and messaging usernames.',
    icon: Share2,
    fields: [
      'social_facebook', 'social_instagram', 'social_youtube',
      'social_whatsapp', 'social_messenger_username',
    ],
  },
  'commerce-checkout': {
    id: 'commerce-checkout',
    categoryId: 'commerce',
    title: 'Checkout Configuration',
    description: 'Form fields and payment options available to customers.',
    icon: ShoppingCart,
    fields: [
      'checkout_district_enabled', 'checkout_thana_enabled',
      'checkout_district_required', 'checkout_thana_required',
    ],
  },
  'commerce-order': {
    id: 'commerce-order',
    categoryId: 'commerce',
    title: 'Order Contact',
    description: 'WhatsApp and phone for order-related customer contact.',
    icon: Phone,
    fields: ['order_whatsapp', 'order_call_number'],
  },
  'catalog-display': {
    id: 'catalog-display',
    categoryId: 'commerce',
    title: 'Catalog Display',
    description: 'Image ratio and display settings for product and combo cards.',
    icon: ImageIcon,
    fields: ['catalogImageRatio', 'hide_oos_products', 'default_variant_selected'],
  },

}

export function getSectionById(id: SectionId): SectionMeta {
  const section = SECTIONS[id]
  if (!section) throw new Error(`Unknown section id: ${id}`)
  return section
}

export function getFieldsInSection(id: SectionId): string[] {
  return SECTIONS[id]?.fields ?? []
}

export function getAllFieldKeys(): string[] {
  return Object.values(SECTIONS).flatMap(s => s.fields)
}

export function getSectionForField(key: string): SectionMeta | null {
  for (const section of Object.values(SECTIONS)) {
    if (section.fields.includes(key)) return section
  }
  return null
}

export function getCategoryById(id: CategoryId): CategoryMeta {
  const cat = CATEGORIES.find(c => c.id === id)
  if (!cat) throw new Error(`Unknown category id: ${id}`)
  return cat
}

export function getSectionsInCategory(id: CategoryId): SectionMeta[] {
  const cat = getCategoryById(id)
  return cat.sections.map(getSectionById)
}

export function getAllSections(): SectionMeta[] {
  return Object.values(SECTIONS)
}

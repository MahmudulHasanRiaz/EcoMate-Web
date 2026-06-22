export type FieldType =
  | 'text' | 'email' | 'tel' | 'url'
  | 'textarea'
  | 'switch'
  | 'image'
  | 'currency'
  | 'array-store-systems'
  | 'array-hero-slides'
  | 'array-nav'
  | 'array-faq'
  | 'array-hours'
  | 'payment-modes'

export interface FieldSchema {
  label: string
  type: FieldType
  hint?: string
  placeholder?: string
  rows?: number
}

export const FIELD_SCHEMAS: Record<string, FieldSchema> = {
  store_name:                    { label: 'Store Name', type: 'text' },
  store_tagline:                 { label: 'Tagline', type: 'text' },
  store_email:                   { label: 'Email', type: 'email' },
  store_phone:                   { label: 'Phone', type: 'tel' },
  store_address:                 { label: 'Address', type: 'textarea', rows: 2 },
  currency:                      { label: 'Currency Code', type: 'text', placeholder: 'BDT' },
  currency_symbol:               { label: 'Currency Symbol', type: 'text', placeholder: '\u09e7' },
  hero_slides:                   { label: 'Hero Slides', type: 'array-hero-slides' },
  hero_secondary_banner:         { label: 'Secondary Banner', type: 'image' },
  hero_secondary_banner_alt:     { label: 'Banner Alt Text', type: 'text' },
  social_facebook:               { label: 'Facebook URL', type: 'url', placeholder: 'https://facebook.com/...' },
  social_instagram:              { label: 'Instagram URL', type: 'url', placeholder: 'https://instagram.com/...' },
  social_youtube:                { label: 'YouTube URL', type: 'url', placeholder: 'https://youtube.com/...' },
  social_whatsapp:               { label: 'WhatsApp Number', type: 'tel', placeholder: '+8801700000000' },
  social_messenger_username:     { label: 'Messenger Username', type: 'text', placeholder: 'ecopage.bd' },
  order_whatsapp:                { label: 'Order WhatsApp', type: 'tel', placeholder: '+8801700000000' },
  order_call_number:             { label: 'Order Call Number', type: 'tel', placeholder: '+8801700000000' },
  seo_title:                     { label: 'Default Page Title', type: 'text' },
  seo_description:               { label: 'Meta Description', type: 'textarea', rows: 3 },
  seo_keywords:                  { label: 'Keywords (comma separated)', type: 'text' },
  footer_description:            { label: 'Footer Description', type: 'textarea', rows: 4 },
  footer_copyright:              { label: 'Copyright Text', type: 'text' },
  about_us_text:                 { label: 'About Us Text', type: 'textarea', rows: 4 },
  payment_info:                  { label: 'Payment Information', type: 'textarea', rows: 3 },
  shipping_info:                 { label: 'Shipping Policy Text', type: 'textarea', rows: 3, hint: 'Per-district delivery charges are configured in Shipping Settings.' },
  navigation_items:              { label: 'Navigation Items', type: 'array-nav' },
  navigation_categories:         { label: 'Menu Categories', type: 'text', hint: 'Managed in the Menu Categories section' },
  faq_items:                     { label: 'FAQ Items', type: 'array-faq' },
  hours_label:                   { label: 'Hours Summary (text)', type: 'text', placeholder: 'Sat-Thu 10AM-10PM, Fri 3PM-10PM' },
  hours_details:                 { label: 'Daily Schedule', type: 'array-hours' },
  company_name:                  { label: 'Company Name', type: 'text' },
  company_registration:          { label: 'Registration Number', type: 'text' },
  company_certifications:        { label: 'Certifications', type: 'text' },
  company_team_size:             { label: 'Team Size', type: 'text' },
  company_ceo_name:              { label: 'CEO / Founder Name', type: 'text' },
  store_systems:                 { label: 'Store Brands / Systems', type: 'array-store-systems' },
  checkout_district_enabled:     { label: 'District Field', type: 'switch', hint: 'Show district dropdown in checkout' },
  checkout_thana_enabled:        { label: 'Thana/Upazila Field', type: 'switch', hint: 'Show thana dropdown in checkout' },
  checkout_district_required:    { label: 'District Required', type: 'switch', hint: 'Customer must select a district', },
  checkout_thana_required:       { label: 'Thana/Upazila Required', type: 'switch', hint: 'Customer must select a thana' },

  catalogImageRatio:             { label: 'Catalog Image Ratio', type: 'text', hint: 'JSON — managed via Catalog Display section' },
  hide_oos_products:             { label: 'Hide Out of Stock Products', type: 'switch', hint: 'When enabled, products with zero stock are hidden from the archive/catalog listing' },
  default_variant_selected:      { label: 'Default Variant Selection', type: 'switch', hint: 'When enabled, the first variant of a product is automatically selected by default on the storefront. When disabled, the user must explicitly select color/size/attributes.' },
  show_reviews:                  { label: 'Show Product Reviews', type: 'switch', hint: 'Toggle product reviews on/off on the product details page.' },
}

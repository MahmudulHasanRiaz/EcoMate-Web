export interface LicenseInfoResponse {
  features: string[];
  clientId?: string;
  domains?: string[];
  exp?: number;
  iat?: number;
}

export class LicenseInfo {
  features: string[];
  raw: any;

  constructor(data: { features: string[]; raw?: any }) {
    this.features = data.features;
    this.raw = data.raw;
  }

  hasFeature(key: string): boolean {
    return this.features.includes(key);
  }
}

export type ResourceLimits = Record<string, number>;

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  dependencies?: string[];
}

export interface LicenseToken {
  clientId: string;
  features: string[];
  limits: ResourceLimits;
  domains: string[];
  exp: number;
  iat: number;
}

export const FEATURES: Record<string, FeatureFlag> = {
  // ── A: Storefront (1 feature) ──
  storefront: { key: 'storefront', enabled: true },

  // ── B: Public Add-ons (5) ──
  storefront_order_tracking: { key: 'storefront_order_tracking', enabled: true, dependencies: ['storefront'] },
  storefront_flying_cart: { key: 'storefront_flying_cart', enabled: true, dependencies: ['storefront'] },
  storefront_reviews: { key: 'storefront_reviews', enabled: true, dependencies: ['storefront'] },
  storefront_wishlist: { key: 'storefront_wishlist', enabled: true, dependencies: ['storefront'] },
  storefront_referral: { key: 'storefront_referral', enabled: true, dependencies: ['storefront'] },

  // ── C: Storefront Enhancements (3) ──
  pwa_setup: { key: 'pwa_setup', enabled: true, dependencies: ['storefront'] },
  seo_suite: { key: 'seo_suite', enabled: true, dependencies: ['storefront'] },
  offline_conversion: { key: 'offline_conversion', enabled: true },

  // ── D: Tracking & Analytics Integrations (4) ──
  integration_ga4: { key: 'integration_ga4', enabled: true, dependencies: ['storefront'] },
  integration_tiktok: { key: 'integration_tiktok', enabled: true, dependencies: ['storefront'] },
  integration_meta: { key: 'integration_meta', enabled: true, dependencies: ['storefront'] },
  integration_google_ads: { key: 'integration_google_ads', enabled: true, dependencies: ['storefront'] },

  // ── E: Core Admin — Operation (9) ──
  admin_products: { key: 'admin_products', enabled: true },
  admin_orders: { key: 'admin_orders', enabled: true },
  admin_customers: { key: 'admin_customers', enabled: true },
  admin_brands: { key: 'admin_brands', enabled: true, dependencies: ['admin_products'] },
  admin_settings: { key: 'admin_settings', enabled: true },
  admin_media: { key: 'admin_media', enabled: true },
  admin_users: { key: 'admin_users', enabled: true },
  admin_print: { key: 'admin_print', enabled: true, dependencies: ['admin_orders'] },
  admin_coupons: { key: 'admin_coupons', enabled: true, dependencies: ['admin_products', 'admin_orders'] },

  // ── F: Product Enhancement (5) ──
  admin_size_charts: { key: 'admin_size_charts', enabled: true, dependencies: ['admin_products'] },
  admin_combos: { key: 'admin_combos', enabled: true, dependencies: ['admin_products'] },
  admin_reviews: { key: 'admin_reviews', enabled: true, dependencies: ['storefront_reviews'] },
  admin_import_products: { key: 'admin_import_products', enabled: true, dependencies: ['admin_products'] },
  admin_price_tags: { key: 'admin_price_tags', enabled: true, dependencies: ['admin_products'] },

  // ── G: Supply Chain (3) ──
  admin_suppliers: { key: 'admin_suppliers', enabled: true, dependencies: ['admin_products'] },
  admin_purchases: { key: 'admin_purchases', enabled: true, dependencies: ['admin_suppliers', 'admin_inventory'] },
  admin_order_import: { key: 'admin_order_import', enabled: true, dependencies: ['admin_orders'] },

  // ── H: Financial (5) ──
  admin_expenses: { key: 'admin_expenses', enabled: true },
  admin_payments: { key: 'admin_payments', enabled: true, dependencies: ['admin_orders'] },
  admin_refunds: { key: 'admin_refunds', enabled: true, dependencies: ['admin_orders'] },
  admin_accounting: { key: 'admin_accounting', enabled: true },
  admin_financial_periods: { key: 'admin_financial_periods', enabled: true, dependencies: ['admin_accounting'] },

  // ── I: HR & Operations (3) ──
  admin_payroll: { key: 'admin_payroll', enabled: true },
  admin_employees: { key: 'admin_employees', enabled: true },
  admin_tasks: { key: 'admin_tasks', enabled: true },

  // ── J: Marketing & Content (5) ──
  admin_email_campaigns: { key: 'admin_email_campaigns', enabled: true, dependencies: ['admin_customers'] },
  admin_landing_pages: { key: 'admin_landing_pages', enabled: true },
  admin_cms_pages: { key: 'admin_cms_pages', enabled: true },
  admin_product_feeds: { key: 'admin_product_feeds', enabled: true, dependencies: ['admin_products'] },
  admin_referrals: { key: 'admin_referrals', enabled: true, dependencies: ['storefront_referral'] },

  // ── K: Inventory & Fulfillment (8) ──
  admin_inventory: { key: 'admin_inventory', enabled: true, dependencies: ['admin_products'] },
  admin_warehouses: { key: 'admin_warehouses', enabled: true, dependencies: ['admin_inventory'] },
  admin_inventory_valuation: { key: 'admin_inventory_valuation', enabled: true, dependencies: ['admin_inventory'] },
  admin_dispatch: { key: 'admin_dispatch', enabled: true, dependencies: ['admin_products', 'admin_orders'] },
  admin_packing: { key: 'admin_packing', enabled: true, dependencies: ['admin_orders'] },
  admin_barcode_search: { key: 'admin_barcode_search', enabled: true, dependencies: ['admin_products'] },
  admin_incomplete_orders: { key: 'admin_incomplete_orders', enabled: true, dependencies: ['admin_orders'] },
  admin_global_search: { key: 'admin_global_search', enabled: true },

  // ── L: Courier Services (4) ──
  courier_steadfast: { key: 'courier_steadfast', enabled: true, dependencies: ['admin_products', 'admin_orders'] },
  courier_pathao: { key: 'courier_pathao', enabled: true, dependencies: ['admin_products', 'admin_orders'] },
  courier_redx: { key: 'courier_redx', enabled: true, dependencies: ['admin_products', 'admin_orders'] },
  courier_carrybee: { key: 'courier_carrybee', enabled: true, dependencies: ['admin_products', 'admin_orders'] },

  // ── M: Payment Gateways (6) ──
  gateway_bkash: { key: 'gateway_bkash', enabled: true, dependencies: ['storefront'] },
  gateway_nagad: { key: 'gateway_nagad', enabled: true, dependencies: ['storefront'] },
  gateway_rocket: { key: 'gateway_rocket', enabled: true, dependencies: ['storefront'] },
  gateway_sslcommerz: { key: 'gateway_sslcommerz', enabled: true, dependencies: ['storefront'] },
  gateway_surjopay: { key: 'gateway_surjopay', enabled: true, dependencies: ['storefront'] },
  gateway_aamarpay: { key: 'gateway_aamarpay', enabled: true, dependencies: ['storefront'] },

  // ── N: Admin Tools (5) ──
  admin_notifications: { key: 'admin_notifications', enabled: true },
  admin_blocking: { key: 'admin_blocking', enabled: true },
  admin_analytics: { key: 'admin_analytics', enabled: true },
  admin_activity_logs: { key: 'admin_activity_logs', enabled: true },
  admin_help_center: { key: 'admin_help_center', enabled: true },

  // ── O: Infrastructure (9) ──
  mobile_distribution: { key: 'mobile_distribution', enabled: true, dependencies: ['storefront'] },
  mobile_distribution_admin: { key: 'mobile_distribution_admin', enabled: true, dependencies: ['mobile_distribution'] },
  mobile_distribution_pos: { key: 'mobile_distribution_pos', enabled: true, dependencies: ['mobile_distribution'] },
  image_resize_proxy: { key: 'image_resize_proxy', enabled: true },
  pos_system: { key: 'pos_system', enabled: true, dependencies: ['admin_products'] },
  smtp_server: { key: 'smtp_server', enabled: true },
  s3_storage: { key: 's3_storage', enabled: true },
  db_backup: { key: 'db_backup', enabled: true },
  custom_domain: { key: 'custom_domain', enabled: true },
};

export const FEATURE_KEYS = Object.keys(FEATURES);

export const DEPENDENCY_MAP: Record<string, string[]> = {
  admin_warehouses: ['admin_inventory'],
  admin_inventory_valuation: ['admin_inventory'],
  admin_purchases: ['admin_suppliers', 'admin_inventory'],
  admin_financial_periods: ['admin_accounting'],
  admin_refunds: ['admin_orders'],
  admin_packing: ['admin_orders'],
  admin_dispatch: ['admin_products', 'admin_orders'],
  admin_incomplete_orders: ['admin_orders'],
  admin_reviews: ['storefront_reviews'],
  admin_referrals: ['storefront_referral'],
  courier_steadfast: ['admin_orders'],
  courier_pathao: ['admin_orders'],
  courier_redx: ['admin_orders'],
  courier_carrybee: ['admin_orders'],
  gateway_bkash: ['storefront'],
  gateway_nagad: ['storefront'],
  gateway_rocket: ['storefront'],
  gateway_sslcommerz: ['storefront'],
  gateway_surjopay: ['storefront'],
  gateway_aamarpay: ['storefront'],
  pos_system: ['admin_products'],
  mobile_distribution: ['storefront'],
  mobile_distribution_admin: ['mobile_distribution'],
  mobile_distribution_pos: ['mobile_distribution'],
  admin_barcode_search: ['pos_system'],
  admin_order_import: ['admin_orders'],
};

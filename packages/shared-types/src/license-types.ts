export type PlanType = 'essential' | 'growth' | 'enterprise' | 'custom';

export const PLAN_TYPES: readonly PlanType[] = ['essential', 'growth', 'enterprise', 'custom'] as const;

export function isPlanType(v: string): v is PlanType {
  return PLAN_TYPES.includes(v as PlanType);
}

export type ResourceLimits = Record<string, number>;

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  planMin: PlanType;
}

/** Feature map definitions */
const featureDefs: Array<{ key: string; name: string; group: string; planMin: PlanType }> = [
  // ── Storefront ──
  { key: 'storefront_catalog', name: 'Product Catalog', group: 'Storefront', planMin: 'essential' },
  { key: 'storefront_detail', name: 'Product Detail', group: 'Storefront', planMin: 'essential' },
  { key: 'storefront_categories', name: 'Categories', group: 'Storefront', planMin: 'essential' },
  { key: 'storefront_brands', name: 'Brands', group: 'Storefront', planMin: 'essential' },
  { key: 'storefront_tags', name: 'Tags', group: 'Storefront', planMin: 'essential' },
  { key: 'storefront_search', name: 'Search', group: 'Storefront', planMin: 'essential' },
  { key: 'storefront_cart', name: 'Cart', group: 'Storefront', planMin: 'essential' },
  { key: 'storefront_checkout', name: 'Checkout', group: 'Storefront', planMin: 'essential' },
  { key: 'storefront_orders', name: 'Order History', group: 'Storefront', planMin: 'essential' },
  { key: 'storefront_account', name: 'User Account', group: 'Storefront', planMin: 'essential' },
  { key: 'storefront_cms_pages', name: 'CMS Pages', group: 'Storefront', planMin: 'essential' },
  { key: 'storefront_combos', name: 'Combo Deals', group: 'Storefront', planMin: 'growth' },
  { key: 'storefront_reviews', name: 'Reviews', group: 'Storefront', planMin: 'growth' },
  { key: 'storefront_wishlist', name: 'Wishlist', group: 'Storefront', planMin: 'growth' },
  { key: 'storefront_delivery', name: 'Delivery Areas', group: 'Storefront', planMin: 'growth' },
  { key: 'storefront_referral', name: 'Referral Program', group: 'Storefront', planMin: 'growth' },
  { key: 'storefront_landing', name: 'Landing Pages', group: 'Storefront', planMin: 'growth' },
  // ── Admin ──
  { key: 'admin_dashboard', name: 'Dashboard', group: 'Admin', planMin: 'essential' },
  { key: 'admin_products', name: 'Product Management', group: 'Admin', planMin: 'essential' },
  { key: 'admin_orders', name: 'Order Management', group: 'Admin', planMin: 'essential' },
  { key: 'admin_order_statuses', name: 'Custom Order Statuses', group: 'Admin', planMin: 'essential' },
  { key: 'admin_customers', name: 'Customer Management', group: 'Admin', planMin: 'essential' },
  { key: 'admin_categories', name: 'Category Management', group: 'Admin', planMin: 'essential' },
  { key: 'admin_brands', name: 'Brand Management', group: 'Admin', planMin: 'essential' },
  { key: 'admin_settings', name: 'Settings', group: 'Admin', planMin: 'essential' },
  { key: 'admin_print', name: 'Print Invoices/Stickers', group: 'Admin', planMin: 'essential' },
  { key: 'admin_attributes', name: 'Product Attributes', group: 'Admin', planMin: 'growth' },
  { key: 'admin_size_charts', name: 'Size Charts', group: 'Admin', planMin: 'growth' },
  { key: 'admin_tags', name: 'Tags', group: 'Admin', planMin: 'growth' },
  { key: 'admin_combos', name: 'Combo Management', group: 'Admin', planMin: 'growth' },
  { key: 'admin_coupons', name: 'Coupons & Discounts', group: 'Admin', planMin: 'growth' },
  { key: 'admin_reviews', name: 'Review Moderation', group: 'Admin', planMin: 'growth' },
  { key: 'admin_suppliers', name: 'Supplier Management', group: 'Admin', planMin: 'growth' },
  { key: 'admin_purchases', name: 'Purchase Orders', group: 'Admin', planMin: 'growth' },
  { key: 'admin_inventory', name: 'Inventory Management', group: 'Admin', planMin: 'growth' },
  { key: 'admin_expenses', name: 'Expense Management', group: 'Admin', planMin: 'growth' },
  { key: 'admin_shipments', name: 'Shipments', group: 'Admin', planMin: 'growth' },
  { key: 'admin_courier', name: 'Courier Integration', group: 'Admin', planMin: 'growth' },
  { key: 'admin_payments', name: 'Payment Management', group: 'Admin', planMin: 'growth' },
  { key: 'admin_refunds', name: 'Refund Processing', group: 'Admin', planMin: 'growth' },
  { key: 'admin_media', name: 'Media Library', group: 'Admin', planMin: 'growth' },
  { key: 'admin_import', name: 'Import Products', group: 'Admin', planMin: 'growth' },
  { key: 'admin_checkout_leads', name: 'Checkout Leads', group: 'Admin', planMin: 'growth' },
  { key: 'admin_staff_users', name: 'Staff Users & Roles', group: 'Admin', planMin: 'growth' },
  { key: 'admin_notifications', name: 'Notifications', group: 'Admin', planMin: 'growth' },
  { key: 'admin_accounting', name: 'Accounting', group: 'Admin', planMin: 'enterprise' },
  { key: 'admin_payroll', name: 'Payroll', group: 'Admin', planMin: 'enterprise' },
  { key: 'admin_employees', name: 'Employee Management', group: 'Admin', planMin: 'enterprise' },
  { key: 'admin_campaigns', name: 'Email Campaigns', group: 'Admin', planMin: 'enterprise' },
  { key: 'admin_landing_pages', name: 'Landing Page Builder', group: 'Admin', planMin: 'enterprise' },
  { key: 'admin_cms', name: 'CMS Pages', group: 'Admin', planMin: 'enterprise' },
  { key: 'admin_blocking', name: 'IP/Phone Blocking', group: 'Admin', planMin: 'enterprise' },
  { key: 'admin_analytics', name: 'Analytics', group: 'Admin', planMin: 'enterprise' },
  { key: 'admin_activity_logs', name: 'Activity Logs', group: 'Admin', planMin: 'enterprise' },
  { key: 'admin_tracking', name: 'Conversion Tracking', group: 'Admin', planMin: 'enterprise' },
  { key: 'admin_tasks', name: 'Task Management', group: 'Admin', planMin: 'enterprise' },
  { key: 'admin_referrals', name: 'Referral Management', group: 'Admin', planMin: 'enterprise' },
  { key: 'admin_inventory_valuation', name: 'Inventory Valuation', group: 'Admin', planMin: 'enterprise' },
];

export const FEATURES: Record<string, FeatureFlag> = {};
for (const def of featureDefs) {
  FEATURES[def.key] = { key: def.key, enabled: true, planMin: def.planMin };
}

export interface LicenseToken {
  clientId: string;
  plan: PlanType;
  features: string[];
  limits: ResourceLimits;
  domains: string[];
  exp: number;
  iat: number;
}

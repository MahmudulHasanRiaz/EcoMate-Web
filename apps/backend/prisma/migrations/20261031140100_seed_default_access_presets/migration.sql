-- Seed the standard access presets for a typical Bangladeshi e-commerce
-- operation (owner request, 2026-10-31), alongside the existing built-in
-- "Manager" preset (migration 20261005120000).
--
-- Preservation contract (owner's explicit requirement): these rows are
-- inserted ONLY when a preset with the same name does not already exist
-- (ON CONFLICT DO NOTHING). A redeploy therefore never overwrites a
-- client's own presets, and the built-ins themselves are isSystem=true,
-- which the API already protects from edit/delete ("duplicate to make
-- changes") — a client's customized copy is their own row and is never
-- touched by any future seed.
--
-- Permission keys are the catalogue's stable legacy keys (same style as
-- the Manager seed); a backend spec asserts every key below exists in
-- the live permission catalogue, so a renamed key fails CI instead of
-- silently seeding a preset that grants less than its description says.
INSERT INTO "AccessPreset" (id, name, description, permissions, "isSystem", "createdAt", "updatedAt")
VALUES
(
  'system-preset-order-operator',
  'Order Operator',
  'Day-to-day order processing: confirm orders, manage customers, book couriers and shipments, handle returns and exchanges. No finance, discounts, or settings access.',
  ARRAY[
    'view_orders','create_orders','edit_orders','assign_orders','change_status_orders',
    'view_customers','create_customers','edit_customers',
    'view_customer_addresses','create_customer_addresses','edit_customer_addresses',
    'view_products','view_inventory','view_delivery_areas','view_shipping',
    'view_shipment','create_shipment','edit_shipment','manage_dispatch_dispatch',
    'view_tracking','view_couriers',
    'view_rtn','create_rtn','edit_rtn','view_exchange','create_exchange','edit_exchange',
    'view_checkout_leads','view_payments',
    'view_blocked_entries','create_blocked_entries','edit_blocked_entries'
  ]::TEXT[],
  true, NOW(), NOW()
),
(
  'system-preset-call-center',
  'Call Center Agent',
  'Phone orders and customer support: take orders by phone, look up customers and order status, follow up checkout leads. Cannot dispatch, refund, or change payments.',
  ARRAY[
    'view_orders','create_orders','edit_orders',
    'view_customers','create_customers','edit_customers',
    'view_customer_addresses','create_customer_addresses','edit_customer_addresses',
    'view_products','view_inventory',
    'view_checkout_leads','create_checkout_leads','edit_checkout_leads',
    'view_tracking','view_shipment','view_delivery_areas','view_shipping',
    'view_customer_reviews'
  ]::TEXT[],
  true, NOW(), NOW()
),
(
  'system-preset-accounts',
  'Accounts & Finance',
  'Money desk: verify bKash/Nagad and bank payments, process refunds, reconcile courier COD settlements and mismatches, record expenses, view financial reports. Cannot change orders or products.',
  ARRAY[
    'view_analytics','view_financial_summary','view_orders','view_customers',
    'view_payments','create_payments','edit_payments','approve_payments',
    'view_refunds','create_refunds','edit_refunds',
    'view_accounts','view_accounting',
    'view_expenses','create_expenses','edit_expenses',
    'view_expense_categories','create_expense_categories','edit_expense_categories',
    'view_courier_settlement','import_courier_settlement','finalize_courier_settlement','adjust_courier_settlement',
    'view_cod_mismatch','resolve_cod_mismatch',
    'view_gateways','view_financial_periods'
  ]::TEXT[],
  true, NOW(), NOW()
),
(
  'system-preset-warehouse',
  'Warehouse & Packing',
  'Godown and packing station: receive and adjust stock, process returns at the scanner, pack orders and hand over to dispatch. No prices, payments, or settings.',
  ARRAY[
    'view_orders','view_products',
    'view_inventory','create_inventory','edit_inventory','adjust_stock_inventory',
    'manage_stock','manage_stock_products','view_warehouses',
    'view_purchases','view_suppliers',
    'view_rtn','create_rtn','edit_rtn',
    'manage_packing_packing','view_shipment','manage_dispatch_dispatch'
  ]::TEXT[],
  true, NOW(), NOW()
),
(
  'system-preset-marketing',
  'Marketing Executive',
  'Campaigns and content: coupons, automatic discounts, campaigns, landing pages, CMS and media, review moderation, analytics. No delete rights, no orders or finance.',
  ARRAY[
    'view_analytics','view_products',
    'view_campaigns','create_campaigns','edit_campaigns',
    'view_coupons','create_coupons','edit_coupons',
    'view_discounts','create_discounts','edit_discounts',
    'view_landing_pages','create_landing_pages','edit_landing_pages',
    'view_cms_pages','create_cms_pages','edit_cms_pages',
    'view_media','create_media','edit_media',
    'view_customer_reviews','approve_customer_reviews',
    'view_referrals'
  ]::TEXT[],
  true, NOW(), NOW()
),
(
  'system-preset-catalog',
  'Product Catalog',
  'Product listing and data entry: products, categories, brands, tags, attributes, combos, size charts, media uploads and bulk import. Cannot delete products or change stock levels.',
  ARRAY[
    'view_products','create_products','edit_products',
    'view_categories','create_categories','edit_categories',
    'view_brands','create_brands','edit_brands',
    'view_tags','create_tags','edit_tags',
    'view_attributes','create_attributes','edit_attributes',
    'view_combos','create_combos','edit_combos',
    'view_size_charts','create_size_charts','edit_size_charts',
    'view_media','create_media','edit_media',
    'view_inventory','run_import'
  ]::TEXT[],
  true, NOW(), NOW()
)
ON CONFLICT (name) DO NOTHING;

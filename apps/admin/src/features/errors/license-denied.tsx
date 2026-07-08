import { useNavigate, useSearch } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { FileX } from 'lucide-react'

const FEATURE_ERROR_MESSAGES: Record<string, string> = {
  storefront: 'This store is currently not active.',
  storefront_order_tracking: 'Public order tracking is not available on your current plan.',
  storefront_flying_cart: '',
  storefront_reviews: 'Product reviews are not available on your current plan.',
  storefront_wishlist: 'The wishlist feature is not available on your current plan.',
  storefront_referral: 'The referral program is not currently available.',
  pwa_setup: '',
  seo_suite: '',
  offline_conversion: 'Offline conversion tracking requires an upgraded license.',
  integration_ga4: '',
  integration_tiktok: '',
  integration_meta: 'Meta Pixel & CAPI integration is not included in your current plan.',
  integration_google_ads: '',
  admin_products: 'Product management is not included in your current plan.',
  admin_orders: 'Order management is not included in your current plan.',
  admin_customers: 'Customer management is not included in your current plan.',
  admin_brands: 'Brand management is not included in your current plan.',
  admin_settings: 'Settings are not included in your current plan.',
  admin_media: 'Media library is not included in your current plan.',
  admin_users: 'User management is not included in your current plan.',
  admin_print: 'Invoice printing is not included in your current plan.',
  admin_coupons: 'Coupons & discounts are not included in your current plan.',
  admin_size_charts: 'Size charts are not included in your current plan.',
  admin_combos: 'Combo management is not included in your current plan.',
  admin_reviews: 'Review moderation is not included in your current plan.',
  admin_import_products: '',
  admin_price_tags: 'Barcode & price tag printing is not included in your current plan.',
  admin_suppliers: 'Supplier management is not included in your current plan.',
  admin_purchases: 'Purchase orders are not included in your current plan.',
  admin_order_import: 'Order import is not included in your current plan.',
  admin_expenses: 'Expense management is not included in your current plan.',
  admin_payments: 'Payment management is not included in your current plan.',
  admin_refunds: 'Refund processing is not included in your current plan.',
  admin_accounting: 'Double-entry accounting is not included in your current plan.',
  admin_financial_periods: '',
  admin_payroll: 'Payroll management is not included in your current plan.',
  admin_employees: 'Employee management is not included in your current plan.',
  admin_tasks: 'Task management is not included in your current plan.',
  admin_email_campaigns: 'Email campaigns are not included in your current plan.',
  admin_landing_pages: 'Landing page builder is not included in your current plan.',
  admin_cms_pages: 'CMS page builder is not included in your current plan.',
  admin_product_feeds: 'Product feed generator is not included in your current plan.',
  admin_referrals: 'Referral management is not included in your current plan.',
  admin_inventory: 'Inventory management is not included in your current plan.',
  admin_warehouses: 'Warehouse management is not included in your current plan.',
  admin_inventory_valuation: 'Inventory valuation is not included in your current plan.',
  admin_dispatch: 'The dispatch system is not included in your current plan.',
  admin_packing: 'The packing workspace is not included in your current plan.',
  admin_barcode_search: '',
  admin_incomplete_orders: 'Incomplete order tracking is not included in your current plan.',
  admin_global_search: '',
  courier_steadfast: '',
  courier_pathao: '',
  courier_redx: '',
  courier_carrybee: '',
  gateway_bkash: 'bKash payment gateway is currently unavailable.',
  gateway_nagad: 'Nagad payment gateway is currently unavailable.',
  gateway_rocket: 'Rocket payment gateway is currently unavailable.',
  gateway_sslcommerz: 'SSLCommerz payment gateway is currently unavailable.',
  gateway_surjopay: 'SurjoPay payment gateway is currently unavailable.',
  gateway_aamarpay: 'AamarPay payment gateway is currently unavailable.',
  admin_notifications: 'Notification configuration is not included in your current plan.',
  admin_blocking: 'IP/phone blocking is not included in your current plan.',
  admin_analytics: 'Advanced analytics are not included in your current plan.',
  admin_activity_logs: 'Activity logs are not included in your current plan.',
  admin_help_center: 'Help center management is not included in your current plan.',
  image_resize_proxy: '',
  pos_system: 'The POS system is not included in your current plan.',
  smtp_server: 'Custom SMTP configuration requires a license upgrade.',
  s3_storage: '',
  db_backup: 'Database backup is not included in your current plan.',
  custom_domain: 'Custom domain configuration is not included in your current plan.',
}

export function LicenseDeniedError() {
  const navigate = useNavigate()
  const { feature } = useSearch({ from: '/(errors)/license-denied' })
  const errorMessage = feature ? FEATURE_ERROR_MESSAGES[feature] : undefined

  return (
    <div className='h-svh flex items-center justify-center'>
      <div className='flex flex-col items-center gap-4 max-w-md text-center px-4'>
        <div className='rounded-full bg-amber-100 dark:bg-amber-900/30 p-4'>
          <FileX className='h-10 w-10 text-amber-600 dark:text-amber-400' />
        </div>
        <h1 className='text-2xl font-bold'>Feature Not Available</h1>
        <p className='text-muted-foreground'>
          {errorMessage
            ? errorMessage
            : 'This feature is not included in your current plan.'}
        </p>
        <p className='text-sm text-muted-foreground'>
          Please upgrade your plan to access this feature.
        </p>
        <div className='flex gap-4 mt-2'>
          <Button variant='outline' onClick={() => navigate({ to: '/' })}>
            Go to Dashboard
          </Button>
          <Button onClick={() => navigate({ to: '/mon/settings/license' })}>
            View License
          </Button>
        </div>
      </div>
    </div>
  )
}

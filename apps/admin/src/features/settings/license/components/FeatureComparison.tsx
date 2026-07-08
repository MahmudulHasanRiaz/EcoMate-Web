import { FEATURES } from '@ecomate/shared-types'
import { Check, X } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

function featureLabel(key: string): string {
  return key
    .replace(/^admin_/, '')
    .replace(/^courier_/, '')
    .replace(/^gateway_/, '')
    .replace(/^integration_/, '')
    .replace(/^storefront_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

const FEATURE_GROUPS: { label: string; keys: string[] }[] = [
  { label: 'Storefront', keys: ['storefront'] },
  { label: 'Public Add-ons', keys: ['storefront_order_tracking', 'storefront_flying_cart', 'storefront_reviews', 'storefront_wishlist', 'storefront_referral'] },
  { label: 'Storefront Enhancements', keys: ['pwa_setup', 'seo_suite', 'offline_conversion'] },
  { label: 'Tracking & Analytics', keys: ['integration_ga4', 'integration_tiktok', 'integration_meta', 'integration_google_ads'] },
  { label: 'Core Admin — Operations', keys: ['admin_products', 'admin_orders', 'admin_customers', 'admin_brands', 'admin_settings', 'admin_media', 'admin_users', 'admin_print', 'admin_coupons'] },
  { label: 'Product Enhancement', keys: ['admin_size_charts', 'admin_combos', 'admin_reviews', 'admin_import_products', 'admin_price_tags'] },
  { label: 'Supply Chain', keys: ['admin_suppliers', 'admin_purchases', 'admin_order_import'] },
  { label: 'Financial', keys: ['admin_expenses', 'admin_payments', 'admin_refunds', 'admin_accounting', 'admin_financial_periods'] },
  { label: 'HR & Operations', keys: ['admin_payroll', 'admin_employees', 'admin_tasks'] },
  { label: 'Marketing & Content', keys: ['admin_email_campaigns', 'admin_landing_pages', 'admin_cms_pages', 'admin_product_feeds', 'admin_referrals'] },
  { label: 'Inventory & Fulfillment', keys: ['admin_inventory', 'admin_warehouses', 'admin_inventory_valuation', 'admin_dispatch', 'admin_packing', 'admin_barcode_search', 'admin_incomplete_orders', 'admin_global_search'] },
  { label: 'Courier Services', keys: ['courier_steadfast', 'courier_pathao', 'courier_redx', 'courier_carrybee'] },
  { label: 'Payment Gateways', keys: ['gateway_bkash', 'gateway_nagad', 'gateway_rocket', 'gateway_sslcommerz', 'gateway_surjopay', 'gateway_aamarpay'] },
  { label: 'Admin Tools', keys: ['admin_notifications', 'admin_blocking', 'admin_analytics', 'admin_activity_logs', 'admin_help_center'] },
  { label: 'Infrastructure', keys: ['image_resize_proxy', 'pos_system', 'smtp_server', 's3_storage', 'db_backup', 'custom_domain'] },
]

interface FeatureComparisonProps {
  activeFeatures: string[]
}

export function FeatureComparison({ activeFeatures }: FeatureComparisonProps) {
  const activeSet = new Set(activeFeatures)

  const totalCount = FEATURE_GROUPS.reduce((sum, g) => sum + g.keys.length, 0)
  const activeCount = FEATURE_GROUPS.reduce((sum, g) => sum + g.keys.filter(k => activeSet.has(k)).length, 0)

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <p className='text-sm text-muted-foreground'>
          Showing {activeCount} of {totalCount} features enabled
        </p>
        <Badge variant='outline' className='text-xs'>
          {Math.round((activeCount / totalCount) * 100)}% coverage
        </Badge>
      </div>
      <div className='rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-[220px]'>Feature</TableHead>
              <TableHead className='w-[100px]'>Key</TableHead>
              <TableHead className='w-[80px] text-center'>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {FEATURE_GROUPS.map((group) => (
              <>
                <TableRow key={group.label} className='bg-muted/30'>
                  <TableCell colSpan={3} className='font-semibold text-xs uppercase tracking-wider text-muted-foreground py-2'>
                    {group.label}
                  </TableCell>
                </TableRow>
                {group.keys.map((key) => {
                  const feat = FEATURES[key]
                  if (!feat) return null
                  const isActive = activeSet.has(key)

                  return (
                    <TableRow key={key}>
                      <TableCell className='font-medium'>
                        {featureLabel(key)}
                        {feat.dependencies && feat.dependencies.length > 0 && (
                          <span className='ml-2 text-[10px] text-muted-foreground'>
                            needs {feat.dependencies.map(d => d.replace(/^admin_/, '').replace(/^storefront_/, '')).join(', ')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className='text-xs text-muted-foreground'>{key}</code>
                      </TableCell>
                      <TableCell className='text-center'>
                        {isActive ? (
                          <Check className='inline h-4 w-4 text-green-500' />
                        ) : (
                          <X className='inline h-4 w-4 text-muted-foreground/40' />
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

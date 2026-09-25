import { capabilityNotices, type ProviderCapabilities } from '../api'
import { Info } from 'lucide-react'

/**
 * Informational capability rows (§11 UX contract): state the consequence,
 * never a failure. Shopify stock, WooCommerce SEO without the plugin,
 * combos, unsupported categories.
 */
export function CapabilityNotice({ capabilities }: { capabilities: ProviderCapabilities | null | undefined }) {
  const rows = capabilityNotices(capabilities)
  if (rows.length === 0) return null
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row} className="flex items-start gap-2 rounded-md border p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{row}</span>
        </div>
      ))}
    </div>
  )
}

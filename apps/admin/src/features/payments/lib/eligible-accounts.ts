import type { AccountResponse } from '@/features/accounting/api'
import type { GatewayConfig } from '@/features/gateways/api'

/** Deep-flattens the account tree into eligible asset leaves. */
export function flattenEligibleAssetAccounts(tree: AccountResponse[] | undefined): AccountResponse[] {
  const out: AccountResponse[] = []
  const walk = (rows: AccountResponse[] | undefined) => {
    for (const row of rows ?? []) {
      if (row.type === 'asset' && row.isGroup === false && row.isActive === true) {
        out.push(row)
      }
      if (row.children?.length) walk(row.children)
    }
  }
  walk(tree)
  return out
}

/**
 * The ADMIN-visible gateway set: enabled gateways only.
 *
 * D7 (owner-locked 2026-10-24): PaymentOption.enabled is a STOREFRONT-ONLY
 * flag — it controls what website customers may pick at checkout. It must
 * never hide a gateway from staff flows (new payments, refunds, lead
 * conversion): an option switched off for the website still has live
 * gateways the admin works with.
 */
export function enabledGatewayOptions(gateways: GatewayConfig[] | undefined): GatewayConfig[] {
  return (gateways ?? []).filter((g) => g.enabled === true)
}

/**
 * D6+D7: the ADMIN-selectable set for NEW staff payments — the enabled set
 * minus gateways hidden from the admin panel. Refunds and other history
 * flows keep using enabledGatewayOptions: a surface flag must never
 * block work on payments that already exist.
 */
export function adminSelectableGatewayOptions(gateways: GatewayConfig[] | undefined): GatewayConfig[] {
  return enabledGatewayOptions(gateways).filter((g) => g.showOnAdmin !== false)
}

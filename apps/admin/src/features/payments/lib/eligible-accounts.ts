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

/** The POS-visible set: enabled gateway + enabled payment option. */
export function enabledGatewayOptions(gateways: GatewayConfig[] | undefined): GatewayConfig[] {
  return (gateways ?? []).filter(
    (g) => g.enabled === true && g.paymentOptionEnabled !== false,
  )
}

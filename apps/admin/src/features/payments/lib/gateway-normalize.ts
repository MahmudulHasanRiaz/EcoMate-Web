import type { GatewayConfig } from '@/features/gateways/api'
import { enabledGatewayOptions } from './eligible-accounts'

/**
 * Lead conversion payment normalization (owner rule): a stored lead payment
 * value is HISTORY — it may be the checkout enum (`CASH_ON_DELIVERY`), an old
 * shorthand (`cash`, `cod`), an uppercase/underscore variant, or a real
 * gateway code. These writes must submit a CONFIGURED gateway code, never the
 * legacy string, so every lead-conversion path is normalized through here.
 */

/** Case-insensitive, separator-insensitive comparison key. */
export function gatewayKey(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Every spelling of "cash on delivery" that has ever been stored: the
 * checkout payment-option enum, the older storefront label and the short
 * staff code. All of them mean the configured COD gateway.
 */
const COD_ALIASES = new Set(['cashondelivery', 'cash', 'cod'])

/**
 * The configured gateway that represents cash on delivery — by payment
 * option first, then by gateway type, then by the conventional code.
 */
function codGatewayCode(options: GatewayConfig[]): string | undefined {
  return (
    options.find((g) => g.paymentOptionType === 'CASH_ON_DELIVERY')?.code ??
    options.find((g) => g.type === 'cash')?.code ??
    options.find((g) => {
      const code = gatewayKey(g.code)
      return code === 'cash' || code === 'cod'
    })?.code
  )
}

/** Fallback when nothing matches: the COD gateway, else the first enabled one. */
function fallbackGatewayCode(options: GatewayConfig[]): string {
  return codGatewayCode(options) ?? options[0].code
}

/**
 * Resolves a stored/legacy payment string to a configured, enabled gateway
 * code — the value that must be submitted and stored.
 *
 * Resolution order (first hit wins):
 *   1. the value already IS a configured gateway — by code or by name,
 *      case-insensitively and ignoring separators (underscores, spaces,
 *      punctuation);
 *   2. a cash-on-delivery spelling (`CASH_ON_DELIVERY` / `cash` / `cod`) →
 *      the configured COD gateway;
 *   3. a partial name/code match (e.g. a renamed "bKash Business API");
 *   4. the documented fallback — the COD gateway when one is configured,
 *      otherwise the first enabled gateway.
 *
 * Returns '' when no gateway is enabled/configured, which is the state the
 * shared selector already reports to the user.
 */
export function normalizeLegacyGatewayCode(
  raw: string | null | undefined,
  gateways: GatewayConfig[] | undefined,
): string {
  const options = enabledGatewayOptions(gateways)
  if (options.length === 0) return ''

  const key = gatewayKey(raw)
  if (!key) return fallbackGatewayCode(options)

  const exact = options.find(
    (g) => gatewayKey(g.code) === key || gatewayKey(g.name) === key,
  )
  if (exact) return exact.code

  if (COD_ALIASES.has(key)) return fallbackGatewayCode(options)

  if (key.length >= 4) {
    const partial = options.find((g) => {
      const nameKey = gatewayKey(g.name)
      const codeKey = gatewayKey(g.code)
      return (
        (nameKey.length >= 4 && nameKey.includes(key)) ||
        (codeKey.length >= 4 && key.includes(codeKey))
      )
    })
    if (partial) return partial.code
  }

  return fallbackGatewayCode(options)
}

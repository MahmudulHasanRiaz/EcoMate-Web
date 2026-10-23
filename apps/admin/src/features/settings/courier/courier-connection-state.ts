/**
 * Truthful courier card status (queue burn-down D2).
 *
 * `enabled` means "switched on", NOT "connected". A courier with an empty
 * credential set cannot authenticate, so the card must say so instead of
 * claiming "Connected".
 *
 * Required fields below mirror the backend dispatch validation — they are not
 * guesses:
 *   - steadfast  resolveSteadfastAuth (`api_key`/`secret_key`) —
 *               courier-manager.service.ts:307-310, with the default
 *               credential-set fallback in steadfast-credential-sets.service.ts:270-300
 *   - pathao     dispatchPathao (`clientId`, `clientSecret`, `username`,
 *               `password`; `storeId` falls back to '1') —
 *               courier-manager.service.ts:1000-1008
 *   - redx       getRedxParcelDetails (`apiKey` only) —
 *               courier-manager.service.ts:1584-1586, :2880-2883
 *   - carrybee   carrybeeHeaders (`clientId`, `clientSecret`;
 *               `clientContext` falls back to 'merchant') —
 *               courier-manager.service.ts:2146-2152
 *
 * Secret values are only ever checked for presence — never rendered, logged or
 * returned by this module.
 */

export type CourierCredentialField =
  | 'apiKey'
  | 'secretKey'
  | 'username'
  | 'password'
  | 'clientId'
  | 'clientSecret'
  | 'clientContext'
  | 'storeId'
  | 'shopId'

export const REQUIRED_COURIER_CREDENTIALS: Record<string, readonly CourierCredentialField[]> = {
  steadfast: ['apiKey', 'secretKey'],
  pathao: ['clientId', 'clientSecret', 'username', 'password'],
  redx: ['apiKey'],
  carrybee: ['clientId', 'clientSecret'],
}

export const COURIER_CREDENTIAL_FIELD_LABELS: Record<CourierCredentialField, string> = {
  apiKey: 'API Key',
  secretKey: 'Secret Key',
  username: 'Username',
  password: 'Password',
  clientId: 'Client ID',
  clientSecret: 'Client Secret',
  clientContext: 'Client Context',
  storeId: 'Store ID',
  shopId: 'Shop ID',
}

export type CourierConnectionState = 'connected' | 'enabled-credentials-missing' | 'disabled'

export interface CourierConnectionInput {
  courier: string
  enabled: boolean
  /** Form/record values. Only presence is inspected. */
  values?: Record<string, unknown> | null
  /**
   * Steadfast-only: when a default credential set exists, the courier
   * authenticates through it even if the legacy single row is empty
   * (steadfast-credential-sets.service.ts reserves this exact fallback order).
   */
  hasManagedCredentialSet?: boolean
}

export interface CourierConnectionInfo {
  state: CourierConnectionState
  label: string
  tone: 'success' | 'warning' | 'muted'
  missingFields: CourierCredentialField[]
  missingFieldLabels: string[]
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false
  return String(value).trim().length > 0
}

/** Required-but-empty fields for a courier (empty array for unknown couriers). */
export function missingCourierCredentials(
  courier: string,
  values?: Record<string, unknown> | null,
): CourierCredentialField[] {
  const required = REQUIRED_COURIER_CREDENTIALS[courier] ?? []
  return required.filter((field) => !isPresent(values?.[field]))
}

/**
 * Three-way truth:
 *  - disabled                     → "Disabled"
 *  - enabled + credentials present → "Connected"
 *  - enabled + credentials missing → "Enabled — credentials missing" (warning)
 */
export function resolveCourierConnectionState(input: CourierConnectionInput): CourierConnectionInfo {
  const { courier, enabled, values, hasManagedCredentialSet } = input
  const missingFields = enabled
    ? missingCourierCredentials(courier, values)
    : []
  const missingFieldLabels = missingFields.map((f) => COURIER_CREDENTIAL_FIELD_LABELS[f] ?? f)

  if (!enabled) {
    return { state: 'disabled', label: 'Disabled', tone: 'muted', missingFields, missingFieldLabels }
  }

  if (hasManagedCredentialSet && missingFields.length > 0) {
    return { state: 'connected', label: 'Connected', tone: 'success', missingFields, missingFieldLabels }
  }

  if (missingFields.length > 0) {
    return {
      state: 'enabled-credentials-missing',
      label: 'Enabled — credentials missing',
      tone: 'warning',
      missingFields,
      missingFieldLabels,
    }
  }

  return { state: 'connected', label: 'Connected', tone: 'success', missingFields, missingFieldLabels }
}

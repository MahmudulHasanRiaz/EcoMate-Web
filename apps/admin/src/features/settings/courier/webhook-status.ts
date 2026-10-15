/**
 * Task 4: settings-banner state for unverified courier webhooks.
 * Pure helpers (vitest) over the GET /couriers/webhook-status payload.
 */

export interface CourierWebhookStatus {
  configured: boolean
}

export type WebhookStatusPayload = Record<string, CourierWebhookStatus | undefined>

export const WEBHOOK_COURIERS = ['steadfast', 'pathao', 'redx', 'carrybee'] as const

export const WEBHOOK_COURIER_LABELS: Record<string, string> = {
  steadfast: 'Steadfast',
  pathao: 'Pathao',
  redx: 'RedX',
  carrybee: 'Carrybee',
}

/** Couriers currently accepting webhooks WITHOUT signature verification. */
export function unconfiguredCouriers(status: WebhookStatusPayload | null | undefined): string[] {
  if (!status) return []
  return WEBHOOK_COURIERS.filter((c) => !status[c]?.configured)
}

/** Banner copy, or null when every courier verifies. */
export function webhookBannerCopy(unconfigured: string[]): string | null {
  if (unconfigured.length === 0) return null
  const names = unconfigured.map((c) => WEBHOOK_COURIER_LABELS[c] ?? c).join(', ')
  return (
    `Webhook verification is not configured for: ${names}. ` +
    `Incoming webhooks from ${unconfigured.length === 1 ? 'this courier is' : 'these couriers are'} ` +
    `accepted without signature verification — set the webhook token below to enable it.`
  )
}

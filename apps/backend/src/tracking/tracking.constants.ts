/**
 * Canonical snapshot event types. PageView is not a canonical funnel type
 * (volume-conscious set) but IS dispatched server-side to Meta only, via the
 * mirror's page_view mapping + MetaAdapter opt-in (redundant setup, deduped
 * by the shared event_id). No other adapter supports it.
 */
export const TRACKING_EVENT_TYPES = Object.freeze([
  'Purchase',
  'Refund',
  'AddToCart',
  'AddToWishlist',
  'InitiateCheckout',
  'AddPaymentInfo',
  'ViewContent',
  'Search',
  'CompleteRegistration',
  'Lead',
  // Server-side order-lifecycle custom events (Meta-only; TikTok explicitly
  // opts out, GA4/GoogleAds have no mapping). Each is its own canonical type
  // so the @@unique([orderId, eventType]) ledger holds one row per stage.
  'OrderPlaced',
  'OrderConfirmed',
  'OrderCancelled',
  'OrderDelivered',
  'OrderReturned',
] as const);
export type TrackingEventType = (typeof TRACKING_EVENT_TYPES)[number];

/**
 * Order-lifecycle custom events bound to order status names. Meta-only
 * destination routing is enforced at the adapter boundary (Meta supports
 * these names; TikTok explicitly excludes them; GA4/GoogleAds have no
 * mapping), never in the order lifecycle itself.
 */
export const ORDER_LIFECYCLE_EVENT_TYPES = Object.freeze([
  'OrderPlaced',
  'OrderConfirmed',
  'OrderCancelled',
  'OrderDelivered',
  'OrderReturned',
] as const);
export type OrderLifecycleEventType =
  (typeof ORDER_LIFECYCLE_EVENT_TYPES)[number];

/** TrackingOutbox.status — DB is source of truth. DEAD->PENDING only via ReplayService. */
export const OUTBOX_STATUS = Object.freeze(['PENDING', 'CLAIMED', 'SENT', 'FAILED', 'DEAD'] as const);
export type OutboxStatus = (typeof OUTBOX_STATUS)[number];

/** TrackingDispatch.status — per-provider state. Version columns are null for SKIPPED/DEDUPED. */
export const DISPATCH_STATUS = Object.freeze([
  'PENDING',
  'SENDING',
  'SENT',
  'RETRY',
  'FAILED',
  'DEDUPED',
  'SKIPPED',
  'DEAD',
] as const);
export type DispatchStatus = (typeof DISPATCH_STATUS)[number];

/** TrackingOutbox.configSnapshot.successPolicy */
export const SUCCESS_POLICIES = Object.freeze(['ALL_SENT', 'ANY_SENT', 'N_SENT'] as const);
export type SuccessPolicy = (typeof SUCCESS_POLICIES)[number];

/** Canonical snapshot payload schema version — bump only on breaking shape changes. */
export const SCHEMA_VERSION = 1;

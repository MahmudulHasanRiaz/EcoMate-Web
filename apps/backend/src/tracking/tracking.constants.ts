/** Canonical snapshot event types. PageView is deliberately excluded (Pixel + analytics only). */
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
] as const);
export type TrackingEventType = (typeof TRACKING_EVENT_TYPES)[number];

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

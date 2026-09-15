/**
 * Canonical snapshot types (design §4.2). The snapshot is the immutable,
 * provider-agnostic business record — raw, unhashed values. Hashing happens
 * only in the TrackingNormalizer / adapter send path, never at capture.
 */

export interface SnapshotContentItem {
  id: string;
  quantity: number;
  item_price?: number;
  name?: string;
  category?: string;
}

/** How a Purchase snapshot was triggered — drives per-provider dispatch gating. */
export type PurchaseTriggerMode = 'instant' | 'validated' | 'offline' | 'browser';

/** Canonical business data captured at event time (raw, unhashed). */
export interface TrackingSnapshotPayload {
  /** Canonical event type (see TRACKING_EVENT_TYPES); the dispatcher populates it. */
  eventType?: string;
  /**
   * Purchase trigger mode (Purchase events only). The dispatcher defers
   * providers whose configured purchase mode does not match this trigger, so
   * Meta=instant / TikTok=validated (and vice versa) stay independent on one
   * shared canonical snapshot. Legacy snapshots without it dispatch to all.
   */
  triggerMode?: PurchaseTriggerMode;
  /** Caller-provided dedup id; adapters override for order events (purchase_/refund_). */
  eventId?: string;
  /** Capture-time action source ('website' | 'physical_store'); the dispatcher merges it for adapters. */
  actionSource?: string;
  /** Business event time (unix seconds). Adapters fall back to dispatch time when absent. */
  eventTime?: number;
  orderId?: string;
  /** Customer binding for identity resolution (Wave-2.1) — set on order events at capture. */
  customerId?: string;
  /**
   * Order-time tracking identity frozen at Purchase creation. The dispatcher
   * uses this instead of the live TrackingContext row so that a Purchase
   * dispatched minutes/hours later carries the exact identity that existed
   * when the qualifying action occurred — not a mutated later state.
   * Absent for legacy/backfilled snapshots (dispatcher falls back to live context).
   */
  trackingIdentity?: FrozenTrackingIdentity;
  value?: number;
  currency?: string;
  content_ids?: string[];
  content_type?: 'product' | 'product_group';
  content_name?: string;
  content_category?: string;
  contents?: SnapshotContentItem[];
  num_items?: number;
  search_string?: string;
  customer?: {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    city?: string;
    state?: string;
    country?: string;
    zip?: string;
    /**
     * The customer's Facebook user id (Meta `fb_login_id`). RAW value, never
     * hashed (Meta matches it verbatim, unlike every other
     * customer-information parameter). Server-resolved at dispatch for order
     * events / carried by the mirror for browser events; absent for guests.
     */
    fbLoginId?: string;
  };
}

/**
 * Frozen order-time tracking identity. Captured once at Purchase creation
 * and stored on the snapshot payload so the dispatcher never reads mutable
 * live TrackingContext for order-bound events. Preserves the exact identity
 * that existed when the qualifying action (checkout / payment) occurred.
 */
export interface FrozenTrackingIdentity {
  ip?: string;
  userAgent?: string;
  url?: string;
  referrer?: string;
  externalId?: string;
  fbp?: string;
  fbc?: string;
  gclid?: string;
  ttclid?: string;
}

/** Session identifiers + server/request context for the dispatch moment. */
export interface TrackingContextView {
  externalId?: string;
  ip?: string;
  userAgent?: string;
  url?: string;
  referrer?: string;
  fbp?: string;
  fbc?: string;
  gaClientId?: string;
  gclid?: string;
  ttclid?: string;
  // future providers extend this view at the adapter boundary
}

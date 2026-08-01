/**
 * Canonical snapshot types (design §4.2). The snapshot is the immutable,
 * provider-agnostic business record — raw, unhashed values. Hashing happens
 * only in the TrackingNormalizer / adapter send path, never at capture.
 */

export interface SnapshotContentItem {
  id: string;
  quantity: number;
  item_price?: number;
}

/** Canonical business data captured at event time (raw, unhashed). */
export interface TrackingSnapshotPayload {
  orderId?: string;
  value?: number;
  currency?: string;
  content_ids?: string[];
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
  };
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

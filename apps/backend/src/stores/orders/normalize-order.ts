/**
 * Order normalization — central-commerce P6 (§8.5 ingest worker step 2).
 *
 * Pure functions: provider payloads (WooCommerce REST, Shopify REST, Custom
 * bridge v1, FakeProvider fixtures) → one canonical `NormalizedIngestOrder`.
 * Unit-tested in isolation; the worker never parses provider JSON itself.
 *
 * Sanitization: only allowlisted scalar fields are extracted. Unknown keys,
 * credentials and secrets structurally cannot flow into the order pipeline
 * (the `sanitizeFailurePayload` pattern, §4.1).
 */
import { createHash } from 'crypto';

export interface NormalizedIngestItem {
  sku: string;
  name: string;
  quantity: number;
  /** Unit price in store currency (number; unparseable → 0). */
  price: number;
}

export interface NormalizedIngestOrder {
  externalId: string;
  /** Raw external status string (mapped via StoreOrderStatusMap later). */
  externalStatus: string;
  externalTotal: number;
  currency: string;
  externalCreatedAt: Date | null;
  externalUpdatedAt: Date | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  shippingAddress: Record<string, unknown>;
  items: NormalizedIngestItem[];
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

function asNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asQuantity(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function pickName(...candidates: unknown[]): string {
  for (const c of candidates) {
    const s = asString(c).trim();
    if (s) return s;
  }
  return '';
}

/**
 * Delivery identity (§4.1): sha256(storeId + provider delivery id) on the
 * UNIQUE `StoreWebhookDelivery.deliveryKey` column. A body hash is NOT an
 * event identity — the same payload can arrive on two legitimate deliveries.
 */
export function buildStoreDeliveryKey(storeId: string, deliveryId: string): string {
  return createHash('sha256').update(`${storeId}:${deliveryId}`).digest('hex');
}

/**
 * Job identity shared by the webhook and reconcile paths (BR-11/BR-12):
 * both funnels resolve to the same key so the two paths cannot double-work.
 * The worker treats `store:{storeId}:order:{externalId}` as the execution
 * identity; `StoreOrderMapping` + `Order.idempotencyKey` enforce it in the DB.
 */
export function buildStoreOrderIdentity(storeId: string, externalId: string): {
  idempotencyKey: string;
  objectKey: string;
} {
  const idempotencyKey = `store:${storeId}:order:${externalId}`;
  return { idempotencyKey, objectKey: idempotencyKey };
}

/**
 * Normalize one provider order payload. Accepts:
 *  - WooCommerce REST (`id`, `status`, `total`, `currency`, `date_created`,
 *    `line_items[]` with `sku/quantity/price/name`, `billing{}`);
 *  - Shopify REST (`id`, `financial_status`, `total_price`, `line_items[]`
 *    with `sku/quantity/price/title`, `customer{}`, `created_at`);
 *  - Custom bridge v1 / FakeProvider fixtures (`id`, `status`, `total`,
 *    `currency`, `createdAt`, `items[]` with `sku/qty/price`, `customer{}`).
 * Unknown shapes yield an order with empty items (SKU resolution then raises
 * UNMATCHED_SKU per item — never a throw here).
 */
export function normalizeOrder(raw: Record<string, unknown>): NormalizedIngestOrder {
  const r = raw ?? {};
  const externalId = pickName(r.id, r.number, r.name, r.order_id) || 'unknown';

  const lineItems = Array.isArray(r.line_items)
    ? (r.line_items as Record<string, unknown>[])
    : Array.isArray(r.items)
      ? (r.items as Record<string, unknown>[])
      : [];

  const items: NormalizedIngestItem[] = lineItems.map((li) => ({
    sku: pickName(li.sku, li.product_sku, li.variant_sku),
    name: pickName(li.name, li.title, li.product_name),
    quantity: asQuantity(li.quantity ?? li.qty),
    price: asNumber(li.price ?? li.unit_price ?? li.total),
  }));

  const billing = (r.billing ?? {}) as Record<string, unknown>;
  const shipping = (r.shipping ?? {}) as Record<string, unknown>;
  const customer = (r.customer ?? {}) as Record<string, unknown>;

  const customerPhone = pickName(
    billing.phone, customer.phone, r.phone, shipping.phone,
  ) || null;
  const customerName = pickName(
    [billing.first_name, billing.last_name].filter(Boolean).join(' '),
    customer.name, r.customer_name,
    [customer.first_name, customer.last_name].filter(Boolean).join(' '),
    billing.name,
  ) || null;
  const customerEmail = pickName(billing.email, customer.email, r.email) || null;

  const createdRaw = asString(r.createdAt ?? r.created_at ?? r.date_created ?? r.date_created_gmt);
  const updatedRaw = asString(r.updatedAt ?? r.updated_at ?? r.date_modified ?? r.date_modified_gmt);
  const createdMs = createdRaw ? Date.parse(createdRaw) : NaN;
  const updatedMs = updatedRaw ? Date.parse(updatedRaw) : NaN;

  return {
    externalId,
    externalStatus: pickName(r.status, r.financial_status, r.order_status) || 'pending',
    externalTotal: asNumber(r.total ?? r.total_price ?? r.grand_total),
    currency: pickName(r.currency ?? r.currency_code, r.presentment_currency) || 'BDT',
    externalCreatedAt: Number.isFinite(createdMs) ? new Date(createdMs) : null,
    externalUpdatedAt: Number.isFinite(updatedMs) ? new Date(updatedMs) : null,
    customerName,
    customerPhone,
    customerEmail,
    shippingAddress: {
      ...(shipping && typeof shipping === 'object' ? shipping : {}),
      ...(billing && typeof billing === 'object'
        ? { billing_city: billing.city, billing_country: billing.country }
        : {}),
    },
    items,
  };
}

/** P6 §8.5 widening bounds (BR-10): default window + hard max + page cap. */
export const RECONCILE_DEFAULT_WINDOW_DAYS = 3;
export const RECONCILE_MAX_WINDOW_DAYS = 30;
export const RECONCILE_MAX_PAGES = 20;
export const RECONCILE_PAGE_SIZE = 50;

/**
 * Clamp a requested reconcile window to the BR-10 bounds. Returns the
 * effective window plus whether widening applied (recorded on the run as
 * `windowDays` + `wideningReason`).
 */
export function clampReconcileWindow(opts: {
  requestedDays?: number;
  wideningReason?: string;
  wideningEnabled: boolean;
}): { windowDays: number; wideningReason: string | null; widened: boolean } {
  const requested = opts.requestedDays ?? RECONCILE_DEFAULT_WINDOW_DAYS;
  if (requested <= RECONCILE_DEFAULT_WINDOW_DAYS) {
    return { windowDays: RECONCILE_DEFAULT_WINDOW_DAYS, wideningReason: null, widened: false };
  }
  // Widening is opt-in, failure-driven, bounded (BR-10): without the flag or
  // a recorded reason the window stays at the 3-day default.
  if (!opts.wideningEnabled || !opts.wideningReason) {
    return { windowDays: RECONCILE_DEFAULT_WINDOW_DAYS, wideningReason: null, widened: false };
  }
  return {
    windowDays: Math.min(Math.floor(requested), RECONCILE_MAX_WINDOW_DAYS),
    wideningReason: opts.wideningReason,
    widened: true,
  };
}

/**
 * Browser Purchase payload builders (spec §5, §12, §33).
 *
 * Pure functions extracted from the Thank-You page so the exact payload that
 * reaches the browser Pixel / mirror is unit-testable (content metadata from
 * the order query relations, and the corrected BD geo mapping ct=district,
 * st=division). ThankYouContent renders these; nothing else may build a
 * browser Purchase payload.
 */

export interface BrowserPurchaseItem {
  productId?: string | null;
  comboId?: string | null;
  quantity: number;
  price: number | string;
  product?: { name?: string | null; sku?: string | null; category?: { name?: string | null } | null } | null;
  combo?: { name?: string | null } | null;
  variant?: { sku?: string | null } | null;
}

export interface BrowserPurchaseOrder {
  id: string;
  total?: number | string | null;
  subtotal?: number | string | null;
  items?: BrowserPurchaseItem[] | null;
  shippingAddress?: Record<string, unknown> | null;
  guestName?: string | null;
  guestPhone?: string | null;
  customer?: { email?: string | null } | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * content/custom_data for the browser Purchase (aligned with the server CAPI
 * snapshot: same content_ids/content_name/content_category/num_items).
 */
export function buildPurchaseSharedData(
  order: BrowserPurchaseOrder,
  currencyCode: string,
): Record<string, unknown> {
  const itemsList: any[] = Array.isArray(order.items) ? order.items : [];
  const totalValue = Number(order.total || order.subtotal || 0);
  const firstItem = itemsList[0];
  return {
    value: totalValue,
    currency: currencyCode,
    content_type: 'product',
    content_ids: itemsList
      .map((i: any) => i.variant?.sku || i.product?.sku || i.productId || i.comboId || '')
      .filter(Boolean),
    content_name: firstItem
      ? firstItem.product?.name || firstItem.combo?.name || undefined
      : undefined,
    content_category: firstItem?.product?.category?.name || undefined,
    num_items: itemsList.reduce((s: number, i: any) => s + (i.quantity || 0), 0),
    order_id: order.id,
    contents: itemsList.map((i: any) => ({
      id: i.variant?.sku || i.product?.sku || i.productId || i.comboId || '',
      quantity: i.quantity,
      item_price: Number(i.price),
    })),
  };
}

/**
 * user_data for the browser Purchase. BD geo per spec §22: ct = district,
 * st = division (lazy fallback to district for legacy orders without one).
 */
export function buildPurchaseUserData(
  order: BrowserPurchaseOrder,
): Record<string, unknown> {
  const sa = (order.shippingAddress || {}) as Record<string, any>;
  const district = String(sa.district || sa.city || '');
  const division = String(sa.division || sa.state || '');
  return {
    email: order.customer?.email || '',
    phone: sa.phone || order.guestPhone || '',
    name: sa.name || order.guestName || '',
    city: district,
    state: division || district,
    country: 'BD',
    zip: sa.zip || '',
    address: `${sa.address || ''}, ${district}`.trim().replace(/^,\s*/, ''),
  };
}
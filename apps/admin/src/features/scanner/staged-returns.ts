import type { ScanItemPreview } from '@/features/orders/api'

/** The two scan tasks that feed the ONE staged-returns list. */
export type StagedReturnPurpose = 'RETURN_RECEIVE' | 'DISPATCH_RETURN'

/** One physical line inside a staged row (quantity is what staff confirm). */
export interface StagedReturnLine {
  productId: string | null
  variantId: string | null
  name: string
  variantLabel?: string
  sku?: string | null
  image?: string | null
  price?: number
  /** Received / returned units. For DISPATCH_RETURN this is the returning qty. */
  quantity: number
  /** Upper bound for quantity (order line or courier return line). */
  maxQuantity: number
  /** Units that must never be restocked. */
  damagedQuantity: number
  /** Unconfirmed courier splits allow staff to confirm quantity at receive. */
  quantityEditable?: boolean
  /** Exchange legs are informational; no quantity/damage controls. */
  infoOnly?: boolean
}

/**
 * One staged return. RETURN_RECEIVE stages a linked Return/Exchange leg;
 * DISPATCH_RETURN stages a courier dispatch that is being returned. Both
 * live in the SAME list and run only through Process returns.
 */
export interface StagedReturn {
  key: string
  purpose: StagedReturnPurpose
  /** Scanned identifier — the process payload reuses it per row. */
  identifier: string
  kind: 'return' | 'exchange' | 'dispatch'
  /** Return id / exchange order id / dispatch id (process payload id). */
  legId: string
  dispatchId?: string
  /** Original order id (used for open-order links on dispatch rows). */
  orderId: string
  displayId: string
  orderDisplayId: string
  status: string
  processable: boolean
  failed?: boolean
  reason: string | null
  customerName: string
  customerPhone: string
  courier?: string | null
  trackingCode?: string | null
  items: StagedReturnLine[]
}

export const STAGED_RETURNS_KEY = 'ecomate:scanner:staged-returns'
export const LEGACY_RETURN_STAGING_KEY = 'ecomate:scanner:return-staged'
export const STAGED_RETURNS_CAP = 200

const clampInt = (value: unknown, min: number, max: number): number => {
  const n = Math.floor(Number(value) || 0)
  return Math.max(min, Math.min(max, n))
}

/** Resolve payload preview → editable line (damage defaults to 0). */
export function lineFromPreview(
  it: ScanItemPreview,
  opts: { quantityEditable?: boolean; infoOnly?: boolean } = {},
): StagedReturnLine {
  const maxQuantity = Math.max(0, Number(it.maxQuantity ?? it.quantity) || 0)
  const quantity = clampInt(it.quantity, 0, maxQuantity)
  return {
    productId: it.productId ?? null,
    variantId: it.variantId ?? null,
    name: it.name || 'Unknown product',
    variantLabel: it.variantLabel,
    sku: it.sku ?? null,
    image: it.image ?? null,
    price: typeof it.price === 'number' ? it.price : undefined,
    quantity,
    maxQuantity,
    damagedQuantity: clampInt(it.damagedQuantity, 0, quantity),
    quantityEditable: opts.quantityEditable === true,
    infoOnly: opts.infoOnly === true || !it.productId,
  }
}

export function linesFromPreview(
  items: ScanItemPreview[] | undefined,
  opts: { quantityEditable?: boolean; infoOnly?: boolean } = {},
): StagedReturnLine[] {
  return (items ?? []).slice(0, 50).map((it) => lineFromPreview(it, opts))
}

/**
 * Clamp a line edit so damage can never exceed the received quantity and the
 * received quantity can never exceed its line maximum. Pure + shared by the
 * staged list and tests.
 */
export function editStagedLine(
  line: StagedReturnLine,
  patch: { quantity?: number; damagedQuantity?: number },
): StagedReturnLine {
  const quantity =
    patch.quantity === undefined
      ? line.quantity
      : clampInt(patch.quantity, 0, line.maxQuantity)
  const damagedQuantity =
    patch.damagedQuantity === undefined
      ? Math.min(line.damagedQuantity, quantity)
      : clampInt(patch.damagedQuantity, 0, quantity)
  return { ...line, quantity, damagedQuantity }
}

/** JSON-guarded restore: malformed/foreign payloads become an empty batch. */
export function sanitizeStagedReturns(raw: unknown): StagedReturn[] {
  if (!Array.isArray(raw)) return []
  const rows: StagedReturn[] = []
  for (const r of raw as any[]) {
    if (!r || typeof r.key !== 'string' || typeof r.displayId !== 'string') continue
    const purpose: StagedReturnPurpose =
      r.purpose === 'DISPATCH_RETURN' ? 'DISPATCH_RETURN' : 'RETURN_RECEIVE'
    const kind =
      r.kind === 'exchange' || r.kind === 'dispatch' || r.kind === 'return'
        ? r.kind
        : purpose === 'DISPATCH_RETURN'
          ? 'dispatch'
          : 'return'
    const items: StagedReturnLine[] = Array.isArray(r.items)
      ? (r.items as any[]).slice(0, 50).map((it) => {
          const maxQuantity = Math.max(0, Number(it?.maxQuantity ?? it?.quantity) || 0)
          const quantity = clampInt(it?.quantity, 0, maxQuantity)
          return {
            productId: typeof it?.productId === 'string' ? it.productId : null,
            variantId: typeof it?.variantId === 'string' ? it.variantId : null,
            name: typeof it?.name === 'string' ? it.name : 'Unknown product',
            variantLabel: typeof it?.variantLabel === 'string' ? it.variantLabel : undefined,
            sku: typeof it?.sku === 'string' ? it.sku : null,
            image: typeof it?.image === 'string' ? it.image : null,
            price: typeof it?.price === 'number' ? it.price : undefined,
            quantity,
            maxQuantity,
            damagedQuantity: clampInt(it?.damagedQuantity, 0, quantity),
            quantityEditable: it?.quantityEditable === true,
            infoOnly: it?.infoOnly === true || typeof it?.productId !== 'string',
          }
        })
      : []
    const legId = typeof r.legId === 'string' ? r.legId : r.key
    rows.push({
      key: r.key,
      purpose,
      identifier: typeof r.identifier === 'string' ? r.identifier : '',
      kind,
      legId,
      dispatchId:
        typeof r.dispatchId === 'string'
          ? r.dispatchId
          : purpose === 'DISPATCH_RETURN'
            ? legId
            : undefined,
      orderId: typeof r.orderId === 'string' ? r.orderId : legId,
      displayId: r.displayId,
      orderDisplayId: typeof r.orderDisplayId === 'string' ? r.orderDisplayId : '',
      status: typeof r.status === 'string' ? r.status : '',
      processable: r.processable !== false,
      failed: r.failed === true,
      reason: typeof r.reason === 'string' ? r.reason : null,
      customerName: typeof r.customerName === 'string' ? r.customerName : '',
      customerPhone: typeof r.customerPhone === 'string' ? r.customerPhone : '',
      courier: typeof r.courier === 'string' ? r.courier : null,
      trackingCode: typeof r.trackingCode === 'string' ? r.trackingCode : null,
      items,
    })
  }
  return rows.slice(0, STAGED_RETURNS_CAP)
}

const dedupe = (rows: StagedReturn[]): StagedReturn[] => {
  const seen = new Set<string>()
  const out: StagedReturn[] = []
  for (const r of rows) {
    if (seen.has(r.key)) continue
    seen.add(r.key)
    out.push(r)
  }
  return out.slice(0, STAGED_RETURNS_CAP)
}

/**
 * Load the unified list. The pre-unified RETURN_RECEIVE key is merged ONCE
 * (same key wins) and then retired so two lists can never diverge again.
 */
export function loadStagedReturns(storage: Storage): StagedReturn[] {
  const parse = (key: string): StagedReturn[] => {
    try {
      const raw = storage.getItem(key)
      return raw ? sanitizeStagedReturns(JSON.parse(raw)) : []
    } catch {
      return []
    }
  }
  const current = parse(STAGED_RETURNS_KEY)
  let legacyRaw: string | null = null
  try {
    legacyRaw = storage.getItem(LEGACY_RETURN_STAGING_KEY)
  } catch {
    legacyRaw = null
  }
  if (legacyRaw == null) return current
  let legacy: StagedReturn[] = []
  try {
    legacy = sanitizeStagedReturns(JSON.parse(legacyRaw))
  } catch {
    legacy = []
  }
  const merged = dedupe([...current, ...legacy])
  try {
    storage.setItem(STAGED_RETURNS_KEY, JSON.stringify(merged))
    storage.removeItem(LEGACY_RETURN_STAGING_KEY)
  } catch {
    /* storage unavailable — keep session rows */
  }
  return merged
}

export function persistStagedReturns(storage: Storage, rows: StagedReturn[]): void {
  try {
    storage.setItem(STAGED_RETURNS_KEY, JSON.stringify(rows.slice(0, STAGED_RETURNS_CAP)))
  } catch {
    /* storage unavailable/full — batch stays session-only */
  }
}

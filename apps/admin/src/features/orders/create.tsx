import { useState, useEffect, useRef, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ordersApi, exchangeApi, mediaUrl } from './api'
import { paymentsApi } from '@/features/payments/api'
import { PaymentGatewayAccountSelect } from '@/features/payments/components/payment-gateway-account-select'
import { creditApi } from '@/features/customers/api'
import {
  CreatePaymentsSection,
  emptyCollectedRow,
  nonEmptyCollectedRows,
  collectedRowsTotal,
  validateCollectedRows,
  type CollectedPaymentRow,
} from './components/create-payments-section'
import { resolveCityCharge, shouldAutoFillCharge } from './shipping-charge'
import {
  ACQUISITION_OPTIONS,
  CHANNEL_OPTIONS,
  type AcquisitionType,
  type ChannelV2,
  type SourcePlatformView,
} from './sales-channel-options'
import {
  ITEM_EDIT_BLOCKED_STATUSES,
  ITEM_EDIT_WARNING_STATUSES,
} from './item-edit-policy'
import { ExchangePaidConfirm, isPaidConfirmValid } from './components/exchange-paid-confirm'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { SafeImage } from '@/components/safe-image'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { normalizePhone } from '@/lib/phone-utils'
import { variantLabel, variantThumbUrl } from '@/lib/product-variant'
import { byExactMatchFirst } from '@/lib/search-products'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, ArrowLeft, ArrowRightLeft, Package, Barcode, Plus, Trash2, X, User, Phone, Mail, MapPin, CreditCard, ShoppingCart, Tag, Minus, Search, FileText, Receipt, Layers, Save, AlertTriangle } from 'lucide-react'
const nn = (v: number | string) => Number(v)

const fmt = (v: number | string) => nn(v).toFixed(2)

const ep = (p: any) => {
  if (p.type === 'variable' && p.variants?.length) {
    return Math.min(...p.variants.map((v: any) => nn(v.salePrice ?? v.price ?? 0)))
  }
  return nn(p.salePrice ?? p.basePrice ?? 0)
}

export type OrderFormMode = 'create' | 'edit' | 'exchange'

export interface OrderFormPageProps {
  mode?: OrderFormMode
  /** Required in edit/exchange mode — the order whose fields are pre-filled. */
  orderId?: string
}

export function OrderFormPage({ mode = 'create', orderId }: OrderFormPageProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Exchange pre-fills from the original too, but its customer block is
  // read-only (identity is inherited) and its items start empty.
  const isEdit = mode === 'edit'
  const isExchange = mode === 'exchange'
  const isPrefilled = isEdit || isExchange

  const [customerPhone, setCustomerPhone] = useState('')
  // Optional second contact number for this order. Stored on the order and
  // linked to the customer (CustomerPhone) — typing any linked number later
  // resolves the same customer.
  const [secondaryPhone, setSecondaryPhone] = useState('')
  // Edit-mode baseline: the secondary field is sent only when it differs.
  const [secondaryInitial, setSecondaryInitial] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerCityId, setCustomerCityId] = useState('')
  const [customerZoneId, setCustomerZoneId] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [customerMatched, setCustomerMatched] = useState(false)
  const [searchingCustomer, setSearchingCustomer] = useState(false)
  const [customerResults, setCustomerResults] = useState<any[]>([])
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)

  const [cities, setCities] = useState<any[]>([])
  const [zones, setZones] = useState<any[]>([])
  const [shipZones, setShipZones] = useState<any[]>([])
  const [useDiffShipping, setUseDiffShipping] = useState(false)
  const [shipAddress, setShipAddress] = useState('')
  const [shipCityId, setShipCityId] = useState('')
  const [shipZoneId, setShipZoneId] = useState('')

  const { data: sysSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => apiClient.get('/system-settings').then(r => r.data),
    staleTime: 5 * 60_000,
  })

  // D: effective S1/S2 per gateway (tri-state override ?? global) — the
  // create form mirrors the exact rule the backend ledger will enforce.
  const { data: effectivePaySettings } = useQuery({
    queryKey: ['payment-effective-settings'],
    queryFn: () => paymentsApi.getEffectiveSettings(),
    staleTime: 5 * 60_000,
  })

  // Per-row txn requirement: the row's gateway effective S1; falls back to
  // the effective global, then the legacy system-settings read.
  const txnRequiredFor = (gatewayCode: string): boolean => {
    const eff = effectivePaySettings?.gateways.find((g) => g.code === gatewayCode)?.effective
    if (eff) return !eff.staffAutoVerified
    if (effectivePaySettings?.global) return !effectivePaySettings.global.staffAutoVerified
    return sysSettings?.['payments.staffAutoVerified'] === 'false'
  }

  // The zone-group route lives under /shipping (`GET /shipping/zones`).
  // The old `/shipping-zones` path 404'd, so the city → charge suggestion
  // silently fell back to the flat default and ignored configured zones.
  const { data: shippingZones } = useQuery({
    queryKey: ['shipping-zones'],
    queryFn: () => apiClient.get('/shipping/zones').then(r => (r.data as any[]) || []),
    staleTime: 5 * 60_000,
  })

  const [shippingChargeManuallyEdited, setShippingChargeManuallyEdited] = useState(false)

  const cityOptions = useMemo(() => {
    return (cities || []).map((c: any) => ({
      id: c.id,
      label: c.name,
    }))
  }, [cities])

  const zoneOptions = useMemo(() => {
    return (zones || []).map((z: any) => ({
      id: z.id,
      label: z.name,
    }))
  }, [zones])

  const shipZoneOptions = useMemo(() => {
    return (shipZones || []).map((z: any) => ({
      id: z.id,
      label: z.name,
    }))
  }, [shipZones])

  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<any[]>([])
  const [productSearching, setProductSearching] = useState(false)
  const [cartItems, setCartItems] = useState<any[]>([])
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const productInputRef = useRef<HTMLInputElement>(null)

  const [shippingCharge, setShippingCharge] = useState('')
  const [discount, setDiscount] = useState('')
  const [discountType, setDiscountType] = useState<'flat' | 'percentage'>('flat')

  // NOTE: the POS showroom is resolved server-side from the POS session, so
  // this form no longer loads or asks for it — the user is never asked for
  // something the system already knows.

  // ── Canonical sales-attribution dimensions ──────────────────────────────
  // Four INDEPENDENT facts. Every one is optional: an order is created even
  // when all four are left empty. Vocabulary comes from the backend registry,
  // so a new platform appears without a client change.
  const [channel, setChannel] = useState<ChannelV2>('MESSAGING')
  const [channelEntity, setChannelEntity] = useState('')
  const [sourceSlug, setSourceSlug] = useState('facebook')
  const [acquisitionType, setAcquisitionType] = useState<AcquisitionType | ''>('')

  // Messaging may only offer messaging-capable platforms. This is a
  // convenience; the backend re-validates and clears anything incompatible.
  const { data: messagingSources } = useQuery({
    queryKey: ['sales-channel', 'sources', 'MESSAGING'],
    queryFn: () =>
      apiClient
        .get<SourcePlatformView[]>('/sales-channel/sources', { params: { capability: 'MESSAGING' } })
        .then(r => r.data),
    staleTime: 5 * 60_000,
  })
  const { data: allSources } = useQuery({
    queryKey: ['sales-channel', 'sources'],
    queryFn: () =>
      apiClient.get<SourcePlatformView[]>('/sales-channel/sources').then(r => r.data),
    staleTime: 5 * 60_000,
  })

  const sourceOptions = channel === 'MESSAGING' ? (messagingSources ?? []) : (allSources ?? [])

  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [paymentMode, setPaymentMode] = useState<'cod' | 'full' | 'partial'>('cod')
  const [partialAmount, setPartialAmount] = useState('')

  // ── Task 11 (JOB C): multi-row collected payments (create, full/partial) ──
  // Backend create takes NO payment rows: when rows are entered the payload
  // omits gatewayCode/partialAmount (so the server creates no rows) and each
  // row is recorded via POST /payments/:id after the order exists; optional
  // credit apply follows via POST /orders/:id/apply-credit. Documented choice:
  // create-then-record keeps one writer per row (the ledger service) instead
  // of two competing row creators.
  const [collectedRows, setCollectedRows] = useState<CollectedPaymentRow[]>([emptyCollectedRow()])
  const [applyCredit, setApplyCredit] = useState(false)
  const [creditAmount, setCreditAmount] = useState('')
  // Snapshot at submit time — the async post-create steps must not read live
  // state that staff may keep editing after pressing Create.
  const postCreateRef = useRef<{ rows: CollectedPaymentRow[]; apply: boolean; creditAmt: number } | null>(null)
  const showCollectedRows = !isEdit && !isExchange && paymentMode !== 'cod'

  const [customerNotes, setCustomerNotes] = useState('')
  const [officeNotes, setOfficeNotes] = useState('')
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<any>(null)
  // Edit-only: opt-in to rewriting the canonical CustomerProfile.
  const [updateCustomerProfile, setUpdateCustomerProfile] = useState(false)

  // ── Edit mode: load the order and pre-fill every field ────────────
  const [hydrated, setHydrated] = useState(!isPrefilled)
  const { data: editOrder, isLoading: editLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => ordersApi.get(orderId!).then(r => r.data as any),
    enabled: isPrefilled && !!orderId,
    // The detail page already fetched this; reuse it and never overwrite an
    // in-progress edit with a background refetch.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  // Status drives whether items may change at all. Mirrors the backend gate
  // (ITEM_EDIT_BLOCKED_STATUSES) — the API is still the authority, this only
  // avoids showing controls that would be rejected.
  const editStatusName: string | undefined = editOrder?.status?.name
  const itemsBlocked = isEdit && !!editStatusName && ITEM_EDIT_BLOCKED_STATUSES.includes(editStatusName)
  const itemsWarn = isEdit && !!editStatusName && ITEM_EDIT_WARNING_STATUSES.includes(editStatusName)

  // ── Exchange: what the customer already paid on the original ──────────
  // Drives the live settlement readout: only the difference is ever collected,
  // and the original's paid amount is never collected twice.
  const { data: settlementPreview } = useQuery({
    queryKey: ['exchange-settlement', orderId],
    queryFn: () => exchangeApi.settlementPreview(orderId!),
    enabled: isExchange && !!orderId,
    staleTime: 30_000,
  })

  // ── Exchange paid-confirm (phase-1 paidConfirmed contract) ────────────
  // Pre-filled from the ledger (Σ PAID rows on the original). CONFIRM is
  // required — the dialog can never be skipped — and any figure that differs
  // from the ledger needs a written reason (mirrors the backend fail-closed
  // rule: silent money adjustments are never allowed).
  const recordedPaid = useMemo(
    () =>
      (isExchange ? ((editOrder as any)?.payments ?? []) : [])
        .filter((p: any) => p?.status === 'PAID')
        .reduce((s: number, p: any) => s + (Number(p?.amount) || 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isExchange, (editOrder as any)?.payments],
  )
  const [paid, setPaid] = useState(0)
  const [paidReason, setPaidReason] = useState('')
  const [paidConfirmedChecked, setPaidConfirmedChecked] = useState(false)
  const [paidHydrated, setPaidHydrated] = useState(false)
  useEffect(() => {
    if (isExchange && editOrder && !paidHydrated) {
      setPaid(recordedPaid)
      setPaidHydrated(true)
    }
  }, [isExchange, editOrder, recordedPaid, paidHydrated])
  const paidValid =
    !isExchange || isPaidConfirmValid(paid, recordedPaid, paidReason, paidConfirmedChecked)

  // ── Task 11 (JOB C): customer credit offer (create mode, linked customer) ─
  const { data: customerCredit, isLoading: creditLoading } = useQuery({
    queryKey: ['customer-credit', selectedCustomerId],
    queryFn: () => creditApi.get(selectedCustomerId!),
    enabled: !isEdit && !isExchange && !!selectedCustomerId,
    staleTime: 30_000,
  })
  const creditBalance = Number(customerCredit?.balance || 0)

  // Pre-fill the credit amount once per customer (clamped to the balance;
  // the server clamps again against the live balance — never negative).
  useEffect(() => {
    if (creditBalance > 0 && !creditAmount) {
      setCreditAmount(String(Math.round(creditBalance * 100) / 100))
    }
    if (creditBalance <= 0) {
      setApplyCredit(false)
    }
    // Intentionally not keyed on creditAmount: only auto-fill once per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditBalance])

  // Pre-fill the form from the loaded order. Runs ONCE per order: `hydrated`
// guards against clobbering the user's in-progress edits if the query
// refetches in the background.
// Wait for the city list before hydrating so the stored city name can be
  // resolved to a real id — but never block forever if the lookup fails.
  const [citiesFailed, setCitiesFailed] = useState(false)
  useEffect(() => {
    if (!isPrefilled || !editOrder || hydrated) return
    if (cities.length === 0 && !citiesFailed) return
    const o = editOrder as any
  const sa = (o.shippingAddress && typeof o.shippingAddress === 'object') ? o.shippingAddress : {}

  // Customer identity comes from the ORDER's own snapshot, falling back to the
  // guest columns for rows written before the snapshot existed.
  const fullName =
    [o.customerFirstName, o.customerLastName].filter(Boolean).join(' ') ||
    o.customer?.name ||
    o.guestName ||
    ''
  setCustomerName(fullName)
  setCustomerPhone(o.customerPhone || o.guestPhone || o.customer?.phone || '')
  setSecondaryPhone((o as any).secondaryPhone || '')
  setSecondaryInitial((o as any).secondaryPhone || '')
  setCustomerEmail(o.customerEmail || o.customer?.email || '')
  setCustomerAddress(sa.address || '')

  const cityName = sa.city || sa.district || o.customerCity || ''
  const cityMatch = cities.find((c: any) => c.name?.toLowerCase() === cityName.trim().toLowerCase())
  if (cityMatch) {
    setCustomerCityId(String(cityMatch.id))
    if (sa.zoneId) setCustomerZoneId(String(sa.zoneId))
  }

  // An order stores exactly ONE address snapshot (Order.shippingAddress); the
  // "ship somewhere else" toggle only exists on the create form. So the stored
  // address always loads as the primary one and the alternative stays off —
  // if staff need a different destination they tick the box themselves.
  setUseDiffShipping(false)
  setShipAddress('')
  setShipCityId('')
  setShipZoneId('')

  // An EDIT carries the original's lines forward. An EXCHANGE starts EMPTY —
  // it is a brand-new replacement order, not a copy of what is being returned.
  setCartItems(
    isExchange
      ? []
      : (o.items || []).map((i: any) => ({
          itemId: i.id,
          productId: i.productId,
          variantId: i.variantId || null,
          product: i.product
            ? { ...i.product, name: i.variant ? `${i.product.name} (${variantLabel(i.variant)})` : i.product.name }
            : { name: i.product?.name || 'Product' },
          variant: i.variant || null,
          quantity: i.quantity,
          price: Number(i.price),
        })),
  )

  // Money is inherited on an EDIT but starts fresh on an EXCHANGE (§2: no
  // charge is copied from the original). Shipping defaults to 0.
  setShippingCharge(
    isExchange
      ? ''
      : o.shippingCharge != null ? String(Number(o.shippingCharge)) : '',
  )
  // The stored charge is authoritative on an edit — never let the city-based
  // auto-calc overwrite what the order already agreed with the customer.
  setShippingChargeManuallyEdited(true)
  setDiscount(
    isExchange
      ? ''
      : o.discount != null && Number(o.discount) > 0 ? String(Number(o.discount)) : '',
  )
  setDiscountType(!isExchange && o.discountType === 'percentage' ? 'percentage' : 'flat')

  setCustomerNotes(isExchange ? '' : o.customerNotes || '')
  setOfficeNotes(isExchange ? '' : o.officeNotes || '')

  const optType = o.paymentOptionType
  setPaymentMode(
    optType === 'CASH_ON_DELIVERY' ? 'cod'
      : optType === 'PARTIAL_PAYMENT' ? 'partial'
        : optType === 'FULL_PAYMENT' ? 'full'
          : 'cod',
  )
  setPaymentMethod(o.payments?.[0]?.gatewayCode || o.gatewayCode || '')
  setPaymentAccountId(o.payments?.[0]?.accountId || '')
  setPartialAmount(o.partialAmount != null ? String(Number(o.partialAmount)) : '')

  if (o.channel) setChannel(o.channel as ChannelV2)
  setChannelEntity(o.channelEntity || '')
  setSourceSlug(o.sourceSlug || '')
  setAcquisitionType((o.acquisitionType as AcquisitionType) || '')

  setSelectedCustomerId(o.customerId || null)
  setCustomerMatched(!!o.customerId)
  setHydrated(true)
  }, [isPrefilled, editOrder, hydrated, cities, citiesFailed])

  const productSearchRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const productDropdownRef = useRef<HTMLDivElement>(null)
  const customerDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    apiClient.get('/couriers/cities')
      .then(r => setCities(r.data as any[]))
      .catch(() => {
        // Edit hydration waits on this list; release it so the form still loads.
        setCitiesFailed(true)
        toast.error('Failed to fetch cities')
      })
  }, [])

  useEffect(() => {
    if (customerCityId) {
      apiClient.get(`/couriers/zones?cityId=${customerCityId}`).then(r => setZones(r.data as any[])).catch(() => {})
    } else {
      setZones([])
    }
  }, [customerCityId])

  useEffect(() => {
    if (shipCityId) {
      apiClient.get(`/couriers/zones?cityId=${shipCityId}`).then(r => setShipZones(r.data as any[])).catch(() => {})
    } else {
      setShipZones([])
    }
  }, [shipCityId])

  const activeCityId = useDiffShipping ? shipCityId : customerCityId
  // Last city the auto-fill wrote for — lets the effect tell "staff picked a
  // new city" (refill) apart from "same city, fresh data" (keep staff edits).
  const lastAutoCityRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeCityId || cities.length === 0) return
    // On an EDIT or EXCHANGE the stored delivery charge is already agreed with the
    // customer — never silently reprice because a zone table changed. A
    // staff-typed custom rate also survives background refetches (new array
    // identities for the same city); picking a DIFFERENT city still refills.
    if (!shouldAutoFillCharge({
      isPrefilled,
      activeCityId,
      lastAutoCityId: lastAutoCityRef.current,
      manuallyEdited: shippingChargeManuallyEdited,
    })) return
    const selectedCity = cities.find((c: any) => String(c.id) === String(activeCityId))
    if (!selectedCity) return

    const cityName = (selectedCity.name || '').trim()
    const defaultCharge = resolveCityCharge(cityName, sysSettings as any, shippingZones as any)

    // Automatically populate delivery charge from default settings for this city
    setShippingCharge(defaultCharge > 0 ? String(defaultCharge) : '')
    setShippingChargeManuallyEdited(false)
    lastAutoCityRef.current = activeCityId
  }, [activeCityId, cities, sysSettings, shippingZones, isPrefilled, shippingChargeManuallyEdited])

  useEffect(() => {
    // While an order is being hydrated the phone arrives from the server, not
    // from the user. Without this guard the lookup below would fire on mount
    // and immediately clear the customer link we just restored.
    if (isPrefilled && !hydrated) return
    const normalized = normalizePhone(customerPhone)
    if (!normalized || customerPhone.length < 11) {
      setSearchingCustomer(false)
      setCustomerMatched(false)
      setSelectedCustomerId(null)
      setCustomerResults([])
      setCustomerDropdownOpen(false)
      return
    }
    setSearchingCustomer(true)
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient.get('/customers', { params: { search: normalized, perPage: 8 } })
        const customers = (res.data as any)?.data || []
        const matches = customers.filter((c: any) => {
          const cNormalized = normalizePhone(c.phoneNumber || '')
          if (cNormalized === normalized) return true
          // Typing any linked (secondary) number resolves the same customer.
          const linked: string[] = Array.isArray(c.linkedPhones) ? c.linkedPhones : []
          return linked.some((p) => normalizePhone(p) === normalized)
        })
        setCustomerResults(matches)
        setCustomerDropdownOpen(matches.length > 0)
        // Changing the phone invalidates any previously selected customer.
        setSelectedCustomerId(null)
        setCustomerMatched(false)
      } catch {
        setCustomerResults([])
        setCustomerDropdownOpen(false)
        setSelectedCustomerId(null)
        setCustomerMatched(false)
      } finally {
        setSearchingCustomer(false)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [customerPhone, isPrefilled, hydrated])

  const selectCustomer = (c: any) => {
    setSelectedCustomerId(c.id)
    setCustomerName(`${c.firstName || ''} ${c.lastName || ''}`.trim())
    setCustomerEmail(c.email || '')
    setCustomerAddress(c.address || '')
    if (c.cityId) {
      setCustomerCityId(String(c.cityId))
      if (c.zoneId) setCustomerZoneId(String(c.zoneId))
    } else if (c.city || c.district) {
      const match = cities.find((city: any) =>
        city.name?.toLowerCase() === (c.city || c.district || '').trim().toLowerCase()
      )
      if (match) setCustomerCityId(String(match.id))
    }
    setCustomerMatched(true)
    setCustomerDropdownOpen(false)
  }

  useEffect(() => {
    if (!productSearch || productSearch.length < 1) { setProductResults([]); setShowProductDropdown(false); return }
    setProductSearching(true)
    clearTimeout(productSearchRef.current)
    productSearchRef.current = setTimeout(() => {
      const params: any = { search: productSearch, perPage: 50 }
      apiClient.get('/products', { params })
        .then(r => { setProductResults(byExactMatchFirst<any>(r.data?.data || r.data || [], productSearch)); setShowProductDropdown(true) })
        .catch(() => {})
        .finally(() => setProductSearching(false))
    }, 300)
    return () => clearTimeout(productSearchRef.current)
  }, [productSearch])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (productDropdownRef.current && !productDropdownRef.current.contains(e.target as Node)) {
        setShowProductDropdown(false)
      }
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target as Node)) {
        setCustomerDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleBarcodeSearch = (sku: string) => {
    const q = sku.trim()
    if (!q) return
    apiClient.get('/products', { params: { search: q, perPage: 50 } })
      .then(r => {
        const results = byExactMatchFirst<any>(r.data?.data || r.data || [], q)
        const exact = results.find((p: any) =>
          p.sku?.toLowerCase() === q.toLowerCase() ||
          p.variants?.some((v: any) => v.sku?.toLowerCase() === q.toLowerCase())
        )
        const target = exact || (results.length > 0 ? results[0] : null)
        if (target) {
          const matchedVariant = target.variants?.find((v: any) => v.sku?.toLowerCase() === q.toLowerCase())
          if (matchedVariant) {
            addToCart(target, matchedVariant)
            toast.success(`${target.name} (${matchedVariant.name || matchedVariant.sku}) added`)
          } else if (target.type === 'variable' || target.variants?.length > 0) {
            setSelectedProductForVariants(target)
          } else {
            addToCart(target)
            toast.success(`${target.name} added to cart`)
          }
          setProductSearch('')
          setShowProductDropdown(false)
        } else {
          toast.error('Product not found with this SKU/barcode')
        }
      })
      .catch(() => toast.error('Failed to search by barcode'))
  }

  const addToCart = (product: any, variant?: any) => {
    if (itemsBlocked) return
    setCartItems(prev => {
      const existing = prev.findIndex(
        (i: any) => i.productId === product.id && (i.variantId || null) === (variant?.id || null)
      )
      if (existing >= 0) {
        const updated = [...prev]
        updated[existing] = { ...updated[existing], quantity: updated[existing].quantity + 1 }
        return updated
      }
      return [...prev, {
        productId: product.id,
        variantId: variant?.id || null,
        product: { ...product, name: variant ? `${product.name} (${variant.name || variant.sku})` : product.name },
        quantity: 1,
        price: parseFloat(variant?.salePrice ?? variant?.price ?? product.salePrice ?? product.basePrice ?? 0) || 0,
        variant: variant || null,
      }]
    })
  }

  // Line-item mutators are no-ops once the status gate locks items. Guarding the
  // handlers (rather than only disabling the buttons) means keyboard, dropdown
  // and mobile entry points are all covered by one rule.
  const removeFromCart = (index: number) => {
    if (itemsBlocked) return
    setCartItems(prev => prev.filter((_, i) => i !== index))
  }

  // Relative quantity changes take a DELTA, not an absolute value. Computing the
  // target from `item.quantity` in the click closure reads a stale render when
  // two clicks land before React re-renders, so the second increment was
  // silently dropped (2 → 3 instead of 2 → 4). Deriving the new value inside
  // the state updater reads the latest committed value instead.
  const bumpCartQty = (index: number, delta: number) => {
    if (itemsBlocked) return
    setCartItems(prev => {
      const current = prev[index]?.quantity
      if (current == null) return prev
      const next = Number(current) + delta
      if (next < 1) return prev
      const updated = [...prev]
      updated[index] = { ...updated[index], quantity: next }
      return updated
    })
  }

  const updateCartPrice = (index: number, price: number | string) => {
    setCartItems(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], price }
      return updated
    })
  }

  const calculateSubtotal = () => cartItems.reduce((sum, item) => sum + nn(item.price) * item.quantity, 0)

  const calculateDiscountValue = () => {
    const subtotal = calculateSubtotal()
    const rawDiscount = parseFloat(discount) || 0
    if (rawDiscount <= 0) return 0
    if (discountType === 'percentage') {
      const pct = Math.min(100, Math.max(0, rawDiscount))
      return subtotal * (pct / 100)
    }
    return Math.min(subtotal, Math.max(0, rawDiscount))
  }

  const calculateTotal = () => {
    const subtotal = calculateSubtotal()
    const shipping = parseFloat(shippingCharge) || 0
    const disc = calculateDiscountValue()
    return Math.max(0, subtotal + shipping - disc)
  }

  const buildPayload = () => {
    const payload: any = {
      items: cartItems.map(item => ({
        productId: item.productId,
        quantity: parseInt(item.quantity as any) || 1,
        price: parseFloat(item.price as any) || 0,
        ...(item.variantId ? { variantId: item.variantId } : {}),
      })),
      shippingCharge: parseFloat(shippingCharge) || 0,
      discount: parseFloat(discount) || 0,
      discountType,
      // Canonical dimensions. Legacy salesChannel/sourcePlatform/sourceType/
      // sourceEntity are intentionally NOT sent by the manual form any more:
      // the canonical model supersedes them, and the backend still writes the
      // legacy columns from the canonical values.
      channel,
      ...(channelEntity ? { channelEntity } : {}),
      ...(sourceSlug ? { sourceSlug } : {}),
      ...(acquisitionType ? { acquisitionType } : {}),
      customerNotes: customerNotes || null,
      officeNotes: officeNotes || null,
      paymentOptionType: paymentMode === 'cod' ? 'CASH_ON_DELIVERY' : paymentMode === 'full' ? 'FULL_PAYMENT' : paymentMode === 'partial' ? 'PARTIAL_PAYMENT' : undefined,
      gatewayCode: paymentMethod || undefined,
      ...(paymentAccountId ? { accountId: paymentAccountId } : {}),
    }

    if (paymentMode === 'partial' && partialAmount) {
      payload.partialAmount = parseFloat(partialAmount)
    }

    const normalizedPhone = normalizePhone(customerPhone)
    const [firstName, ...restName] = (customerName || '').trim().split(/\s+/)
    const lastName = restName.join(' ')

    if (isEdit) {
      // An update edits an EXISTING order, so identity corrections go through
      // `customerInfo` (the order's own snapshot). guestName/guestPhone only
      // exist on creation. `updateCustomerProfile` stays opt-in and defaults
      // to false — correcting one order must never silently rewrite a real
      // person's canonical customer profile.
      payload.customerInfo = {
        firstName: firstName || undefined,
        ...(lastName ? { lastName } : {}),
        ...(normalizedPhone ? { phoneNumber: normalizedPhone } : {}),
        ...(customerEmail ? { email: customerEmail } : {}),
      }
      // Secondary phone is sent ONLY when staff actually changed it — an
      // untouched field must never rewrite the stored value on every save.
      // Clearing the input clears the order's secondary number (null).
      const normalizedSecondary = normalizePhone(secondaryPhone)
      const normalizedSecondaryInitial = normalizePhone(secondaryInitial)
      if ((normalizedSecondary || null) !== (normalizedSecondaryInitial || null)) {
        payload.customerInfo.secondaryPhone = normalizedSecondary || null
      }
      if (updateCustomerProfile) payload.updateCustomerProfile = true
    } else {
      if (customerName) payload.guestName = customerName
      if (normalizedPhone) payload.guestPhone = normalizedPhone
      const normalizedSecondary = normalizePhone(secondaryPhone)
      if (normalizedSecondary) payload.secondaryPhone = normalizedSecondary
      if (customerEmail) payload.guestEmail = customerEmail
      if (selectedCustomerId) {
        payload.customerId = selectedCustomerId
      }
    }

    const shipAddr = useDiffShipping ? shipAddress : customerAddress
    const shipCity = useDiffShipping ? shipCityId : customerCityId
    const shipZone = useDiffShipping ? shipZoneId : customerZoneId
    const selectedCity = cities.find((c: any) => String(c.id) === String(shipCity))
    if (selectedCity?.name) {
      payload.district = selectedCity.name
    }
    // An exchange inherits the ORIGINAL's identity and address server-side, so
    // sending them again would only risk a second source of truth.
    if (!isExchange && (shipAddr || shipCity)) {
      payload.shippingAddress = {
        address: shipAddr,
        cityId: shipCity || undefined,
        zoneId: shipZone || undefined,
        district: selectedCity?.name || undefined,
        city: selectedCity?.name || undefined,
      }
    }

    return payload
  }

  const submitMut = useMutation({
    mutationFn: (data: any) => {
      if (isExchange) {
        // The exchange endpoint takes its own, much smaller payload — no
        // customer/shipping (inherited server-side) and no attribution.
        const { items, discount: d, discountType: dt, shippingCharge: sc, customerNotes: cn, officeNotes: on } = data
        return exchangeApi.create(orderId!, {
          items,
          ...(d ? { discount: d } : {}),
          ...(dt ? { discountType: dt } : {}),
          ...(sc ? { shippingCharge: sc } : {}),
          ...(cn ? { customerNotes: cn } : {}),
          ...(on ? { officeNotes: on } : {}),
          paidConfirmed: paid,
          ...(Math.abs(paid - recordedPaid) > 0.005 ? { paidAdjustmentReason: paidReason.trim() } : {}),
        })
      }
      return isEdit ? ordersApi.updateOrder(orderId!, data) : ordersApi.create(data)
    },
    onSuccess: async (res: any) => {
      if (isExchange) {        // The exchange response carries its own settlement breakdown, which is
        // the whole point of the flow — surface it instead of a bare "created".
        const s = res?.settlement
        const exId = res?.exchange?.id
        if (s?.status === 'SETTLED_DUE') {
          toast.warning(
            `Collect ৳${Number(s.delta).toFixed(2)} — the customer paid ৳${Number(s.originalPaid).toFixed(2)} on the original, the exchange costs ৳${Number(s.exchangeTotal).toFixed(2)}.`,
            { duration: 9000 },
          )
        } else if (s?.status === 'SETTLED_REFUND') {
          toast.warning(
            `Refund ৳${Number(s.delta).toFixed(2)} — unused credit from the original order. A refund has been raised for review.`,
            { duration: 9000 },
          )
        }
        toast.success('Exchange Order created — original moved to Return Pending')
        queryClient.invalidateQueries({ queryKey: ['order', orderId] })
        navigate({ to: '/op/orders/$id', params: { id: exId || orderId! } })
        return
      }
      const savedId = res.data?.id || res.id || orderId
      // Task 11 (JOB C): the order carries NO payment rows yet — record the
      // collected rows + credit apply now, before leaving. Partial failures
      // navigate anyway (the order page can finish them); nothing is silent.
      const post = !isEdit ? postCreateRef.current : null
      postCreateRef.current = null
      if (post && savedId) {
        const failures: string[] = []
        for (let i = 0; i < post.rows.length; i++) {
          const r = post.rows[i]
          try {
            await paymentsApi.record(savedId, {
              gatewayCode: r.gatewayCode,
              amount: parseFloat(r.amount),
              accountId: r.accountId || undefined,
              transactionId: r.transactionId.trim() || undefined,
              notes: r.note.trim() || undefined,
            })
          } catch (e: any) {
            failures.push(`payment row ${i + 1}: ${e?.response?.data?.message || 'failed'}`)
          }
        }
        if (post.apply && post.creditAmt > 0) {
          try {
            await creditApi.apply(savedId, post.creditAmt)
          } catch (e: any) {
            failures.push(`apply credit: ${e?.response?.data?.message || 'failed'}`)
          }
        }
        if (failures.length > 0) {
          toast.error(
            `Order created, but some money movements failed — finish them on the order page: ${failures.join('; ')}`,
            { duration: 10000 },
          )
        }
        queryClient.invalidateQueries({ queryKey: ['order', savedId] })
      }
      // Only creation reports staff-context warnings (blocked phone/IP). An
      // update never produces them, so read defensively rather than assuming.
      const warnings: string[] = res.data?.warnings || res.warnings || []
      if (warnings.length > 0) {
        toast.warning(
          warnings.join('\n'),
          { duration: 8000 },
        )
      }
      toast.success(isEdit ? 'Order updated successfully' : 'Order created successfully')
      navigate({ to: '/op/orders/$id', params: { id: savedId } })
    },
    onError: (err: any) => {
      toast.error(
        err?.response?.data?.message ||
          (isExchange
            ? 'Failed to create the exchange order'
            : isEdit ? 'Failed to update order' : 'Failed to create order'),
      )
    },
  })

  const handleSubmit = async () => {
    if (isExchange) {
      // An exchange needs only replacement items — customer details are
      // inherited, so the create-mode identity rules do not apply.
      if (cartItems.length === 0) {
        toast.error('Add at least one replacement item')
        return
      }
      // The paid figure can never be skipped: CONFIRM is required, and a
      // figure that differs from the ledger needs a written reason.
      if (!paidConfirmedChecked) {
        toast.error('Confirm the already-paid figure before creating the exchange')
        return
      }
      if (Math.abs(paid - recordedPaid) > 0.005 && !paidReason.trim()) {
        toast.error('Explain why the confirmed figure differs from the ledger')
        return
      }
      submitMut.mutate(buildPayload())
      return
    }
    if (itemsBlocked) {
      toast.error(
        `Items of a "${editStatusName}" order can no longer be changed — the goods have already left the warehouse.`,
      )
      return
    }
    if (cartItems.length === 0) {
      toast.error('Add at least one item to the cart')
      return
    }
    const normalizedPhone = normalizePhone(customerPhone)
    if (!normalizedPhone || normalizedPhone.length < 11) {
      toast.error('Enter a valid 11-digit phone number (e.g. 01712345678)')
      return
    }
    if (!customerName.trim()) {
      toast.error('Customer name is required')
      return
    }
    if (paymentMode === 'partial' && !showCollectedRows) {
      const pAmt = parseFloat(partialAmount) || 0
      if (!partialAmount || pAmt <= 0) {
        toast.error('Enter a valid partial advance amount')
        return
      }
      if (pAmt >= total) {
        toast.error('Advance amount must be less than order total (use Full Payment instead)')
        return
      }
    }
    const payload = buildPayload()
    if (showCollectedRows) {
      // S1 mirror (same rule as the order page): txn required iff staff
      // entries are NOT auto-verified — resolved PER ROW by gateway (D).
      const rowErrors = validateCollectedRows(collectedRows, txnRequiredFor)
      if (rowErrors.length > 0) {
        toast.error(rowErrors[0])
        return
      }
      const rows = nonEmptyCollectedRows(collectedRows)
      if (paymentMode === 'partial' && rows.length === 0) {
        toast.error('Add at least one collected payment row for the partial advance')
        return
      }
      if (rows.length > 0) {
        // The rows ARE the collection — the server must not also mint its own
        // advance/collect-later row from gatewayCode/partialAmount.
        delete payload.gatewayCode
        delete payload.partialAmount
        delete payload.accountId
      }
      let creditAmt = 0
      const wantCredit = applyCredit && creditBalance > 0
      if (wantCredit) {
        creditAmt = Math.min(parseFloat(creditAmount) || 0, creditBalance)
        if (!(creditAmt > 0)) {
          toast.error('Enter a credit amount greater than 0')
          return
        }
      }
      postCreateRef.current = { rows, apply: wantCredit && creditAmt > 0, creditAmt }
    } else {
      postCreateRef.current = null
    }
    submitMut.mutate(payload)
  }

  const subtotal = calculateSubtotal()
  const discountValue = calculateDiscountValue()
  const total = calculateTotal()

  const submitLabel =
    isExchange ? 'Create Exchange Order' : isEdit ? 'Update Order' : 'Create Order'

  if (isPrefilled && (editLoading || !hydrated)) {
    return (
      <div className='flex items-center justify-center min-h-[60vh] gap-2 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' />
        {isExchange ? 'Loading order for exchange…' : 'Loading order for editing…'}
      </div>
    )
  }

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost'
            size='sm'
            className='h-8 px-2 sm:px-3 text-xs sm:text-sm'
            onClick={() =>
              isPrefilled
                ? navigate({ to: '/op/orders/$id', params: { id: orderId! } })
                : navigate({ to: '/op/orders' })
            }
          >
            <ArrowLeft className='h-4 w-4 mr-1 shrink-0' />
            <span className='hidden sm:inline'>{isPrefilled ? 'Back to order' : 'Back to '}</span>
            <span className='sm:hidden'>Back</span>
            {!isPrefilled && <span className='hidden sm:inline'>Orders</span>}
          </Button>
        </div>
        <div className='ml-auto flex items-center gap-2'>
          <ThemeSwitch /><ProfileDropdown />
        </div>
      </Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6 p-3 sm:p-6 max-w-7xl mx-auto w-full pb-24 sm:pb-8'>
        {/* Page Header */}
        <div className='flex items-center justify-between gap-3 pb-1 border-b border-border/40'>
          <div>
            <h1 className='text-xl sm:text-2xl font-bold tracking-tight text-foreground'>
              {isExchange ? 'Create Exchange Order' : isEdit ? 'Edit Order' : 'Create New Order'}
            </h1>
            <p className='text-xs sm:text-sm text-muted-foreground mt-0.5'>
              {isExchange
                ? `Exchanging against ${(editOrder as any)?.displayId || orderId} — customer details are carried over, add the replacement items`
                : isEdit
                  ? `Updating ${(editOrder as any)?.displayId || orderId} — stock adjusts automatically when you change items`
                  : 'Add customer details, select products, configure shipping and payment options'}
            </p>
          </div>
          <div className='hidden sm:flex items-center gap-2'>
            <Button
              size='sm'
              className='h-9 px-4 font-semibold text-xs shadow-xs'
              onClick={handleSubmit}
              disabled={submitMut.isPending || !paidValid}
            >
              {submitMut.isPending
                ? <Loader2 className='h-3.5 w-3.5 animate-spin mr-1.5' />
                : isEdit ? <Save className='h-3.5 w-3.5 mr-1.5' /> : <Plus className='h-3.5 w-3.5 mr-1.5' />}
              {submitLabel}
            </Button>
          </div>
        </div>

        {isEdit && itemsBlocked && (
          <div className='flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
            <AlertTriangle className='h-4 w-4 mt-0.5 shrink-0' />
            <span>
              <strong>Items are locked.</strong> This order is{' '}
              <strong>{editStatusName}</strong> — the goods have already left the
              warehouse, so its lines can no longer be added, changed or removed.
              Customer details, notes, shipping and payment are still editable.
            </span>
          </div>
        )}

        {isEdit && itemsWarn && !itemsBlocked && (
          <div className='flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400'>
            <AlertTriangle className='h-4 w-4 mt-0.5 shrink-0' />
            <span>
              <strong>Heads up.</strong> This order is <strong>{editStatusName}</strong>{' '}
              — items are already picked or being packed. Changing them now will
              adjust stock again, so double-check before saving.
            </span>
          </div>
        )}

        {/* ── Main Grid ── */}
        <div className='grid grid-cols-1 xl:grid-cols-12 gap-4 sm:gap-6 items-start'>

          {/* ════ LEFT COLUMN (Customer, Items, Notes) ════ */}
          <div className='xl:col-span-7 2xl:col-span-8 space-y-4 sm:space-y-6'>

            {/* Customer Information Card */}
            <Card className='overflow-hidden border border-border/70 shadow-xs rounded-xl'>
              <CardHeader className='bg-muted/30 border-b border-border/50 py-3 px-4 sm:py-3.5 sm:px-6'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2.5'>
                    <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0'>
                      <Phone className='h-4 w-4' />
                    </div>
                    <div>
                      <CardTitle className='text-sm sm:text-base font-semibold tracking-tight text-foreground flex items-center gap-2'>
                        Customer Information
                        {customerMatched && (
                          <Badge variant='secondary' className='text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium'>
                            Existing Customer
                          </Badge>
                        )}
                      </CardTitle>
                      <p className='text-xs text-muted-foreground mt-0.5'>Search by phone or type new customer details</p>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-4 sm:p-6 space-y-4'>
                <div className='relative' ref={customerDropdownRef}>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Customer Phone *</Label>
                  <div className='relative'>
                    <Phone className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                    <Input
                      value={customerPhone}
                      onChange={e => setCustomerPhone(e.target.value)}
                      onFocus={() => { if (customerResults.length > 0) setCustomerDropdownOpen(true) }}
                      placeholder='Phone number (e.g. 01712345678)'
                      className='pl-9 h-10 text-sm'
                    />
                    {searchingCustomer && <Loader2 className='absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground' />}
                  </div>
                  {customerDropdownOpen && customerResults.length > 0 && (
                    <div className='absolute z-30 mt-1.5 w-full bg-background border rounded-xl shadow-xl overflow-hidden'>
                      <div className='px-3.5 py-1.5 bg-muted/40 border-b text-[11px] text-muted-foreground font-medium'>
                        Matching Customers ({customerResults.length})
                      </div>
                      <div className='max-h-60 overflow-y-auto divide-y divide-border/50'>
                        {customerResults.map(c => (
                          <button
                            key={c.id}
                            type='button'
                            className='w-full text-left px-3.5 py-2.5 text-sm hover:bg-muted/70 flex items-center gap-2 transition-colors'
                            onClick={() => selectCustomer(c)}
                          >
                            <div className='min-w-0 flex-1'>
                              <p className='text-sm font-semibold truncate'>{(c.firstName || c.lastName) ? `${c.firstName || ''} ${c.lastName || ''}`.trim() : 'Customer'}</p>
                              <p className='text-xs text-muted-foreground truncate'>{c.phoneNumber}{c.address ? ` · ${c.address}` : ''}</p>
                            </div>
                            <User className='h-4 w-4 text-muted-foreground shrink-0' />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {customerMatched && (
                    <p className='text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium'>
                      ✓ Auto-filled information for {customerName}
                    </p>
                  )}
                  {isEdit && !!selectedCustomerId && (
              <label
                htmlFor='updateCustomerProfile'
                className='inline-flex items-start gap-2 cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground pt-1'
              >
                <input
                  type='checkbox'
                  id='updateCustomerProfile'
                  checked={updateCustomerProfile}
                  onChange={e => setUpdateCustomerProfile(e.target.checked)}
                  className='h-4 w-4 mt-0.5 rounded border-border text-primary focus:ring-primary/20'
                />
                <span>
                  Also update this customer's saved profile
                  <span className='block text-[11px] text-muted-foreground/80'>
                    Off by default — corrects this order only, without rewriting
                    their master record.
                  </span>
                </span>
              </label>
            )}
                  {customerPhone.length >= 11 && !customerMatched && !searchingCustomer && !customerDropdownOpen && (
                    <p className='text-xs text-muted-foreground mt-1'>
                      No existing record found. A new customer profile will be created with this number.
                    </p>
                  )}
                </div>

                <div>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>
                    Secondary Phone <span className='font-normal'>(Optional)</span>
                  </Label>
                  <div className='relative'>
                    <Phone className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                    <Input
                      value={secondaryPhone}
                      onChange={e => setSecondaryPhone(e.target.value)}
                      placeholder='Second contact number (optional)'
                      className='pl-9 h-10 text-sm'
                      disabled={isExchange}
                    />
                  </div>
                  <p className='text-[11px] text-muted-foreground mt-1'>
                    Saved on the order and linked to this customer — any linked number finds them later.
                  </p>
                </div>

                <div className='grid grid-cols-1 sm:grid-cols-2 gap-3.5'>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Full Name *</Label>
                    <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder='Customer name' className='h-9.5 text-sm' disabled={isExchange} />
                  </div>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Email (Optional)</Label>
                    <Input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder='customer@example.com' className='h-9.5 text-sm' disabled={isExchange} />
                  </div>
                </div>

                <div>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Delivery Address</Label>
                  <Textarea value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} rows={2} placeholder='House/Road, Village/Area...' className='text-sm resize-none' disabled={isExchange} />
                </div>

                <div className='grid grid-cols-1 sm:grid-cols-2 gap-3.5'>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>City / District</Label>
                    <SearchableSelect
                      options={cityOptions}
                      value={customerCityId}
                      onChange={val => { setCustomerCityId(val); setCustomerZoneId('') }}
                      placeholder='Select city...'
                      searchPlaceholder='Search cities...'
                      disabled={isExchange}
                    />
                  </div>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Courier Delivery Zone</Label>
                    <SearchableSelect
                      options={zoneOptions}
                      value={customerZoneId}
                      onChange={setCustomerZoneId}
                      placeholder='Select zone...'
                      searchPlaceholder='Search zones...'
                      disabled={isExchange || !customerCityId}
                    />
                  </div>
                </div>

                {isExchange && (
                  <p className='text-[11px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-2'>
                    Customer and delivery details are carried over from the original order and cannot be changed here.
                  </p>
                )}

                <div className='pt-1'>
                  <label htmlFor='diffShipping' className='inline-flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground'>
                    <input
                      type='checkbox'
                      id='diffShipping'
                      checked={useDiffShipping}
                      onChange={e => setUseDiffShipping(e.target.checked)}
                      className='h-4 w-4 rounded border-border text-primary focus:ring-primary/20'
                    />
                    Deliver to a different shipping address
                  </label>
                </div>

                {useDiffShipping && (
                  <div className='p-3.5 bg-muted/30 border border-border/60 rounded-xl space-y-3 pt-3'>
                    <div className='flex items-center gap-1.5 text-xs font-semibold text-foreground'>
                      <MapPin className='h-3.5 w-3.5 text-primary' />
                      Alternative Shipping Destination
                    </div>
                    <div>
                      <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Shipping Address</Label>
                      <Textarea value={shipAddress} onChange={e => setShipAddress(e.target.value)} rows={2} placeholder='Different recipient address...' className='text-sm resize-none' />
                    </div>
                    <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                      <div>
                        <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Shipping City</Label>
                        <SearchableSelect
                          options={cityOptions}
                          value={shipCityId}
                          onChange={val => { setShipCityId(val); setShipZoneId('') }}
                          placeholder='Select city...'
                          searchPlaceholder='Search cities...'
                        />
                      </div>
                      <div>
                        <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Shipping Zone</Label>
                        <SearchableSelect
                          options={shipZoneOptions}
                          value={shipZoneId}
                          onChange={setShipZoneId}
                          placeholder='Select zone...'
                          searchPlaceholder='Search zones...'
                          disabled={!shipCityId}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Ordered Items Card */}
            <Card className='overflow-hidden border border-border/70 shadow-xs rounded-xl'>
              <CardHeader className='bg-muted/30 border-b border-border/50 py-3 px-4 sm:py-3.5 sm:px-6'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2.5'>
                    <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0'>
                      <Package className='h-4 w-4' />
                    </div>
                    <div>
                      <CardTitle className='text-sm sm:text-base font-semibold tracking-tight text-foreground flex items-center gap-2'>
                        Ordered Items
                        <Badge variant='secondary' className='text-[11px] font-medium px-2 py-0.5 rounded-full'>
                          {cartItems.length} {cartItems.length === 1 ? 'item' : 'items'} ({cartItems.reduce((acc, i) => acc + i.quantity, 0)} units)
                        </Badge>
                      </CardTitle>
                      <p className='text-xs text-muted-foreground mt-0.5'>Search products, adjust unit prices and quantities</p>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-4 sm:p-6 space-y-4'>
                {/* Unified Smart Search Bar */}
                <div className='relative' ref={productDropdownRef}>
                  <div className='relative flex items-center'>
                    <Search className='absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10' />
                    <input
                      ref={productInputRef}
                      type='text'
                      value={productSearch}
                      onChange={e => {
                        setProductSearch(e.target.value)
                        if (!e.target.value) setShowProductDropdown(false)
                      }}
                      onFocus={() => {
                        if (productResults.length > 0) setShowProductDropdown(true)
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && productSearch.trim()) {
                          const localExact = productResults.find((p: any) =>
                            p.sku?.toLowerCase() === productSearch.trim().toLowerCase() ||
                            p.variants?.some((v: any) => v.sku?.toLowerCase() === productSearch.trim().toLowerCase())
                          )
                          if (localExact) {
                            const matchedVariant = localExact.variants?.find((v: any) => v.sku?.toLowerCase() === productSearch.trim().toLowerCase())
                            if (matchedVariant) {
                              addToCart(localExact, matchedVariant)
                              toast.success(`${localExact.name} (${matchedVariant.name || matchedVariant.sku}) added`)
                              setProductSearch('')
                              setShowProductDropdown(false)
                            } else if (localExact.type === 'variable' || localExact.variants?.length > 0) {
                              setSelectedProductForVariants(localExact)
                              setProductSearch('')
                              setShowProductDropdown(false)
                            } else {
                              addToCart(localExact)
                              toast.success(`${localExact.name} added`)
                              setProductSearch('')
                              setShowProductDropdown(false)
                            }
                          } else {
                            handleBarcodeSearch(productSearch.trim())
                          }
                        }
                        if (e.key === 'Escape') setShowProductDropdown(false)
                      }}
                      placeholder='Search by product name, SKU or scan barcode...'
                      disabled={itemsBlocked}
                      className='w-full h-11 pl-10 pr-10 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed'
                      autoComplete='off'
                    />
                    {productSearching ? (
                      <Loader2 className='absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground' />
                    ) : productSearch ? (
                      <button
                        type='button'
                        onClick={() => { setProductSearch(''); setShowProductDropdown(false) }}
                        className='absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1'
                      >
                        <X className='h-4 w-4' />
                      </button>
                    ) : null}
                  </div>

                  {/* Dropdown Menu */}
                  {showProductDropdown && productResults.length > 0 && (
                    <div className='absolute z-30 mt-1.5 w-full bg-background border rounded-xl shadow-xl overflow-hidden'>
                      <div className='px-3.5 py-2 bg-muted/40 border-b flex items-center justify-between text-xs text-muted-foreground'>
                        <span>{productResults.length} product{productResults.length > 1 ? 's' : ''} found</span>
                        <span className='text-[11px] hidden sm:inline'>Tap product to add or select variant</span>
                      </div>
                      <div className='max-h-72 sm:max-h-80 overflow-y-auto divide-y divide-border/50'>
                        {productResults.map((p: any) => {
                          const isVariable = p.type === 'variable' || (p.variants && p.variants.length > 0)
                          return (
                            <div
                              key={p.id}
                              className='w-full p-2.5 sm:p-3 hover:bg-muted/60 transition-colors flex items-center gap-3 cursor-pointer'
                              onClick={() => {
                                if (isVariable) {
                                  setSelectedProductForVariants(p)
                                } else {
                                  addToCart(p)
                                  toast.success(`${p.name} added to cart`)
                                }
                                setProductSearch('')
                                setShowProductDropdown(false)
                              }}
                            >
                              {p.images && Array.isArray(p.images) && p.images[0] ? (
                                <SafeImage src={mediaUrl(p.images[0])} alt='' className='h-11 w-11 rounded-lg border object-cover shrink-0' thumbWidth={48} thumbHeight={48} />
                              ) : (
                                <div className='h-11 w-11 rounded-lg border bg-muted flex items-center justify-center shrink-0'>
                                  <Package className='h-5 w-5 text-muted-foreground' />
                                </div>
                              )}
                              <div className='min-w-0 flex-1'>
                                <p className='text-sm font-semibold text-foreground line-clamp-2 leading-snug'>{p.name}</p>
                                <div className='flex items-center gap-1.5 mt-1 flex-wrap'>
                                  {p.sku && (
                                    <span className='text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
                                      {p.sku}
                                    </span>
                                  )}
                                  {isVariable && (
                                    <Badge variant='outline' className='text-[10px] h-4.5 font-normal border-primary/30 text-primary'>
                                      {p.variants?.length} options
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <div className='text-right shrink-0'>
                                <div className='text-sm font-bold text-primary'>৳{fmt(ep(p))}</div>
                                <Button
                                  size='sm'
                                  variant={isVariable ? 'outline' : 'secondary'}
                                  className='h-7 text-xs px-2.5 mt-1'
                                >
                                  {isVariable ? 'Choose' : '+ Add'}
                                </Button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Cart Area */}
                {cartItems.length === 0 ? (
                  <div className='flex flex-col items-center justify-center py-12 border border-dashed rounded-xl text-muted-foreground bg-muted/10'>
                    <ShoppingCart className='h-12 w-12 mb-2 opacity-20' />
                    <p className='text-sm font-medium'>No products in this order</p>
                    <p className='text-xs text-muted-foreground mt-0.5'>Search and select items above to add to cart</p>
                  </div>
                ) : (
                  <div className='border border-border/70 rounded-xl overflow-hidden'>
                    {/* Desktop Table View */}
                    <div className='hidden md:block overflow-x-auto'>
                      <Table>
                        <TableHeader>
                          <TableRow className='bg-muted/20 border-b border-border/50'>
                            <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-9 px-4'>Product</TableHead>
                            <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-9'>Variant</TableHead>
                            <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-9 text-right w-28'>Unit Price (৳)</TableHead>
                            <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-9 text-right w-28'>Quantity</TableHead>
                            <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-9 text-right w-28'>Total</TableHead>
                            <TableHead className='w-10'></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cartItems.map((item, index) => (
                            <TableRow key={`${item.productId}-${item.variantId || ''}-${index}`} className='hover:bg-muted/30 transition-colors'>
                              <TableCell className='px-4 py-3'>
                                <div className='flex items-center gap-2.5'>
                                  {item.product.images && Array.isArray(item.product.images) && item.product.images[0] ? (
                                    <SafeImage src={mediaUrl(item.product.images[0])} alt='' className='h-9 w-9 rounded-md border object-cover shrink-0' thumbWidth={48} thumbHeight={48} />
                                  ) : (
                                    <div className='h-9 w-9 rounded-md border bg-muted flex items-center justify-center shrink-0'><Package className='h-4 w-4 text-muted-foreground' /></div>
                                  )}
                                  <span className='text-sm font-semibold truncate max-w-[200px] text-foreground'>{item.product.name}</span>
                                </div>
                              </TableCell>
                              <TableCell className='text-sm text-muted-foreground'>
                                {item.variant?.name || (item.variantId ? item.variant?.sku || '—' : '—')}
                              </TableCell>
                              <TableCell className='text-right'>
                                <Input
                                  type='number'
                                  step='0.01'
                                  min='0'
                                  value={item.price === 0 || item.price === '0' || item.price === '' ? '' : item.price}
                                  onChange={e => updateCartPrice(index, e.target.value)}
                                  onFocus={e => {
                                    if (e.target.value === '0' || item.price === 0 || item.price === '0') {
                                      updateCartPrice(index, '')
                                    } else {
                                      e.target.select()
                                    }
                                  }}
                                  placeholder='0'
                                  className='w-20 text-right h-8 text-sm ml-auto'
                                />
                              </TableCell>
                              <TableCell className='text-right'>
                                <div className='flex items-center justify-end gap-1'>
                                  <Button variant='outline' size='icon' className='h-7 w-7' onClick={() => bumpCartQty(index, -1)}>
                                    <Minus className='h-3 w-3' />
                                  </Button>
                                  <span className='w-8 text-center text-sm font-bold'>{item.quantity}</span>
                                  <Button variant='outline' size='icon' className='h-7 w-7' onClick={() => bumpCartQty(index, +1)}>
                                    <Plus className='h-3 w-3' />
                                  </Button>
                                </div>
                              </TableCell>
                              <TableCell className='text-right text-sm font-bold text-foreground'>৳{fmt(nn(item.price) * item.quantity)}</TableCell>
                              <TableCell>
                                <Button variant='ghost' size='icon' className='h-8 w-8 text-destructive hover:bg-destructive/10' onClick={() => removeFromCart(index)}>
                                  <Trash2 className='h-4 w-4' />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Mobile Cart Cards View */}
                    <div className='block md:hidden divide-y divide-border/60'>
                      {cartItems.map((item, index) => (
                        <div key={`${item.productId}-${item.variantId || ''}-${index}`} className='p-3 space-y-2.5'>
                          <div className='flex items-start justify-between gap-2'>
                            <div className='flex items-center gap-2.5 min-w-0 flex-1'>
                              {item.product.images && Array.isArray(item.product.images) && item.product.images[0] ? (
                                <SafeImage src={mediaUrl(item.product.images[0])} alt='' className='h-11 w-11 rounded-lg border object-cover shrink-0' thumbWidth={48} thumbHeight={48} />
                              ) : (
                                <div className='h-11 w-11 rounded-lg border bg-muted flex items-center justify-center shrink-0'>
                                  <Package className='h-5 w-5 text-muted-foreground' />
                                </div>
                              )}
                              <div className='min-w-0 flex-1'>
                                <p className='text-xs font-semibold text-foreground line-clamp-1'>{item.product.name}</p>
                                {(item.variant?.name || item.variantId) && (
                                  <Badge variant='outline' className='text-[10px] mt-0.5 font-normal'>
                                    {item.variant?.name || item.variant?.sku || 'Variant'}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='h-8 w-8 text-destructive hover:bg-destructive/10 shrink-0'
                              onClick={() => removeFromCart(index)}
                            >
                              <Trash2 className='h-4 w-4' />
                            </Button>
                          </div>

                          <div className='flex items-center justify-between gap-2 pt-1 border-t border-border/40 text-xs'>
                            <div className='flex items-center gap-1.5'>
                              <span className='text-muted-foreground'>৳</span>
                              <Input
                                type='number'
                                step='0.01'
                                min='0'
                                value={item.price === 0 || item.price === '0' || item.price === '' ? '' : item.price}
                                onChange={e => updateCartPrice(index, e.target.value)}
                                onFocus={e => {
                                  if (e.target.value === '0' || item.price === 0 || item.price === '0') {
                                    updateCartPrice(index, '')
                                  } else {
                                    e.target.select()
                                  }
                                }}
                                placeholder='0'
                                className='w-20 text-right h-8 text-xs font-medium'
                              />
                            </div>

                            <div className='flex items-center gap-1'>
                              <Button
                                variant='outline'
                                size='icon'
                                className='h-8 w-8'
                                onClick={() => bumpCartQty(index, -1)}
                              >
                                <Minus className='h-3.5 w-3.5' />
                              </Button>
                              <span className='w-7 text-center text-xs font-bold'>{item.quantity}</span>
                              <Button
                                variant='outline'
                                size='icon'
                                className='h-8 w-8'
                                onClick={() => bumpCartQty(index, +1)}
                              >
                                <Plus className='h-3.5 w-3.5' />
                              </Button>
                            </div>

                            <div className='text-right'>
                              <span className='font-bold text-sm text-foreground'>৳{fmt(nn(item.price) * item.quantity)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Order Notes Card */}
            <Card className='overflow-hidden border border-border/70 shadow-xs rounded-xl'>
              <CardHeader className='bg-muted/30 border-b border-border/50 py-3 px-4 sm:py-3.5 sm:px-6'>
                <div className='flex items-center gap-2.5'>
                  <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0'>
                    <FileText className='h-4 w-4' />
                  </div>
                  <div>
                    <CardTitle className='text-sm sm:text-base font-semibold tracking-tight text-foreground'>
                      Order Notes
                    </CardTitle>
                    <p className='text-xs text-muted-foreground mt-0.5'>Invoice instructions and internal staff notes</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-4 sm:p-6 space-y-3.5'>
                <div>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Customer Notes (Printed on Customer Invoice)</Label>
                  <Textarea
                    value={customerNotes}
                    onChange={e => setCustomerNotes(e.target.value)}
                    rows={2}
                    className='text-sm resize-none'
                    placeholder='Special delivery instructions, timing or customer requests...'
                  />
                </div>
                <div>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Office Notes (Internal Staff Only)</Label>
                  <Textarea
                    value={officeNotes}
                    onChange={e => setOfficeNotes(e.target.value)}
                    rows={2}
                    className='text-sm resize-none'
                    placeholder='Internal remarks, confirmation details, packaging notes...'
                  />
                  <p className='text-[11px] text-muted-foreground mt-1'>
                    Internal note will be automatically combined with the system default office note.
                  </p>
                </div>
              </CardContent>
            </Card>

          </div>

          {/* ════ RIGHT COLUMN (Sidebar: Summary, Payment, Attribution) ════ */}
          <div className='xl:col-span-5 2xl:col-span-4 space-y-4 sm:space-y-6'>

            {/* Order Summary Card */}
            <Card className='overflow-hidden border border-border/70 shadow-xs rounded-xl'>
              <CardHeader className='bg-muted/30 border-b border-border/50 py-3 px-4 sm:py-3.5 sm:px-6'>
                <div className='flex items-center gap-2.5'>
                  <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0'>
                    <Receipt className='h-4 w-4' />
                  </div>
                  <div>
                    <CardTitle className='text-sm sm:text-base font-semibold tracking-tight text-foreground'>
                      Order Summary
                    </CardTitle>
                    <p className='text-xs text-muted-foreground mt-0.5'>Pricing, delivery charges, and discounts</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-4 sm:p-6 space-y-4'>
                <div className='bg-muted/50 rounded-xl p-3.5 space-y-2 text-sm border border-border/40'>
                  <div className='flex justify-between items-center'>
                    <span className='text-muted-foreground'>Subtotal</span>
                    <span className='font-medium text-foreground'>৳{fmt(subtotal)}</span>
                  </div>
                  <div className='flex justify-between items-center'>
                    <span className='text-muted-foreground'>Delivery Charge</span>
                    <span className='font-medium text-foreground'>+৳{fmt(parseFloat(shippingCharge) || 0)}</span>
                  </div>
                  {discountValue > 0 && (
                    <div className='flex justify-between items-center text-emerald-600 dark:text-emerald-400 font-medium'>
                      <span>Discount {discountType === 'percentage' ? `(${parseFloat(discount) || 0}%)` : '(Flat)'}</span>
                      <span>-৳{fmt(discountValue)}</span>
                    </div>
                  )}
                  <div className='flex justify-between items-center font-bold text-base pt-2.5 border-t border-border/60'>
                    <span>Total Amount</span>
                    <span className='text-primary text-lg font-extrabold'>৳{fmt(total)}</span>
                  </div>
                  {paymentMode === 'partial' && parseFloat(partialAmount) > 0 && (
                    <div className='pt-2 border-t border-dashed border-border/60 space-y-1.5'>
                      <div className='flex justify-between items-center text-xs text-emerald-600 dark:text-emerald-400 font-medium'>
                        <span>Advance Paid (Now)</span>
                        <span>-৳{fmt(parseFloat(partialAmount) || 0)}</span>
                      </div>
                      <div className='flex justify-between items-center text-sm font-bold text-amber-600 dark:text-amber-500 bg-amber-500/10 dark:bg-amber-500/15 p-2 rounded-lg border border-amber-500/20'>
                        <span>Due on Delivery (COD)</span>
                        <span className='text-base font-extrabold'>
                          ৳{fmt(Math.max(0, total - (parseFloat(partialAmount) || 0)))}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className='grid grid-cols-1 sm:grid-cols-2 gap-3.5'>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Shipping Charge (৳)</Label>
                    <Input
                      type='number'
                      step='0.01'
                      min='0'
                      value={shippingCharge === '0' ? '' : shippingCharge}
                      onChange={e => {
                        setShippingChargeManuallyEdited(true)
                        setShippingCharge(e.target.value)
                      }}
                      onFocus={e => {
                        if (e.target.value === '0' || shippingCharge === '0') {
                          setShippingCharge('')
                        } else {
                          e.target.select()
                        }
                      }}
                      placeholder='0'
                      className='h-9.5 text-sm'
                    />
                    <p className='text-[11px] text-muted-foreground mt-1'>
                      {shippingChargeManuallyEdited ? 'Custom rate applied' : 'Auto-calculated from city'}
                    </p>
                  </div>
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Discount</Label>
                    <div className='flex gap-1.5'>
                      <Input
                        type='number'
                        step='0.01'
                        min='0'
                        value={discount === '0' ? '' : discount}
                        onChange={e => setDiscount(e.target.value)}
                        onFocus={e => {
                          if (e.target.value === '0' || discount === '0') {
                            setDiscount('')
                          } else {
                            e.target.select()
                          }
                        }}
                        className='h-9.5 text-sm flex-1'
                        placeholder='0'
                      />
                      <div className='flex border rounded-lg p-0.5 bg-muted/40 shrink-0'>
                        <Button
                          type='button'
                          variant={discountType === 'flat' ? 'default' : 'ghost'}
                          size='sm'
                          className='h-8 px-2.5 text-xs'
                          onClick={() => setDiscountType('flat')}
                        >
                          Flat
                        </Button>
                        <Button
                          type='button'
                          variant={discountType === 'percentage' ? 'default' : 'ghost'}
                          size='sm'
                          className='h-8 px-2.5 text-xs'
                          onClick={() => setDiscountType('percentage')}
                        >
                          %
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Exchange paid-confirm (phase-1 contract): pre-filled from the
              ledger, CONFIRM required, reason required on adjustment. */}
            {isExchange && editOrder && (
              <ExchangePaidConfirm
                recordedPaid={recordedPaid}
                exchangeTotal={total}
                paid={paid}
                reason={paidReason}
                confirmed={paidConfirmedChecked}
                onPaid={setPaid}
                onReason={setPaidReason}
                onConfirmed={setPaidConfirmedChecked}
              />
            )}

            {/* Exchange settlement preview (§4) */}
            {isExchange && settlementPreview && (
              <Card className='overflow-hidden border border-primary/30 shadow-xs rounded-xl'>
                <CardHeader className='bg-primary/5 border-b border-primary/20 py-3 px-4 sm:py-3.5 sm:px-6'>
                  <div className='flex items-center gap-2.5'>
                    <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0'>
                      <ArrowRightLeft className='h-4 w-4' />
                    </div>
                    <div>
                      <CardTitle className='text-sm sm:text-base font-semibold tracking-tight text-foreground'>
                        Settlement
                      </CardTitle>
                      <p className='text-xs text-muted-foreground mt-0.5'>
                        Settled against what the customer already paid
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className='p-4 sm:p-6 space-y-3'>
                  <div className='bg-muted/50 rounded-xl p-3.5 space-y-2 text-sm border border-border/40'>
                    <div className='flex justify-between items-center'>
                      <span className='text-muted-foreground'>Paid on {settlementPreview.displayId}</span>
                      <span className='font-medium text-foreground'>৳{fmt(nn(settlementPreview.originalPaid))}</span>
                    </div>
                    <div className='flex justify-between items-center'>
                      <span className='text-muted-foreground'>This exchange</span>
                      <span className='font-medium text-foreground'>৳{fmt(total)}</span>
                    </div>
                    <div className='flex justify-between items-center font-bold text-base pt-2.5 border-t border-border/60'>
                      <span>To collect</span>
                      <span className='text-primary text-lg font-extrabold'>
                        ৳{fmt(Math.max(0, total - nn(settlementPreview.creditAvailable)))}
                      </span>
                    </div>
                    {total < nn(settlementPreview.creditAvailable) && (
                      <div className='flex justify-between items-center text-xs font-semibold text-amber-600 dark:text-amber-400 pt-1.5 border-t border-dashed border-border/60'>
                        <span>Refund due (unused credit)</span>
                        <span>৳{fmt(nn(settlementPreview.creditAvailable) - total)}</span>
                      </div>
                    )}
                  </div>
                  <p className='text-[11px] text-muted-foreground leading-relaxed'>
                    Only the difference above is collected from the customer — the amount already paid
                    on the original is never collected again. Any unused credit is raised as a refund
                    against the original.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Payment Details Card */}
            <Card className='overflow-hidden border border-border/70 shadow-xs rounded-xl'>
              <CardHeader className='bg-muted/30 border-b border-border/50 py-3 px-4 sm:py-3.5 sm:px-6'>
                <div className='flex items-center gap-2.5'>
                  <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0'>
                    <CreditCard className='h-4 w-4' />
                  </div>
                  <div>
                    <CardTitle className='text-sm sm:text-base font-semibold tracking-tight text-foreground'>
                      Payment Details
                    </CardTitle>
                    <p className='text-xs text-muted-foreground mt-0.5'>Select payment gateway and payment mode</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-4 sm:p-6 space-y-3.5'>
                {!showCollectedRows && (
                  <PaymentGatewayAccountSelect
                    gatewayCode={paymentMethod}
                    accountId={paymentAccountId}
                    onChange={(next) => {
                      setPaymentMethod(next.gatewayCode)
                      setPaymentAccountId(next.accountId)
                    }}
                  />
                )}
                <div className={showCollectedRows ? '' : 'sm:w-1/2'}>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Payment Mode</Label>
                  <select
                    className='w-full h-9.5 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
                    value={paymentMode}
                    onChange={e => setPaymentMode(e.target.value as any)}
                  >
                    <option value='cod'>Cash on Delivery (COD)</option>
                    <option value='full'>Full Payment</option>
                    <option value='partial'>Partial Payment (Advance)</option>
                  </select>
                </div>
                {paymentMode === 'partial' && !showCollectedRows && (
                  <div className='p-3.5 bg-muted/40 rounded-xl border border-border/60 space-y-2'>
                    <div>
                      <Label className='text-xs font-semibold block text-foreground mb-1'>Advance Paid Amount (৳) *</Label>
                      <Input
                        type='number'
                        step='0.01'
                        min='0'
                        value={partialAmount === '0' ? '' : partialAmount}
                        onChange={e => setPartialAmount(e.target.value)}
                        onFocus={e => {
                          if (e.target.value === '0' || partialAmount === '0') {
                            setPartialAmount('')
                          } else {
                            e.target.select()
                          }
                        }}
                        className='h-9.5 text-sm bg-background'
                        placeholder='0'
                      />
                    </div>
                    <p className='text-xs text-muted-foreground leading-relaxed'>
                      Advance of ৳{fmt(parseFloat(partialAmount) || 0)} will be recorded as paid now. Balance of ৳{fmt(Math.max(0, total - (parseFloat(partialAmount) || 0)))} will be assigned to courier collection.
                    </p>
                  </div>
                )}
                {showCollectedRows && (
                  <CreatePaymentsSection
                    rows={collectedRows}
                    onRowsChange={setCollectedRows}
                    txnRequired={txnRequiredFor}
                    total={total}
                    creditBalance={creditBalance}
                    applyCredit={applyCredit}
                    onApplyCreditChange={setApplyCredit}
                    creditAmount={creditAmount}
                    onCreditAmountChange={setCreditAmount}
                  />
                )}
              </CardContent>
            </Card>

            {/* Sales Channel & Attribution Card */}
            <Card className='overflow-hidden border border-border/70 shadow-xs rounded-xl'>
              <CardHeader className='bg-muted/30 border-b border-border/50 py-3 px-4 sm:py-3.5 sm:px-6'>
                <div className='flex items-center gap-2.5'>
                  <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0'>
                    <Layers className='h-4 w-4' />
                  </div>
                  <div>
                    <CardTitle className='text-sm sm:text-base font-semibold tracking-tight text-foreground'>
                      Sales Attribution
                    </CardTitle>
                    <p className='text-xs text-muted-foreground mt-0.5'>Order origin channel and acquisition source</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className='p-4 sm:p-6 space-y-3.5'>
                <div>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>Channel</Label>
                  <select
                    className='w-full h-9.5 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
                    value={channel}
                    onChange={e => {
                      const val = e.target.value as ChannelV2
                      setChannel(val)
                      if (val === 'MESSAGING') setSourceSlug('facebook')
                      else setSourceSlug('')
                      if (val === 'POS') setAcquisitionType('')
                    }}
                  >
                    {CHANNEL_OPTIONS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>

                {channel !== 'POS' && (
                  <div>
                    <Label className='text-xs font-medium text-muted-foreground mb-1 block'>
                      Channel Entity <span className='text-muted-foreground/70 font-normal'>(optional)</span>
                    </Label>
                    <Input
                      value={channelEntity}
                      onChange={e => setChannelEntity(e.target.value)}
                      className='h-9.5 text-sm'
                      placeholder={
                        channel === 'WEBSITE' ? 'Auto-filled from connected store'
                        : channel === 'MESSAGING' ? 'Page or account'
                        : 'Office'
                      }
                    />
                  </div>
                )}

                <div>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>
                    Source <span className='text-muted-foreground/70 font-normal'>(optional)</span>
                  </Label>
                  <select
                    className='w-full h-9.5 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
                    value={sourceSlug}
                    onChange={e => setSourceSlug(e.target.value)}
                  >
                    <option value=''>— none —</option>
                    {sourceOptions.map(s => (
                      <option key={s.slug} value={s.slug}>{s.displayName}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label className='text-xs font-medium text-muted-foreground mb-1 block'>
                    Acquisition Type <span className='text-muted-foreground/70 font-normal'>(optional)</span>
                  </Label>
                  <select
                    className='w-full h-9.5 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
                    value={acquisitionType}
                    onChange={e =>
                      setAcquisitionType(e.target.value as AcquisitionType | '')
                    }
                  >
                    <option value=''>— not set —</option>
                    {ACQUISITION_OPTIONS.map(a => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* Desktop submit CTA */}
            <div className='hidden sm:block pt-1'>
              <Button
                className='w-full h-11 text-sm font-semibold shadow-xs'
                size='lg'
                onClick={handleSubmit}
                disabled={submitMut.isPending || itemsBlocked || !paidValid}
              >
                {submitMut.isPending
                  ? <Loader2 className='h-4 w-4 animate-spin mr-2' />
                  : isEdit ? <Save className='h-4 w-4 mr-2' /> : <Plus className='h-4 w-4 mr-2' />}
                {submitLabel}
              </Button>
            </div>

          </div>
        </div>
      </Main>

      {/* ── Mobile Sticky Bottom Action Bar ── */}
      <div className='fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-md border-t border-border/70 p-3 sm:hidden shadow-lg flex items-center justify-between gap-3'>
        <div className='min-w-0 flex-1'>
          <span className='text-[10px] uppercase font-semibold text-muted-foreground block tracking-wider leading-none'>Total</span>
          <span className='text-base font-extrabold text-primary leading-tight block mt-0.5'>৳{fmt(total)}</span>
          {paymentMode === 'partial' && parseFloat(partialAmount) > 0 && (
            <span className='text-[10px] text-amber-600 dark:text-amber-500 font-semibold block leading-none truncate'>
              Due: ৳{fmt(Math.max(0, total - (parseFloat(partialAmount) || 0)))}
            </span>
          )}
        </div>
        <Button
          className='h-11 px-6 font-semibold text-sm shadow-sm shrink-0'
          onClick={handleSubmit}
          disabled={submitMut.isPending || itemsBlocked || !paidValid}
        >
          {submitMut.isPending
            ? <Loader2 className='h-4 w-4 animate-spin mr-1.5' />
            : isEdit ? <Save className='h-4 w-4 mr-1.5' /> : <Plus className='h-4 w-4 mr-1.5' />}
          {submitLabel}
        </Button>
      </div>

      <Dialog open={!!selectedProductForVariants} onOpenChange={() => setSelectedProductForVariants(null)}>
        <DialogContent className='max-w-md w-[95vw] sm:w-full max-h-[85vh] flex flex-col p-4 sm:p-6'>
          <DialogHeader className='pb-2 text-left'>
            <DialogTitle className='text-base sm:text-lg'>Select Variant</DialogTitle>
            <DialogDescription className='text-xs'>
              {selectedProductForVariants?.name}
            </DialogDescription>
          </DialogHeader>
          <div className='flex-1 overflow-y-auto space-y-2 py-2 -mx-1 px-1 max-h-[55vh] divide-y divide-border/40'>
            {selectedProductForVariants?.variants?.map((v: any) => {
              const label = variantLabel(v)
              const price = v.salePrice ?? v.price ?? ep(selectedProductForVariants)
              const thumb = variantThumbUrl(v, selectedProductForVariants)
              return (
                <div
                  key={v.id}
                  className='flex items-center justify-between p-2.5 sm:p-3 border rounded-lg hover:bg-muted/70 active:bg-muted transition-colors cursor-pointer gap-2.5 min-h-[52px]'
                  onClick={() => {
                    addToCart(selectedProductForVariants, v)
                    setSelectedProductForVariants(null)
                    toast.success(`${selectedProductForVariants.name} (${label}) added to cart`)
                  }}
                >
                  <div className='flex items-center gap-2.5 min-w-0 flex-1'>
                    {thumb ? (
                      <SafeImage src={mediaUrl(thumb)} alt='' className='h-10 w-10 rounded-md border object-cover shrink-0' thumbWidth={48} thumbHeight={48} />
                    ) : (
                      <div className='h-10 w-10 rounded-md border bg-muted flex items-center justify-center shrink-0'>
                        <Package className='h-5 w-5 text-muted-foreground' />
                      </div>
                    )}
                    <div className='min-w-0 flex-1'>
                      <p className='text-sm font-semibold text-foreground truncate'>{label}</p>
                      <p className='text-xs font-mono text-muted-foreground truncate'>{v.sku || 'No SKU'}</p>
                    </div>
                  </div>
                  <div className='text-right shrink-0'>
                    <div className='text-sm font-bold text-primary'>৳{fmt(price)}</div>
                    <Button size='sm' variant='secondary' className='h-6 text-[11px] px-2 mt-1'>
                      + Select
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          <DialogFooter className='pt-2 border-t flex flex-row justify-end'>
            <Button variant='outline' size='sm' className='w-full sm:w-auto' onClick={() => setSelectedProductForVariants(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Create Order page — the same form, empty, posting a new order. */
export function CreateOrder() {
  return <OrderFormPage mode='create' />
}

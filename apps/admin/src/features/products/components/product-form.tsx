import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { X, Plus, Loader2, Package, Image as ImageIcon, Pencil, Check, GripVertical, Star, Trash2 } from 'lucide-react'
import { appUrl } from '@/lib/utils'
import { appHref } from '@/lib/app-href'
import { SafeImage } from '@/components/safe-image'
import { productsApi, type ProductResponse } from '../api'
import { CustomizationEditor } from './customization-editor'
import { useLicenseStore } from '@/stores/license-store'
import { productOverrideApi } from '@/features/gateways/api'
import { MediaPicker } from '@/components/media-picker'
import { MultiSearchableSelect, type MultiSearchableOption } from '@/components/ui/multi-searchable-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { TagInput } from '@/components/ui/tag-input'
import { ManagedStockAdjustmentModal } from './managed-stock-adjustment-modal'
const imgUrl = appUrl
import { apiClient } from '@/lib/api-client'
import { useInventoryManagement } from '@/features/inventory/hooks/use-inventory-management'
import { defaultAvailabilityMode } from '@/features/products/lib/availability-defaults'
import { isSupportedVideoUrl, cleanDetailRows, cleanDescriptionSections, type DetailRow } from '@/features/products/lib/pdp-fields'
import { attributesApi } from '@/features/attributes/api'
import { categoriesApi } from '@/features/categories/api'
import { brandsApi } from '@/features/brands/api'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, rectSortingStrategy, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type Props = { open: boolean; onOpenChange: (v: boolean) => void; currentRow?: ProductResponse; mode: 'add' | 'edit' | 'duplicate' }

// ---- Unsaved-draft persistence (localStorage) ----
// A half-finished product creation/duplication is auto-saved as a server
// draft (visible in the product list's Drafts tab), so closing the dialog
// never loses work. No local resume prompt — drafts are managed there.
export function ProductForm({ open, onOpenChange, currentRow, mode }: Props) {
  const queryClient = useQueryClient()
  const isEdit = mode === 'edit'
  const isDuplicate = mode === 'duplicate'
  const isDraftEdit = isEdit && currentRow?.status === 'draft'
  const [tab, setTab] = useState('general')
  const [createdProductId, setCreatedProductId] = useState<string | null>(null)
  const [serverDraftId, setServerDraftId] = useState<string | null>(null)

  const { data: fullProduct, isError: fullProductError } = useQuery({
    queryKey: ['product', currentRow?.id || createdProductId],
    queryFn: () => productsApi.get(currentRow?.id || createdProductId!).then(r => r.data),
    enabled: (isEdit && !!currentRow?.id) || !!createdProductId,
  })

  const { data: cats } = useQuery({ queryKey: ['categories'], queryFn: () => categoriesApi.list().then(r => r.data) })
  const { data: brands } = useQuery({ queryKey: ['brands'], queryFn: () => brandsApi.list(true).then((r: any) => Array.isArray(r.data) ? r.data : r.data?.data || []) })
  const { data: attrs } = useQuery({ queryKey: ['attributes'], queryFn: () => attributesApi.list().then(r => r.data) })
  const { data: sizeCharts } = useQuery({ queryKey: ['size-charts'], queryFn: () => apiClient.get('/size-charts').then(r => r.data) })
  const { data: overrideData } = useQuery({
    queryKey: ['product-overrides', currentRow?.id],
    queryFn: () => productOverrideApi.list(currentRow!.id).then(r => (Array.isArray(r.data) ? r.data : r.data?.data || [])),
    enabled: isEdit && !!currentRow?.id,
  })

  const { data: imEnabled } = useInventoryManagement()

  const categoryOptions = React.useMemo(() => {
    const flat = Array.isArray(cats) ? cats : []
    const map = new Map<string, any>()
    for (const c of flat) map.set(c.id, { id: c.id, name: c.name })
    const children = new Map<string, any[]>()
    const roots: any[] = []
    for (const c of flat) {
      if (c.parentId && map.has(c.parentId)) {
        const list = children.get(c.parentId) || []
        list.push(c.id)
        children.set(c.parentId, list)
      } else {
        roots.push(c.id)
      }
    }
    const result: MultiSearchableOption[] = []
    const walk = (ids: string[], depth: number) => {
      for (const id of ids) {
        const c = map.get(id)
        if (!c) continue
        result.push({ id: c.id, label: c.name, depth })
        const childIds = children.get(id)
        if (childIds) walk(childIds, depth + 1)
      }
    }
    walk(roots, 0)
    return result
  }, [cats])

  const brandOptions = useMemo(() => {
    return (brands || []).map((b: any) => ({ id: b.id, label: b.name }))
  }, [brands])

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugError, setSlugError] = useState('')
  const [slugChecking, setSlugChecking] = useState(false)
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null)
  const [skuChecking, setSkuChecking] = useState(false)
  const [skuAvailable, setSkuAvailable] = useState<boolean | null>(null)
  const [type, setType] = useState<string>('simple')
  const [desc, setDesc] = useState('')
  const [shortDesc, setShortDesc] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [videoUrlError, setVideoUrlError] = useState('')
  const [detailRows, setDetailRows] = useState<DetailRow[]>([])
  const [dsTagline, setDsTagline] = useState('')
  const [dsBenefits, setDsBenefits] = useState<string[]>([])
  const [dsSpecs, setDsSpecs] = useState('')
  const [dsTip, setDsTip] = useState('')
  const [basePrice, setBasePrice] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [sku, setSku] = useState('')
  const [stock, setStock] = useState('0')
  const [lowStockQty, setLowStockQty] = useState('')
  const [weightGram, setWeightGram] = useState('')
  const [customizationGroups, setCustomizationGroups] = useState<any[]>([])
  const hasCustomizationFeature = useLicenseStore((s) => s.hasFeature)('product-customization')
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [brandId, setBrandId] = useState<string>('')
  const [isActive, setIsActive] = useState(true)
  const [isFeatured, setIsFeatured] = useState(false)
  const [availabilityMode, setAvailabilityMode] = useState<string>('MANAGED_STOCK')
  const [standardCost, setStandardCost] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [tags, setTags] = useState<string>('')
  const [sizeChartId, setSizeChartId] = useState<string>('')
  const [categoryDefaultChart, setCategoryDefaultChart] = useState<{ id: string; name: string | null } | null>(null)
  const sizeChartOptions = useMemo(() => {
    const defaultLabel = categoryDefaultChart?.id ? 'None (use default)' : 'None';
    return [
      { id: '', label: defaultLabel },
      ...(Array.isArray(sizeCharts) ? sizeCharts : (sizeCharts as any)?.data || []).map((sc: any) => ({
        id: sc.id,
        label: sc.id === categoryDefaultChart?.id ? `${sc.name} (default)` : sc.name,
      })),
    ];
  }, [sizeCharts, categoryDefaultChart]);
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDesc, setSeoDesc] = useState('')
  const [seoKeywords, setSeoKeywords] = useState('')

  const [selectedAttrs, setSelectedAttrs] = useState<string[]>([])
  const [selectedValues, setSelectedValues] = useState<Record<string, string[]>>({})
  const [newValueInput, setNewValueInput] = useState<Record<string, string>>({})
  const [defaultVariantStock, setDefaultVariantStock] = useState('0')

  const [uploading] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [variantPickerOpen, setVariantPickerOpen] = useState(false)
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)
  const [regenerateConfirm, setRegenerateConfirm] = useState(false)
  const [clearVariantConfirm, setClearVariantConfirm] = useState(false)
  const [localVariants, setLocalVariants] = useState<any[]>([])
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false)
  const [showReviewGuard, setShowReviewGuard] = useState(false)
  const [reviewGuardItems, setReviewGuardItems] = useState<string[]>([])
  const [variantImgMgr, setVariantImgMgr] = useState<{ variantId: string; images: string[] } | null>(null)
  const [variantImgGalleryOpen, setVariantImgGalleryOpen] = useState(false)
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false)
  const [bulkPrice, setBulkPrice] = useState('')
  const [bulkSalePrice, setBulkSalePrice] = useState('')
  const [bulkStandardCost, setBulkStandardCost] = useState('')
  const [bulkOverridePrice, setBulkOverridePrice] = useState(false)
  const [bulkOverrideSalePrice, setBulkOverrideSalePrice] = useState(false)
  const [bulkOverrideStandardCost, setBulkOverrideStandardCost] = useState(false)
  const [isBulkUpdating, setIsBulkUpdating] = useState(false)
  const [overrideFormState, setOverrideFormState] = useState<Record<string, { enabled: boolean; partialFixedAmount: string; partialPercentage: string }>>({
    FULL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
    PARTIAL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
    CASH_ON_DELIVERY: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
  })

  const populateKeyRef = useRef<string | null>(null)
  const prevOpenRef = useRef(false)
  const prevSku = useRef(sku)
  const slugTouchedRef = useRef(false)
  const openStateRef = useRef<any>(null)
  const notifySaveErrorRef = useRef(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  const notifySaveErrorMsgRef = useRef<string | null>(null)
  const notifySaveErrorAtRef = useRef(0)
  const notifyDraftSaveFailure = (e: any, force = false) => {
    console.error('[draft-save]', e?.response?.data || e?.message || e)
    const raw = e?.response?.data?.message
    const msg = Array.isArray(raw) ? raw.join('. ') : (raw || 'The draft could not be saved to the server')
    // Throttle repeats of the SAME cause (autosave ticks every edit), but
    // never latch-suppress forever: a persistent failure re-toasts every
    // 30s, and an explicit/manual save always reports.
    if (!force && notifySaveErrorMsgRef.current === msg && Date.now() - notifySaveErrorAtRef.current < 30000) return
    notifySaveErrorMsgRef.current = msg
    notifySaveErrorAtRef.current = Date.now()
    notifySaveErrorRef.current = true
    toast.error(`Draft not saved: ${msg}`)
  }

  // Single-flight server-draft saver shared by the autosave timer and the
  // exit flush: a flush arriving while an autosave create is still in flight
  // used to fire a SECOND createDraft (orphan "...-2" draft). Now the flush
  // only records the latest snapshot; it is written once the in-flight
  // request settles, against the draft id that request created.
  const draftSaveInFlightRef = useRef(false)
  const pendingDraftPayloadRef = useRef<any | null>(null)
  const queueDraftSave = (payload: any) => {
    if (draftSaveInFlightRef.current) {
      pendingDraftPayloadRef.current = payload
      return
    }
    const targetId = serverDraftId || (isDraftEdit && currentRow ? currentRow.id : null)
    draftSaveInFlightRef.current = true
    const req = targetId
      ? productsApi.updateDraft(targetId, { ...payload, isActive: false })
      : productsApi.createDraft({ ...payload, isActive: false })
    req.then((res: any) => {
      notifySaveErrorRef.current = false
      const created = res.data || res
      if (!targetId && created?.id) setServerDraftId(created.id)
      queryClient.invalidateQueries({ queryKey: ['products'] })
    }).catch((e: any) => notifyDraftSaveFailure(e))
      .finally(() => {
        draftSaveInFlightRef.current = false
        const pending = pendingDraftPayloadRef.current
        pendingDraftPayloadRef.current = null
        if (pending) queueDraftSave(pending)
      })
  }
  const hasSavedRef = useRef(false)
  const availabilityModeTouchedRef = useRef(false)

  // Smart default: global Inventory Management setting determines the
  // new-product availability mode (IM on → INVENTORY_CONTROLLED, off →
  // MANAGED_STOCK). Applies only for a brand-new simple product whose mode
  // the user has NOT explicitly touched — editing always keeps the stored mode.
  useEffect(() => {
    const def = defaultAvailabilityMode({
      imEnabled,
      type,
      userTouched: availabilityModeTouchedRef.current,
      hasExistingRow: !!currentRow,
      hasDraft: false,
    })
    if (!open || def === undefined) return
    setAvailabilityMode(def)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, imEnabled])

  // Snapshot of all form fields (used by auto-save and the exit flush) and a
  // helper deciding whether the user has changed anything since the dialog
  // opened — while untouched, the persistence layers skip, so an empty form
  // never creates or overwrites any draft row.
  const snapshotOf = () => ({
    mode, name, slug, type, desc, shortDesc, videoUrl, detailRows,
    dsTagline, dsBenefits, dsSpecs, dsTip, basePrice, salePrice, sku,
    stock, lowStockQty, weightGram, customizationGroups, categoryIds, brandId, isActive, isFeatured,
    availabilityMode, standardCost, images, tags, sizeChartId,
    seoTitle, seoDesc, seoKeywords, selectedAttrs, selectedValues, localVariants,
  })
  const hasFormContent = (s: any) =>
    s && (!!s.name?.trim() || !!s.sku || Number(s.basePrice) > 0 ||
      (Array.isArray(s.images) && s.images.length > 0) ||
      !!s.shortDesc?.trim() || !!s.desc?.trim() || !!s.videoUrl?.trim() ||
      (Array.isArray(s.detailRows) && cleanDetailRows(s.detailRows).length > 0) ||
      !!s.dsTagline?.trim() || (Array.isArray(s.dsBenefits) && s.dsBenefits.some((b: string) => b?.trim())) ||
      !!s.dsSpecs?.trim() || !!s.dsTip?.trim() ||
      (Array.isArray(s.localVariants) && s.localVariants.length > 0))
  const formUntouched = () => {
    try {
      const s = snapshotOf()
      if (JSON.stringify(openStateRef.current) === JSON.stringify(s)) return true
      // A blank form (e.g. just the availability default applied after open)
      // must never count as "changed" — otherwise the auto-save would wipe a
      // stored draft before the user has a chance to resume it.
      return !hasFormContent(s)
    } catch {
      return false
    }
  }

  // The untouched-baseline for a populated form, built from the SOURCE object
  // (an effect cannot read the state it just queued). Mirrors every setter in
  // the population effect, including the `[type]` effect that zeroes stock for
  // variable products. `localVariants` is passed in because the duplicate
  // suffix must be identical between the state and the baseline.
  const baselineFromSource = (src: any, localVariantList: any[]) => ({
    mode, name: src.name || '', slug: src.slug || '', type: src.type || 'simple',
    desc: src.description || '', shortDesc: src.shortDesc || '', videoUrl: src.videoUrl || '',
    detailRows: Array.isArray(src.detailRows) ? src.detailRows : [],
    dsTagline: src.descriptionSections?.tagline || '',
    dsBenefits: Array.isArray(src.descriptionSections?.benefits) ? src.descriptionSections.benefits : [],
    dsSpecs: src.descriptionSections?.specifications || '',
    dsTip: src.descriptionSections?.stylingTip || '',
    basePrice: String(src.basePrice ?? ''),
    salePrice: src.salePrice != null ? String(src.salePrice) : '',
    sku: src.sku || '',
    stock: src.type === 'variable' && type !== 'variable' ? '0' : String(src.managedStockQuantity ?? 0),
    lowStockQty: src.lowStockQty != null ? String(src.lowStockQty) : '',
    weightGram: src.weightGram != null ? String(src.weightGram) : '',
    customizationGroups: Array.isArray(src.customizations) ? src.customizations : [],
    categoryIds: src.productCategories?.map((pc: any) => pc.categoryId) || (src.categoryId ? [src.categoryId] : []),
    brandId: src.brandId || '',
    isActive: src.isActive ?? true,
    isFeatured: src.isFeatured ?? false,
    availabilityMode: src.availabilityMode || (src.manageStock ? 'MANAGED_STOCK' : 'INVENTORY_CONTROLLED'),
    standardCost: src.standardCost != null ? String(src.standardCost) : '',
    images: dedupUrls(Array.isArray(src.images) ? src.images : []),
    tags: Array.isArray(src.tags) ? src.tags.join(', ') : '',
    sizeChartId: src.sizeChartId || '',
    seoTitle: src.seoMeta?.title || '',
    seoDesc: src.seoMeta?.description || '',
    seoKeywords: src.seoMeta?.keywords || '',
    selectedAttrs: [] as string[],
    selectedValues: {} as Record<string, string[]>,
    localVariants: localVariantList,
  })

  // Opening the dialog always starts a fresh create/duplicate session: the
  // draft surface is the Drafts tab, so no resume prompt here. Clean up the
  // legacy localStorage draft keys from the previous system, if present.
  useEffect(() => {
    if (!open || isEdit) return
    hasSavedRef.current = false
    setServerDraftId(null)
    openStateRef.current = null // captured fresh after row-load settles
    try {
      localStorage.removeItem('ecomate-product-form-draft')
      localStorage.removeItem('ecomate-product-server-draft-id')
    } catch {
      /* ignore */
    }
  }, [open, isEdit])

  // Persistent server-side draft: the first meaningful change creates a real
  // (hidden) draft product record; later changes update that same record, so
  // a half-finished product survives closing, other devices and browser
  // storage resets. Publishing consumes the record into a live product.
  useEffect(() => {
    if (!open || isEdit || hasSavedRef.current || formUntouched()) return
    const payload = buildPayload()
    const hasContent =
      !!payload.name?.trim() || !!payload.sku || payload.basePrice > 0 ||
      !!(payload.images && payload.images.length > 0) ||
      !!(payload.shortDesc || payload.description) ||
      !!payload.videoUrl ||
      !!(payload.detailRows && payload.detailRows.length > 0) ||
      !!payload.descriptionSections ||
      !!(payload.variants && payload.variants.length > 0)
    if (!hasContent) return
    const timer = setTimeout(() => queueDraftSave(payload), 1500)
    return () => clearTimeout(timer)
  }, [open, isEdit, serverDraftId, mode, name, slug, type, desc, shortDesc, videoUrl, detailRows, dsTagline, dsBenefits, dsSpecs, dsTip,
    basePrice, salePrice, sku, stock, lowStockQty, weightGram, customizationGroups, categoryIds, brandId,
    isFeatured, availabilityMode, standardCost, images, tags, sizeChartId,
    seoTitle, seoDesc, seoKeywords, localVariants, isActive])

  // Exit flush: the debounced auto-save above is cleared when the dialog
  // closes or the page unmounts, which would drop text typed less than ~1.5s
  // before leaving. flushRef holds the latest form snapshot (updated on every
  // render) and is invoked synchronously on close, page leave and hard close,
  // so a half-finished product always survives as a draft with all info.
  const wasOpenRef = useRef(false)
  const flushRef = useRef<() => void>(() => {})
  flushRef.current = () => {
    const untouched = formUntouched()
    if (!wasOpenRef.current || hasSavedRef.current || untouched) return
    const payload = buildPayload()
    const hasContent =
      !!payload.name?.trim() || !!payload.sku || payload.basePrice > 0 ||
      !!(payload.images && payload.images.length > 0) ||
      !!(payload.shortDesc || payload.description) ||
      !!payload.videoUrl ||
      !!(payload.detailRows && payload.detailRows.length > 0) ||
      !!payload.descriptionSections ||
      !!(payload.variants && payload.variants.length > 0)
    if (!hasContent) return
    // Draft edits target the row being edited; creation targets the session's
    // server draft. Single-flight: if an autosave is in flight, this only
    // records the latest snapshot (no second createDraft, no orphan draft).
    queueDraftSave(payload)
  }

  useEffect(() => {
    if (open) {
      if (!isEdit || isDraftEdit) wasOpenRef.current = true
    } else {
      // NOTE: no flush here — closing resets form state synchronously in the
      // Dialog onOpenChange/Cancel handlers (which flush first), so an extra
      // flush in this effect would overwrite the saved snapshot with empty
      // values. Page-leave is covered by the unmount flush below.
      wasOpenRef.current = false
    }
  }, [open, isEdit])

  useEffect(() => () => { if (wasOpenRef.current) flushRef.current() }, [])

  // A fresh open must ALWAYS repopulate: closing the dialog resets every
  // field while a naive "same row id" guard would still remember the previous
  // session — reopening the same product then showed an EMPTY form (phantom
  // "Product name is required", and saving wiped the stored images). The
  // population marker therefore resets on every open transition and is keyed
  // by (row id + data source), so an upgrade from list-row data to the full
  // product GET still repopulates without clobbering in-progress edits.
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      populateKeyRef.current = null
      openStateRef.current = null
    }
    prevOpenRef.current = open
  }, [open])

  useEffect(() => {
    if (!open) return
    // Prefer the full product (GET) once it has loaded; the list row is the
    // instant-paint fallback and already carries every scalar this form edits.
    const source: any = isEdit ? (fullProduct ?? currentRow) : currentRow
    const sourceKind = isEdit && fullProduct ? 'full' : 'row'
    const sourceKey = source?.id ? `${sourceKind}:${source.id}${isDuplicate ? ':dup' : ''}` : 'blank'
    if (sourceKey === populateKeyRef.current) return

    // The row painted first; if the user already started editing while the
    // full product was in flight, keep their work.
    if (
      sourceKey.startsWith('full:') &&
      populateKeyRef.current?.startsWith('row:') &&
      openStateRef.current !== null &&
      !formUntouched()
    ) {
      populateKeyRef.current = sourceKey
      return
    }

    populateKeyRef.current = sourceKey

    if (source) {
      const isClone = isDuplicate
      // Duplicate rule (owner): variants are REGENERATED, never carried over.
      // Carrying them crashed the save (no attributeValueIds), corrupted
      // edits/deletes (shared undefined keys) and mirrored phantom physical
      // stock. The duplicate opens with zero variants; the source's attribute
      // selection is pre-selected so regeneration is one click.
      const cloneVariants: any[] = []
      const dupAttrs: string[] = []
      const dupValues: Record<string, string[]> = {}
      if (isClone) {
        ;(source.variants || []).forEach((v: any) => {
          ;(v.attributeValues || []).forEach((av: any) => {
            const val = av.attributeValue
            if (!val) return
            const attrId = val.attribute?.id || val.attributeId
            if (!attrId) return
            if (!dupAttrs.includes(attrId)) dupAttrs.push(attrId)
            if (!dupValues[attrId]) dupValues[attrId] = []
            if (!dupValues[attrId].includes(val.id)) dupValues[attrId].push(val.id)
          })
        })
      }
      availabilityModeTouchedRef.current = true
      setName(source.name || '')
      setSlug(source.slug || '')
      setType(source.type || 'simple')
      setDesc(source.description || '')
      setShortDesc(source.shortDesc || '')
      setVideoUrl((source as any).videoUrl || '')
      setVideoUrlError('')
      setDetailRows(Array.isArray((source as any).detailRows) ? (source as any).detailRows : [])
      setDsTagline((source as any).descriptionSections?.tagline || '')
      setDsBenefits(Array.isArray((source as any).descriptionSections?.benefits) ? (source as any).descriptionSections.benefits : [])
      setDsSpecs((source as any).descriptionSections?.specifications || '')
      setDsTip((source as any).descriptionSections?.stylingTip || '')
      setBasePrice(String(source.basePrice ?? ''))
      setSalePrice(source.salePrice != null ? String(source.salePrice) : '')
      setSku(source.sku || '')
      setStock(String(source.managedStockQuantity ?? 0))
      setLowStockQty(source.lowStockQty != null ? String(source.lowStockQty) : '')
      setWeightGram(source.weightGram != null ? String(source.weightGram) : '')
      setCustomizationGroups(Array.isArray(source.customizations) ? source.customizations : [])
      setCategoryIds((source as any).productCategories?.map((pc: any) => pc.categoryId) || (source.categoryId ? [source.categoryId] : []))
      setBrandId(source.brandId || '')
      setIsActive(source.isActive ?? true)
      setIsFeatured(source.isFeatured ?? false)
      setAvailabilityMode(source.availabilityMode || (source.manageStock ? 'MANAGED_STOCK' : 'INVENTORY_CONTROLLED'))
      setStandardCost(source.standardCost != null ? String(source.standardCost) : '')
      setImages(dedupUrls(Array.isArray(source.images) ? source.images : []))
      setTags(Array.isArray(source.tags) ? source.tags.join(', ') : '')
      setSizeChartId((source as any).sizeChartId || '')
      setSeoTitle((source.seoMeta as any)?.title || '')
      setSeoDesc((source.seoMeta as any)?.description || '')
      setSeoKeywords((source.seoMeta as any)?.keywords || '')
      setFieldErrors({})
      setSelectedAttrs(isDuplicate ? dupAttrs : []); setSelectedValues(isDuplicate ? dupValues : {}); setNewValueInput({})
      setDefaultVariantStock('0')
      setLocalVariants(cloneVariants)
      // Baseline is derived from the source, not from the just-queued state —
      // an effect cannot observe its own updates, and deferring the capture by
      // one render races user input (a keystroke could be captured AS the
      // baseline, silently disabling auto-save).
      openStateRef.current = baselineFromSource(source, cloneVariants)
    } else {
      setName(''); setSlug(''); setType('simple'); setDesc(''); setShortDesc(''); setBasePrice(''); setSalePrice('');
      setSku(''); setStock('0'); setLowStockQty(''); setCategoryIds([]); setBrandId(''); setIsActive(true); setIsFeatured(false);
      setAvailabilityMode('MANAGED_STOCK'); availabilityModeTouchedRef.current = false; setStandardCost(''); setImages([]); setTags(''); setSizeChartId(''); setSeoTitle(''); setSeoDesc(''); setSeoKeywords('');
setSelectedAttrs([]); setSelectedValues({}); setNewValueInput({});
      setDefaultVariantStock('0'); setLocalVariants([]);
      setFieldErrors({})
      // Blank session: no baseline — `formUntouched` falls back to the
      // "has no real content" rule so an untouched form never auto-saves.
      openStateRef.current = null
    }
    setTab('general')
  }, [open, currentRow, fullProduct, isEdit, isDuplicate])

  // Baseline fallback for the blank session: once the (possibly defaulted)
  // values settle, capture them so the first user edit is measured against
  // them. Populated sessions already have their baseline from the effect
  // above, so this is a no-op for them.
  useEffect(() => {
    if (open && openStateRef.current === null) openStateRef.current = snapshotOf()
  }, [open, mode, name, slug, type, desc, shortDesc, videoUrl, detailRows, dsTagline, dsBenefits, dsSpecs, dsTip, basePrice, salePrice, sku,
    stock, lowStockQty, weightGram, customizationGroups, categoryIds, brandId, isActive, isFeatured,
    availabilityMode, standardCost, images, tags, sizeChartId,
    seoTitle, seoDesc, seoKeywords, selectedAttrs, selectedValues, localVariants])

  useEffect(() => {
    if (type === 'variable') {
      setStock('0')
    }
  }, [type])

  useEffect(() => {
    if (isLocalMode && sku !== prevSku.current && localVariants.length > 0) {
      setLocalVariants(prev => prev.map(v => ({
        ...v,
        sku: v.sku.replace(prevSku.current, sku),
      })))
    }
    prevSku.current = sku
  }, [sku])

  // Debounced slug availability check
  useEffect(() => {
    if (!slug || slug.length < 2 || isEdit) { setSlugAvailable(null); return }
    const timer = setTimeout(async () => {
      setSlugChecking(true)
      try {
        const res = await apiClient.get(`/products/check-slug/${encodeURIComponent(slug)}`)
        setSlugAvailable(res.data.available)
      } catch { setSlugAvailable(null) }
      setSlugChecking(false)
    }, 500)
    return () => { clearTimeout(timer); setSlugChecking(false) }
  }, [slug, isEdit])

  // Debounced SKU availability check
  useEffect(() => {
    if (!sku || sku.length < 2) { setSkuAvailable(null); return }
    const timer = setTimeout(async () => {
      setSkuChecking(true)
      try {
        const excludeId = isEdit ? currentRow?.id : undefined
        const res = await apiClient.get(`/products/check-sku/${encodeURIComponent(sku)}`, { params: { excludeId } })
        setSkuAvailable(res.data.available)
      } catch { setSkuAvailable(null) }
      setSkuChecking(false)
    }, 500)
    return () => { clearTimeout(timer); setSkuChecking(false) }
  }, [sku, isEdit, currentRow?.id])

  useEffect(() => {
    if (categoryIds.length > 0 && categoryIds[0]) {
      apiClient.get(`/categories/${categoryIds[0]}`).then(r => {
        const cat = r.data as any
        const chartId = cat?.sizeChartId || null
        if (chartId) {
          const charts = Array.isArray(sizeCharts) ? sizeCharts : (sizeCharts as any)?.data || []
          const chart = charts.find((sc: any) => sc.id === chartId)
          setCategoryDefaultChart({ id: chartId, name: chart?.name || null })
        } else {
          setCategoryDefaultChart(null)
        }
      }).catch(() => setCategoryDefaultChart(null))
    } else {
      setCategoryDefaultChart(null)
    }
  }, [categoryIds, sizeCharts])

  useEffect(() => {
    if (!overrideData) return
    const state: Record<string, { enabled: boolean; partialFixedAmount: string; partialPercentage: string }> = {
      FULL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
      PARTIAL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
      CASH_ON_DELIVERY: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
    }
    for (const ov of overrideData) {
      const key = ov.paymentOptionType as string
      if (state[key]) {
        state[key].enabled = ov.enabled ?? false
        state[key].partialFixedAmount = ov.partialFixedAmount != null ? String(ov.partialFixedAmount) : ''
        state[key].partialPercentage = ov.partialPercentage != null ? String(ov.partialPercentage) : ''
      }
    }
    setOverrideFormState(state)
  }, [overrideData])

  const reset = () => {
      setName(''); setSlug(''); setSlugError(''); setDesc(''); setShortDesc(''); setVideoUrl(''); setVideoUrlError(''); setDetailRows([]); setDsTagline(''); setDsBenefits([]); setDsSpecs(''); setDsTip(''); setBasePrice(''); setSalePrice('');
    setSku(''); setStock('0'); setLowStockQty(''); setCategoryIds([]); setBrandId(''); setIsActive(true); setIsFeatured(false);
    setAvailabilityMode('MANAGED_STOCK'); setStandardCost(''); setImages([]); setTags(''); setSizeChartId(''); setSeoTitle(''); setSeoDesc(''); setSeoKeywords('');
    setSelectedAttrs([]); setSelectedValues({}); setNewValueInput({});
    setCreatedProductId(null); setRegenerateConfirm(false); setClearVariantConfirm(false); setLocalVariants([]);
    setServerDraftId(null);
    setBulkUpdateOpen(false); setIsBulkUpdating(false);
    setOverrideFormState({
      FULL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
      PARTIAL_PAYMENT: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
      CASH_ON_DELIVERY: { enabled: false, partialFixedAmount: '', partialPercentage: '' },
    })
    setAdjustmentModalOpen(false)
    setShowDiscardConfirm(false)
    setFieldErrors({})
  }

  const handleBackendError = (e: any) => {
    const raw = e.response?.data?.message
    const msg = Array.isArray(raw) ? raw.join('. ') : raw || 'Error'
    const code = e.response?.data?.statusCode
    if (code === 409 || (typeof raw === 'string' && raw.toLowerCase().includes('slug'))) {
      if (typeof raw === 'string' && raw.toLowerCase().includes('variant sku')) {
        setTab('variants')
      } else {
        setSlugError(typeof raw === 'string' ? raw : 'This slug is already taken')
        setTab('general')
      }
    }
    toast.error(msg)
  }

  const createMut = useMutation({
    mutationFn: productsApi.create,
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      const createdId = res.data?.id || res.id;
      if (serverDraftId && serverDraftId !== createdId) {
        productsApi.delete(serverDraftId).catch(() => {
          toast.warning('The leftover auto-saved draft could not be cleaned up — remove it from the Drafts tab')
        })
      }
      setServerDraftId(null);
      hasSavedRef.current = true;
      setLocalVariants([]);
      if (type === 'variable' && selectedAttrs.length > 0 && createdId) {
        setCreatedProductId(createdId);
        setTab('variants');
        toast.success('Product created. Now configure variants.');
      } else {
        onOpenChange(false);
        reset();
        toast.success('Product created');
      }
    },
    onError: handleBackendError,
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', variables.id] })
      onOpenChange(false)
      toast.success('Product updated')
    },
    onError: handleBackendError,
  })

  const publishDraftMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.publishDraft(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', variables.id] })
      onOpenChange(false)
      toast.success('Draft published')
    },
    onError: handleBackendError,
  })

  const saveDraftMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.updateDraft(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', variables.id] })
      onOpenChange(false)
      toast.success('Draft saved')
    },
    onError: handleBackendError,
  })

  // Manual Save Draft for create/duplicate sessions (draft-edit already has
  // one). A manual save always reports its result — it bypasses the autosave
  // throttle so a click never silently vanishes.
  const manualDraftMut = useMutation({
    mutationFn: async () => {
      const payload = buildPayload()
      if (serverDraftId) return productsApi.updateDraft(serverDraftId, { ...payload, isActive: false })
      return productsApi.createDraft({ ...payload, isActive: false })
    },
    onSuccess: (res: any) => {
      const created = res.data || res
      if (created?.id && !serverDraftId) setServerDraftId(created.id)
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success('Draft saved')
    },
    onError: (e: any) => notifyDraftSaveFailure(e, true),
  })

  const genVariantMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => productsApi.generateVariants(id, data),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      const freshId = currentRow?.id || res?.data?.id
      if (freshId) queryClient.invalidateQueries({ queryKey: ['product', freshId] })
      toast.success('Variants generated')
    },
    onError: handleBackendError,
  })

  const updateVariantMut = useMutation({
    mutationFn: ({ id, variantId, data }: { id: string; variantId: string; data: any }) =>
      productsApi.updateVariant(id, variantId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', variables.id] })
      toast.success('Variant updated')
    },
    onError: handleBackendError,
  })

  const reorderVariantsMut = useMutation({
    mutationFn: ({ id, orderedIds }: { id: string; orderedIds: string[] }) =>
      productsApi.reorderVariants(id, orderedIds),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', variables.id] })
    },
    onError: handleBackendError,
  })

  const clearVariantMut = useMutation({
    mutationFn: (id: string) => productsApi.removeAllVariants(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', id] })
      setClearVariantConfirm(false)
      setType('simple')
      toast.success('All variants removed')
    },
    onError: handleBackendError,
  })

  const removeVariantMut = useMutation({
    mutationFn: ({ id, variantId }: { id: string; variantId: string }) =>
      productsApi.removeVariant(id, variantId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', variables.id] })
      toast.success('Variant removed')
    },
    onError: handleBackendError,
  })

  const addAttrValueMut = useMutation({
    mutationFn: ({ attributeId, value }: { attributeId: string; value: string }) =>
      attributesApi.addValue(attributeId, { value }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['attributes'] })
      toast.success('Value added')
      setNewValueInput(prev => ({ ...prev, [vars.attributeId]: '' }))
    },
    onError: handleBackendError,
  })

  const upsertOverrideMut = useMutation({
    mutationFn: ({ type, data }: { type: string; data: any }) => productOverrideApi.upsert(currentRow!.id, type, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['product-overrides', currentRow?.id] }) },
    onError: handleBackendError,
  })

  const handleOverrideToggle = (type: string, enabled: boolean) => {
    const update: any = { enabled }
    if (type === 'PARTIAL_PAYMENT') {
      const cur = overrideFormState[type]
      if (cur.partialFixedAmount) update.partialFixedAmount = parseFloat(cur.partialFixedAmount)
      if (cur.partialPercentage) update.partialPercentage = parseFloat(cur.partialPercentage)
    }
    upsertOverrideMut.mutate({ type, data: update })
    setOverrideFormState(prev => ({ ...prev, [type]: { ...prev[type], enabled } }))
  }

  const handlePartialBlur = (type: string) => {
    const cur = overrideFormState[type]
    if (!cur?.enabled) return
    const update: any = { enabled: true }
    if (cur.partialFixedAmount) update.partialFixedAmount = parseFloat(cur.partialFixedAmount)
    else update.partialFixedAmount = null
    if (cur.partialPercentage) update.partialPercentage = parseFloat(cur.partialPercentage)
    else update.partialPercentage = null
    upsertOverrideMut.mutate({ type, data: update })
  }

  const buildPayload = () => {
    // Bengali-only names derive an empty slug from the latin-only regex —
    // fall back to a generated slug instead of failing validation.
    const derivedSlug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const payload: any = {
      name, slug: slug || derivedSlug || `product-${Date.now().toString(36)}`,
      // On edit, cleared fields must actually clear: send explicit null for
      // nullable fields (backend accepts null) and [] for tags/categories.
      // On create, omit them instead.
      description: isEdit ? (desc || null) : (desc || undefined),
      shortDesc: isEdit ? (shortDesc || null) : (shortDesc || undefined),
      videoUrl: isEdit ? (videoUrl.trim() || null) : (videoUrl.trim() || undefined),
      detailRows: (() => { const cleaned = cleanDetailRows(detailRows); return cleaned.length > 0 ? cleaned : undefined })(),
      descriptionSections: cleanDescriptionSections({ tagline: dsTagline, benefits: dsBenefits, specifications: dsSpecs, stylingTip: dsTip }),
      basePrice: parseFloat(basePrice) || 0, salePrice: salePrice ? parseFloat(salePrice) : undefined,
      sku: isEdit ? (sku || null) : (sku || undefined), type,
      categoryId: categoryIds[0] || undefined,
      brandId: brandId || null,
      categoryIds: isEdit ? categoryIds : (categoryIds.length > 0 ? categoryIds : undefined),
      lowStockQty: lowStockQty ? parseInt(lowStockQty) : undefined,
      // Owner Q12: optional parcel weight; empty clears to courier fallback
      // on edit (null), and simply omits on create.
      weightGram: weightGram ? parseInt(weightGram) : (isEdit ? null : undefined),
      // Customization definition (Q15/Q20): only sent when the license
      // feature is on — when it's off the field is omitted entirely so an
      // unrelated edit never wipes a stored definition.
      customizations: hasCustomizationFeature
        ? (customizationGroups.length > 0 ? customizationGroups : (isEdit ? [] : undefined))
        : undefined,
      sizeChartId: isEdit ? (sizeChartId || null) : (sizeChartId || undefined),
      images, tags: isEdit ? tags.split(',').map(t => t.trim()).filter(Boolean) : (tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : undefined), isActive, isFeatured,
      seoMeta: seoTitle || seoDesc || seoKeywords ? { title: seoTitle, description: seoDesc, keywords: seoKeywords } : undefined,
    }
    payload.availabilityMode = availabilityMode
    payload.standardCost = standardCost ? parseFloat(standardCost) : undefined
    // Plain edits never send managedStockQuantity: update() rejects a value
    // differing from stock (stock changes only via the adjustment tool), and
    // the form's stock state goes stale after an in-form adjustment.
    if (!isEdit && type !== 'variable' && availabilityMode === 'MANAGED_STOCK') {
      payload.managedStockQuantity = parseInt(stock) || 0
    }
    if (type === 'variable' && localVariants.length > 0) {
      payload.variants = localVariants.map((v, i) => ({
        sku: v.sku,
        sortOrder: v.sortOrder ?? i,
        price: v.price,
        salePrice: v.salePrice || undefined,
        managedStockQuantity: v.managedStockQuantity || 0,
        standardCost: v.standardCost || undefined,
        image: v.images?.[0] || v.image || undefined,
        images: v.images || undefined,
        // Defensive: never throw on a variant without attributeValueIds
        // (the old duplicate clones) — derive from attributeValues instead.
        attributeValues: (v.attributeValueIds || (v.attributeValues || []).map((av: any) => av.attributeValue?.id || av.attributeValueId)).filter(Boolean).map((id: string) => ({ attributeValueId: id })),
      }))
    }
    return payload
  }

  const handleSave = () => {
    let payload: any
    try {
      payload = buildPayload()
    } catch (err: any) {
      toast.error(`Could not prepare the product data: ${err?.message || err}`)
      return
    }
    if (isDraftEdit && currentRow) publishDraftMut.mutate({ id: currentRow.id, data: payload })
    else if ((isEdit && currentRow) || createdProductId) updateMut.mutate({ id: (currentRow?.id || createdProductId)!, data: payload })
    else createMut.mutate(payload)
  }

  const toggleAttr = (id: string) => {
    setSelectedAttrs(prev => {
      if (prev.includes(id)) {
        setSelectedValues(v => { const { [id]: _, ...rest } = v; return rest })
        return prev.filter(a => a !== id)
      }
      return [...prev, id]
    })
  }

  const toggleValue = (attrId: string, valueId: string) => {
    setSelectedValues(prev => {
      const current = prev[attrId] || []
      const updated = current.includes(valueId) ? current.filter(v => v !== valueId) : [...current, valueId]
      if (updated.length === 0) {
        const { [attrId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [attrId]: updated }
    })
  }

  const cartesian = <T,>(arrays: T[][]): T[][] =>
    arrays.reduce((acc, curr) => acc.flatMap(a => curr.map(b => [...a, b])), [[]] as T[][])

  const handleGenerateVariants = () => {
    if (selectedAttrs.length === 0) return

    const productId = (isEdit || !!createdProductId) ? (currentRow?.id || createdProductId) : null
    if (productId) {
      // Existing product — call API
      if (variantList.length > 0 && !regenerateConfirm) {
        setRegenerateConfirm(true)
        return
      }
      setTimeout(() => setRegenerateConfirm(false), 0)
      const allValueIds = Object.values(selectedValues).flat()
      genVariantMut.mutate({
        id: productId,
        data: {
          attributeIds: selectedAttrs,
          attributeValueIds: allValueIds.length > 0 ? allValueIds : undefined,
          defaultPrice: basePrice ? parseFloat(basePrice) : undefined,
          defaultSalePrice: salePrice ? parseFloat(salePrice) : undefined,
          defaultStandardCost: standardCost ? parseFloat(standardCost) : undefined,
          defaultManagedStockQuantity: parseInt(defaultVariantStock) || 0,
        },
      })
    } else {
      // New product — compute locally
      const groups: any[][] = []
      for (const attrId of selectedAttrs) {
        const attr = (attrs || []).find((a: any) => a.id === attrId)
        if (!attr) continue
        const vals = selectedValues[attrId]
        const activeValues = vals?.length
          ? attr.values.filter((v: any) => vals.includes(v.id))
          : (attr.values || [])
        if (activeValues.length > 0) groups.push(activeValues)
      }
      const combinations = cartesian(groups)
      if (combinations.length > 500) {
        toast.error('Too many variant combinations (max 500) — narrow the attribute selection')
        return
      }
      const generated = combinations.map((combo, idx) => {
        const values = combo.map((av: any) => av.value)
        const fullSku = `${sku || 'PRD'}-${values.join('-').replace(/\s+/g, '-').replace(/\//g, '_').toUpperCase()}`
        return {
          _tempId: `_new_${idx}`,
          sku: fullSku,
          price: parseFloat(basePrice) || 0,
          salePrice: salePrice ? parseFloat(salePrice) : null,
          managedStockQuantity: parseInt(defaultVariantStock) || 0,
          standardCost: standardCost ? parseFloat(standardCost) : null,
          images: [],
          attributeValueIds: combo.map((av: any) => av.id),
          attributeValues: combo.map((av: any) => ({
            attributeValue: { value: av.value, id: av.id, attribute: { name: av.attribute?.name || '' } },
          })),
        }
      })
      setLocalVariants(generated)
      toast.success(`${generated.length} variants generated. Configure them then save.`)
    }
  }

  const dedupUrls = (urls: string[]) => [...new Set(urls)]

  const removeImage = (url: string) => setImages(prev => prev.filter(i => i !== url))

  const handleImageDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const idToUrl = (id: string) => images.find(u => `img-${u}` === id)
    const oldUrl = idToUrl(active.id as string)
    const newUrl = idToUrl(over.id as string)
    if (!oldUrl || !newUrl) return
    const oldIndex = images.indexOf(oldUrl)
    const newIndex = images.indexOf(newUrl)
    if (oldIndex === -1 || newIndex === -1) return
    setImages(arrayMove(images, oldIndex, newIndex))
  }

  const setPrimaryImage = (url: string) => {
    setImages(prev => {
      const filtered = prev.filter(i => i !== url)
      return [url, ...filtered]
    })
  }

  const imageDndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const imageIds = images.map(url => `img-${url}`)

  const openVariantImgMgr = (variant: any) => {
    const vid = variant.id || variant._tempId
    const imgs = variant.images?.length ? dedupUrls([...variant.images]) : (variant.image ? [variant.image] : [])
    setVariantImgMgr({ variantId: vid, images: imgs })
  }

  const saveVariantImgMgr = () => {
    if (!variantImgMgr) return
    const { variantId, images: mgrImages } = variantImgMgr
    if (isLocalMode || isDuplicate) {
      setLocalVariants(prev => prev.map(lv =>
        (lv.id || lv._tempId) === variantId
          ? { ...lv, images: mgrImages, image: mgrImages[0] || null }
          : lv
      ))
      setVariantImgMgr(null)
    } else {
      updateVariantMut.mutate({
        id: currentRow?.id || createdProductId!,
        variantId,
        data: { images: mgrImages },
      }, {
        onSuccess: () => setVariantImgMgr(null),
      })
    }
  }

  const reorderVariantImg = (variantId: string, oldIndex: number, newIndex: number) => {
    if (!variantImgMgr || variantImgMgr.variantId !== variantId) return
    const reordered = arrayMove(variantImgMgr.images, oldIndex, newIndex)
    setVariantImgMgr({ ...variantImgMgr, images: reordered })
  }

  const setPrimaryVariantImg = (variantId: string, url: string) => {
    if (!variantImgMgr || variantImgMgr.variantId !== variantId) return
    const filtered = variantImgMgr.images.filter(i => i !== url)
    setVariantImgMgr({ ...variantImgMgr, images: [url, ...filtered] })
  }

  const removeVariantImg = (variantId: string, url: string) => {
    if (!variantImgMgr || variantImgMgr.variantId !== variantId) return
    setVariantImgMgr({ ...variantImgMgr, images: variantImgMgr.images.filter(i => i !== url) })
  }

  const handleBulkUpdate = async () => {
    const patch: Record<string, any> = {}
    if (bulkOverridePrice && bulkPrice) patch.price = parseFloat(bulkPrice)
    if (bulkOverrideSalePrice && bulkSalePrice) patch.salePrice = parseFloat(bulkSalePrice)
    if (bulkOverrideStandardCost && bulkStandardCost) patch.standardCost = parseFloat(bulkStandardCost)
    if (Object.keys(patch).length === 0) { toast.error('Select at least one field to update'); return }

    if (isLocalMode || isDuplicate) {
      setLocalVariants(prev => prev.map(lv => ({ ...lv, ...patch })))
      toast.success(`Updated ${variantList.length} variants`)
    } else {
      const rowId = currentRow?.id || createdProductId
      if (!rowId) return
      setIsBulkUpdating(true)
      const results = await Promise.allSettled(
        variantList.map(v =>
          productsApi.updateVariant(rowId, v.id, patch)
        )
      )
      setIsBulkUpdating(false)
      const succeeded = results.filter(r => r.status === 'fulfilled').length
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed === 0) {
        toast.success(`Updated ${succeeded} variants`)
      } else {
        toast.error(`Updated ${succeeded}, ${failed} failed`)
      }
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', rowId] })
    }
    // Close the nested dialog on the NEXT tick. The outer Dialog guards outside
    // clicks while a sub-overlay is open, but if we flip bulkUpdateOpen=false in
    // the same event, Radix processes the pending "pointer down outside" AFTER
    // our re-render — hasSubOverlay is already false, the guard no-ops, and the
    // whole product form closes (losing the product). Deferring the close keeps
    // hasSubOverlay=true until the outer has rejected that dismissal.
    setTimeout(() => {
      setBulkUpdateOpen(false)
      setBulkPrice(''); setBulkSalePrice(''); setBulkStandardCost('')
      setBulkOverridePrice(false); setBulkOverrideSalePrice(false); setBulkOverrideStandardCost(false)
    }, 0)
  }

  // Validation returns structured errors pointing at both the TAB and the
  // FIELD they belong to, so a failing save navigates to the offending section
  // and highlights the input instead of only showing a toast.
  type FormFieldError = { tab: 'general' | 'images' | 'variants' | 'payments' | 'seo'; field: string; message: string }
  const validateForSave = (): FormFieldError[] => {
    const errors: FormFieldError[] = []
    if (!name.trim()) errors.push({ tab: 'general', field: 'name', message: 'Product name is required' })
    if (!basePrice || parseFloat(basePrice) <= 0) errors.push({ tab: 'general', field: 'basePrice', message: 'Regular price is required' })
    if (salePrice && basePrice && parseFloat(salePrice) > parseFloat(basePrice)) {
      errors.push({ tab: 'general', field: 'salePrice', message: 'Sale price cannot be higher than regular price' })
    }
    if (videoUrl.trim() && !isSupportedVideoUrl(videoUrl)) {
      errors.push({ tab: 'general', field: 'videoUrl', message: 'Video URL must be a YouTube or Facebook video link' })
    }
    if (seoTitle.trim().length > 60) {
      errors.push({ tab: 'seo', field: 'seoTitle', message: 'SEO title must be 60 characters or fewer' })
    }
    return errors
  }

  const TAB_LABELS: Record<FormFieldError['tab'], string> = {
    general: 'General', images: 'Images', variants: 'Variants', payments: 'Payments', seo: 'SEO',
  }

  const focusField = (field: string) => {
    setTimeout(() => {
      const el = document.getElementById(`product-field-${field}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      ;(el as HTMLInputElement | null)?.focus?.()
    }, 60)
  }

  const clearFieldError = (field: string) => {
    setFieldErrors(prev => {
      if (!prev[field]) return prev
      const { [field]: _removed, ...rest } = prev
      return rest
    })
  }

  const handleSaveClick = (skipReviewGuard = false) => {
    if (!fullProductReady) {
      toast.error('Product data is still loading — try again in a moment')
      return
    }
    const errors = validateForSave()
    if (errors.length > 0) {
      setFieldErrors(Object.fromEntries(errors.map(e => [e.field, e.message])))
      setTab(errors[0].tab)
      toast.error(`${errors[0].message} — check the ${TAB_LABELS[errors[0].tab]} tab`)
      focusField(errors[0].field)
      return
    }
    setFieldErrors({})
    if (!isEdit && !skipReviewGuard) {
      const items: string[] = []
      if (images.length === 0) items.push('No product images configured')
      if (type === 'variable' && variantList.length === 0) items.push('Variable product has no variants')
      if (items.length > 0) {
        setReviewGuardItems(items)
        setShowReviewGuard(true)
        return
      }
    }
    handleSave()
  }

  const isLocalMode = localVariants.length > 0 && !currentRow && !createdProductId
  const variantList = (isLocalMode || isDuplicate) ? localVariants : (fullProduct?.variants || currentRow?.variants || [])
  // Editing must never submit a half-loaded form. If the full-product GET
  // failed, saving stays allowed (the list row carries every scalar) but the
  // user is warned.
  const fullProductReady = !isEdit || !!fullProduct || fullProductError

  // Any nested overlay/dialog open — main dialog must NOT close from outside clicks.
  // Radix Dialog (modal) fires main onOpenChange(false) on any pointerdown outside its
  // content, which includes clicks inside nested dialogs (bulk update, confirmations).
  const hasSubOverlay = bulkUpdateOpen || clearVariantConfirm || regenerateConfirm || showReviewGuard || adjustmentModalOpen || !!variantImgMgr || showDiscardConfirm || galleryOpen || variantImgGalleryOpen

  // Closing a plain edit with unsaved edits silently discarded them; warn
  // first. Create/duplicate/draft-edit sessions persist to a server draft on
  // close (autosave + exit flush), so only plain edits need the prompt.
  const hasUnsavedEditChanges = isEdit && !isDraftEdit && fullProductReady && openStateRef.current !== null && !formUntouched()

  const closeNow = () => {
    if (wasOpenRef.current) flushRef.current()
    onOpenChange(false)
    reset()
  }

  const requestClose = () => {
    if (hasUnsavedEditChanges) {
      setShowDiscardConfirm(true)
      return
    }
    closeNow()
  }

  // Tab close / refresh bypasses the in-dialog exit flush entirely, so warn
  // while the form holds unsaved work instead of losing it silently.
  const dirtyRef = useRef(false)
  dirtyRef.current = !!open && openStateRef.current !== null && !formUntouched()
  useEffect(() => {
    if (!open) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [open])

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleVariantDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = variantList.findIndex((v: any) => (v.id || v._tempId) === active.id)
    const newIndex = variantList.findIndex((v: any) => (v.id || v._tempId) === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(variantList, oldIndex, newIndex)
    if (isLocalMode || isDuplicate) {
      setLocalVariants(reordered)
    } else {
      const rowId = currentRow?.id || createdProductId!
      const orderedIds = reordered.map((v: any) => v.id)
      reorderVariantsMut.mutate({ id: rowId, orderedIds })
    }
  }

  const variantIds = variantList.map((v: any) => v.id || v._tempId)

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) { if (hasSubOverlay) return; requestClose() } }}>
      <DialogContent
        className='!max-w-[92vw] max-w-[1400px] max-h-[95vh] overflow-hidden flex flex-col p-0'
        onInteractOutside={(e) => { if (hasSubOverlay) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (hasSubOverlay) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (hasSubOverlay) e.preventDefault(); }}
      >
        <DialogHeader className='px-6 pt-6 pb-2'>
          <DialogTitle>{isDraftEdit ? `Edit Draft: ${currentRow?.name || 'Untitled Draft'}` : isEdit ? `Edit: ${currentRow?.name}` : isDuplicate ? `Duplicate: ${currentRow?.name}` : 'Add New Product'}</DialogTitle>
        </DialogHeader>

        {isEdit && !fullProductReady && (
          <div className='px-6 py-2 text-xs text-muted-foreground flex items-center gap-2 border-b bg-muted/30' data-testid='product-loading-banner'>
            <Loader2 className='h-3.5 w-3.5 animate-spin' />
            Loading full product data — the form fills in as soon as it arrives…
          </div>
        )}
        {isEdit && fullProductError && (
          <div className='px-6 py-2 text-xs text-destructive border-b bg-destructive/5' data-testid='product-loading-error'>
            Could not load the full product — list data is shown. Reload the page before saving to avoid missing fields.
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab} className='flex-1 flex flex-col overflow-hidden'>
          <TabsList className='px-6 justify-start rounded-none border-b'>
            <TabsTrigger value='general'>General</TabsTrigger>
            <TabsTrigger value='images'>Images</TabsTrigger>
            <TabsTrigger value='variants' disabled={type !== 'variable'}>Variants</TabsTrigger>
            <TabsTrigger value='payments'>Payments</TabsTrigger>
            <TabsTrigger value='seo'>SEO</TabsTrigger>
            {hasCustomizationFeature && (
              <TabsTrigger value='customization'>Customization</TabsTrigger>
            )}
          </TabsList>

          <div className='flex-1 overflow-y-auto px-8 py-6'>
            <TabsContent value='general' className='mt-0 space-y-8'>
              {/* Product Type + Status Row */}
              <section className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Product Settings</h3>
                <div className='grid grid-cols-2 gap-6'>
                  <div className='space-y-1.5'>
                    <Label>Product Type</Label>
                    <select
                      value={type}
                      onChange={e => {
                        const next = e.target.value
                        if (isEdit && next === 'simple' && currentRow?.type === 'variable' && (fullProduct?.variants?.length || currentRow?.variants?.length || 0) > 0) {
                          toast.error('Remove all variants first (Variants tab → Clear All) before switching to Simple')
                          return
                        }
                        setType(next)
                        // Smart default on type switch: variable products are
                        // managed per-variant. Only auto-snap while the user
                        // hasn't explicitly chosen a mode.
                        if (!availabilityModeTouchedRef.current) {
                          setAvailabilityMode(
                            next === 'variable'
                              ? 'MANAGED_STOCK'
                              : imEnabled
                                ? 'INVENTORY_CONTROLLED'
                                : 'MANAGED_STOCK',
                          )
                        }
                      }}
                      className='w-full rounded-md border px-3 py-2 text-sm bg-background'
                    >
                      <option value='simple'>Simple Product</option>
                      <option value='variable'>Variable Product</option>
                    </select>
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Status</Label>
                    <div className='flex items-center gap-4 h-10'>
                      <div className='flex items-center gap-2'>
                        <Switch checked={isActive} onCheckedChange={setIsActive} />
                        <Label className='font-normal text-sm'>{isActive ? 'Active' : 'Draft'}</Label>
                      </div>
                      <div className='flex items-center gap-2'>
                        <Switch checked={isFeatured} onCheckedChange={setIsFeatured} />
                        <Label className='font-normal text-sm'>{isFeatured ? 'Featured' : 'Regular'}</Label>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Basic Info */}
              <section className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Basic Information</h3>
                <div className='grid grid-cols-2 gap-6'>
                  <div className='space-y-1.5'>
                    <Label>Product Name *</Label>
                    <Input id='product-field-name' value={name} onChange={e => { clearFieldError('name'); setName(e.target.value); if (!isEdit && !isDuplicate && !slugTouchedRef.current) setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')) }} placeholder='Product name' className={fieldErrors.name ? 'border-destructive' : ''} />
                    {fieldErrors.name && <p className='text-xs text-destructive'>{fieldErrors.name}</p>}
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Slug</Label>
                    <div className='relative'>
                      <Input value={slug} onChange={e => { slugTouchedRef.current = true; setSlug(e.target.value); setSlugError(''); setSlugAvailable(null) }} placeholder='product-slug' className={slugError ? 'border-destructive' : ''} />
                      <div className='absolute right-2 top-1/2 -translate-y-1/2'>
                        {slugChecking && <Loader2 className='h-3.5 w-3.5 animate-spin text-muted-foreground' />}
                        {!slugChecking && slugAvailable === false && !slugError && <X className='h-3.5 w-3.5 text-destructive' />}
                        {!slugChecking && slugAvailable === true && <Check className='h-3.5 w-3.5 text-green-500' />}
                      </div>
                    </div>
                    {slugError && <p className='text-xs text-destructive'>{slugError}</p>}
                    {!slugError && slugAvailable === false && <p className='text-xs text-destructive'>Slug already taken</p>}
                    {!slugError && slugAvailable === true && <p className='text-xs text-green-600'>Available</p>}
                  </div>
                </div>
                <div className='grid grid-cols-4 gap-6'>
                  <div className='space-y-1.5'>
                    <Label>Categories</Label>
                    <MultiSearchableSelect
                      options={categoryOptions}
                      value={categoryIds}
                      onChange={setCategoryIds}
                      placeholder='Search categories...'
                      searchPlaceholder='Type to search...'
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Brand</Label>
                    <SearchableSelect
                      options={brandOptions}
                      value={brandId}
                      onChange={setBrandId}
                      placeholder='Search brands...'
                      searchPlaceholder='Type to search...'
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label>SKU</Label>
                    <div className='relative'>
                      <Input value={sku} onChange={e => setSku(e.target.value)} placeholder='PRD-001' />
                      <div className='absolute right-2 top-1/2 -translate-y-1/2'>
                        {skuChecking && <Loader2 className='h-3.5 w-3.5 animate-spin text-muted-foreground' />}
                        {!skuChecking && skuAvailable === false && <X className='h-3.5 w-3.5 text-destructive' />}
                        {!skuChecking && skuAvailable === true && <Check className='h-3.5 w-3.5 text-green-500' />}
                      </div>
                    </div>
                    {skuAvailable === false && <p className='text-xs text-destructive'>SKU already in use</p>}
                    {skuAvailable === true && <p className='text-xs text-green-600'>Available</p>}
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Weight (grams, optional)</Label>
                    <Input type='number' min='1' value={weightGram} onChange={e => setWeightGram(e.target.value)} placeholder='500' />
                    <p className='text-xs text-muted-foreground'>Parcel weight for courier booking. Leave empty to use the courier default (500 g).</p>
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Tags</Label>
                    <TagInput
                      value={tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : []}
                      onChange={(arr) => setTags(arr.join(', '))}
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Size Chart</Label>
                    <SearchableSelect
                      options={sizeChartOptions}
                      value={sizeChartId}
                      onChange={setSizeChartId}
                      placeholder={categoryDefaultChart?.id ? 'None (use default)' : 'None'}
                      searchPlaceholder='Search size charts...'
                    />
                    {categoryDefaultChart?.id && (
                      <p className='text-xs text-muted-foreground mt-1'>
                        Default from{' '}
                        {(() => {
                          const c = Array.isArray(cats) ? cats.find((c: any) => c.id === categoryIds[0]) : null
                          return c?.name || 'selected category'
                        })()}
                        : {categoryDefaultChart.name}
                      </p>
                    )}
                  </div>
                </div>
                <div className='space-y-1.5'>
                  <Label>Short Description</Label>
                  <Textarea value={shortDesc} onChange={e => setShortDesc(e.target.value)} rows={3} placeholder='Brief excerpt...' />
                </div>
                <div className='space-y-1.5'>
                  <Label>Video URL (optional)</Label>
                  <Input
                    id='product-field-videoUrl'
                    value={videoUrl}
                    onChange={e => { clearFieldError('videoUrl'); setVideoUrl(e.target.value); setVideoUrlError('') }}
                    onBlur={() => { if (videoUrl.trim() && !isSupportedVideoUrl(videoUrl)) setVideoUrlError('Must be a YouTube or Facebook video link') }}
                    placeholder='YouTube / Facebook video link'
                    className={videoUrlError || fieldErrors.videoUrl ? 'border-destructive' : ''}
                  />
                  {(videoUrlError || fieldErrors.videoUrl) && <p className='text-xs text-destructive'>{fieldErrors.videoUrl || videoUrlError}</p>}
                </div>
                <div className='space-y-1.5'>
                  <Label>Product Details rows (optional)</Label>
                  {detailRows.map((row, i) => (
                    <div key={i} className='flex gap-2'>
                      <Input
                        value={row.label}
                        onChange={e => setDetailRows(prev => prev.map((r, j) => j === i ? { ...r, label: e.target.value } : r))}
                        placeholder='Label (e.g. Fabric)'
                      />
                      <Input
                        value={row.value}
                        onChange={e => setDetailRows(prev => prev.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                        placeholder='Value (e.g. China Imported Popcorn)'
                      />
                      <Button type='button' variant='ghost' size='icon' onClick={() => setDetailRows(prev => prev.filter((_, j) => j !== i))} aria-label={`Remove details row ${i + 1}`}>
                        <X size={16} />
                      </Button>
                    </div>
                  ))}
                  <Button type='button' variant='outline' size='sm' onClick={() => setDetailRows(prev => [...prev, { label: '', value: '' }])}>
                    <Plus size={14} /> Add row
                  </Button>
                </div>
                <div className='space-y-1.5'>
                  <Label>Description Sections (optional)</Label>
                  <Input value={dsTagline} onChange={e => setDsTagline(e.target.value)} placeholder='Tagline (shown under the title)' />
                  {dsBenefits.map((b, i) => (
                    <div key={i} className='flex gap-2'>
                      <Input
                        value={b}
                        onChange={e => setDsBenefits(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                        placeholder={`Benefit ${i + 1} (Key Features grid)`}
                      />
                      <Button type='button' variant='ghost' size='icon' onClick={() => setDsBenefits(prev => prev.filter((_, j) => j !== i))} aria-label={`Remove benefit ${i + 1}`}>
                        <X size={16} />
                      </Button>
                    </div>
                  ))}
                  <Button type='button' variant='outline' size='sm' onClick={() => setDsBenefits(prev => [...prev, ''])}>
                    <Plus size={14} /> Add benefit
                  </Button>
                  <Textarea value={dsSpecs} onChange={e => setDsSpecs(e.target.value)} rows={3} placeholder='Specifications HTML (fallback when detail rows are empty)' />
                  <Input value={dsTip} onChange={e => setDsTip(e.target.value)} placeholder='Styling tip (shown under the buy box)' />
                </div>
                <div className='space-y-1.5'>
                  <Label>Description</Label>
                  <RichTextEditor value={desc} onChange={setDesc} placeholder='Full product description...' minHeight={300} />
                </div>
              </section>

              {/* Pricing */}
              <section className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Pricing</h3>
                <div className='grid grid-cols-3 gap-6'>
                  <div className='space-y-1.5'>
                    <Label>Regular Price *</Label>
                    <Input id='product-field-basePrice' type='number' step='0.01' value={basePrice} onChange={e => { clearFieldError('basePrice'); clearFieldError('salePrice'); setBasePrice(e.target.value) }} placeholder='0.00' className={fieldErrors.basePrice ? 'border-destructive' : ''} />
                    {fieldErrors.basePrice && <p className='text-xs text-destructive'>{fieldErrors.basePrice}</p>}
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Sale Price</Label>
                    <Input id='product-field-salePrice' type='number' step='0.01' value={salePrice} onChange={e => { clearFieldError('salePrice'); setSalePrice(e.target.value) }} placeholder='0.00' className={fieldErrors.salePrice ? 'border-destructive' : ''} />
                    {fieldErrors.salePrice && <p className='text-xs text-destructive'>{fieldErrors.salePrice}</p>}
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Standard Cost (COGS)</Label>
                    <Input type='number' step='0.01' value={standardCost} onChange={e => setStandardCost(e.target.value)} placeholder='0.00' />
                  </div>
                </div>
              </section>

              {/* Inventory */}
              <section className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Inventory</h3>
                <div className='space-y-1.5'>
                  <Label>Availability Mode</Label>
                  <select
                    className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                    value={availabilityMode}
                    onChange={e => {
                      availabilityModeTouchedRef.current = true
                      setAvailabilityMode(e.target.value)
                    }}
                  >
                    <option value='MANAGED_STOCK'>Managed Stock</option>
                    <option value='ALWAYS_IN_STOCK'>Always In Stock</option>
                    <option value='ALWAYS_OUT_OF_STOCK'>Always Out Of Stock</option>
                    {imEnabled && <option value='INVENTORY_CONTROLLED'>Inventory Controlled</option>}
                  </select>
                </div>
                {availabilityMode === 'MANAGED_STOCK' && type !== 'variable' && (
                  isEdit ? (
                    <div className='space-y-3'>
                      <div className='flex items-center gap-3'>
                        <Badge variant='outline' className='text-sm px-3 py-1'>
                          Current Stock: <strong className='ml-1'>{stock}</strong>
                        </Badge>
                        <div className='space-y-1.5 w-40'>
                          <Label className='text-xs'>Low Stock Alert</Label>
                          <Input type='number' value={lowStockQty} onChange={e => setLowStockQty(e.target.value)} placeholder='5' className='h-8 text-xs' />
                        </div>
                      </div>
                      <div className='flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2'>
                        <p className='text-xs text-blue-700 dark:text-blue-300'>
                          Stock adjustments tracked in Managed Stock Ledger.
                        </p>
                        <Button type="button" variant="outline" size="sm" onClick={() => { setActiveVariantId(null); setAdjustmentModalOpen(true); }}>
                          Adjust Stock
                        </Button>
                      </div>
                    </div>
                  ) : isDuplicate ? (
                    <div className='flex flex-col sm:flex-row items-start sm:items-center gap-6'>
                      <div className='space-y-1.5 w-full sm:w-40'>
                        <Label>Low Stock Alert</Label>
                        <Input type='number' value={lowStockQty} onChange={e => setLowStockQty(e.target.value)} placeholder='5' />
                      </div>
                      <div className='flex-1 bg-muted/30 border rounded-md px-3 py-2'>
                        <p className='text-xs text-muted-foreground'>
                          Stock starts at 0. Use <strong>Inventory &gt; Stock</strong> to add stock after creation.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className='flex flex-col sm:flex-row items-start sm:items-center gap-6'>
                      <div className='space-y-1.5 w-full sm:w-40'>
                        <Label>Low Stock Alert</Label>
                        <Input type='number' value={lowStockQty} onChange={e => setLowStockQty(e.target.value)} placeholder='5' />
                      </div>
                      <div className='flex-1 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2'>
                        <p className='text-xs text-blue-700 dark:text-blue-300'>
                          Starting stock cannot be set here. Please load initial quantities via the <strong>Inventory &gt; Stock</strong> page's adjustment tool after creating the product to preserve ledger audit trail integrity.
                        </p>
                      </div>
                    </div>
                  )
                )}
                {availabilityMode === 'MANAGED_STOCK' && type === 'variable' && (
                  <div className='space-y-3'>
                    <p className='text-sm text-muted-foreground'>Stock is managed at the variant level.</p>
                    {isEdit && (
                      <div className='flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2'>
                        <p className='text-xs text-blue-700 dark:text-blue-300'>
                          Adjust variant stock using the Managed Stock tool.
                        </p>
                        <Button type="button" variant="outline" size="sm" onClick={() => { setActiveVariantId(null); setAdjustmentModalOpen(true); }}>
                          Adjust Variants
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {availabilityMode === 'ALWAYS_IN_STOCK' && (
                  <div className='bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md px-3 py-2'>
                    <p className='text-xs text-green-700 dark:text-green-300'>
                      Product is always in stock. No quantity tracking.
                    </p>
                  </div>
                )}
                {availabilityMode === 'ALWAYS_OUT_OF_STOCK' && (
                  <div className='bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-3 py-2'>
                    <p className='text-xs text-red-700 dark:text-red-300'>
                      Product is marked as out of stock.
                    </p>
                  </div>
                )}
                {availabilityMode === 'INVENTORY_CONTROLLED' && (
                  <div className='flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2'>
                    <p className='text-xs text-blue-700 dark:text-blue-300'>
                      Stock controlled by physical Inventory module. Managed Stock rules do not apply.
                    </p>
                    {isEdit && (
                       <Button type="button" variant="default" size="sm" onClick={() => {
                         window.open(appHref(`/op/inventory?productId=${currentRow?.id}`), '_blank')
                       }}>
                         Open Inventory
                       </Button>
                    )}
                  </div>
                )}
              </section>
            </TabsContent>

            <TabsContent value='images' className='mt-0 space-y-6'>
              <div className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <div className='flex items-center justify-between'>
                  <div>
                    <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Product Images</h3>
                    <p className='text-xs text-muted-foreground mt-1'>Drag to reorder · first image is the Primary/thumbnail</p>
                  </div>
                  <Button variant='outline' size='sm' onClick={() => setGalleryOpen(true)}>
                    <ImageIcon className='h-4 w-4 mr-1' /> Browse Library
                  </Button>
                </div>
                <DndContext sensors={imageDndSensors} collisionDetection={closestCenter} onDragEnd={handleImageDragEnd}>
                  <SortableContext items={imageIds} strategy={rectSortingStrategy}>
                    <div className='grid grid-cols-6 gap-3'>
                      {images.map((url) => (
                        <SortableImageCard
                          key={`img-${url}`}
                          url={url}
                          isPrimary={images.indexOf(url) === 0}
                          onSetPrimary={setPrimaryImage}
                          onRemove={removeImage}
                        />
                      ))}
                      {images.length === 0 && (
                        <div className='col-span-6 flex flex-col items-center justify-center py-12 text-muted-foreground border-2 border-dashed rounded-lg'>
                          <Package className='h-10 w-10 mb-3' />
                          <p className='text-sm'>No images selected</p>
                          <Button variant='outline' size='sm' className='mt-3' onClick={() => setGalleryOpen(true)}>Browse Library</Button>
                        </div>
                      )}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
              <MediaPicker
                open={galleryOpen}
                onOpenChange={setGalleryOpen}
                selected={images}
                multiple={true}
                onSelect={(urls) => setImages(dedupUrls(urls))}
              />
            </TabsContent>

            <TabsContent value='variants' className='mt-0 space-y-6'>
              {isDuplicate && type === 'variable' && (
                <div className='bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-4 py-3'>
                  <p className='text-sm text-blue-700 dark:text-blue-300'>
                    Variants are <strong>not copied</strong> from the original product. Select the attributes below and click <strong>Generate Variants</strong> to create fresh variants with new SKUs. Stock starts at 0 — add it from Inventory &gt; Stock after creation.
                  </p>
                </div>
              )}
              {type !== 'variable' ? (
                <div className='bg-muted/20 rounded-lg p-8 text-center space-y-3'>
                  <Package className='h-10 w-10 text-muted-foreground mx-auto' />
                  <div>
                    <h3 className='font-medium'>Variable product only</h3>
                    <p className='text-sm text-muted-foreground'>Switch product type to <strong>Variable Product</strong> in the General tab to configure variants.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className='bg-muted/20 rounded-lg p-5 space-y-5'>
                    <div>
                      <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1'>Step 1: Select Attributes & Values</h3>
                      <p className='text-xs text-muted-foreground mb-4'>Choose attributes and pick specific values for variant generation.</p>
                      <div className='space-y-3'>
                        {(attrs || []).map((attr: any) => (
                          <div key={attr.id} className='border rounded-lg overflow-hidden'>
                            <button
                              type='button'
                              onClick={() => toggleAttr(attr.id)}
                              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium transition-colors ${
                                selectedAttrs.includes(attr.id) ? 'bg-primary/10 text-primary' : 'hover:bg-muted/30'
                              }`}
                            >
                              <span>{attr.name}</span>
                              <Badge variant={selectedAttrs.includes(attr.id) ? 'default' : 'outline'}>
                                {selectedAttrs.includes(attr.id) ? (selectedValues[attr.id]?.length || attr.values?.length || 0) + ' selected' : 'Click to select'}
                              </Badge>
                            </button>
                            {selectedAttrs.includes(attr.id) && (
                              <div className='px-4 pb-3 pt-2 space-y-2'>
                                <div className='flex flex-wrap gap-1.5'>
                                  {(attr.values || []).map((v: any) => (
                                    <Badge
                                      key={v.id}
                                      variant={(selectedValues[attr.id] || []).includes(v.id) ? 'default' : 'outline'}
                                      className='cursor-pointer text-xs'
                                      onClick={() => toggleValue(attr.id, v.id)}
                                    >
                                      {(selectedValues[attr.id] || []).includes(v.id) ? <Check className='h-3 w-3 mr-1' /> : null}
                                      {v.value}
                                    </Badge>
                                  ))}
                                  {(attr.values || []).length === 0 && (
                                    <p className='text-xs text-muted-foreground italic'>No values yet. Add one below.</p>
                                  )}
                                </div>
                                <div className='flex items-center gap-2'>
                                  <Input
                                    value={newValueInput[attr.id] || ''}
                                    onChange={e => setNewValueInput(prev => ({ ...prev, [attr.id]: e.target.value }))}
                                    placeholder='Add new value...'
                                    className='h-7 text-xs py-0 px-2'
                                  />
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-7 text-xs'
                                    disabled={!newValueInput[attr.id]?.trim() || addAttrValueMut.isPending}
                                    onClick={() => {
                                      const val = newValueInput[attr.id]?.trim()
                                      if (val) addAttrValueMut.mutate({ attributeId: attr.id, value: val })
                                    }}
                                  >
                                    {addAttrValueMut.isPending ? <Loader2 className='h-3 w-3 animate-spin' /> : <Plus className='h-3 w-3' />}
                                    Add
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                        {(!attrs || attrs.length === 0) && (
                          <p className='text-xs text-muted-foreground italic'>No attributes found. Create attributes first from the Attributes section.</p>
                        )}
                      </div>
                    </div>

                    <div className='border-t pt-5'>
                      <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1'>Step 2: Generate</h3>
                      {/* Generation preview */}
                      {selectedAttrs.length > 0 && (() => {
                        const counts: { attr: string; values: string; count: number }[] = []
                        let total = 1
                        for (const attrId of selectedAttrs) {
                          const attr = (attrs || []).find((a: any) => a.id === attrId)
                          if (!attr) continue
                          const vals = selectedValues[attrId]
                          const activeValues = vals?.length
                            ? attr.values.filter((v: any) => vals.includes(v.id))
                            : (attr.values || [])
                          const count = activeValues.length || 0
                          if (count > 0) {
                            counts.push({ attr: attr.name, values: activeValues.map((v: any) => v.value).join(', '), count })
                            total *= count
                          }
                        }
                        return (
                          <div className='mt-3 bg-muted/20 rounded-lg p-4 space-y-2'>
                            <div className='flex items-center justify-between'>
                              <span className='text-sm font-medium'>Expected combinations: <strong>{total}</strong></span>
                              <span className='text-xs text-muted-foreground'>Default stock: {parseInt(defaultVariantStock) || 0} per variant</span>
                            </div>

                            {counts.map(c => (
                              <div key={c.attr} className='text-xs text-muted-foreground'>
                                <span className='font-medium text-foreground'>{c.attr}</span>: {c.values} ({c.count})
                              </div>
                            ))}
                            {total > 50 && (
                              <p className='text-xs text-amber-600 font-medium'>⚠ Large combination set ({total} variants). Consider narrowing your attribute selection.</p>
                            )}
                          </div>
                        )
                      })()}
                      <div className='flex items-center gap-4 mt-3'>
                        <Button onClick={handleGenerateVariants} disabled={selectedAttrs.length === 0 || genVariantMut.isPending} size='default'>
                          {genVariantMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : <Plus className='h-4 w-4 mr-2' />}
                          Generate Variants
                        </Button>
                        <span className='text-xs text-muted-foreground'>
                          {selectedAttrs.length > 0
                            ? `Generates all combinations of selected attributes`
                            : 'Select attributes first'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {isEdit && !fullProductReady && (
                    <div className='border-2 border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2'>
                      <Loader2 className='h-4 w-4 animate-spin' /> Loading variants…
                    </div>
                  )}
                  {fullProductReady && variantList.length === 0 && (
                    <div className='border-2 border-dashed rounded-lg p-8 text-center space-y-2'>
                      <Package className='h-8 w-8 text-muted-foreground mx-auto' />
                      <h3 className='font-medium text-sm'>No variants yet</h3>
                      <p className='text-xs text-muted-foreground'>Select attributes above and click <strong>Generate Variants</strong> to create the combinations.</p>
                    </div>
                  )}

                  {variantList.length > 0 && (
                    <div className='border rounded-lg overflow-hidden'>
                      <div className='bg-muted/30 px-4 py-2 border-b flex items-center justify-between'>
                        <h3 className='font-medium'>Variants ({variantList.length})</h3>
                        <div className='flex items-center gap-2'>
                          {(isLocalMode || isDuplicate) && localVariants.length > 0 && (
                            <Button variant='outline' size='sm' className='text-destructive' onClick={() => { setLocalVariants([]); toast.success('All variants cleared') }}>
                              <Trash2 className='h-4 w-4 mr-1.5' />
                              Clear All
                            </Button>
                          )}
                          {!isLocalMode && !isDuplicate && variantList.length > 0 && (currentRow?.id || createdProductId) && (
                            <Button variant='outline' size='sm' className='text-destructive' onClick={() => setClearVariantConfirm(true)}>
                              <Trash2 className='h-4 w-4 mr-1.5' />
                              Clear All
                            </Button>
                          )}
                          <Button variant='outline' size='sm' onClick={() => setBulkUpdateOpen(true)} disabled={variantList.length === 0}>
                            Bulk Update
                          </Button>
                          <span className='text-xs text-muted-foreground'>Drag to reorder · Click values to edit inline</span>
                        </div>
                      </div>
                      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleVariantDragEnd}>
                        <SortableContext items={variantIds} strategy={verticalListSortingStrategy}>
                          <div className='divide-y'>
                            {variantList.map(v => {
                              const vid = v.id || v._tempId
                              return (
                                <SortableVariantRow key={vid} id={vid}>
                                  {isLocalMode || isDuplicate ? (
                                    <VariantRow
                                      variant={v}
                                      productId=''
                                      onUpdate={(data) => {
                                        setLocalVariants(prev => prev.map(lv =>
                                          lv._tempId === v._tempId ? { ...lv, ...data } : lv
                                        ))
                                      }}
                                      onImagePick={() => openVariantImgMgr(v)}
                                      currencySymbol='৳'
                                      onDelete={() => {
                                        setLocalVariants(prev => prev.filter(lv => (lv.id || lv._tempId) !== (v.id || v._tempId)))
                                        toast.success('Variant removed')
                                      }}
                                    />
                                  ) : (
                                    <VariantRow
                                      variant={v}
                                      productId={currentRow?.id || createdProductId!}
                                      onUpdate={(data) => updateVariantMut.mutate({ id: currentRow?.id || createdProductId!, variantId: v.id, data })}
                                      onImagePick={() => openVariantImgMgr(v)}
                                      currencySymbol='৳'
                                      onAdjustStock={() => { setActiveVariantId(v.id); setAdjustmentModalOpen(true) }}
                                      onDelete={() => {
                                        const pid = currentRow?.id || createdProductId
                                        if (!pid || !v.id) return
                                        removeVariantMut.mutate({ id: pid, variantId: v.id })
                                      }}
                                    />
                                  )}
                                </SortableVariantRow>
                              )
                            })}
                          </div>
                        </SortableContext>
                      </DndContext>
                    </div>
                  )}

                  <MediaPicker
                    open={variantPickerOpen}
                    onOpenChange={(v) => { setVariantPickerOpen(v); if (!v) setActiveVariantId(null) }}
                    selected={
                      activeVariantId
                        ? (() => {
                            const v = variantList.find((x: any) => (x.id || x._tempId) === activeVariantId)
                            if (!v) return []
                            const imgs = v.images?.length ? v.images : (v.image ? [v.image] : [])
                            return imgs
                          })()
                        : []
                    }
                    multiple={true}
                    onSelect={(urls) => {
                      if (isLocalMode && activeVariantId) {
                        setLocalVariants(prev => prev.map(lv =>
                          lv._tempId === activeVariantId ? { ...lv, images: urls, image: urls[0] || null } : lv
                        ))
                      } else if (activeVariantId && currentRow) {
                        updateVariantMut.mutate({
                          id: currentRow.id,
                          variantId: activeVariantId,
                          data: { images: urls },
                        })
                      }
                      setVariantPickerOpen(false)
                      setActiveVariantId(null)
                    }}
                  />
                </>
              )}
            </TabsContent>

            <TabsContent value='payments' className='mt-0 space-y-6'>
              <div className='bg-muted/20 rounded-lg p-5 space-y-4'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Payment Options</h3>
                <p className='text-xs text-muted-foreground'>Override global payment option settings for this product.</p>
                {!isEdit ? (
                  <p className='text-sm text-muted-foreground py-4'>Save the product first to configure payment overrides.</p>
                ) : (
                  <div className='space-y-2'>
                    {[
                      { type: 'FULL_PAYMENT', label: 'Full Payment', desc: 'One-time full payment' },
                      { type: 'PARTIAL_PAYMENT', label: 'Partial Payment', desc: 'Pay in installments' },
                      { type: 'CASH_ON_DELIVERY', label: 'Cash on Delivery', desc: 'Pay upon delivery' },
                    ].map(({ type, label, desc }) => (
                      <div key={type} className='border rounded-lg p-4 space-y-3'>
                        <div className='flex items-center justify-between'>
                          <div>
                            <p className='text-sm font-medium'>{label}</p>
                            <p className='text-xs text-muted-foreground'>{desc}</p>
                          </div>
                          <Switch
                            checked={overrideFormState[type]?.enabled || false}
                            onCheckedChange={(v) => handleOverrideToggle(type, v)}
                          />
                        </div>
                        {type === 'PARTIAL_PAYMENT' && overrideFormState[type]?.enabled && (
                          <div className='grid grid-cols-2 gap-4 pt-2 border-t'>
                            <div className='space-y-1.5'>
                              <Label className='text-xs'>Fixed Amount</Label>
                              <Input
                                type='number' step='0.01' placeholder='0.00'
                                value={overrideFormState[type]?.partialFixedAmount || ''}
                                onChange={(e) => setOverrideFormState(prev => ({
                                  ...prev,
                                  [type]: { ...prev[type], partialFixedAmount: e.target.value }
                                }))}
                                onBlur={() => handlePartialBlur(type)}
                              />
                            </div>
                            <div className='space-y-1.5'>
                              <Label className='text-xs'>Percentage (%)</Label>
                              <Input
                                type='number' step='0.01' min='0' max='100' placeholder='0'
                                value={overrideFormState[type]?.partialPercentage || ''}
                                onChange={(e) => setOverrideFormState(prev => ({
                                  ...prev,
                                  [type]: { ...prev[type], partialPercentage: e.target.value }
                                }))}
                                onBlur={() => handlePartialBlur(type)}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value='seo' className='mt-0 space-y-6'>
              <div className='bg-muted/20 rounded-lg p-5 space-y-5'>
                <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider'>Search Engine Optimization</h3>
                <div className='grid grid-cols-2 gap-6'>
                  <div className='space-y-1.5'>
                    <Label>Meta Title</Label>
                    <Input id='product-field-seoTitle' value={seoTitle} onChange={e => { clearFieldError('seoTitle'); setSeoTitle(e.target.value) }} placeholder='SEO title...' className={fieldErrors.seoTitle ? 'border-destructive' : ''} />
                    <span className={`text-xs ${seoTitle.length > 60 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>{seoTitle.length}/60 characters</span>
                    {fieldErrors.seoTitle && <p className='text-xs text-destructive'>{fieldErrors.seoTitle}</p>}
                  </div>
                  <div className='space-y-1.5'>
                    <Label>Keywords</Label>
                    <Input value={seoKeywords} onChange={e => setSeoKeywords(e.target.value)} placeholder='keyword1, keyword2, ...' />
                  </div>
                </div>
                <div className='space-y-1.5'>
                  <Label>Meta Description</Label>
                  <Textarea value={seoDesc} onChange={e => setSeoDesc(e.target.value)} rows={3} placeholder='Meta description (max 160 chars)...' />
                  <span className={`text-xs ${seoDesc.length > 160 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>{seoDesc.length}/160</span>
                </div>
              </div>
            </TabsContent>

            {hasCustomizationFeature && (
              <TabsContent value='customization' className='mt-0 space-y-6'>
                <div className='bg-muted/20 rounded-lg p-5'>
                  <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4'>Customization Options</h3>
                  <CustomizationEditor value={customizationGroups} onChange={setCustomizationGroups} />
                </div>
              </TabsContent>
            )}
          </div>
        </Tabs>

        <div className='flex items-center justify-end gap-3 px-6 py-4 border-t mt-auto shrink-0 bg-muted/20'>
          {hasUnsavedEditChanges && (
            <span className='mr-auto text-xs text-muted-foreground flex items-center gap-1.5' data-testid='unsaved-changes-indicator'>
              <span className='h-1.5 w-1.5 rounded-full bg-amber-500' /> Unsaved changes
            </span>
          )}
          {/* Cancel on create/duplicate/draft-edit FLUSHES a server draft, so
              it is not a discard — label it honestly. Plain-edit Cancel
              discards (with the confirm dialog). */}
          <Button variant='outline' onClick={requestClose}>{isEdit && !isDraftEdit ? 'Cancel' : 'Save & Close'}</Button>
          {isDraftEdit && currentRow && (
            <Button
              variant='outline'
              disabled={saveDraftMut.isPending}
              onClick={() => saveDraftMut.mutate({ id: currentRow.id, data: buildPayload() })}
            >
              {saveDraftMut.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              Save Draft
            </Button>
          )}
          {!isEdit && (
            <Button
              variant='outline'
              disabled={manualDraftMut.isPending}
              onClick={() => {
                if (formUntouched()) { toast('No changes to save yet'); return }
                try { manualDraftMut.mutate() } catch (err: any) { toast.error(`Could not prepare the product data: ${err?.message || err}`) }
              }}
            >
              {manualDraftMut.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              Save Draft
            </Button>
          )}
          <Button onClick={() => handleSaveClick()} disabled={createMut.isPending || updateMut.isPending || publishDraftMut.isPending || !fullProductReady}>
            {(createMut.isPending || updateMut.isPending || publishDraftMut.isPending) && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {isDraftEdit ? 'Publish' : isEdit ? 'Update Product' : createdProductId ? 'Update Product' : 'Create Product'}
          </Button>
        </div>
      </DialogContent>
      {adjustmentModalOpen && currentRow?.id && (
        <ManagedStockAdjustmentModal
          open={adjustmentModalOpen}
          onOpenChange={setAdjustmentModalOpen}
          initialProductId={currentRow.id}
          initialVariantId={activeVariantId || undefined}
        />
      )}
    </Dialog>

    {/* Nested overlays — full modals (Radix), rendered as siblings of the main
        dialog. Modal nesting cooperates: focus trap, ESC-to-close, scroll lock
        and aria-hidden are managed per layer, and the hasSubOverlay guards
        keep the parent open until the top-most layer resolves. */}
    <Dialog open={showReviewGuard} onOpenChange={(v) => { if (v) setShowReviewGuard(true); else setTimeout(() => setShowReviewGuard(false), 0) }}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Review before creating</DialogTitle>
          <DialogDescription>
            The following configuration areas may need attention
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-2'>
          {reviewGuardItems.map((item, i) => (
            <div key={i} className='flex items-center gap-2 text-sm border rounded-lg p-3'>
              <span className='text-amber-500 font-bold'>⚠</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div className='flex justify-end gap-3 pt-2'>
          <Button variant='outline' onClick={() => setTimeout(() => setShowReviewGuard(false), 0)}>Continue Editing</Button>
          <Button onClick={() => { handleSaveClick(true); setTimeout(() => setShowReviewGuard(false), 0); }} disabled={createMut.isPending || updateMut.isPending}>
            {(createMut.isPending || updateMut.isPending) && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Create Anyway
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={!!variantImgMgr} onOpenChange={(v) => { if (!v) setTimeout(() => setVariantImgMgr(null), 0) }}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Variant Images</DialogTitle>
        </DialogHeader>
        <div className='flex items-center justify-between'>
          <p className='text-sm text-muted-foreground'>
            {variantImgMgr?.images.length === 0
              ? 'No images for this variant'
              : `${variantImgMgr?.images.length} image(s) — drag to reorder, first is primary`}
          </p>
          <Button variant='outline' size='sm' onClick={() => setVariantImgGalleryOpen(true)}>
            <ImageIcon className='h-4 w-4 mr-1' /> Add Images
          </Button>
        </div>
        {variantImgMgr && variantImgMgr.images.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-10 text-muted-foreground border-2 border-dashed rounded-lg'>
            <Package className='h-8 w-8 mb-2' />
            <p className='text-sm'>No images for this variant</p>
            <Button variant='outline' size='sm' className='mt-2' onClick={() => setVariantImgGalleryOpen(true)}>Browse Library</Button>
          </div>
        ) : variantImgMgr ? (
          <DndContext sensors={imageDndSensors} collisionDetection={closestCenter} onDragEnd={(event) => {
            const { active, over } = event
            if (!over || active.id === over.id) return
            const imgs = variantImgMgr.images
            const idToUrl = (id: string) => imgs.find(u => `vimg-${variantImgMgr.variantId}-${u}` === id)
            const oldUrl = idToUrl(active.id as string)
            const newUrl = idToUrl(over.id as string)
            if (!oldUrl || !newUrl) return
            const oldIdx = imgs.indexOf(oldUrl)
            const newIdx = imgs.indexOf(newUrl)
            if (oldIdx === -1 || newIdx === -1) return
            reorderVariantImg(variantImgMgr.variantId, oldIdx, newIdx)
          }}>
            <SortableContext items={variantImgMgr.images.map(u => `vimg-${variantImgMgr.variantId}-${u}`)} strategy={rectSortingStrategy}>
              <div className='grid grid-cols-4 gap-3'>
                {variantImgMgr.images.map((url) => {
                  const idx = variantImgMgr.images.indexOf(url)
                  return (
                    <SortableImageCard
                      key={`vimg-${variantImgMgr.variantId}-${url}`}
                      url={url}
                      isPrimary={idx === 0}
                      onSetPrimary={(u) => setPrimaryVariantImg(variantImgMgr.variantId, u)}
                      onRemove={(u) => removeVariantImg(variantImgMgr.variantId, u)}
                    />
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        ) : null}
        <div className='flex justify-end gap-3 pt-2 border-t'>
          <Button variant='outline' onClick={() => setTimeout(() => setVariantImgMgr(null), 0)} disabled={updateVariantMut.isPending}>Cancel</Button>
          <Button onClick={saveVariantImgMgr} disabled={updateVariantMut.isPending}>
            {updateVariantMut.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Save Images
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {variantImgGalleryOpen && variantImgMgr && (
      <MediaPicker
        open={variantImgGalleryOpen}
        onOpenChange={setVariantImgGalleryOpen}
        selected={variantImgMgr.images}
        multiple={true}
        onSelect={(urls) => {
          setVariantImgMgr(prev => prev ? { ...prev, images: dedupUrls(urls) } : null)
          setVariantImgGalleryOpen(false)
        }}
      />
    )}

    <ConfirmDialog
      open={regenerateConfirm}
      onOpenChange={(v) => { if (v) setRegenerateConfirm(true); else setTimeout(() => setRegenerateConfirm(false), 0) }}
      title='Regenerate Variants?'
      desc={<span>This product already has <strong>{variantList.length} variant(s)</strong>. Regenerating will <strong className='text-destructive'>delete all existing variants</strong> and recreate them with default prices and stock. Any custom prices, images, or inventory adjustments will be lost.</span>}
      confirmText='Delete &amp; Regenerate'
      destructive
      isLoading={genVariantMut.isPending}
      handleConfirm={handleGenerateVariants}
    />

    <ConfirmDialog
      open={clearVariantConfirm}
      onOpenChange={(v) => { if (v) setClearVariantConfirm(true); else setTimeout(() => setClearVariantConfirm(false), 0) }}
      title='Remove All Variants?'
      desc={`This will delete all ${variantList.length} variant(s) and convert the product to Simple type.`}
      confirmText={clearVariantMut.isPending ? 'Removing...' : 'Remove All'}
      destructive
      isLoading={clearVariantMut.isPending}
      handleConfirm={() => { const id = currentRow?.id || createdProductId; if (id) clearVariantMut.mutate(id); }}
    />

    {/* Unsaved-changes guard for plain edits (create/duplicate/draft-edit
        sessions persist to a server draft on close instead). Deferred close:
        the click that confirms this dialog is a pointer event the outer
        dialog must settle before the guard drops (see Key Decisions). */}
    <ConfirmDialog
      open={showDiscardConfirm}
      onOpenChange={(v) => { if (v) setShowDiscardConfirm(true); else setTimeout(() => setShowDiscardConfirm(false), 0) }}
      title='Discard unsaved changes?'
      desc='This product has edits that have not been saved yet. Closing now will discard them.'
      confirmText='Discard changes'
      destructive
      handleConfirm={() => setTimeout(() => { setShowDiscardConfirm(false); closeNow() }, 0)}
    />

    {/* Nested dialog MUST be a full modal. A non-modal DialogContent inside a
        modal parent is portaled to <body>, so Radix treats clicks on it as
        "outside" the parent; when setBulkUpdateOpen(false) runs, the pending
        dismiss drops hasSubOverlay and the parent closes — losing the whole
        product form. Nested modals cooperate instead of dismissing each other. */}
    <Dialog open={bulkUpdateOpen} onOpenChange={(v) => { if (v) setBulkUpdateOpen(true); else setTimeout(() => setBulkUpdateOpen(false), 0) }}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Bulk Update All Variants</DialogTitle>
        </DialogHeader>
        <p className='text-sm text-muted-foreground'>
          Check the fields you want to update. Only checked fields will be applied to all {variantList.length} variant(s).
        </p>
        <div className='space-y-3'>
            <label className='flex items-center gap-3 cursor-pointer'>
              <input type='checkbox' checked={bulkOverridePrice} onChange={e => setBulkOverridePrice(e.target.checked)} className='rounded' />
              <span className='text-sm w-24'>Price</span>
              <Input type='number' step='0.01' value={bulkPrice} onChange={e => setBulkPrice(e.target.value)} placeholder='0.00' disabled={!bulkOverridePrice} className='flex-1' />
            </label>
            <label className='flex items-center gap-3 cursor-pointer'>
              <input type='checkbox' checked={bulkOverrideSalePrice} onChange={e => setBulkOverrideSalePrice(e.target.checked)} className='rounded' />
              <span className='text-sm w-24'>Sale Price</span>
              <Input type='number' step='0.01' value={bulkSalePrice} onChange={e => setBulkSalePrice(e.target.value)} placeholder='0.00' disabled={!bulkOverrideSalePrice} className='flex-1' />
            </label>
            <label className='flex items-center gap-3 cursor-pointer'>
              <input type='checkbox' checked={bulkOverrideStandardCost} onChange={e => setBulkOverrideStandardCost(e.target.checked)} className='rounded' />
              <span className='text-sm w-24'>Std Cost</span>
              <Input type='number' step='0.01' value={bulkStandardCost} onChange={e => setBulkStandardCost(e.target.value)} placeholder='0.00' disabled={!bulkOverrideStandardCost} className='flex-1' />
            </label>
          </div>
          <div className='flex justify-end gap-3 pt-2'>
            <Button variant='outline' onClick={() => setTimeout(() => setBulkUpdateOpen(false), 0)} disabled={isBulkUpdating}>Cancel</Button>
            <Button onClick={handleBulkUpdate} disabled={isBulkUpdating}>
              {isBulkUpdating && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              Apply to All
            </Button>
          </div>
      </DialogContent>
    </Dialog>
  </>
  )
}

function SortableVariantRow(props: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 10 : 0,
  }
  return (
    <div ref={setNodeRef} style={style} className='flex items-center'>
      <button
        type='button'
        className='cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground shrink-0 touch-none'
        {...attributes}
        {...listeners}
      >
        <GripVertical className='h-4 w-4' />
      </button>
      <div className='flex-1 min-w-0'>
        {props.children}
      </div>
    </div>
  )
}

function SortableImageCard({ url, isPrimary, onSetPrimary, onRemove }: { url: string; isPrimary: boolean; onSetPrimary: (url: string) => void; onRemove: (url: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `img-${url}` })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} className='relative group border rounded-lg overflow-hidden bg-muted/30 aspect-square'>
      <SafeImage src={imgUrl(url)} alt='' className='w-full h-full object-cover' />
      <button
        type='button'
        className='absolute top-1 left-1 cursor-grab active:cursor-grabbing p-1 bg-black/40 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity touch-none'
        {...attributes}
        {...listeners}
      >
        <GripVertical className='h-3.5 w-3.5' />
      </button>
      <button
        type='button'
        onClick={() => onRemove(url)}
        className='absolute top-1 right-1 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity'
      >
        <X className='h-3 w-3' />
      </button>
      {isPrimary ? (
        <Badge className='absolute bottom-1 left-1 text-xs gap-1'>
          <Star className='h-3 w-3 fill-current' /> Primary
        </Badge>
      ) : (
        <button
          type='button'
          onClick={() => onSetPrimary(url)}
          className='absolute bottom-1 left-1 bg-foreground/70 text-background text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1'
        >
          <Star className='h-2.5 w-2.5' /> Primary
        </button>
      )}
    </div>
  )
}

function VariantRow({
  variant,
  productId,
  onUpdate,
  onImagePick,
  currencySymbol,
  onAdjustStock,
  onDelete,
}: {
  variant: ProductResponse['variants'][number]
  productId: string
  onUpdate: (data: any) => void
  onImagePick: () => void
  currencySymbol: string
  onAdjustStock?: () => void
  onDelete?: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const startEdit = (field: string, current: any) => {
    setEditing(field)
    setEditValue(String(current ?? ''))
  }

  const saveEdit = () => {
    if (!editing) return
    const field = editing as 'price' | 'salePrice' | 'standardCost' | 'sku'
    if (field === 'sku') {
      if (!editValue.trim()) {
        toast.error('SKU cannot be empty')
        cancelEdit()
        return
      }
      onUpdate({ sku: editValue.trim() })
    } else if (field === 'price') {
      const val = parseFloat(editValue)
      if (isNaN(val) || val < 0) {
        toast.error('Price must be a valid positive number')
        cancelEdit()
        return
      }
      onUpdate({ price: val })
    } else if (field === 'salePrice') {
      const val = editValue === '' ? null : parseFloat(editValue)
      if (val !== null && (isNaN(val) || val < 0)) {
        toast.error('Sale price must be a valid positive number')
        cancelEdit()
        return
      }
      onUpdate({ salePrice: val })
    } else if (field === 'standardCost') {
      const val = editValue === '' ? null : parseFloat(editValue)
      if (val !== null && (isNaN(val) || val < 0)) {
        toast.error('Standard cost must be a valid positive number')
        cancelEdit()
        return
      }
      onUpdate({ standardCost: val })
    }
    setEditing(null)
  }

  const cancelEdit = () => setEditing(null)
  const variantImages = variant.images?.length ? variant.images : (variant.image ? [variant.image] : [])

  return (
    <div className='p-3 flex items-center gap-3 text-sm hover:bg-muted/10 transition-colors'>
      <div className='shrink-0 cursor-pointer' onClick={onImagePick}>
        {variantImages.length === 0 ? (
          <div className='h-12 w-12 rounded border bg-muted overflow-hidden flex items-center justify-center'>
            <ImageIcon className='h-4 w-4 text-muted-foreground' />
          </div>
        ) : (
          <div className='relative'>
            <div className='flex -space-x-2 hover:space-x-0.5 transition-all'>
              {variantImages.slice(0, 3).map((img: string, i: number) => (
                <div key={i} className='h-12 w-12 rounded border bg-muted overflow-hidden shadow-sm' style={{ zIndex: 3 - i }}>
                  <SafeImage src={imgUrl(img)} alt='' className='h-full w-full object-cover' />
                </div>
              ))}
              {variantImages.length > 3 && (
                <div className='h-12 w-12 rounded border bg-muted/50 overflow-hidden flex items-center justify-center text-xs text-muted-foreground shadow-sm' style={{ zIndex: 0 }}>
                  +{variantImages.length - 3}
                </div>
              )}
            </div>
            {variantImages.length > 0 && (
              <span className='absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[9px] px-1 py-0.5 rounded-full leading-none border border-background'>
                {variantImages.length}
              </span>
            )}
          </div>
        )}
      </div>
      <div className='flex-1 min-w-0 grid grid-cols-7 gap-3 items-center'>
        <div className='min-w-0'>
          <p className='font-medium text-xs text-muted-foreground mb-0.5'>Attribute</p>
          <p className='truncate'>{variant.attributeValues?.map(av => av.attributeValue.value).join(' / ')}</p>
        </div>

        {/* SKU */}
        <div className='min-w-0'>
          <p className='font-medium text-xs text-muted-foreground mb-0.5'>SKU</p>
          {editing === 'sku' ? (
            <div className='flex items-center gap-1'>
              <Input value={editValue} onChange={e => setEditValue(e.target.value)} className='h-7 text-xs py-0 px-2' autoFocus onBlur={saveEdit} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }} />
            </div>
          ) : (
            <button onClick={() => startEdit('sku', variant.sku)} className='flex items-center gap-1 group'>
              <span className='text-xs'>{variant.sku}</span>
              <Pencil className='h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100' />
            </button>
          )}
        </div>

        {/* Reg. Price */}
        <div className='min-w-0'>
          <p className='font-medium text-xs text-muted-foreground mb-0.5'>Reg. Price</p>
          {editing === 'price' ? (
            <div className='flex items-center gap-1'>
              <span className='text-xs text-muted-foreground'>{currencySymbol}</span>
              <Input type='number' step='0.01' value={editValue} onChange={e => setEditValue(e.target.value)} className='h-7 text-xs py-0 px-2 w-24' autoFocus onBlur={saveEdit} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }} />
            </div>
          ) : (
            <button onClick={() => startEdit('price', variant.price)} className='flex items-center gap-1 group'>
              <span>{currencySymbol}{Number(variant.price || 0).toFixed(2)}</span>
              <Pencil className='h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100' />
            </button>
          )}
        </div>

        {/* Sale Price */}
        <div className='min-w-0'>
          <p className='font-medium text-xs text-muted-foreground mb-0.5'>Sale Price</p>
          {editing === 'salePrice' ? (
            <div className='flex items-center gap-1'>
              <span className='text-xs text-muted-foreground'>{currencySymbol}</span>
              <Input type='number' step='0.01' value={editValue} onChange={e => setEditValue(e.target.value)} className='h-7 text-xs py-0 px-2 w-24' autoFocus onBlur={saveEdit} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }} />
            </div>
          ) : (
            <button onClick={() => startEdit('salePrice', variant.salePrice)} className='flex items-center gap-1 group'>
              {variant.salePrice ? (
                <span className='text-green-600 font-medium'>{currencySymbol}{Number(variant.salePrice).toFixed(2)}</span>
              ) : (
                <span className='text-muted-foreground italic text-xs'>—</span>
              )}
              <Pencil className='h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100' />
            </button>
          )}
        </div>

        {/* Stock (read-only — edit via Inventory) */}
        <div className='min-w-0 flex items-center gap-1.5'>
          <div>
            <p className='font-medium text-xs text-muted-foreground mb-0.5'>Stock</p>
            <Badge variant={variant.managedStockQuantity > 0 ? 'secondary' : 'destructive'} className='text-xs'>
              {variant.managedStockQuantity}
            </Badge>
          </div>
          {onAdjustStock && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 mt-4"
              onClick={onAdjustStock}
              title="Adjust Stock"
            >
              <Pencil className="h-3 w-3" />
            </Button>
          )}
        </div>

        {/* Standard Cost */}
        <div className='min-w-0'>
          <p className='font-medium text-xs text-muted-foreground mb-0.5'>Std. Cost</p>
          {editing === 'standardCost' ? (
            <div className='flex items-center gap-1'>
              <span className='text-xs text-muted-foreground'>{currencySymbol}</span>
              <Input type='number' step='0.01' value={editValue} onChange={e => setEditValue(e.target.value)} className='h-7 text-xs py-0 px-2 w-24' autoFocus onBlur={saveEdit} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }} />
            </div>
          ) : (
            <button onClick={() => startEdit('standardCost', variant.standardCost)} className='flex items-center gap-1 group'>
              {variant.standardCost != null ? (
                <span>{currencySymbol}{Number(variant.standardCost).toFixed(2)}</span>
              ) : (
                <span className='text-muted-foreground italic text-xs'>—</span>
              )}
              <Pencil className='h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100' />
            </button>
          )}
        </div>

        {/* Delete */}
        <div className='min-w-0 flex items-center justify-end'>
          {onDelete && (
            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7 text-destructive hover:text-destructive'
              onClick={onDelete}
              title='Remove variant'
            >
              <Trash2 className='h-3.5 w-3.5' />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

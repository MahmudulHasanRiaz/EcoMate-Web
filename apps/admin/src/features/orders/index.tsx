import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ordersApi, mediaUrl, type OrderResponse } from './api'
import { returnsApi } from '@/features/returns/api'
import { usersApi } from '@/features/users/api'
import { SafeImage } from '@/components/safe-image'
import { CustomerContactActions } from '@/components/customer-contact-actions'
import { BlockPhoneDialog } from '@/features/orders/block-phone-dialog'
import { apiClient } from '@/lib/api-client'
import { useLicenseStore } from '@/stores/license-store'
import { useOrdersFilterStore } from '@/stores/orders-filter-store'
import { copyToClipboard } from '@/lib/clipboard'
import { resolveOrderItemImages } from '@/lib/product-image'
import { getCustomerDisplayName, getCustomerPhone, getCustomerEmail, extractOrderScanCode, getOrderPaymentMode, hasOpenCodAlert } from '@/lib/order-display'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Loader2, ExternalLink, Printer, X, ChevronLeft, ChevronRight, ArrowUpDown, Truck, ChevronRight as ChevronRightIcon, Package, MapPin, Mail, Tag, Phone, Receipt, CreditCard, MessageCircle, FileText, ClipboardCopy, MoreHorizontal, Inbox, Eye, UserCheck, Calendar, Search as SearchIcon, Send, Plus, Upload, Trash2, Ban, RotateCcw, ArrowRightLeft } from 'lucide-react'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { OrderSourceBadges } from '@/features/orders/order-source-badge'
import { CanonicalAttributionBadges } from '@/features/orders/canonical-attribution-badge'
import { formatCourierDispatchToast } from '@/features/dispatch/courier-errors'
import { useSteadfastSets } from '@/features/dispatch/steadfast-set-picker'
import { BulkSteadfastDefaultWarning } from '@/features/orders/bulk-steadfast-warning'

const fallbackStatusColors: Record<string, string> = { Pending: 'var(--warning)', Confirmed: 'var(--info)', Cancelled: 'var(--danger)', 'On Hold': 'var(--accent-violet)', 'Hold': 'var(--accent-violet)', 'Recall': 'var(--warning)', 'No Response': 'var(--muted-foreground)', Packed: 'var(--accent-cyan)', Shipped: 'var(--success)', 'Shipping': 'var(--accent-cyan)', 'In Courier': 'var(--accent-violet)', Delivered: 'var(--success)', 'Partial Return': 'var(--warning)', 'Return Pending': 'var(--accent-pink)', Returned: 'var(--danger)', Damaged: 'var(--danger)' }
const nn = (v: number | string) => Number(v)
const fmt = (v: number | string) => nn(v).toFixed(2)

function getStatusColor(statusName: string, statusColor?: string): string {
  if (statusColor && statusColor !== '#6B7280') return statusColor
  return fallbackStatusColors[statusName] || '#6B7280'
}

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

type AddressParts = { line1?: string; line2?: string; city?: string; zone?: string; postcode?: string; country?: string; phone?: string; name?: string }

function parseAddress(addr: unknown): AddressParts {
  if (!addr || typeof addr !== 'object') return {}
  const a = addr as Record<string, unknown>
  return {
    line1: (a.address || a.addressLine || a.street || a.line1 || '') as string,
    line2: (a.line2 || a.area || '') as string,
    city: (a.city || a.thana || '') as string,
    zone: (a.zone || a.state || a.region || a.district || '') as string,
    postcode: (a.postcode || a.zip || a.postalCode || '') as string,
    country: (a.country || '') as string,
    phone: (a.phone || a.phoneNumber || '') as string,
    name: (a.name || '') as string,
  }
}

function formatAddressFull(addr: AddressParts): string {
  return [
    addr.line1,
    addr.line2,
    addr.city,
    addr.zone,
    addr.postcode,
    addr.country && addr.country !== 'Bangladesh' ? addr.country : '',
  ].filter(Boolean).join(', ')
}

function getProductThumb(item: OrderResponse['items'][number]): string | null {
  const resolved = resolveOrderItemImages(item?.product, undefined)
  if (!resolved.hasImage) return null
  const raw = resolved.image ?? resolved.colorImage ?? resolved.productImage
  return raw ? mediaUrl(raw) : null
}

function paymentMethodLabel(method: string): { label: string; colorClass: string } {
  const m = method?.toLowerCase() || ''
  if (m.includes('bkash')) return { label: 'bKash', colorClass: 'text-accent-pink' }
  if (m.includes('nagad')) return { label: 'Nagad', colorClass: 'text-warning' }
  if (m.includes('rocket')) return { label: 'Rocket', colorClass: 'text-accent-violet' }
  if (m.includes('card') || m.includes('visa') || m.includes('master')) return { label: method, colorClass: 'text-info' }
  if (m.includes('cash')) return { label: 'Cash', colorClass: 'text-success' }
  if (m.includes('cod') || m.includes('delivery')) return { label: 'COD', colorClass: 'text-success' }
  if (m.includes('bank') || m.includes('transfer')) return { label: method, colorClass: 'text-ink-muted' }
  if (m.includes('gateway')) return { label: method.split('_').slice(1).join(' ') || method, colorClass: 'text-muted-foreground' }
  return { label: method, colorClass: 'text-muted-foreground' }
}

function paymentStatusBadgeClass(status: string): { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string } {
  const s = status?.toLowerCase() || ''
  if (['paid', 'verified', 'completed'].includes(s)) return { variant: 'default', className: 'bg-success-soft text-success border-success/25' }
  if (['pending', 'payment_pending'].includes(s)) return { variant: 'secondary', className: 'bg-warning-soft text-warning border-warning/25' }
  if (['failed', 'cancelled', 'unpaid'].includes(s)) return { variant: 'destructive', className: 'bg-danger-soft text-danger border-danger/25' }
  if (['partial', 'partial_paid'].includes(s)) return { variant: 'default', className: 'bg-info-soft text-info border-info/25' }
  if (s === 'credit') return { variant: 'outline', className: 'bg-accent-violet-soft text-accent-violet border-accent-violet/25' }
  if (s === 'refunded') return { variant: 'outline', className: 'bg-accent-pink-soft text-accent-pink border-accent-pink/25' }
  return { variant: 'outline', className: '' }
}

function OrderRowSkeleton() {
  return (
    <TableRow className='hover:bg-transparent'>
      <TableCell className='pl-3'><Skeleton className='h-4 w-4 rounded' /></TableCell>
      <TableCell className='px-1'><Skeleton className='h-3.5 w-3.5 rounded' /></TableCell>
      <TableCell><div className='space-y-1.5'><Skeleton className='h-3.5 w-24 rounded' /><Skeleton className='h-3 w-16 rounded' /></div></TableCell>
      <TableCell><div className='space-y-1.5'><Skeleton className='h-3.5 w-28 rounded' /><Skeleton className='h-3 w-20 rounded' /></div></TableCell>
      <TableCell><Skeleton className='h-6 w-24 rounded-full' /></TableCell>
      <TableCell><Skeleton className='h-5 w-20 rounded-full' /></TableCell>
      <TableCell><Skeleton className='h-6 w-24 rounded-md' /></TableCell>
      <TableCell><Skeleton className='h-3.5 w-16 ml-auto rounded' /></TableCell>
      <TableCell className='pr-4'><Skeleton className='h-3.5 w-6 ml-auto rounded' /></TableCell>
      <TableCell className='pr-3'><Skeleton className='h-7 w-7 rounded-md ml-auto' /></TableCell>
    </TableRow>
  )
}

function EmptyState({ search, statusFilter, onClear }: { search: string; statusFilter: string; onClear: () => void }) {
  return (
    <div className='flex flex-col items-center justify-center py-20 px-4 text-center'>
      <div className='h-14 w-14 rounded-2xl bg-surface-raised border border-border/70 flex items-center justify-center mb-3.5 shadow-2xs text-muted-foreground'>
        <Inbox className='h-7 w-7' />
      </div>
      <h3 className='text-base font-semibold mb-1 text-foreground'>No orders found</h3>
      <p className='text-xs text-muted-foreground max-w-sm leading-relaxed'>
        {(search || statusFilter !== 'all')
          ? 'No orders match your current filters. Try adjusting your search term or clearing filters.'
          : 'No orders have been placed yet in this workspace.'}
      </p>
      {(search || statusFilter !== 'all') && (
        <Button variant='outline' size='sm' className='mt-4 h-8 text-xs rounded-lg gap-1.5 shadow-2xs' onClick={onClear}>
          <X className='h-3.5 w-3.5 mr-1' /> Clear filters
        </Button>
      )}
    </div>
  )
}

const ASSIGNEE_ROLE_VARIANT: Record<string, 'danger' | 'violet' | 'info' | 'success' | 'warning' | 'outline'> = {
  superadmin: 'danger',
  admin: 'violet',
  employee: 'info',
  packing_assistant: 'success',
  cashier: 'warning',
}

export function AssigneeCell({ assignee }: { assignee: { id: string; firstName?: string; lastName?: string } | null | undefined }) {
  const [open, setOpen] = useState(false)
  const { data: user, isLoading } = useQuery({
    queryKey: ['assignee-card', assignee?.id],
    queryFn: () => usersApi.get(assignee!.id).then(r => r.data),
    enabled: open && !!assignee?.id,
    staleTime: 120_000,
    retry: false,
  })
  if (!assignee) return <span className='text-xs text-muted-foreground/50 italic'>Unassigned</span>
  const name = `${assignee.firstName ?? ''} ${assignee.lastName ?? ''}`.trim() || 'Staff'
  const shown = user ?? null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={name} className='flex items-center gap-1.5 rounded-md px-1 -mx-1 transition-colors hover:bg-muted/50 cursor-pointer'>
        <div className='h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-semibold text-primary shrink-0'>
          {assignee.firstName?.[0]}{assignee.lastName?.[0]}
        </div>
        <span className='text-xs font-medium truncate max-w-[80px]'>{name}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className='h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0'>
                {(shown?.firstName ?? assignee.firstName)?.[0]}{(shown?.lastName ?? assignee.lastName)?.[0]}
              </div>
              <span>{shown ? `${shown.firstName} ${shown.lastName}` : name}</span>
            </DialogTitle>
          </DialogHeader>
          {isLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          ) : shown ? (
            <div className="space-y-3 py-1">
              <Card>
                <CardContent className="p-3 space-y-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{shown.email}</span>
                  </div>
                  {shown.phoneNumber && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span>{shown.phoneNumber}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm">
                    <UserCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Badge variant={ASSIGNEE_ROLE_VARIANT[shown.role] ?? 'outline'} className="text-[11px] px-1.5 py-0">
                      {shown.role.replace(/_/g, ' ')}
                    </Badge>
                    <Badge variant={shown.status === 'active' ? 'success' : 'outline'} className="text-[11px] px-1.5 py-0">
                      {shown.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">Joined {new Date(shown.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">User not found</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function CourierQuickView({ phone }: { phone: string }) {
  const { data: courierData, isLoading } = useQuery({ 
    queryKey: ['courier-search', phone], 
    queryFn: () => apiClient.get(`/courier/search?phone=${phone}`).then(r => r.data),
    enabled: !!phone
  })

  if (!phone) return null;
  if (isLoading) return <div className='text-xs text-muted-foreground flex items-center gap-1.5 py-1'><Loader2 className='h-3 w-3 animate-spin' /> Loading courier history...</div>
  
  const isDummy = !!courierData?.error;
  const summariesToUse = isDummy ? {
    "Steadfast (Dummy)": { "Total Parcels": 15, "Delivered Parcels": 12, "Canceled Parcels": 3 },
    "Pathao (Dummy)": { "Total Delivery": 8, "Successful Delivery": 5, "Canceled Delivery": 3 },
    "RedX (Dummy)": { "Total Parcels": 22, "Delivered Parcels": 15, "Canceled Parcels": 7 }
  } : courierData?.Summaries;

  if (summariesToUse) {
    const entries = Object.entries(summariesToUse as Record<string, any>);
    if (entries.length === 0) return null;

    let overallDelivered = 0;
    let overallCancelled = 0;
    let overallTotal = 0;

    entries.forEach(([, stats]) => {
      overallDelivered += (stats['Delivered Parcels'] || stats['Successful Delivery'] || 0);
      overallCancelled += (stats['Canceled Parcels'] || stats['Canceled Delivery'] || 0);
      overallTotal += (stats['Total Parcels'] || stats['Total Delivery'] || 0);
    });

    const overallSuccessRate = overallTotal > 0 ? Math.round((overallDelivered / overallTotal) * 100) : 0;
    const overallFailRate = overallTotal > 0 ? Math.round((overallCancelled / overallTotal) * 100) : 0;

    return (
      <div className='space-y-2 w-full mt-1.5'>
        <div className='flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider'>
          <Truck className='h-3 w-3' /> Courier Analytics
          {isDummy && <span className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-[4px] text-[9px] lowercase tracking-normal">dummy preview</span>}
        </div>
        
        <div className={`rounded-xl border border-border/70 dark:border-border/60 bg-card text-card-foreground shadow-2xs overflow-hidden ${isDummy ? 'opacity-90' : ''}`}>
          <div className='bg-muted/40 dark:bg-muted/20 px-3 py-2 border-b border-border/60 flex items-center justify-between'>
             <div className='text-xs font-bold uppercase tracking-wider text-muted-foreground'>Overall Success Rate</div>
             <div className='text-[10px] font-semibold text-muted-foreground bg-background px-1.5 py-0.5 rounded border border-border/60 shadow-2xs'>Total Parcels: <span className='text-foreground'>{overallTotal}</span></div>
          </div>
          <div className='p-3 space-y-3'>
             <div className='space-y-1.5'>
               <div className='flex justify-between text-sm font-black'>
                 <span className='text-emerald-600 dark:text-emerald-400'>{overallSuccessRate}%</span>
                 <span className='text-rose-600 dark:text-rose-400'>{overallFailRate}%</span>
               </div>
               <div className='h-2 w-full rounded-full bg-muted dark:bg-muted/60 overflow-hidden flex shadow-inner'>
                 <div className='h-full bg-emerald-500 dark:bg-emerald-400 transition-all duration-500' style={{ width: `${overallSuccessRate}%` }} />
                 <div className='h-full bg-rose-500 dark:bg-rose-400 transition-all duration-500' style={{ width: `${overallFailRate}%` }} />
               </div>
               <div className='flex justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground'>
                 <span>{overallDelivered} Delivered</span>
                 <span>{overallCancelled} Cancelled</span>
               </div>
             </div>

             <div className='flex flex-wrap gap-2 pt-2.5 border-t border-border/50'>
               {entries.map(([name, stats]) => {
                 const delivered = stats['Delivered Parcels'] || stats['Successful Delivery'] || 0;
                 const cancelled = stats['Canceled Parcels'] || stats['Canceled Delivery'] || 0;
                 return (
                   <div key={name} className='flex items-center gap-1.5 bg-muted/40 dark:bg-muted/20 rounded-md px-2 py-1 text-[10px] border border-border/60 shadow-2xs'>
                     <span className='font-bold text-foreground'>{name.replace(' (Dummy)', '')}</span>
                     <div className='flex items-center gap-1.5 bg-background px-1.5 py-0.5 rounded-sm border border-border/60'>
                       <span className='text-emerald-600 dark:text-emerald-400 font-bold' title='Delivered'>{delivered}</span>
                       <span className='text-muted-foreground/30'>/</span>
                       <span className='text-rose-600 dark:text-rose-400 font-bold' title='Cancelled'>{cancelled}</span>
                     </div>
                   </div>
                 )
               })}
             </div>
          </div>
        </div>
      </div>
    )
  }
  return null;
}

function OrdersStatusFilterBar({
  statusList,
  statusCountMap,
  totalOrders,
  statusFilter,
  setStatusFilter,
  kindFilter,
  setKindFilter,
  setPage,
}: {
  statusList: any[]
  statusCountMap: Record<string, number>
  totalOrders: number
  statusFilter: string
  setStatusFilter: (s: string) => void
  kindFilter: 'all' | 'SALE' | 'RETURN' | 'EXCHANGE'
  setKindFilter: (k: 'all' | 'SALE' | 'RETURN' | 'EXCHANGE') => void
  setPage: (p: number) => void
}) {
  const visible = statusList.filter((s: any) => (statusCountMap[s.id] || 0) > 0)
  if (visible.length === 0 && totalOrders === 0) return null

  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const isDraggingRef = useRef(false)
  const startXRef = useRef(0)
  const scrollStartLeftRef = useRef(0)
  const hasDraggedRef = useRef(false)

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setCanScrollLeft(scrollLeft > 4)
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 4)
  }, [])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return

    const ro = new ResizeObserver(() => checkScroll())
    ro.observe(el)
    return () => ro.disconnect()
  }, [checkScroll, visible.length, totalOrders])

  const scrollByAmount = (amount: number) => {
    if (!scrollRef.current) return
    scrollRef.current.scrollBy({ left: amount, behavior: 'smooth' })
  }

  // Mouse drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag with primary mouse button
    if (e.button !== 0 || !scrollRef.current) return
    isDraggingRef.current = true
    hasDraggedRef.current = false
    startXRef.current = e.pageX - scrollRef.current.offsetLeft
    scrollStartLeftRef.current = scrollRef.current.scrollLeft
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !scrollRef.current) return
    e.preventDefault()
    const x = e.pageX - scrollRef.current.offsetLeft
    const walk = (x - startXRef.current) * 1.2
    if (Math.abs(walk) > 4) {
      hasDraggedRef.current = true
    }
    scrollRef.current.scrollLeft = scrollStartLeftRef.current - walk
    checkScroll()
  }

  const handleMouseUpOrLeave = () => {
    isDraggingRef.current = false
  }

  // Horizontal mouse wheel navigation
  const handleWheel = (e: React.WheelEvent) => {
    const el = scrollRef.current
    if (!el) return
    if (e.deltaY !== 0 && !e.shiftKey) {
      // Allow user to scroll horizontally with vertical mouse wheel
      if (el.scrollWidth > el.clientWidth) {
        el.scrollLeft += e.deltaY
        checkScroll()
      }
    }
  }

  const renderChip = (
    key: string,
    label: string,
    count: number,
    color: string,
    active: boolean,
    onClick: () => void
  ) => (
    <button
      key={key}
      type="button"
      aria-pressed={active}
      title={`${label} (${count})`}
      onClick={() => {
        if (!hasDraggedRef.current) onClick()
      }}
      className={`group relative inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-all duration-200 select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        active
          ? 'font-semibold shadow-xs ring-1 ring-border/20'
          : 'border-border/60 bg-card/80 text-muted-foreground hover:text-foreground hover:bg-card hover:border-border/90 hover:shadow-2xs active:scale-[0.98]'
      }`}
      style={
        active
          ? {
              borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
              color: color,
            }
          : undefined
      }
    >
      <span
        className={`size-2 rounded-full shrink-0 transition-transform duration-200 ${
          active ? 'scale-110 shadow-xs' : 'opacity-70 group-hover:opacity-100 group-hover:scale-105'
        }`}
        style={{
          backgroundColor: color,
          boxShadow: active ? `0 0 8px color-mix(in srgb, ${color} 60%, transparent)` : undefined,
        }}
      />
      <span className="truncate max-w-36 tracking-tight">{label}</span>
      <span
        className={`tabular-nums text-[11px] px-1.5 py-0.5 min-w-[20px] text-center rounded-full font-bold transition-colors ${
          active
            ? 'bg-background/80 shadow-2xs border border-border/40'
            : 'bg-muted/80 text-muted-foreground/90 group-hover:bg-muted group-hover:text-foreground'
        }`}
        style={active ? { color } : undefined}
      >
        {count}
      </span>
    </button>
  )

  const allActive = statusFilter === 'all'

  return (
    <div className="relative group/status-bar flex items-center w-full min-w-0" aria-label="Filter orders by status">
      {/* Left scroll chevron button */}
      <div
        className={`absolute left-0 z-10 flex items-center pr-2 transition-opacity duration-200 ${
          canScrollLeft ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="absolute inset-y-0 -left-1 w-12 bg-gradient-to-r from-background via-background/90 to-transparent pointer-events-none" />
        <button
          type="button"
          onClick={() => scrollByAmount(-220)}
          aria-label="Scroll statuses left"
          className="relative size-7 rounded-full bg-card/95 hover:bg-card text-muted-foreground hover:text-foreground border border-border/80 shadow-sm flex items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable chip container */}
      <div
        ref={scrollRef}
        onScroll={checkScroll}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 w-full min-w-0 cursor-grab active:cursor-grabbing select-none scroll-smooth px-0.5"
      >
        {renderChip('all', 'All', totalOrders, 'var(--primary)', allActive, () => {
          if (!allActive) {
            setStatusFilter('all')
            setPage(1)
          }
        })}

        <div className="h-4.5 w-px bg-border/70 shrink-0 mx-1" />

        {([
          ['SALE', 'Sales', 'var(--primary)'],
          ['RETURN', 'Returns', '#EC4899'],
          ['EXCHANGE', 'Exchanges', '#8B5CF6'],
        ] as const).map(([value, label, color]) => {
          const active = kindFilter === value
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              title={label}
              onClick={() => {
                if (!hasDraggedRef.current) {
                  setKindFilter(active ? 'all' : value)
                  setPage(1)
                }
              }}
              className={`group relative inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-all duration-200 select-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                active
                  ? 'font-semibold shadow-xs ring-1 ring-border/20'
                  : 'border-border/60 bg-card/80 text-muted-foreground hover:text-foreground hover:bg-card hover:border-border/90 hover:shadow-2xs active:scale-[0.98]'
              }`}
              style={
                active
                  ? {
                      borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
                      backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
                      color: color,
                    }
                  : undefined
              }
            >
              <span
                className={`size-2 rounded-full shrink-0 transition-transform duration-200 ${
                  active ? 'scale-110 shadow-xs' : 'opacity-70 group-hover:opacity-100 group-hover:scale-105'
                }`}
                style={{
                  backgroundColor: color,
                  boxShadow: active ? `0 0 8px color-mix(in srgb, ${color} 60%, transparent)` : undefined,
                }}
              />
              <span className="truncate max-w-36 tracking-tight">{label}</span>
            </button>
          )
        })}

        {visible.length > 0 && <div className="h-4.5 w-px bg-border/70 shrink-0 mx-1" />}

        {visible.map((s: any) => {
          const color = getStatusColor(s.name, s.color)
          const active = statusFilter === s.id
          return renderChip(
            s.id,
            s.name,
            statusCountMap[s.id] || 0,
            color,
            active,
            () => {
              setStatusFilter(active ? 'all' : s.id)
              setPage(1)
            }
          )
        })}
      </div>

      {/* Right scroll chevron button */}
      <div
        className={`absolute right-0 z-10 flex items-center pl-2 transition-opacity duration-200 ${
          canScrollRight ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="absolute inset-y-0 -right-1 w-12 bg-gradient-to-l from-background via-background/90 to-transparent pointer-events-none" />
        <button
          type="button"
          onClick={() => scrollByAmount(220)}
          aria-label="Scroll statuses right"
          className="relative size-7 rounded-full bg-card/95 hover:bg-card text-muted-foreground hover:text-foreground border border-border/80 shadow-sm flex items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export function Orders() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [customRows, setCustomRows] = useState('')
  const [showCustomRows, setShowCustomRows] = useState(false)
  // Backend clamps list pages to 1000 rows — the custom input must offer the
  // same ceiling, or large values silently come back smaller ("custom broken").
  const applyCustomRows = () => {
    const n = Math.max(1, Math.min(1000, parseInt(customRows) || 10))
    setPerPage(n)
    setShowCustomRows(false)
    setCustomRows('')
    setPage(1)
  }
  const search = useOrdersFilterStore(s => s.search)
  const setSearch = useOrdersFilterStore(s => s.setSearch)
  const statusFilter = useOrdersFilterStore(s => s.statusFilter)
  const setStatusFilter = useOrdersFilterStore(s => s.setStatusFilter)
  const courierFilter = useOrdersFilterStore(s => s.courierFilter)
  const setCourierFilter = useOrdersFilterStore(s => s.setCourierFilter)
  const assigneeFilter = useOrdersFilterStore(s => s.assigneeFilter)
  const setAssigneeFilter = useOrdersFilterStore(s => s.setAssigneeFilter)
  const sort = useOrdersFilterStore(s => s.sort)
  const setSort = useOrdersFilterStore(s => s.setSort)
  const order = useOrdersFilterStore(s => s.order)
  const setOrder = useOrdersFilterStore(s => s.setOrder)
  const perPage = useOrdersFilterStore(s => s.perPage)
  const setPerPage = useOrdersFilterStore(s => s.setPerPage)
  const resetFilters = useOrdersFilterStore(s => s.resetFilters)
  const [selected, setSelected] = useState<string[]>([])
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [statusDialog, setStatusDialog] = useState<{ order: OrderResponse; newStatusId: string; newStatusName: string } | null>(null)
  const [statusNote, setStatusNote] = useState('')
  const [blockPhones, setBlockPhones] = useState<{ phones: string[]; contextLabel?: string } | null>(null)

  useEffect(() => { const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 350); return () => clearTimeout(t) }, [search])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchInputRef.current?.focus() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const { data: statuses } = useQuery({ queryKey: ['order-statuses'], queryFn: () => apiClient.get('/order-statuses').then(r => r.data as any[]) })
  const statusList = (Array.isArray(statuses) ? statuses : []) as any[]
  const { data: staffList } = useQuery({ queryKey: ['staff-list'], queryFn: () => apiClient.get('/orders/staff/list').then(r => r.data as any[]) })
  const staff = (Array.isArray(staffList) ? staffList : []) as any[]

  const [kindFilter, setKindFilter] = useState<'all' | 'SALE' | 'RETURN' | 'EXCHANGE'>('all')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['orders', page, perPage, debouncedSearch, statusFilter, courierFilter, assigneeFilter, sort, order, kindFilter],
    queryFn: () => ordersApi.list({ page, perPage, search: debouncedSearch || undefined, statusId: statusFilter !== 'all' ? statusFilter : undefined, courier: courierFilter !== 'all' ? courierFilter : undefined, assignedToId: assigneeFilter !== 'all' ? assigneeFilter : undefined, sort, order, kind: kindFilter !== 'all' ? kindFilter : undefined }).then(r => r.data),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, statusId, note }: { id: string; statusId: string; note?: string }) => ordersApi.updateStatus(id, statusId, note),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['orders'] }); toast.success('Status updated') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update status'),
  })

  const bulkStatusMut = useMutation({
    mutationFn: (d: { ids: string[]; statusId: string }) => apiClient.post('/orders/bulk/status', d),
    onSuccess: (res) => {
      const r = (res as any)?.data as { updated?: number; skipped?: number; failed?: number; failedDetails?: { id: string; reason: string }[] } | undefined
      const updated = r?.updated ?? 0
      const skipped = r?.skipped ?? 0
      const failed = r?.failed ?? 0
      const details = r?.failedDetails || []
      if (failed > 0) {
        toast.error(`${failed} order(s) could not be updated`)
        details.slice(0, 3).forEach((d) => toast.error(d.reason || 'Unknown error', { id: d.id }))
      }
      if (updated > 0) toast.success(`${updated} order(s) updated`)
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      if (updated > 0) setSelected([])
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Bulk status change failed'),
  })

  const bulkAssignMut = useMutation({
    mutationFn: (d: { ids: string[]; assignedToId: string | null }) => ordersApi.bulkAssign(d.ids, d.assignedToId === '__unassign__' ? null : d.assignedToId),
    onSuccess: (res) => {
      const r = (res as any)?.data as { updated?: number; total?: number } | undefined
      const updated = r?.updated ?? 0
      const total = r?.total ?? 0
      const missing = total - updated
      if (updated > 0) toast.success(`${updated} order(s) assigned`)
      if (missing > 0) toast.error(`${missing} order(s) could not be assigned`)
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      if (updated > 0) setSelected([])
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Assignment failed'),
  })

  const { data: courierCreds } = useQuery({ queryKey: ['courier-creds'], queryFn: () => apiClient.get('/couriers/credentials').then(r => r.data as any[]) })
  const activeCouriers = ((Array.isArray(courierCreds) ? courierCreds : []) as any[]).filter(
    (c: any) => useLicenseStore.getState().hasFeature(`courier_${c.courier}`)
  )
  const [dispatchCourier, setDispatchCourier] = useState('')
  // MEDIUM bulk-silent: the bulk dispatch path resolves ONE Steadfast
  // profile upfront (default account) and ignores per-order overrides —
  // surface that explicitly when >1 sets exist so staff are never
  // surprised. (Single-order dispatch keeps its per-order set picker.)
  const { data: steadfastSets = [] } = useSteadfastSets()
  const showBulkDefaultWarn = dispatchCourier === 'steadfast' && steadfastSets.length > 1

  const dispatchMut = useMutation({
    mutationFn: ({ courier, ids }: { courier: string; ids: string[] }) => apiClient.post(`/couriers/dispatch/${courier}`, { orderIds: ids }),
    onSuccess: (res) => {
      const results = (res as any)?.data as any[] || []
      const succeeded = results.filter((r: any) => r.ok)
      const failed = results.filter((r: any) => !r.ok)
      if (failed.length > 0) {
        toast.error(`${failed.length} order(s) failed to dispatch`)
        // Fix 5: each failure names the EXACT courier field+rule
        // (shaped backend error threaded through untouched).
        failed.forEach((r: any) => toast.error(formatCourierDispatchToast(r), { id: r.id, duration: 8000 }))
      }
      if (succeeded.length > 0) toast.success(`${succeeded.length} order(s) dispatched to courier`)
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      setSelected([])
      setDispatchCourier('')
    },
    onError: (e: any) => {
      // Fix 5: a whole-batch transport rejection can also carry the shaped
      // error ({message, errors}) — surface it with exact field+rule naming.
      const d = e?.response?.data
      toast.error(
        formatCourierDispatchToast({
          message: d?.message || (e as Error)?.message || 'Dispatch failed',
          errors: d?.errors,
        }),
        { duration: 8000 },
      )
    },
  })

  const trashOrderMut = useMutation({
    mutationFn: (id: string) => ordersApi.trash(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      setSelected([])
      toast.success('Order moved to trash')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to trash order'),
  })

  const toggleAll = () => { const ids = data?.data?.map((o: OrderResponse) => o.id) || []; setSelected(selected.length === ids.length ? [] : ids) }
  const selectedPhones = useMemo(() => {
    const rows = (data?.data || []) as OrderResponse[]
    const phones = rows
      .filter(o => selected.includes(o.id))
      .map(o => getCustomerPhone(o))
      .filter(Boolean)
    return Array.from(new Set(phones))
  }, [data, selected])
  const toggleOne = (id: string) => setSelected(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id])
  const toggleExpand = useCallback((id: string) => setExpandedRows(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next }), [])

  const clearAllFilters = () => { resetFilters(); setPage(1) }
  const hasActiveFilters = search || statusFilter !== 'all' || courierFilter !== 'all' || assigneeFilter !== 'all'

  const statusCountMap = useMemo(() => {
    return data?.meta?.statusCounts || {} as Record<string, number>
  }, [data?.meta?.statusCounts])

  const totalRevenue = useMemo(() => {
    if (!data?.data) return 0
    return data.data.reduce((sum: number, o: OrderResponse) => sum + nn(o.total), 0)
  }, [data])

  // Linked return/exchange badges come from the list response itself
  // (hasActiveReturn/activeReturnCount/hasActiveExchange, server-counted
  // per row — no extra fetches, no pagination cap).

  const totalOrders = data?.meta?.total || 0
  const totalPages = data?.meta?.totalPages || 1

  return (
    <>
      <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-4'>
        <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
          <div>
            <div className='flex items-center gap-2.5'>
              <h2 className='text-2xl font-bold tracking-tight'>Orders</h2>
              {isFetching ? (
                <div className='inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary'>
                  <Loader2 className='h-3 w-3 animate-spin' />
                  <span>Refreshing</span>
                </div>
              ) : (
                <div className='inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400'>
                  <span className='size-1.5 rounded-full bg-emerald-500 animate-pulse' />
                  <span>Live</span>
                </div>
              )}
            </div>
            <p className='text-muted-foreground text-xs mt-0.5'>
              <span className='font-semibold text-foreground'>{totalOrders}</span> orders found{data?.data ? ` · ৳${fmt(totalRevenue)} total` : ''}
              {selected.length > 0 && <span className='text-primary font-semibold ml-2'>({selected.length} selected)</span>}
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='h-8.5 gap-1.5 rounded-lg border-border/70 hover:bg-surface-raised font-medium shadow-2xs'
              onClick={() => navigate({ to: '/op/import-orders' })}
            >
              <Upload className='h-3.5 w-3.5' /> Import Orders
            </Button>
            <Button
              size='sm'
              className='h-8.5 gap-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs'
              onClick={() => navigate({ to: '/op/orders/create' })}
            >
              <Plus className='h-3.5 w-3.5' /> Create Order
            </Button>
          </div>
        </div>

        <OrdersStatusFilterBar
          statusList={statusList}
          statusCountMap={statusCountMap}
          totalOrders={totalOrders}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          kindFilter={kindFilter}
          setKindFilter={setKindFilter}
          setPage={setPage}
        />

        <div className='rounded-xl border border-border/70 bg-card/60 backdrop-blur-md p-2.5 shadow-2xs space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <div className='relative flex-1 min-w-[240px] max-w-md'>
              <SearchIcon className='absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70' />
              <Input
                ref={searchInputRef}
                placeholder='Order ID, phone, name or SKU…'
                aria-label='Search orders by order ID, phone number, customer name or product SKU'
                title='Search by order ID, phone number (with or without country code), customer name or product SKU'
                value={search}
                onChange={e => setSearch(extractOrderScanCode(e.target.value))}
                className='h-8.5 text-xs pl-8.5 pr-14 bg-background/80 focus:bg-background border-border/60 focus:border-primary/50 shadow-2xs transition-colors rounded-lg'
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className='absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors'
                >
                  <X className='h-3.5 w-3.5' />
                </button>
              ) : (
                <kbd className='pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex h-4.5 select-none items-center gap-1 rounded border border-border/70 bg-muted/60 px-1.5 font-mono text-[9.5px] font-medium text-muted-foreground/80'>
                  ⌘K
                </kbd>
              )}
            </div>

            <div className='w-[135px]'>
              <Select value={courierFilter} onValueChange={v => { setCourierFilter(v); setPage(1) }}>
                <SelectTrigger className='h-8.5 text-xs bg-background/80 focus:bg-background border-border/60 shadow-2xs rounded-lg'>
                  <div className='flex items-center gap-1.5 truncate'>
                    <Truck className='h-3.5 w-3.5 text-muted-foreground/70 shrink-0' />
                    <SelectValue placeholder='Courier' />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all' className='text-xs font-medium'>All Couriers</SelectItem>
                  {['steadfast','pathao','redx','carrybee'].map(c => (
                    <SelectItem key={c} value={c} className='capitalize text-xs font-medium'>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='w-[165px]'>
              <SearchableSelect
                options={[
                  { id: 'all', label: 'All Staff' },
                  { id: 'unassigned', label: 'Unassigned' },
                  ...staff.map((s: any) => ({ id: s.id, label: `${s.firstName} ${s.lastName}`.trim() }))
                ]}
                value={assigneeFilter}
                onChange={(v) => { setAssigneeFilter(v); setPage(1) }}
                placeholder='Staff'
                searchPlaceholder='Search staff...'
                triggerClassName='h-8.5 text-xs bg-background/80 focus:bg-background border-border/60 shadow-2xs rounded-lg'
              />
            </div>

            <div className='w-[90px]'>
              <Select value={String(perPage)} onValueChange={v => { if (v === 'custom') { setShowCustomRows(true) } else { setPerPage(parseInt(v)); setPage(1) } }}>
                <SelectTrigger className='h-8.5 text-xs bg-background/80 focus:bg-background border-border/60 shadow-2xs rounded-lg'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10,25,50,100].map(n => <SelectItem key={n} value={String(n)} className='text-xs'>{n} / page</SelectItem>)}
                  {![10,25,50,100].includes(perPage) && (
                    <SelectItem value={String(perPage)} className='text-xs'>{perPage} / page</SelectItem>
                  )}
                  <SelectItem value='custom' className='text-xs'>Custom...</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showCustomRows && (
              <div className='flex items-center gap-1 animate-in fade-in slide-in-from-left-2 duration-200'>
                <Input type='number' min={1} max={1000} className='h-8.5 w-16 text-xs bg-background/80 rounded-lg' placeholder='#' value={customRows} onChange={e => setCustomRows(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyCustomRows() }} />
                <Button size='sm' variant='ghost' className='h-8 w-8 px-0 hover:bg-background/70' onClick={applyCustomRows}>✓</Button>
              </div>
            )}

            {hasActiveFilters && (
              <Button variant='ghost' size='sm' className='h-8.5 text-xs text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-lg gap-1.5' onClick={clearAllFilters}>
                <X className='h-3.5 w-3.5' /> Reset
              </Button>
            )}
          </div>

          {hasActiveFilters && (
            <div className='flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-border/50'>
              <span className='text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider mr-1'>Active:</span>
              {courierFilter !== 'all' && (
                <button onClick={() => { setCourierFilter('all'); setPage(1) }} className='inline-flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-0.5 text-[11px] font-medium border border-border/70 shadow-2xs hover:bg-surface-raised transition-colors'>
                  <Truck className='h-3 w-3 text-muted-foreground' />
                  <span className='capitalize'>{courierFilter}</span>
                  <X className='h-3 w-3 ml-0.5 text-muted-foreground' />
                </button>
              )}
              {assigneeFilter !== 'all' && (() => {
                const person = assigneeFilter === 'unassigned' ? null : staff.find((s: any) => s.id === assigneeFilter)
                return (
                  <button onClick={() => { setAssigneeFilter('all'); setPage(1) }} className='inline-flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-0.5 text-[11px] font-medium border border-border/70 shadow-2xs hover:bg-surface-raised transition-colors'>
                    <UserCheck className='h-3 w-3 text-muted-foreground' />
                    <span>{assigneeFilter === 'unassigned' ? 'Unassigned' : person ? `${person.firstName}` : 'Staff'}</span>
                    <X className='h-3 w-3 ml-0.5 text-muted-foreground' />
                  </button>
                )
              })()}
              {search && (
                <button onClick={() => setSearch('')} className='inline-flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-0.5 text-[11px] font-medium border border-border/70 shadow-2xs hover:bg-surface-raised transition-colors'>
                  <span className='text-muted-foreground'>Search:</span>
                  <span className='font-semibold'>"{search.slice(0,18)}{search.length > 18 ? '...' : ''}"</span>
                  <X className='h-3 w-3 ml-0.5 text-muted-foreground' />
                </button>
              )}
            </div>
          )}
        </div>

        <Card className='rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden'>
          <CardContent className='p-0'>
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader className='bg-muted/40 dark:bg-muted/20 sticky top-0 z-10 border-b border-border/70 backdrop-blur-xs'>
                  <TableRow className='hover:bg-transparent border-b border-border/70'>
                    <TableHead className='w-10 pl-3'>
                      <Checkbox checked={(data?.data?.length ?? 0) > 0 && selected.length === (data?.data?.length ?? 0)} onCheckedChange={toggleAll} />
                    </TableHead>
                    <TableHead className='w-7 px-1'></TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Order</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Customer</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Status</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Courier</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Assigned To</TableHead>
                    <TableHead className='text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none' onClick={() => { setSort('total'); setOrder(order === 'asc' ? 'desc' : 'asc') }}>
                      <span className='inline-flex items-center gap-1 justify-end'>
                        Total {sort === 'total' ? (order === 'asc' ? '↑' : '↓') : <ArrowUpDown className='h-3 w-3 inline ml-1' />}
                      </span>
                    </TableHead>
                    <TableHead className='text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pr-4'>Items</TableHead>
                    <TableHead className='w-10 pr-3'></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <>
                      <OrderRowSkeleton /><OrderRowSkeleton /><OrderRowSkeleton />
                      <OrderRowSkeleton /><OrderRowSkeleton /><OrderRowSkeleton />
                    </>
                  ) : data?.data?.length ? data.data.flatMap((o: OrderResponse) => {
                    const isExpanded = expandedRows.has(o.id)
                    const addr = parseAddress(o.shippingAddress)
                    const accentColor = getStatusColor(o.status?.name, o.status?.color)
                    const isSelected = selected.includes(o.id)
                    return [
                      <TableRow
                        key={o.id}
                        // 1000-row pages stay smooth: off-screen rows skip
                        // rendering but keep their scroll size.
                        className={`group cursor-pointer transition-colors border-b border-border/50 dark:border-border/40 [content-visibility:auto] [contain-intrinsic-size:auto_72px] ${
                          isSelected ? 'bg-primary/8 dark:bg-primary/15 hover:bg-primary/12 dark:hover:bg-primary/20' : 'hover:bg-muted/40 dark:hover:bg-muted/20 even:bg-muted/[0.02] dark:even:bg-muted/[0.03]'
                        }`}
                        onClick={() => toggleExpand(o.id)}
                        style={{ borderLeftWidth: 3, borderLeftColor: accentColor }}
                      >
                        <TableCell onClick={e => e.stopPropagation()} className='pl-3'>
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleOne(o.id)} />
                        </TableCell>
                        <TableCell className='px-1'>
                          <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                            <ChevronRightIcon className={`h-3.5 w-3.5 transition-colors ${isExpanded ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-foreground'}`} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className='flex items-center gap-1.5'>
                            <Link
                              to='/op/orders/$id'
                              params={{ id: o.id }}
                              className='font-mono text-xs font-bold text-primary hover:underline'
                              onClick={e => e.stopPropagation()}
                            >
                              {o.displayId}
                            </Link>
                            {o.kind === 'RETURN' && (
                              <span className='inline-flex items-center gap-1 rounded-full border border-pink-500/40 bg-pink-500/10 px-1.5 py-0.5 text-[9px] font-bold text-pink-600 dark:text-pink-400'>
                                <RotateCcw className='h-2.5 w-2.5' /> RTN
                              </span>
                            )}
                            {o.kind === 'EXCHANGE' && (
                              <span className='inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-bold text-violet-600 dark:text-violet-400'>
                                <ArrowRightLeft className='h-2.5 w-2.5' /> Exchange
                              </span>
                            )}
                            {(o.activeReturnCount ?? 0) > 0 && (
                              <Link
                                to='/op/orders/$id'
                                params={{ id: o.id }}
                                onClick={e => e.stopPropagation()}
                                title={`${o.activeReturnCount} active return(s) — view linked returns`}
                                className='inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400 hover:underline'
                              >
                                ↩ Return ×{o.activeReturnCount}
                              </Link>
                            )}
                            {o.hasActiveExchange && (
                              <Link
                                to='/op/orders/$id'
                                params={{ id: o.id }}
                                onClick={e => e.stopPropagation()}
                                title='Has a linked exchange order — view linked exchanges'
                                className='inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-bold text-violet-600 dark:text-violet-400 hover:underline'
                              >
                                ⇄ Exchange
                              </Link>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); copyToClipboard(o.displayId, 'Order ID') }}
                                  aria-label='Copy Order ID'
                                  className='opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity text-muted-foreground/70 hover:text-foreground'
                                >
                                  <ClipboardCopy className='h-3 w-3' />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Copy order ID</TooltipContent>
                            </Tooltip>
                          </div>
                          <div className='flex items-center gap-1.5 mt-0.5'>
                            <span
                              className='cursor-pointer text-[11px] text-muted-foreground select-none'
                              onClick={e => { e.stopPropagation(); setSort('createdAt'); setOrder(order === 'asc' ? 'desc' : 'asc') }}
                            >
                              {new Date(o.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                              <span className='text-muted-foreground/60 ml-1'>{relativeTime(o.createdAt)}</span>
                            </span>
                            <CanonicalAttributionBadges
                              channel={o.channel}
                              channelEntity={o.channelEntity}
                              sourceSlug={o.sourceSlug}
                              sourceLabel={o.sourcePlatformName}
                              acquisitionType={o.acquisitionType}
                            />
                            {!o.channel && !o.sourceSlug && !o.acquisitionType &&
                              (o.salesChannel || o.sourcePlatform || o.sourceType || o.sourceEntity) ? (
                              <OrderSourceBadges
                                attribution={{
                                  salesChannel: o.salesChannel,
                                  sourcePlatform: o.sourcePlatform,
                                  sourceType: o.sourceType,
                                  sourceEntity: o.sourceEntity,
                                }}
                              />
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className='text-xs font-semibold leading-tight text-foreground'>{getCustomerDisplayName(o)}</div>
                          <div className='flex items-center gap-1.5 mt-0.5'>
                            <a
                              href={`tel:${getCustomerPhone(o)}`}
                              onClick={e => e.stopPropagation()}
                              className='text-[11px] text-muted-foreground hover:text-primary transition-colors'
                            >
                              {getCustomerPhone(o) || '—'}
                            </a>
                            <CustomerContactActions phone={getCustomerPhone(o)} />
                          </div>
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          {o.kind !== 'RETURN' && (
                            <Select
                              value={o.status.id}
                              onValueChange={v => {
                                const s = statusList.find((s: any) => s.id === v)
                                if (s) { setStatusNote(''); setStatusDialog({ order: o, newStatusId: v, newStatusName: s.name }) }
                              }}
                            >
                              <SelectTrigger
                                className='h-6.5 w-[125px] text-xs font-medium rounded-full border shadow-2xs transition-all hover:opacity-90'
                                style={{
                                  backgroundColor: `color-mix(in srgb, ${accentColor} 14%, transparent)`,
                                  color: accentColor,
                                  borderColor: `color-mix(in srgb, ${accentColor} 30%, transparent)`,
                                }}
                              >
                                <SelectValue>
                                  <div className='flex items-center gap-1.5 truncate'>
                                    <span className='size-1.5 rounded-full shrink-0' style={{ backgroundColor: accentColor }} />
                                    <span className='truncate'>{o.status.name}</span>
                                  </div>
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {statusList.filter((s: any) => {
                                  const next = Array.isArray(o.status?.nextStatuses) ? o.status.nextStatuses : []
                                  return s.id === o.status?.id || next.includes(s.id)
                                }).map((s: any) => (
                                  <SelectItem key={s.id} value={s.id} className='text-xs'>
                                    <span className='flex items-center gap-2'>
                                      <span className='size-2 rounded-full shrink-0' style={{ backgroundColor: getStatusColor(s.name, s.color) }} />
                                      {s.name}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          {o.courierService ? (
                            <div className='flex items-center gap-1.5'>
                              <Badge variant='outline' className='text-[11px] font-medium capitalize gap-1 py-0 px-2 rounded-md border-border/70 shadow-2xs'>
                                <Truck className='size-3 text-muted-foreground/70' /> {o.courierService}
                              </Badge>
                              {o.trackingUrl && (
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); window.open(o.trackingUrl || undefined, '_blank') }}
                                  className='text-muted-foreground/70 hover:text-primary transition-colors p-0.5 rounded'
                                  title='Track shipment'
                                >
                                  <ExternalLink className='size-3' />
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className='text-xs text-muted-foreground/50 italic'>Not assigned</span>
                          )}
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <AssigneeCell assignee={o.assignee} />
                        </TableCell>
                        <TableCell className='text-right font-mono font-semibold text-xs text-foreground'>
                          <div>৳{fmt(o.total)}</div>
                          {(() => {
                            const mode = getOrderPaymentMode(o)
                            const mc = paymentStatusBadgeClass(mode)
                            return (
                              <span className="inline-flex flex-col items-end gap-0.5">
                                <Badge variant={mc.variant} className={`text-[10px] py-0 px-1.5 mt-0.5 ${mc.className}`}>{mode}</Badge>
                                {hasOpenCodAlert(o) && (
                                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-amber-500/50 text-amber-600 dark:text-amber-500">COD mismatch</Badge>
                                )}
                              </span>
                            )
                          })()}
                        </TableCell>
                        <TableCell className='text-right text-xs text-muted-foreground pr-4 font-mono'>{o.items.length}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()} className='pr-3'>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant='ghost' size='icon' className='h-7 w-7 rounded-md hover:bg-surface-raised'>
                                <MoreHorizontal className='h-3.5 w-3.5 text-muted-foreground' />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end' className='min-w-44 rounded-xl border-border/80 shadow-pop'>
                              <DropdownMenuItem asChild><Link to='/op/orders/$id' params={{ id: o.id }} className='text-xs font-medium cursor-pointer'><Eye className='h-3.5 w-3.5 mr-2 text-muted-foreground' />View Details</Link></DropdownMenuItem>
                              <DropdownMenuItem onClick={() => copyToClipboard(o.displayId, 'Order ID')} className='text-xs cursor-pointer'><ClipboardCopy className='h-3.5 w-3.5 mr-2 text-muted-foreground' />Copy Order ID</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => copyToClipboard(getCustomerPhone(o) || '', 'Phone')} className='text-xs cursor-pointer'><Phone className='h-3.5 w-3.5 mr-2 text-muted-foreground' />Copy Phone</DropdownMenuItem>
                              {formatAddressFull(addr) && <DropdownMenuItem onClick={() => copyToClipboard(formatAddressFull(addr), 'Address')} className='text-xs cursor-pointer'><MapPin className='h-3.5 w-3.5 mr-2 text-muted-foreground' />Copy Address</DropdownMenuItem>}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className='text-destructive focus:text-destructive text-xs cursor-pointer' onClick={() => setBlockPhones({ phones: [getCustomerPhone(o) || ''], contextLabel: o.displayId })}><Ban className='h-3.5 w-3.5 mr-2' />Block Phone</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => window.open(`/admin/op/print/sticker/${o.id}`, '_blank')} className='text-xs cursor-pointer'><Printer className='h-3.5 w-3.5 mr-2 text-muted-foreground' />Print Sticker</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => window.open(`/admin/op/print/invoice/${o.id}`, '_blank')} className='text-xs cursor-pointer'><Receipt className='h-3.5 w-3.5 mr-2 text-muted-foreground' />Print Invoice</DropdownMenuItem>
                              {o.trackingUrl && <DropdownMenuItem onClick={() => window.open(o.trackingUrl || undefined, '_blank')} className='text-xs cursor-pointer'><ExternalLink className='h-3.5 w-3.5 mr-2 text-muted-foreground' />Track Shipment</DropdownMenuItem>}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className='text-destructive focus:text-destructive text-xs cursor-pointer'
                                onClick={(e) => { e.stopPropagation(); trashOrderMut.mutate(o.id) }}
                              >
                                <Trash2 className='h-3.5 w-3.5 mr-2' />Move to Trash
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>,
                      isExpanded && (
                        <TableRow key={`${o.id}-detail`} className='bg-muted/10 dark:bg-muted/5 hover:bg-muted/10 dark:hover:bg-muted/5 border-b border-border/50 dark:border-border/40'>
                          <TableCell colSpan={10} className='p-0 border-0'>
                            <div className='overflow-hidden bg-muted/20 dark:bg-muted/10' style={{ borderTop: `2px solid ${accentColor}` }}>
                              <div className='px-6 py-4.5 grid grid-cols-1 lg:grid-cols-5 gap-4.5'>
                                <div className='lg:col-span-3 space-y-3'>
                                  <div className='flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider'>
                                    <Package className='size-3.5' /> Products
                                    <span className='text-[10px] font-normal normal-case tracking-normal'>({o.items.length} item{o.items.length > 1 ? 's' : ''})</span>
                                  </div>
                                  <div className='space-y-1.5'>
                                    {o.items.map((item) => {
                                      const thumb = getProductThumb(item)
                                      const lineTotal = nn(item.price) * item.quantity
                                      return (
                                        <div key={item.id} className='flex items-center gap-3 rounded-lg border border-border/70 dark:border-border/60 bg-card px-3 py-2 shadow-2xs hover:border-border transition-colors'>
                                          {thumb ? (
                                            <SafeImage src={thumb} alt={item.product?.name} className='h-10 w-10 rounded-md object-cover border border-border/60 shrink-0' thumbWidth={40} thumbHeight={40} />
                                          ) : (
                                            <div className='h-10 w-10 rounded-md border border-border/60 bg-muted/50 flex items-center justify-center shrink-0'>
                                              <Package className='size-4 text-muted-foreground/60' />
                                            </div>
                                          )}
                                          <div className='flex-1 min-w-0'>
                                            <div className='text-xs font-semibold truncate leading-tight text-foreground'>
                                              {item.product?.slug ? (
                                                <Link to='/op/products' className='hover:underline hover:text-primary transition-colors' onClick={e => e.stopPropagation()}>{item.product?.name || 'Unknown Product'}</Link>
                                              ) : (item.product?.name || 'Unknown Product')}
                                            </div>
                                            <div className='flex items-center gap-2 mt-0.5'>
                                              <span className='text-[11px] text-muted-foreground font-mono'>৳{fmt(item.price)} each</span>
                                            </div>
                                          </div>
                                          <div className='text-right shrink-0'>
                                            <div className='text-xs font-bold font-mono text-foreground'>৳{fmt(lineTotal)}</div>
                                            <div className='text-[10.5px] text-muted-foreground font-mono'>x{item.quantity}</div>
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                  <div className='rounded-lg border border-border/70 dark:border-border/60 bg-card p-3 shadow-2xs space-y-1.5 text-xs'>
                                    <div className='flex justify-between text-muted-foreground'>
                                      <span>Subtotal</span>
                                      <span className='font-mono font-medium text-foreground'>৳{fmt(o.subtotal)}</span>
                                    </div>
                                    <div className='flex justify-between text-muted-foreground'>
                                      <span>Shipping</span>
                                      <span className='font-mono font-medium text-foreground'>৳{fmt(o.shippingCharge)}</span>
                                    </div>
                                    {nn(o.discount) > 0 && (
                                      <div className='flex justify-between text-emerald-600 dark:text-emerald-400'>
                                        <span className='flex items-center gap-1'><Tag className='size-3' />Discount{o.discountType === 'percentage' ? ` (${fmt(o.discount)}%)` : ''}</span>
                                        <span className='font-mono font-semibold'>-৳{fmt(o.discountType === 'percentage' ? nn(o.subtotal) * nn(o.discount) / 100 : o.discount)}</span>
                                      </div>
                                    )}
                                    <div className='flex justify-between font-bold text-sm pt-2 border-t border-border/60 text-foreground'>
                                      <span>Total</span>
                                      <span className='font-mono text-primary'>৳{fmt(o.total)}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className='lg:col-span-2 space-y-3'>
                                  <div className='flex items-center justify-between'>
                                    <div className='flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider'>
                                      <MapPin className='size-3.5' /> Shipping & Customer
                                    </div>
                                    {formatAddressFull(addr) && (
                                      <button onClick={() => copyToClipboard(formatAddressFull(addr), 'Address')} className='text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1'>
                                        <ClipboardCopy className='size-3' /> Copy
                                      </button>
                                    )}
                                  </div>
                                  <div className='rounded-lg border border-border/70 dark:border-border/60 bg-card p-3 shadow-2xs space-y-2 text-xs'>
                                    <div className='font-semibold text-xs text-foreground'>
                                      {addr.name || getCustomerDisplayName(o)}
                                    </div>
                                    {(addr.line1 || addr.line2) && (
                                      <div className='leading-relaxed text-foreground/90'>{[addr.line1, addr.line2].filter(Boolean).join(', ')}</div>
                                    )}
                                    {[addr.city, addr.zone].filter(Boolean).length > 0 && (
                                      <div className='text-muted-foreground'>{[addr.city, addr.zone].filter(Boolean).join(', ')}</div>
                                    )}
                                    {addr.postcode && (
                                      <div className='text-muted-foreground'>{addr.postcode}{addr.country && addr.country !== 'Bangladesh' ? `, ${addr.country}` : ''}</div>
                                    )}
                                    {!addr.line1 && !addr.line2 && !addr.city && (
                                      <div className='text-muted-foreground italic'>No address provided</div>
                                    )}
                                    <div className='flex flex-col gap-1.5 pt-1.5 border-t border-border/50'>
                                      {(getCustomerPhone(o)) && (
                                        <div className='flex items-center gap-2'>
                                          <Phone className='size-3.5 text-muted-foreground shrink-0' />
                                          <a href={`tel:${getCustomerPhone(o)}`} className='hover:underline font-mono'>{getCustomerPhone(o)}</a>
                                          <CustomerContactActions phone={getCustomerPhone(o)} />
                                        </div>
                                      )}
                                      {getCustomerEmail(o) && (
                                        <div className='flex items-center gap-2 text-muted-foreground'>
                                          <Mail className='size-3.5 shrink-0' />
                                          <span className='truncate'>{getCustomerEmail(o)}</span>
                                        </div>
                                      )}
                                      {getCustomerPhone(o) && (
                                        <CourierQuickView phone={getCustomerPhone(o).replace(/[^\d]/g, '')} />
                                      )}
                                    </div>
                                  </div>

                                  {(o.customerNotes || o.officeNotes) && (
                                    <div className='space-y-1.5'>
                                      {o.customerNotes && (
                                        <div className='rounded-lg border-l-3 border-l-amber-500 bg-amber-500/10 dark:bg-amber-950/25 border-y border-r border-amber-500/20 dark:border-amber-500/15 px-3 py-2 shadow-2xs'>
                                          <div className='flex items-center gap-1.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-0.5'>
                                            <MessageCircle className='size-3' /> Customer Note
                                          </div>
                                          <div className='text-xs leading-relaxed text-foreground'>{o.customerNotes}</div>
                                        </div>
                                      )}
                                      {o.officeNotes && (
                                        <div className='rounded-lg border-l-3 border-l-blue-500 bg-blue-500/10 dark:bg-blue-950/25 border-y border-r border-blue-500/20 dark:border-blue-500/15 px-3 py-2 shadow-2xs'>
                                          <div className='flex items-center gap-1.5 text-[10.5px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider mb-0.5'>
                                            <FileText className='size-3' /> Office Note
                                          </div>
                                          <div className='text-xs leading-relaxed text-foreground'>{o.officeNotes}</div>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {o.assignee && (
                                    <div className='rounded-lg border border-border/70 dark:border-border/60 bg-card px-3 py-2 shadow-2xs'>
                                      <div className='flex items-center gap-2'>
                                        <div className='size-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0'>
                                          {o.assignee.firstName?.[0]}{o.assignee.lastName?.[0]}
                                        </div>
                                        <div>
                                          <div className='text-[10px] font-semibold text-muted-foreground uppercase tracking-wider'>Assigned To</div>
                                          <div className='text-xs font-semibold text-foreground'>{o.assignee.firstName} {o.assignee.lastName}</div>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {o.payments && o.payments.length > 0 && (
                                    <div className='space-y-1.5'>
                                      <div className='text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider'>Payments</div>
                                      {o.payments.map((p) => {
                                        const gw = p.gatewayCode || p.method
                                        const pm = paymentMethodLabel(gw || '')
                                        const ps = paymentStatusBadgeClass(p.status)
                                        return (
                                          <div key={p.id} className='flex items-center justify-between rounded-lg border border-border/70 dark:border-border/60 bg-card px-3 py-2 shadow-2xs'>
                                            <div className='flex items-center gap-2'>
                                              <CreditCard className={`size-3.5 ${pm.colorClass}`} />
                                              <span className='text-xs font-medium'>{pm.label}</span>
                                            </div>
                                            <div className='flex items-center gap-2'>
                                              <span className='text-xs font-bold font-mono'>৳{fmt(p.amount)}</span>
                                              <Badge variant={ps.variant} className={`text-[10px] py-0 px-1.5 ${ps.className}`}>{p.status}</Badge>
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    ].filter(Boolean)
                  }) : (
                    <TableRow><TableCell colSpan={10} className='p-0 border-0'><EmptyState search={search} statusFilter={statusFilter} onClear={clearAllFilters} /></TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className='flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-1'>
            <span className='text-xs text-muted-foreground'>
              Page <span className='font-semibold text-foreground'>{page}</span> of <span className='font-semibold text-foreground'>{totalPages}</span> ({totalOrders} orders)
            </span>
            <div className='flex items-center gap-1'>
              <Button variant='outline' size='sm' className='h-8 w-8 p-0 rounded-lg shadow-2xs' disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className='h-3.5 w-3.5' />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .map((p, i, arr) => (
                  <span key={p}>
                    {i > 0 && arr[i - 1] !== p - 1 && <span className='px-1 text-xs text-muted-foreground'>...</span>}
                    <Button
                      variant={p === page ? 'default' : 'outline'}
                      size='sm'
                      className={`h-8 w-8 p-0 text-xs rounded-lg font-semibold shadow-2xs ${p === page ? 'bg-primary text-primary-foreground' : ''}`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  </span>
                ))}
              <Button variant='outline' size='sm' className='h-8 w-8 p-0 rounded-lg shadow-2xs' disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className='h-3.5 w-3.5' />
              </Button>
            </div>
          </div>
        )}

        {selected.length > 0 && (
          <div className='fixed bottom-5 left-1/2 -translate-x-1/2 bg-popover/95 backdrop-blur-md border border-border/80 shadow-2xl rounded-2xl px-3.5 py-2 flex flex-wrap items-center gap-2.5 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200'>
            <Button variant='ghost' size='icon' className='h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground' onClick={() => setSelected([])}>
              <X className='h-3.5 w-3.5' />
            </Button>
            <span className='inline-flex items-center rounded-full bg-primary/15 text-primary border border-primary/20 px-2 py-0.5 text-xs font-bold whitespace-nowrap shadow-2xs'>
              {selected.length} selected
            </span>
            <div className='h-4 w-px bg-border/60' />
            <Select onValueChange={v => bulkStatusMut.mutate({ ids: selected, statusId: v })}>
              <SelectTrigger className='h-8 w-[145px] text-xs rounded-lg'><SelectValue placeholder='Status' /></SelectTrigger>
              <SelectContent>{statusList.map((s: any) => <SelectItem key={s.id} value={s.id} className='text-xs'>{s.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className='flex items-center gap-1'>
              <SearchableSelect
                options={[
                  { id: 'unassigned', label: 'Unassign' },
                  ...staff.map((s: any) => ({ id: s.id, label: `${s.firstName} ${s.lastName}`.trim() }))
                ]}
                value={''}
                onChange={(v) => { if (v) bulkAssignMut.mutate({ ids: selected, assignedToId: v === 'unassigned' ? null : v }) }}
                placeholder='Assign to...'
                searchPlaceholder='Search staff...'
                triggerClassName='h-8 text-xs w-[130px] rounded-lg'
              />
              {selected.length > 0 && (
                <Button variant='outline' size='icon' className='h-8 w-8 text-xs text-muted-foreground rounded-lg' onClick={() => bulkAssignMut.mutate({ ids: selected, assignedToId: '__unassign__' })} title='Unassign all selected'>
                  <X className='h-3 w-3' />
                </Button>
              )}
            </div>
            <div className='h-4 w-px bg-border/60' />
            <Button variant='outline' size='sm' className='h-8 text-xs rounded-lg gap-1.5' onClick={() => { const ids = selected.join(','); window.open(`/admin/op/print/bulk?type=sticker&ids=${ids}`, '_blank') }}>
              <Printer className='h-3 w-3' /> Stickers
            </Button>
            <Button variant='outline' size='sm' className='h-8 text-xs rounded-lg gap-1.5' onClick={() => { const ids = selected.join(','); window.open(`/admin/op/print/bulk?type=invoice&ids=${ids}`, '_blank') }}>
              <Receipt className='h-3 w-3' /> Invoices
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8 text-xs text-destructive hover:bg-destructive/10 rounded-lg gap-1.5'
              disabled={selectedPhones.length === 0}
              onClick={() => setBlockPhones({ phones: selectedPhones, contextLabel: `${selected.length} orders` })}
            >
              <Ban className='h-3 w-3' /> Block Phones
            </Button>
            <div className='flex items-center gap-1.5 border-l border-border/60 pl-2.5'>
              <Select value={dispatchCourier} onValueChange={setDispatchCourier}>
                <SelectTrigger className='h-8 w-[115px] text-xs rounded-lg'><SelectValue placeholder='Courier' /></SelectTrigger>
                <SelectContent>
                  {activeCouriers.filter((c: any) => c.enabled).map((c: any) => (
                    <SelectItem key={c.courier} value={c.courier} className='text-xs'>{c.courier.charAt(0).toUpperCase() + c.courier.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size='sm' className='h-8 text-xs rounded-lg gap-1' disabled={!dispatchCourier || dispatchMut.isPending} onClick={() => dispatchMut.mutate({ courier: dispatchCourier, ids: selected })}>
                {dispatchMut.isPending ? <Loader2 className='h-3 w-3 animate-spin' /> : <Send className='h-3 w-3' />}
                Send
              </Button>
            </div>
            {showBulkDefaultWarn && (
              <BulkSteadfastDefaultWarning
                courier={dispatchCourier}
                setCount={steadfastSets.length}
              />
            )}
          </div>
        )}

        <BlockPhoneDialog
          open={!!blockPhones}
          onOpenChange={o => { if (!o) setBlockPhones(null) }}
          phones={blockPhones?.phones || []}
          contextLabel={blockPhones?.contextLabel}
        />

        <Dialog open={!!statusDialog} onOpenChange={o => { if (!o) setStatusDialog(null); setStatusNote('') }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Change Order Status</DialogTitle>
              <DialogDescription>
                Update status for <span className="font-mono font-medium text-foreground">{statusDialog?.order.displayId}</span>
              </DialogDescription>
            </DialogHeader>
            {statusDialog && (
              <div className="space-y-4 py-2">
                <div className="flex items-center gap-3 rounded-lg border border-border/70 dark:border-border/60 bg-muted/40 dark:bg-muted/20 p-3">
                  <div className="flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Current</p>
                    <p className="text-sm font-semibold mt-0.5 text-foreground">{statusDialog.order.status.name}</p>
                  </div>
                  <div className="h-8 w-px bg-border/60" />
                  <div className="flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">New</p>
                    <p className="text-sm font-semibold mt-0.5 text-primary">{statusDialog.newStatusName}</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="status-note" className="text-xs font-medium">Note (optional)</Label>
                  <Textarea id="status-note" placeholder="Reason for this status change..." value={statusNote} onChange={e => setStatusNote(e.target.value)} rows={2} className="text-xs rounded-lg border-border/70" />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" className="rounded-lg shadow-2xs" onClick={() => { setStatusDialog(null); setStatusNote('') }}>Cancel</Button>
              <Button className="rounded-lg shadow-2xs" onClick={() => {
                if (!statusDialog) return
                statusMut.mutate(
                  { id: statusDialog.order.id, statusId: statusDialog.newStatusId, note: statusNote || undefined },
                  { onSuccess: () => { setStatusDialog(null); setStatusNote('') } },
                )
              }} disabled={statusMut.isPending}>
                {statusMut.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Confirm Change
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}
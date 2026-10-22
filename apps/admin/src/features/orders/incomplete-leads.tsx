import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { SafeImage } from '@/components/safe-image'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { CopyButton } from '@/components/copy-button'
import { CustomerContactActions } from '@/components/customer-contact-actions'
import { BlockPhoneDialog } from '@/features/orders/block-phone-dialog'
import { PaymentGatewayAccountSelect } from '@/features/payments/components/payment-gateway-account-select'
import { normalizeLegacyGatewayCode } from '@/features/payments/lib/gateway-normalize'
import { gatewayApi } from '@/features/gateways/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  ChevronLeft, ChevronRight, Phone, MapPin, ShoppingCart,
  MoreHorizontal, Inbox, X, ArrowRightLeft, ChevronRight as ChevronRightIcon,
  Package, Edit3, Trash2, Search as SearchIcon, Clock, CheckCircle2, ShoppingBag,
  XCircle, AlertCircle, RefreshCcw, Ban, ExternalLink, ArrowUpDown, UserCheck, ArrowLeft
} from 'lucide-react'

const statusColors: Record<string, string> = {
  PENDING: '#F59E0B',
  CONVERTED: '#10B981',
  SUPERSEDED: '#8B5CF6',
  NOT_CONVERTED: '#64748B',
  DELETED: '#EF4444',
}

const statusLabels: Record<string, string> = {
  PENDING: 'Pending',
  CONVERTED: 'Converted',
  SUPERSEDED: 'Superseded',
  NOT_CONVERTED: 'Dismissed',
  DELETED: 'Deleted',
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

function LeadStatusBadge({ status }: { status: string }) {
  const color = statusColors[status] || '#6B7280'
  const label = statusLabels[status] || status.replace('_', ' ')
  return (
    <Badge
      variant='outline'
      className='text-[10.5px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 shadow-2xs whitespace-nowrap'
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        color: color,
      }}
    >
      <span className='h-1.5 w-1.5 rounded-full shrink-0' style={{ backgroundColor: color }} />
      <span>{label}</span>
    </Badge>
  )
}

function LeadRowSkeleton() {
  return (
    <TableRow className='hover:bg-transparent border-b border-border/50'>
      <TableCell className='pl-3.5'><Skeleton className='h-4 w-4 rounded' /></TableCell>
      <TableCell className='px-1'><Skeleton className='h-4 w-4 rounded' /></TableCell>
      <TableCell><Skeleton className='h-4 w-20 rounded' /></TableCell>
      <TableCell>
        <div className='space-y-1.5'>
          <Skeleton className='h-4 w-32 rounded' />
          <Skeleton className='h-3 w-24 rounded' />
        </div>
      </TableCell>
      <TableCell><Skeleton className='h-4 w-20 rounded' /></TableCell>
      <TableCell><Skeleton className='h-4 w-16 rounded' /></TableCell>
      <TableCell><Skeleton className='h-6 w-20 rounded-full' /></TableCell>
      <TableCell><Skeleton className='h-5 w-24 rounded-full' /></TableCell>
      <TableCell><Skeleton className='h-4 w-16 rounded' /></TableCell>
      <TableCell className='pr-3.5 text-right'><Skeleton className='h-7 w-7 rounded-lg ml-auto' /></TableCell>
    </TableRow>
  )
}

interface Lead {
  id: string
  displayId?: string | null
  phone?: string | null
  name?: string | null
  email?: string | null
  address?: any
  items?: any
  paymentMethod?: string | null
  status: string
  occurrences: number
  firstSeenAt: string
  lastSeenAt: string
  assignedTo?: { id: string; firstName: string; lastName: string } | null
  convertedBy?: { id: string; firstName: string; lastName: string } | null
  convertedOrder?: { id: string; displayId: string } | null
}

/**
 * Payment fields for the edit-and-convert dialog. Wraps the ONE shared
 * configured-gateway pair (`PaymentGatewayAccountSelect`) so this dialog can
 * never drift from the convert form's gateway list, and normalizes the lead's
 * stored (legacy) payment intent onto a configured gateway code via the shared
 * helper. Extracted as a named export so the payment fields can be rendered in
 * isolation in tests (the in-page dialog has no trigger of its own — the
 * "Convert with Edit" flow is route-backed — and the full page needs router
 * context).
 */
export function LeadConvertPaymentFields({
  gatewayCode,
  accountId,
  storedPaymentMethod,
  onChange,
}: {
  gatewayCode: string
  accountId: string
  /** The lead's raw stored payment intent — HISTORY, never a wire value. */
  storedPaymentMethod?: string | null
  onChange: (next: { gatewayCode: string; accountId: string }) => void
}) {
  // Same query key as PaymentGatewayAccountSelect, so the configured gateway
  // list is shared from cache — no duplicate /gateways/admin request.
  const { data: gateways } = useQuery({
    queryKey: ['admin-gateways'],
    queryFn: () => gatewayApi.listGateways().then((r) => r.data),
    staleTime: 60_000,
  })

  // A stored lead payment value is HISTORY (checkout enum / old shorthand).
  // Once the configured gateways are available, settle the selection onto a
  // CONFIGURED gateway code so a raw legacy string is never submitted. The
  // helper is idempotent — an already-configured value, including a deliberate
  // user choice, comes back unchanged, so only legacy/unknown values rewrite.
  useEffect(() => {
    if (!gateways) return
    const normalized = normalizeLegacyGatewayCode(gatewayCode || storedPaymentMethod, gateways)
    if (normalized && normalized !== gatewayCode) {
      onChange({ gatewayCode: normalized, accountId })
    }
  }, [gateways, storedPaymentMethod, gatewayCode, accountId, onChange])

  return (
    <PaymentGatewayAccountSelect
      gatewayCode={gatewayCode}
      accountId={accountId}
      onChange={onChange}
      gatewayLabel='Payment Method'
      accountLabel='Account'
      className='grid gap-3'
    />
  )
}

export function IncompleteLeads() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('PENDING')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [selected, setSelected] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [blockPhones, setBlockPhones] = useState<{ phones: string[]; contextLabel?: string } | null>(null)
  const [editingLead, setEditingLead] = useState<Lead | null>(null)
  const [editForm, setEditForm] = useState<{
    guestName: string
    guestPhone: string
    paymentMethod: string
    accountId: string
    shippingAddress: string
    items: any[]
  }>({ guestName: '', guestPhone: '', paymentMethod: '', accountId: '', shippingAddress: '', items: [] })

  useEffect(() => {
    if (editingLead) {
      setEditForm({
        guestName: editingLead.name || '',
        guestPhone: editingLead.phone || '',
        // Raw stored intent — normalized onto a configured gateway code by
        // LeadConvertPaymentFields once the gateway list is available.
        paymentMethod: editingLead.paymentMethod || '',
        accountId: '',
        shippingAddress: editingLead.address ? JSON.stringify(editingLead.address) : '',
        items: (editingLead.items as any[])?.map(i => ({ ...i })) || [],
      })
    }
  }, [editingLead])

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const { data: staffList } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => apiClient.get('/orders/staff/list').then(r => r.data as any[]),
  })
  const staff = (Array.isArray(staffList) ? staffList : []) as any[]

  const { data: summary, isFetching: isSummaryFetching } = useQuery({
    queryKey: ['checkout-leads-summary'],
    queryFn: () => apiClient.get('/checkout-leads/summary').then(r => r.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['checkout-leads', page, perPage, debouncedSearch, statusFilter, assigneeFilter],
    queryFn: () =>
      apiClient
        .get('/checkout-leads', {
          params: {
            page,
            perPage,
            search: debouncedSearch || undefined,
            status: statusFilter !== 'all' ? statusFilter : undefined,
            assignedToId: assigneeFilter !== 'all' ? assigneeFilter : undefined,
          },
        })
        .then(r => r.data),
  })

  const convertMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/checkout-leads/${id}/convert`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkout-leads'] })
      queryClient.invalidateQueries({ queryKey: ['checkout-leads-summary'] })
      toast.success('Lead converted to order')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Conversion failed'),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`/checkout-leads/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkout-leads'] })
      queryClient.invalidateQueries({ queryKey: ['checkout-leads-summary'] })
      toast.success('Status updated')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update lead status'),
  })

  const assignMut = useMutation({
    mutationFn: ({ id, assignedToId }: { id: string; assignedToId: string | null }) =>
      apiClient.patch(`/checkout-leads/${id}/assign`, { assignedToId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkout-leads'] })
      toast.success('Lead assigned')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to assign lead'),
  })

  const bulkAssignMut = useMutation({
    mutationFn: ({ ids, assignedToId }: { ids: string[]; assignedToId: string | null }) =>
      apiClient.post('/checkout-leads/bulk/assign', { ids, assignedToId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkout-leads'] })
      setSelected([])
      toast.success('Leads assigned')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Bulk lead assignment failed'),
  })

  const bulkStatusMut = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) =>
      apiClient.post('/checkout-leads/bulk/status', { ids, status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkout-leads'] })
      queryClient.invalidateQueries({ queryKey: ['checkout-leads-summary'] })
      setSelected([])
      toast.success('Bulk status updated')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Bulk lead status change failed'),
  })

  const convertEditMut = useMutation({
    mutationFn: ({ id, overrides }: { id: string; overrides: any }) =>
      apiClient.post(`/checkout-leads/${id}/convert`, overrides),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkout-leads'] })
      queryClient.invalidateQueries({ queryKey: ['checkout-leads-summary'] })
      setEditingLead(null)
      toast.success('Order created from lead')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Conversion failed'),
  })

  const leads = (data?.data || []) as Lead[]
  const total = data?.meta?.total || 0
  const totalPages = data?.meta?.totalPages || 1

  const toggleAll = () => {
    const ids = leads.map(l => l.id)
    setSelected(selected.length === ids.length ? [] : ids)
  }
  const toggleOne = (id: string) =>
    setSelected(p => (p.includes(id) ? p.filter(i => i !== id) : [...p, id]))
  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const clearAllFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setAssigneeFilter('all')
    setPage(1)
  }
  const hasActiveFilters = search || statusFilter !== 'all' || assigneeFilter !== 'all'

  const selectedPhones = leads
    .filter(l => selected.includes(l.id) && !!l.phone)
    .map(l => l.phone as string)

  const totalSummaryCount = summary
    ? (summary.pending || 0) +
      (summary.converted || 0) +
      (summary.superseded || 0) +
      (summary.dismissed ?? summary.notConverted ?? 0) +
      (summary.deleted || 0)
    : total

  // Status Filter Pill Chip renderer (matching Orders list standard)
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
      type='button'
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`inline-flex h-7.5 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-all duration-150 cursor-pointer ${
        active
          ? 'border-transparent font-semibold shadow-2xs'
          : 'border-border/60 bg-card text-muted-foreground hover:text-foreground hover:bg-surface-raised hover:border-border'
      }`}
      style={
        active
          ? {
              borderColor: `color-mix(in srgb, ${color} 50%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
              color: color,
            }
          : undefined
      }
    >
      <span className='size-1.5 rounded-full shrink-0' style={{ backgroundColor: color }} />
      <span className='truncate max-w-32'>{label}</span>
      <span
        className={`tabular-nums text-[10.5px] px-1.5 py-0.2 rounded-full font-semibold ${
          active ? 'bg-background/60 shadow-2xs' : 'bg-muted/70 text-muted-foreground'
        }`}
        style={active ? { color } : undefined}
      >
        {count}
      </span>
    </button>
  )

  return (
    <>
      <Header fixed>
        <Link to='/op/orders' className='me-auto'>
          <Button variant='ghost' size='sm' className='h-8 gap-1 text-xs'>
            <ArrowLeft className='h-3.5 w-3.5' /> Back to Orders
          </Button>
        </Link>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-5 p-3 sm:p-6 pb-24 sm:pb-32 max-w-[1600px] w-full mx-auto'>
        {/* ── Top Header & Executive Toolbar ── */}
        <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
          <div>
            <div className='flex items-center gap-2.5'>
              <h1 className='text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2'>
                <span>Incomplete Leads</span>
                {total > 0 && (
                  <Badge variant='secondary' className='text-xs font-mono font-semibold px-2 py-0.5 rounded-full'>
                    {total}
                  </Badge>
                )}
              </h1>
            </div>
            <p className='text-xs text-muted-foreground mt-0.5'>
              Capture and convert abandoned checkouts into completed orders
              {selected.length > 0 && (
                <span className='text-primary font-semibold ml-2'>({selected.length} selected)</span>
              )}
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='h-8.5 gap-1.5 rounded-lg border-border/70 hover:bg-surface-raised font-medium shadow-2xs'
              onClick={() => navigate({ to: '/op/orders' })}
            >
              <Package className='h-3.5 w-3.5' /> View Orders
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8.5 gap-1.5 rounded-lg border-border/70 hover:bg-surface-raised font-medium shadow-2xs'
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['checkout-leads'] })
                queryClient.invalidateQueries({ queryKey: ['checkout-leads-summary'] })
              }}
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${isSummaryFetching ? 'animate-spin' : ''}`} />
              <span className='hidden sm:inline'>Refresh</span>
            </Button>
          </div>
        </div>

        {/* ── Executive KPI Metric Cards (SaaS Standard) ── */}
        {summary && (
          <div className='grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5'>
            {/* Pending Recovery Card */}
            <button
              type='button'
              onClick={() => {
                setStatusFilter(statusFilter === 'PENDING' ? 'all' : 'PENDING')
                setPage(1)
              }}
              className={`rounded-xl border p-3 sm:p-4 text-left transition-all duration-200 bg-card hover:bg-surface-raised shadow-2xs group relative overflow-hidden ${
                statusFilter === 'PENDING' ? 'ring-2 ring-amber-500 border-amber-500/50' : 'border-border/70'
              }`}
            >
              <div className='flex items-center justify-between gap-2 mb-2'>
                <span className='text-xs font-semibold text-muted-foreground'>Pending Recovery</span>
                <div className='h-7 w-7 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold'>
                  <Clock className='h-3.5 w-3.5' />
                </div>
              </div>
              <div className='flex items-baseline gap-2'>
                <p className='text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground'>
                  {summary.pending || 0}
                </p>
                <span className='text-[11px] text-amber-600 dark:text-amber-400 font-medium'>Follow-up ready</span>
              </div>
              <p className='text-[10.5px] text-muted-foreground mt-1 truncate'>Active checkout abandonments</p>
            </button>

            {/* Converted by Staff */}
            <button
              type='button'
              onClick={() => {
                setStatusFilter(statusFilter === 'CONVERTED' ? 'all' : 'CONVERTED')
                setPage(1)
              }}
              className={`rounded-xl border p-3 sm:p-4 text-left transition-all duration-200 bg-card hover:bg-surface-raised shadow-2xs group relative overflow-hidden ${
                statusFilter === 'CONVERTED' ? 'ring-2 ring-emerald-500 border-emerald-500/50' : 'border-border/70'
              }`}
            >
              <div className='flex items-center justify-between gap-2 mb-2'>
                <span className='text-xs font-semibold text-muted-foreground'>Converted (Staff)</span>
                <div className='h-7 w-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold'>
                  <CheckCircle2 className='h-3.5 w-3.5' />
                </div>
              </div>
              <div className='flex items-baseline gap-2'>
                <p className='text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground'>
                  {summary.converted || 0}
                </p>
                <span className='text-[11px] text-emerald-600 dark:text-emerald-400 font-medium'>Recovered</span>
              </div>
              <p className='text-[10.5px] text-muted-foreground mt-1 truncate'>Converted by team outreach</p>
            </button>

            {/* Self-Purchased (Superseded) */}
            <button
              type='button'
              onClick={() => {
                setStatusFilter(statusFilter === 'SUPERSEDED' ? 'all' : 'SUPERSEDED')
                setPage(1)
              }}
              className={`rounded-xl border p-3 sm:p-4 text-left transition-all duration-200 bg-card hover:bg-surface-raised shadow-2xs group relative overflow-hidden ${
                statusFilter === 'SUPERSEDED' ? 'ring-2 ring-violet-500 border-violet-500/50' : 'border-border/70'
              }`}
            >
              <div className='flex items-center justify-between gap-2 mb-2'>
                <span className='text-xs font-semibold text-muted-foreground'>Self Converted</span>
                <div className='h-7 w-7 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center font-bold'>
                  <ShoppingBag className='h-3.5 w-3.5' />
                </div>
              </div>
              <div className='flex items-baseline gap-2'>
                <p className='text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground'>
                  {summary.superseded || 0}
                </p>
                <span className='text-[11px] text-violet-600 dark:text-violet-400 font-medium'>Self-checkout</span>
              </div>
              <p className='text-[10.5px] text-muted-foreground mt-1 truncate'>Bought later by customer</p>
            </button>

            {/* Dismissed / Inactive */}
            <button
              type='button'
              onClick={() => {
                setStatusFilter(statusFilter === 'NOT_CONVERTED' ? 'all' : 'NOT_CONVERTED')
                setPage(1)
              }}
              className={`rounded-xl border p-3 sm:p-4 text-left transition-all duration-200 bg-card hover:bg-surface-raised shadow-2xs group relative overflow-hidden ${
                statusFilter === 'NOT_CONVERTED' ? 'ring-2 ring-slate-500 border-slate-500/50' : 'border-border/70'
              }`}
            >
              <div className='flex items-center justify-between gap-2 mb-2'>
                <span className='text-xs font-semibold text-muted-foreground'>Dismissed / Deleted</span>
                <div className='h-7 w-7 rounded-lg bg-muted text-muted-foreground flex items-center justify-center font-bold'>
                  <XCircle className='h-3.5 w-3.5' />
                </div>
              </div>
              <div className='flex items-baseline gap-2'>
                <p className='text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground'>
                  {(summary.dismissed ?? summary.notConverted ?? 0) + (summary.deleted || 0)}
                </p>
                <span className='text-[11px] text-muted-foreground font-medium'>Closed leads</span>
              </div>
              <p className='text-[10.5px] text-muted-foreground mt-1 truncate'>Not converted or purged</p>
            </button>
          </div>
        )}

        {/* ── Status Pill Chips Bar (Horizontal Scrollable, Orders List Style) ── */}
        {summary && (
          <div className='flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5' aria-label='Filter leads by status'>
            {renderChip('all', 'All Leads', totalSummaryCount, 'var(--primary)', statusFilter === 'all', () => {
              if (statusFilter !== 'all') {
                setStatusFilter('all')
                setPage(1)
              }
            })}
            <div className='h-4 w-px bg-border/60 shrink-0 mx-0.5' />
            {renderChip('PENDING', 'Pending', summary.pending || 0, statusColors.PENDING, statusFilter === 'PENDING', () => {
              setStatusFilter(statusFilter === 'PENDING' ? 'all' : 'PENDING')
              setPage(1)
            })}
            {renderChip('CONVERTED', 'Converted', summary.converted || 0, statusColors.CONVERTED, statusFilter === 'CONVERTED', () => {
              setStatusFilter(statusFilter === 'CONVERTED' ? 'all' : 'CONVERTED')
              setPage(1)
            })}
            {renderChip('SUPERSEDED', 'Superseded', summary.superseded || 0, statusColors.SUPERSEDED, statusFilter === 'SUPERSEDED', () => {
              setStatusFilter(statusFilter === 'SUPERSEDED' ? 'all' : 'SUPERSEDED')
              setPage(1)
            })}
            {renderChip('NOT_CONVERTED', 'Dismissed', summary.dismissed ?? summary.notConverted ?? 0, statusColors.NOT_CONVERTED, statusFilter === 'NOT_CONVERTED', () => {
              setStatusFilter(statusFilter === 'NOT_CONVERTED' ? 'all' : 'NOT_CONVERTED')
              setPage(1)
            })}
            {renderChip('DELETED', 'Deleted', summary.deleted || 0, statusColors.DELETED, statusFilter === 'DELETED', () => {
              setStatusFilter(statusFilter === 'DELETED' ? 'all' : 'DELETED')
              setPage(1)
            })}
          </div>
        )}

        {/* ── Filter & Search Toolbar (Glassmorphic Card) ── */}
        <div className='rounded-xl border border-border/70 bg-card/60 backdrop-blur-md p-2.5 shadow-2xs space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            {/* Search Input with ⌘K */}
            <div className='relative flex-1 min-w-[240px] max-w-md'>
              <SearchIcon className='absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70' />
              <Input
                ref={searchInputRef}
                placeholder='Search by customer name, phone, lead ID…'
                aria-label='Search incomplete leads'
                value={search}
                onChange={e => setSearch(e.target.value)}
                className='h-8.5 text-xs pl-8.5 pr-14 bg-background/80 focus:bg-background border-border/60 focus:border-primary/50 shadow-2xs transition-colors rounded-lg'
              />
              {search ? (
                <button
                  type='button'
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

            {/* Status Dropdown */}
            <div className='w-[145px]'>
              <Select
                value={statusFilter}
                onValueChange={v => {
                  setStatusFilter(v)
                  setPage(1)
                }}
              >
                <SelectTrigger className='h-8.5 text-xs bg-background/80 focus:bg-background border-border/60 shadow-2xs rounded-lg'>
                  <SelectValue placeholder='All Statuses' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all' className='text-xs font-medium'>
                    All Statuses
                  </SelectItem>
                  {['PENDING', 'CONVERTED', 'SUPERSEDED', 'NOT_CONVERTED', 'DELETED'].map(s => (
                    <SelectItem key={s} value={s} className='text-xs font-medium'>
                      <div className='flex items-center gap-1.5'>
                        <span className='size-1.5 rounded-full' style={{ backgroundColor: statusColors[s] }} />
                        <span>{statusLabels[s] || s.replace('_', ' ')}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Assignee Filter */}
            <div className='w-[165px]'>
              <SearchableSelect
                options={[
                  { id: 'all', label: 'All Staff' },
                  { id: 'unassigned', label: 'Unassigned Leads' },
                  ...staff.map((s: any) => ({ id: s.id, label: `${s.firstName} ${s.lastName}`.trim() })),
                ]}
                value={assigneeFilter}
                onChange={v => {
                  setAssigneeFilter(v || 'all')
                  setPage(1)
                }}
                placeholder='Assigned Staff'
                searchPlaceholder='Search staff...'
                triggerClassName='h-8.5 text-xs bg-background/80 focus:bg-background border-border/60 shadow-2xs rounded-lg'
              />
            </div>

            {/* PerPage Selector */}
            <div className='w-[90px]'>
              <Select
                value={String(perPage)}
                onValueChange={v => {
                  setPerPage(parseInt(v))
                  setPage(1)
                }}
              >
                <SelectTrigger className='h-8.5 text-xs bg-background/80 focus:bg-background border-border/60 shadow-2xs rounded-lg'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 50, 100].map(n => (
                    <SelectItem key={n} value={String(n)} className='text-xs font-medium'>
                      {n} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reset Button */}
            {hasActiveFilters && (
              <Button
                variant='ghost'
                size='sm'
                className='h-8.5 text-xs text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-lg gap-1.5'
                onClick={clearAllFilters}
              >
                <X className='h-3.5 w-3.5' /> Reset
              </Button>
            )}
          </div>

          {/* Active Filter Tags */}
          {hasActiveFilters && (
            <div className='flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-border/50'>
              <span className='text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider mr-1'>
                Active:
              </span>
              {statusFilter !== 'all' && (
                <button
                  type='button'
                  onClick={() => {
                    setStatusFilter('all')
                    setPage(1)
                  }}
                  className='inline-flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-0.5 text-[11px] font-medium border border-border/70 shadow-2xs hover:bg-surface-raised transition-colors'
                >
                  <span className='size-1.5 rounded-full' style={{ backgroundColor: statusColors[statusFilter] }} />
                  <span>{statusLabels[statusFilter] || statusFilter}</span>
                  <X className='h-3 w-3 ml-0.5 text-muted-foreground' />
                </button>
              )}
              {assigneeFilter !== 'all' && (() => {
                const person = assigneeFilter === 'unassigned' ? null : staff.find((s: any) => s.id === assigneeFilter)
                return (
                  <button
                    type='button'
                    onClick={() => {
                      setAssigneeFilter('all')
                      setPage(1)
                    }}
                    className='inline-flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-0.5 text-[11px] font-medium border border-border/70 shadow-2xs hover:bg-surface-raised transition-colors'
                  >
                    <UserCheck className='h-3 w-3 text-muted-foreground' />
                    <span>
                      {assigneeFilter === 'unassigned'
                        ? 'Unassigned'
                        : person
                          ? `${person.firstName} ${person.lastName}`
                          : 'Staff'}
                    </span>
                    <X className='h-3 w-3 ml-0.5 text-muted-foreground' />
                  </button>
                )
              })()}
              {search && (
                <button
                  type='button'
                  onClick={() => setSearch('')}
                  className='inline-flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-0.5 text-[11px] font-medium border border-border/70 shadow-2xs hover:bg-surface-raised transition-colors'
                >
                  <span className='text-muted-foreground'>Search:</span>
                  <span className='font-semibold font-mono'>
                    "{search.slice(0, 18)}
                    {search.length > 18 ? '...' : ''}"
                  </span>
                  <X className='h-3 w-3 ml-0.5 text-muted-foreground' />
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Main Leads Table Card ── */}
        <Card className='rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden'>
          <CardContent className='p-0'>
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader className='bg-muted/40 dark:bg-muted/20 sticky top-0 z-10 border-b border-border/70 backdrop-blur-xs'>
                  <TableRow className='hover:bg-transparent border-b border-border/70'>
                    <TableHead className='w-10 pl-3.5'>
                      <Checkbox
                        checked={leads.length > 0 && selected.length === leads.length}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead className='w-7 px-1'></TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
                      Lead
                    </TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
                      Customer
                    </TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
                      Cart Items
                    </TableHead>
                    <TableHead className='text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
                      Cart Value
                    </TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
                      Status
                    </TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
                      Assigned To
                    </TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
                      Activity
                    </TableHead>
                    <TableHead className='w-10 pr-3.5 text-right'></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <>
                      <LeadRowSkeleton />
                      <LeadRowSkeleton />
                      <LeadRowSkeleton />
                      <LeadRowSkeleton />
                      <LeadRowSkeleton />
                    </>
                  ) : leads.length > 0 ? (
                    leads.flatMap(l => {
                      const isExpanded = expanded.has(l.id)
                      const isSelected = selected.includes(l.id)
                      const accentColor = statusColors[l.status] || '#6B7280'
                      const itemsCount = (l.items as any[])?.length || 0
                      const cartTotal =
                        (l.items as any[])?.reduce?.(
                          (s: number, i: any) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1),
                          0
                        ) || 0

                      return [
                        <TableRow
                          key={l.id}
                          className={`group cursor-pointer transition-colors border-b border-border/50 dark:border-border/40 ${
                            isSelected
                              ? 'bg-primary/8 dark:bg-primary/15 hover:bg-primary/12 dark:hover:bg-primary/20'
                              : 'hover:bg-muted/40 dark:hover:bg-muted/20 even:bg-muted/[0.02] dark:even:bg-muted/[0.03]'
                          }`}
                          onClick={() => toggleExpand(l.id)}
                          style={{ borderLeftWidth: 3, borderLeftColor: accentColor }}
                        >
                          <TableCell className='pl-3.5' onClick={e => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleOne(l.id)}
                            />
                          </TableCell>
                          <TableCell className='px-1'>
                            <div
                              className={`transition-transform duration-200 text-muted-foreground group-hover:text-foreground ${
                                isExpanded ? 'rotate-90' : ''
                              }`}
                            >
                              <ChevronRightIcon className='h-3.5 w-3.5' />
                            </div>
                          </TableCell>
                          {/* Lead ID */}
                          <TableCell>
                            <div className='flex items-center gap-1.5'>
                              <span className='text-xs font-mono font-semibold tracking-tight text-foreground'>
                                {l.displayId || '—'}
                              </span>
                              {l.displayId && <CopyButton text={l.displayId} label='Lead ID' />}
                            </div>
                            {l.occurrences > 1 && (
                              <Badge variant='outline' className='text-[9.5px] px-1.5 py-0 mt-0.5 font-mono text-muted-foreground'>
                                ×{l.occurrences} visits
                              </Badge>
                            )}
                          </TableCell>
                          {/* Customer */}
                          <TableCell>
                            <div className='flex items-start gap-2'>
                              <div className='h-7 w-7 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-xs uppercase shrink-0 ring-1 ring-primary/20 mt-0.5'>
                                {(l.name || 'G')[0]}
                              </div>
                              <div className='min-w-0 space-y-0.5'>
                                <p className='text-xs font-semibold text-foreground truncate max-w-[170px]'>
                                  {l.name || 'Guest Customer'}
                                </p>
                                {l.phone && (
                                  <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                                    <a
                                      href={`tel:${l.phone}`}
                                      onClick={e => e.stopPropagation()}
                                      className='font-medium font-mono text-foreground hover:text-primary transition-colors'
                                    >
                                      {l.phone}
                                    </a>
                                    <CustomerContactActions phone={l.phone} />
                                  </div>
                                )}
                                {l.email && (
                                  <p className='text-[11px] text-muted-foreground/80 truncate max-w-[160px]'>
                                    {l.email}
                                  </p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          {/* Cart Items Preview */}
                          <TableCell>
                            <div className='space-y-0.5'>
                              <div className='text-xs font-medium text-foreground flex items-center gap-1.5'>
                                <ShoppingCart className='h-3.5 w-3.5 text-muted-foreground' />
                                <span>
                                  {itemsCount} {itemsCount === 1 ? 'item' : 'items'}
                                </span>
                              </div>
                              {Array.isArray(l.items) && l.items[0]?.name && (
                                <p className='text-[11px] text-muted-foreground truncate max-w-[150px]'>
                                  {l.items[0].name}
                                  {itemsCount > 1 ? ` +${itemsCount - 1} more` : ''}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          {/* Cart Value */}
                          <TableCell className='text-right'>
                            <span className='font-semibold text-xs font-mono tabular-nums text-foreground'>
                              ৳{cartTotal.toFixed(2)}
                            </span>
                          </TableCell>
                          {/* Status */}
                          <TableCell>
                            <LeadStatusBadge status={l.status} />
                          </TableCell>
                          {/* Assigned Staff */}
                          <TableCell>
                            {l.assignedTo ? (
                              <div className='flex items-center gap-1.5'>
                                <div className='h-5.5 w-5.5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-semibold shrink-0'>
                                  {l.assignedTo.firstName?.[0]}
                                  {l.assignedTo.lastName?.[0]}
                                </div>
                                <span className='text-xs font-medium text-foreground truncate max-w-[110px]'>
                                  {l.assignedTo.firstName} {l.assignedTo.lastName}
                                </span>
                              </div>
                            ) : (
                              <span className='text-xs text-muted-foreground/75 italic'>Unassigned</span>
                            )}
                          </TableCell>
                          {/* Activity */}
                          <TableCell>
                            <div className='space-y-0.5'>
                              <p className='text-xs font-medium text-foreground'>
                                {new Date(l.lastSeenAt).toLocaleDateString('en-GB', {
                                  day: 'numeric',
                                  month: 'short',
                                })}
                              </p>
                              <p className='text-[10px] text-muted-foreground font-medium'>
                                {relativeTime(l.lastSeenAt)}
                              </p>
                            </div>
                          </TableCell>
                          {/* Actions Menu */}
                          <TableCell className='pr-3.5 text-right' onClick={e => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  className='h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground'
                                >
                                  <MoreHorizontal className='h-4 w-4' />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align='end' className='w-48'>
                                {l.status === 'PENDING' && (
                                  <DropdownMenuItem asChild>
                                    <Link to='/op/orders/incomplete-leads/$id/convert' params={{ id: l.id }}>
                                      <Edit3 className='h-4 w-4 mr-2' /> Convert with Edit
                                    </Link>
                                  </DropdownMenuItem>
                                )}
                                {l.status === 'PENDING' && (
                                  <DropdownMenuItem onClick={() => convertMut.mutate(l.id)}>
                                    <ArrowRightLeft className='h-4 w-4 mr-2' /> Quick Convert
                                  </DropdownMenuItem>
                                )}
                                {l.status === 'PENDING' && (
                                  <DropdownMenuItem
                                    onClick={() => statusMut.mutate({ id: l.id, status: 'NOT_CONVERTED' })}
                                  >
                                    <X className='h-4 w-4 mr-2' /> Mark Dismissed
                                  </DropdownMenuItem>
                                )}
                                {l.status !== 'DELETED' && (
                                  <DropdownMenuItem
                                    className='text-destructive focus:text-destructive'
                                    onClick={() => statusMut.mutate({ id: l.id, status: 'DELETED' })}
                                  >
                                    <Trash2 className='h-4 w-4 mr-2' /> Delete Lead
                                  </DropdownMenuItem>
                                )}
                                {l.phone && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className='text-destructive focus:text-destructive'
                                      onClick={() =>
                                        setBlockPhones({
                                          phones: [l.phone!],
                                          contextLabel: l.displayId || 'Incomplete Lead',
                                        })
                                      }
                                    >
                                      <Ban className='h-4 w-4 mr-2' /> Block Phone
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {l.convertedOrder && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem asChild>
                                      <Link to='/op/orders/$id' params={{ id: l.convertedOrder.id }}>
                                        <Package className='h-4 w-4 mr-2' /> View Converted Order
                                      </Link>
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>,

                        // ── Expanded Accordion Details ──
                        isExpanded && (
                          <TableRow key={`${l.id}-detail`} className='even:bg-muted/[0.02]'>
                            <TableCell colSpan={10} className='p-0 border-0'>
                              <div
                                className='overflow-hidden bg-muted/15 dark:bg-muted/10 border-b border-border/70 p-3.5 sm:p-5'
                                style={{ borderTop: `2px solid ${accentColor}` }}
                              >
                                <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
                                  {/* Left: Cart Items breakdown */}
                                  <div className='rounded-xl border border-border/70 bg-card p-3.5 space-y-3 shadow-2xs'>
                                    <div className='flex items-center justify-between pb-2 border-b border-border/50'>
                                      <div className='flex items-center gap-2 text-xs font-semibold text-foreground uppercase tracking-wider'>
                                        <ShoppingCart className='h-3.5 w-3.5 text-primary' />
                                        <span>Captured Cart Items ({itemsCount})</span>
                                      </div>
                                      <Badge variant='outline' className='text-[10px] font-mono'>
                                        Total: ৳{cartTotal.toFixed(2)}
                                      </Badge>
                                    </div>

                                    {Array.isArray(l.items) && l.items.length > 0 ? (
                                      <div className='space-y-2 max-h-60 overflow-y-auto pr-1'>
                                        {l.items.map((item: any, idx: number) => (
                                          <div
                                            key={idx}
                                            className='flex items-center gap-3 rounded-lg border border-border/50 bg-background/80 p-2 shadow-2xs'
                                          >
                                            {item.image ? (
                                              <SafeImage
                                                src={item.image}
                                                alt={item.name}
                                                className='h-10 w-10 rounded-md object-cover border border-border/50 shrink-0'
                                                thumbWidth={48}
                                                thumbHeight={48}
                                              />
                                            ) : (
                                              <div className='h-10 w-10 rounded-md border border-border/50 bg-muted/50 flex items-center justify-center shrink-0'>
                                                <Package className='h-4 w-4 text-muted-foreground/60' />
                                              </div>
                                            )}
                                            <div className='flex-1 min-w-0'>
                                              <p className='text-xs font-medium text-foreground truncate'>
                                                {item.name || 'Product Item'}
                                              </p>
                                              <p className='text-[11px] text-muted-foreground font-mono'>
                                                ৳{Number(item.price || 0).toFixed(2)} × {item.quantity || 1}
                                              </p>
                                            </div>
                                            <div className='text-xs font-semibold font-mono text-foreground shrink-0'>
                                              ৳{((Number(item.price) || 0) * (Number(item.quantity) || 1)).toFixed(2)}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className='text-xs text-muted-foreground italic py-3 text-center'>
                                        No cart items captured
                                      </p>
                                    )}
                                  </div>

                                  {/* Right: Customer & Context Breakdown */}
                                  <div className='rounded-xl border border-border/70 bg-card p-3.5 space-y-3 shadow-2xs flex flex-col justify-between'>
                                    <div className='space-y-3'>
                                      <div className='flex items-center justify-between pb-2 border-b border-border/50'>
                                        <div className='flex items-center gap-2 text-xs font-semibold text-foreground uppercase tracking-wider'>
                                          <MapPin className='h-3.5 w-3.5 text-primary' />
                                          <span>Customer & Context</span>
                                        </div>
                                        {l.occurrences > 1 && (
                                          <Badge variant='secondary' className='text-[10px] font-mono'>
                                            Visited {l.occurrences} times
                                          </Badge>
                                        )}
                                      </div>

                                      <div className='space-y-2 text-xs'>
                                        <div>
                                          <span className='text-muted-foreground'>Customer: </span>
                                          <span className='font-semibold text-foreground'>
                                            {l.name || 'Guest Customer'}
                                          </span>
                                        </div>

                                        {l.phone && (
                                          <div className='flex items-center gap-2'>
                                            <span className='text-muted-foreground'>Phone: </span>
                                            <a
                                              href={`tel:${l.phone}`}
                                              className='font-mono font-medium text-foreground hover:text-primary transition-colors'
                                            >
                                              {l.phone}
                                            </a>
                                            <CustomerContactActions phone={l.phone} />
                                          </div>
                                        )}

                                        {l.address && typeof l.address === 'object' && (
                                          <div className='rounded-lg bg-muted/30 border border-border/40 p-2.5 space-y-1'>
                                            <p className='text-[11px] font-semibold text-muted-foreground uppercase tracking-wider'>
                                              Shipping Address
                                            </p>
                                            <p className='text-xs text-foreground'>
                                              {[l.address.address, l.address.thana, l.address.district]
                                                .filter(Boolean)
                                                .join(', ')}
                                            </p>
                                          </div>
                                        )}

                                        {l.paymentMethod && (
                                          <div>
                                            <span className='text-muted-foreground'>Payment Intent: </span>
                                            <span className='font-medium capitalize text-foreground'>
                                              {l.paymentMethod.replace('_', ' ')}
                                            </span>
                                          </div>
                                        )}

                                        <div className='grid grid-cols-2 gap-2 pt-1 border-t border-border/40 text-[11px] text-muted-foreground'>
                                          <div>
                                            First seen: {new Date(l.firstSeenAt).toLocaleString()}
                                          </div>
                                          <div>
                                            Last seen: {new Date(l.lastSeenAt).toLocaleString()}
                                          </div>
                                        </div>

                                        {l.convertedOrder && (
                                          <div className='rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2 flex items-center justify-between'>
                                            <span className='text-xs font-medium text-emerald-600 dark:text-emerald-400'>
                                              Converted to Order:
                                            </span>
                                            <Link
                                              to='/op/orders/$id'
                                              params={{ id: l.convertedOrder.id }}
                                              className='font-mono font-bold text-xs text-primary hover:underline flex items-center gap-1'
                                            >
                                              <span>{l.convertedOrder.displayId}</span>
                                              <ExternalLink className='h-3 w-3' />
                                            </Link>
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {/* Action footer inside expanded row */}
                                    <div className='flex items-center justify-end gap-2 pt-3 border-t border-border/50'>
                                      {l.status === 'PENDING' && (
                                        <>
                                          <Button
                                            variant='outline'
                                            size='sm'
                                            className='h-8 text-xs font-medium'
                                            onClick={() => statusMut.mutate({ id: l.id, status: 'NOT_CONVERTED' })}
                                          >
                                            <X className='h-3.5 w-3.5 mr-1' /> Dismiss
                                          </Button>
                                          <Button
                                            variant='default'
                                            size='sm'
                                            className='h-8 text-xs font-semibold shadow-xs'
                                            onClick={() =>
                                              navigate({
                                                to: '/op/orders/incomplete-leads/$id/convert',
                                                params: { id: l.id },
                                              })
                                            }
                                          >
                                            <Edit3 className='h-3.5 w-3.5 mr-1.5' /> Convert with Edit
                                          </Button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        ),
                      ]
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={10} className='p-0 border-0'>
                        <div className='flex flex-col items-center justify-center py-16 px-4 text-center'>
                          <div className='h-14 w-14 rounded-full bg-muted/60 border border-border/60 flex items-center justify-center mb-3 shadow-2xs'>
                            <Inbox className='h-7 w-7 text-muted-foreground/60' />
                          </div>
                          <h3 className='text-sm sm:text-base font-semibold text-foreground mb-1'>
                            No incomplete leads found
                          </h3>
                          <p className='text-xs text-muted-foreground max-w-sm mb-4'>
                            {hasActiveFilters
                              ? 'No checkout abandonments match your current search or status filter.'
                              : 'No incomplete leads captured yet. Abandoned checkouts will show up here automatically.'}
                          </p>
                          {hasActiveFilters && (
                            <Button variant='outline' size='sm' onClick={clearAllFilters} className='h-8 text-xs gap-1.5'>
                              <X className='h-3.5 w-3.5' /> Clear Filters
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className='flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-1'>
            <span className='text-xs text-muted-foreground'>
              Page <span className='font-semibold text-foreground'>{page}</span> of{' '}
              <span className='font-semibold text-foreground'>{totalPages}</span> ({total} leads)
            </span>
            <div className='flex items-center gap-1'>
              <Button
                variant='outline'
                size='sm'
                className='h-8 w-8 p-0 rounded-lg shadow-2xs'
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft className='h-3.5 w-3.5' />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .map((p, i, arr) => (
                  <span key={p}>
                    {i > 0 && arr[i - 1] !== p - 1 && (
                      <span className='px-1 text-xs text-muted-foreground'>...</span>
                    )}
                    <Button
                      variant={p === page ? 'default' : 'outline'}
                      size='sm'
                      className={`h-8 w-8 p-0 text-xs rounded-lg font-semibold shadow-2xs ${
                        p === page ? 'bg-primary text-primary-foreground' : ''
                      }`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  </span>
                ))}
              <Button
                variant='outline'
                size='sm'
                className='h-8 w-8 p-0 rounded-lg shadow-2xs'
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                <ChevronRight className='h-3.5 w-3.5' />
              </Button>
            </div>
          </div>
        )}

        {/* ── Floating Bulk Action Bar (Orders List Standard) ── */}
        {selected.length > 0 && (
          <div className='fixed bottom-5 left-1/2 -translate-x-1/2 bg-popover/95 backdrop-blur-md border border-border/80 shadow-2xl rounded-2xl px-3.5 py-2 flex items-center gap-2.5 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200'>
            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground'
              onClick={() => setSelected([])}
            >
              <X className='h-3.5 w-3.5' />
            </Button>
            <span className='inline-flex items-center rounded-full bg-primary/15 text-primary border border-primary/20 px-2 py-0.5 text-xs font-bold whitespace-nowrap shadow-2xs'>
              {selected.length} selected
            </span>
            <div className='h-4 w-px bg-border/60' />
            <Select onValueChange={v => bulkStatusMut.mutate({ ids: selected, status: v })}>
              <SelectTrigger className='h-8 w-[140px] text-xs rounded-lg bg-background/80'>
                <SelectValue placeholder='Change Status' />
              </SelectTrigger>
              <SelectContent>
                {['NOT_CONVERTED', 'DELETED'].map(s => (
                  <SelectItem key={s} value={s} className='text-xs'>
                    {statusLabels[s] || s.replace('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className='flex items-center gap-1'>
              <SearchableSelect
                options={[
                  { id: 'unassigned', label: 'Unassign' },
                  ...staff.map((s: any) => ({ id: s.id, label: `${s.firstName} ${s.lastName}`.trim() })),
                ]}
                value={''}
                onChange={v => {
                  if (v) bulkAssignMut.mutate({ ids: selected, assignedToId: v === 'unassigned' ? null : v })
                }}
                placeholder='Assign to...'
                searchPlaceholder='Search staff...'
                triggerClassName='h-8 text-xs w-[130px] rounded-lg bg-background/80'
              />
              <Button
                variant='outline'
                size='icon'
                className='h-8 w-8 text-xs text-muted-foreground rounded-lg'
                onClick={() => bulkAssignMut.mutate({ ids: selected, assignedToId: null })}
                title='Unassign all selected'
              >
                <X className='h-3 w-3' />
              </Button>
            </div>
            {selectedPhones.length > 0 && (
              <>
                <div className='h-4 w-px bg-border/60' />
                <Button
                  variant='outline'
                  size='sm'
                  className='h-8 text-xs text-destructive hover:bg-destructive/10 rounded-lg gap-1.5'
                  onClick={() =>
                    setBlockPhones({
                      phones: selectedPhones,
                      contextLabel: `${selected.length} incomplete leads`,
                    })
                  }
                >
                  <Ban className='h-3 w-3' /> Block Phones
                </Button>
              </>
            )}
          </div>
        )}
      </Main>

      {/* ── Block Phone Dialog ── */}
      <BlockPhoneDialog
        open={!!blockPhones}
        onOpenChange={o => {
          if (!o) setBlockPhones(null)
        }}
        phones={blockPhones?.phones || []}
        contextLabel={blockPhones?.contextLabel}
      />

      {/* ── Quick Convert Modal / Fallback Dialog ── */}
      <Dialog
        open={!!editingLead}
        onOpenChange={open => {
          if (!open) setEditingLead(null)
        }}
      >
        <DialogContent className='max-w-3xl max-h-[85vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>Convert Lead {editingLead?.displayId || ''} to Order</DialogTitle>
          </DialogHeader>
          {editingLead && (
            <div className='space-y-5 py-2'>
              <div className='grid grid-cols-2 gap-4'>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Customer Name</Label>
                  <Input
                    value={editForm.guestName}
                    onChange={e => setEditForm(f => ({ ...f, guestName: e.target.value }))}
                  />
                </div>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Phone</Label>
                  <Input
                    value={editForm.guestPhone}
                    onChange={e => setEditForm(f => ({ ...f, guestPhone: e.target.value }))}
                  />
                </div>
                <LeadConvertPaymentFields
                  gatewayCode={editForm.paymentMethod}
                  accountId={editForm.accountId}
                  storedPaymentMethod={editingLead.paymentMethod}
                  onChange={(next) => {
                    setEditForm(f => ({
                      ...f,
                      paymentMethod: next.gatewayCode,
                      accountId: next.accountId,
                    }))
                  }}
                />
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Shipping Address</Label>
                  <Textarea
                    value={editForm.shippingAddress}
                    onChange={e => setEditForm(f => ({ ...f, shippingAddress: e.target.value }))}
                    rows={2}
                  />
                </div>
              </div>

              <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <Label className='text-xs font-semibold'>Order Items</Label>
                  <span className='text-xs text-muted-foreground'>
                    Total: ৳
                    {editForm.items
                      .reduce((s: number, i: any) => s + (i.price || 0) * (i.quantity || 1), 0)
                      .toFixed(2)}
                  </span>
                </div>
                <div className='space-y-2 max-h-60 overflow-y-auto'>
                  {editForm.items.map((item: any, idx: number) => (
                    <div key={idx} className='flex items-center gap-2 rounded-lg border bg-background p-2'>
                      {item.image ? (
                        <SafeImage
                          src={item.image}
                          alt=''
                          className='h-10 w-10 rounded object-cover shrink-0'
                          thumbWidth={48}
                          thumbHeight={48}
                        />
                      ) : (
                        <div className='h-10 w-10 rounded border bg-muted/30 flex items-center justify-center shrink-0'>
                          <Package className='h-4 w-4 text-muted-foreground/60' />
                        </div>
                      )}
                      <div className='flex-1 min-w-0'>
                        <div className='text-sm font-medium truncate'>{item.name || 'Product'}</div>
                        <div className='flex items-center gap-2 mt-1'>
                          <Input
                            type='number'
                            value={item.quantity}
                            onChange={e => {
                              const items = [...editForm.items]
                              items[idx] = { ...items[idx], quantity: parseInt(e.target.value) || 0 }
                              setEditForm(f => ({ ...f, items }))
                            }}
                            className='h-7 w-16 text-xs'
                            min={1}
                          />
                          <Input
                            type='number'
                            value={item.price}
                            onChange={e => {
                              const items = [...editForm.items]
                              items[idx] = { ...items[idx], price: parseFloat(e.target.value) || 0 }
                              setEditForm(f => ({ ...f, items }))
                            }}
                            className='h-7 w-20 text-xs'
                            step='any'
                            min={0}
                          />
                          <span className='text-xs font-medium w-16 text-right'>
                            ৳{((item.price || 0) * (item.quantity || 1)).toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-7 w-7 shrink-0 text-red-500'
                        onClick={() =>
                          setEditForm(f => ({ ...f, items: f.items.filter((_: any, i: number) => i !== idx) }))
                        }
                      >
                        <Trash2 className='h-3.5 w-3.5' />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className='gap-2'>
            <Button variant='outline' onClick={() => setEditingLead(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!editingLead) return
                let parsedAddress = undefined
                if (editForm.shippingAddress) {
                  try {
                    parsedAddress = JSON.parse(editForm.shippingAddress)
                  } catch {
                    toast.error('Invalid shipping address format')
                    return
                  }
                }
                convertEditMut.mutate({
                  id: editingLead.id,
                  overrides: {
                    items: editForm.items,
                    guestName: editForm.guestName,
                    guestPhone: editForm.guestPhone,
                    paymentMethod: editForm.paymentMethod || undefined,
                    ...(editForm.accountId ? { accountId: editForm.accountId } : {}),
                    shippingAddress: parsedAddress,
                  },
                })
              }}
              disabled={convertEditMut.isPending || editForm.items.length === 0}
            >
              {convertEditMut.isPending ? 'Creating...' : 'Create Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/date-picker'
import { Skeleton } from '@/components/ui/skeleton'
import { CalendarDays, Plus, Clock, CheckCircle2, XCircle, Ban, AlertCircle, Loader2 } from 'lucide-react'
import {
  useMyLeaveBalancesQuery,
  useMyLeaveTypesQuery,
  useMyLeaveRequestsQuery,
  useCreateMyLeaveRequestMutation,
  useCancelMyLeaveRequestMutation,
} from '../hooks'
import { formatDhakaDate, toDhakaDateString } from '@/lib/dhaka-time'
import type { LeaveStatus } from '../api'

const STATUS_BADGE: Record<LeaveStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20' },
  approved: { label: 'Approved', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' },
  rejected: { label: 'Rejected', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground border-border' },
}

export function LeaveTab({
  openApplyModal,
  onOpenApplyModalChange,
}: {
  openApplyModal?: boolean
  onOpenApplyModalChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isApplyOpen = openApplyModal !== undefined ? openApplyModal : internalOpen
  const setApplyOpen = onOpenApplyModalChange || setInternalOpen

  const { data: balances = [], isLoading: balancesLoading } = useMyLeaveBalancesQuery()
  const { data: leaveTypes = [], isLoading: typesLoading } = useMyLeaveTypesQuery()
  const [page, setPage] = useState(1)
  const { data: requestsData, isLoading: requestsLoading } = useMyLeaveRequestsQuery(page, 20)

  const createMut = useCreateMyLeaveRequestMutation()
  const cancelMut = useCancelMyLeaveRequestMutation()

  // Form State
  const [selectedTypeId, setSelectedTypeId] = useState('')
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [reason, setReason] = useState('')

  // Calculate day count automatically
  const calculatedDays = useMemo(() => {
    if (!startDate || !endDate) return 0
    if (endDate < startDate) return 0
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
    return diffDays
  }, [startDate, endDate])

  const selectedBalance = useMemo(() => {
    return balances.find((b) => b.typeId === selectedTypeId)
  }, [balances, selectedTypeId])

  const isExceedingBalance = selectedBalance && calculatedDays > selectedBalance.remaining

  function handleOpenApply() {
    setSelectedTypeId(leaveTypes[0]?.id || '')
    setStartDate(undefined)
    setEndDate(undefined)
    setReason('')
    setApplyOpen(true)
  }

  function handleSubmit() {
    if (!selectedTypeId || !startDate || !endDate || !reason.trim()) return
    if (calculatedDays <= 0 || isExceedingBalance) return

    createMut.mutate(
      {
        typeId: selectedTypeId,
        startDate: toDhakaDateString(startDate),
        endDate: toDhakaDateString(endDate),
        days: calculatedDays,
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          setApplyOpen(false)
        },
      }
    )
  }

  const requests = requestsData?.data || []

  return (
    <div className="space-y-6">
      {/* Leave Balances Grid */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold">Leave Balances</h3>
            <p className="text-xs text-muted-foreground">
              Your annual leave quota, usage, and available remaining balance.
            </p>
          </div>
          <Button onClick={handleOpenApply} size="sm" className="gap-1.5 shadow-xs">
            <Plus className="h-4 w-4" /> Apply for Leave
          </Button>
        </div>

        {balancesLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-4 w-28 mb-3" />
                  <Skeleton className="h-8 w-20 mb-2" />
                  <Skeleton className="h-2 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : balances.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No leave policies configured yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {balances.map((b) => {
              const usedPercent = b.entitlement > 0 ? Math.min(100, Math.round((b.used / b.entitlement) * 100)) : 0
              return (
                <Card key={b.typeId} className="border-border/60 bg-card">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground truncate">{b.typeName}</span>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {b.isPaid ? 'Paid' : 'Unpaid'}
                      </Badge>
                    </div>

                    <div className="mt-2.5 flex items-baseline justify-between">
                      <div>
                        <span className="text-2xl font-bold tracking-tight text-foreground">
                          {b.remaining}
                        </span>
                        <span className="text-xs text-muted-foreground ml-1">days left</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {b.used} / {b.entitlement} used
                      </span>
                    </div>

                    <div className="mt-3 h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          b.remaining === 0 ? 'bg-destructive' : 'bg-primary'
                        }`}
                        style={{ width: `${usedPercent}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Leave Requests Table */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            My Leave Applications &amp; History
          </CardTitle>
          <CardDescription>
            Track the status of your submitted leave requests and managerial decisions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {requestsLoading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : requests.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              You haven't submitted any leave requests yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Leave Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead className="text-center">Days</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Decision / Note</TableHead>
                    <TableHead className="w-20 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((req) => {
                    const badge = STATUS_BADGE[req.status]
                    return (
                      <TableRow key={req.id}>
                        <TableCell className="font-medium text-sm">
                          {req.type?.name || 'Leave'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDhakaDate(req.startDate)} – {formatDhakaDate(req.endDate)}
                        </TableCell>
                        <TableCell className="text-center font-semibold text-xs">
                          {req.days} {req.days === 1 ? 'day' : 'days'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate" title={req.reason}>
                          {req.reason}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${badge.className}`}>
                            {badge.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                          {req.decisionNote || (req.status === 'approved' ? 'Approved by Manager' : '—')}
                        </TableCell>
                        <TableCell className="text-right">
                          {req.status === 'pending' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-destructive hover:bg-destructive/10"
                              onClick={() => cancelMut.mutate(req.id)}
                              disabled={cancelMut.isPending}
                            >
                              Cancel
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Apply for Leave Modal */}
      <Dialog open={isApplyOpen} onOpenChange={setApplyOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Apply for Leave
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-3">
            {/* Leave Type Selector */}
            <div className="space-y-1.5">
              <Label htmlFor="leave-type">Leave Type *</Label>
              <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
                <SelectTrigger id="leave-type">
                  <SelectValue placeholder="Select type of leave" />
                </SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((t) => {
                    const bal = balances.find((b) => b.typeId === t.id)
                    const remainingStr = bal ? `(${bal.remaining} days left)` : ''
                    return (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} {remainingStr}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              {selectedBalance && (
                <p className="text-[11px] text-muted-foreground">
                  Available remaining: <span className="font-semibold text-foreground">{selectedBalance.remaining} days</span>
                </p>
              )}
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Date *</Label>
                <DatePicker
                  selected={startDate}
                  onSelect={(d) => {
                    setStartDate(d)
                    if (!endDate || (d && endDate < d)) {
                      setEndDate(d)
                    }
                  }}
                  placeholder="Select start"
                />
              </div>
              <div className="space-y-1.5">
                <Label>End Date *</Label>
                <DatePicker
                  selected={endDate}
                  onSelect={setEndDate}
                  placeholder="Select end"
                />
              </div>
            </div>

            {/* Days Preview & Validation */}
            {calculatedDays > 0 && (
              <div
                className={`p-2.5 rounded-lg border text-xs flex items-center justify-between ${
                  isExceedingBalance
                    ? 'border-destructive/30 bg-destructive/10 text-destructive'
                    : 'border-border/60 bg-muted/40 text-foreground'
                }`}
              >
                <span>Total Requested Duration:</span>
                <span className="font-bold">
                  {calculatedDays} {calculatedDays === 1 ? 'Day' : 'Days'}
                </span>
              </div>
            )}

            {isExceedingBalance && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" />
                Cannot request {calculatedDays} days. You only have {selectedBalance?.remaining} days remaining.
              </p>
            )}

            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="leave-reason">Reason for Leave *</Label>
              <Textarea
                id="leave-reason"
                rows={3}
                placeholder="Briefly state the reason for your leave request..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !selectedTypeId ||
                !startDate ||
                !endDate ||
                !reason.trim() ||
                calculatedDays <= 0 ||
                Boolean(isExceedingBalance) ||
                createMut.isPending
              }
            >
              {createMut.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

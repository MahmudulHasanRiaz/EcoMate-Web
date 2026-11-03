import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle2, Loader2, Plus, Trash2, XCircle } from 'lucide-react'
import { ProductSkuCombobox, type LookupRow } from './product-sku-combobox'

interface BulkAdjustDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

interface BulkRow {
  key: number
  picked: LookupRow | null
  quantity: string
}

interface BulkResult {
  productId?: string
  variantId?: string | null
  quantity: number
  success: boolean
  error?: string
}

interface BulkItem {
  productId: string
  variantId?: string
  quantity: number
  reason: string
  confirmDestructive?: boolean
}

// Same reason codes as the single Adjust Stock modal.
const REASON_OPTIONS = [
  { value: 'physical_count', label: 'Physical Count' },
  { value: 'damage', label: 'Damage' },
  { value: 'lost', label: 'Lost' },
  { value: 'found', label: 'Found' },
  { value: 'correction', label: 'Correction' },
  { value: 'initial', label: 'Initial Balance' },
  { value: 'other', label: 'Other' },
]

let rowKey = 0
const newRow = (): BulkRow => ({ key: ++rowKey, picked: null, quantity: '' })

/**
 * Managed-stock bulk adjustment: posts rows to POST /inventory/bulk-adjust
 * (the endpoint previously had NO UI caller) and shows the per-item
 * success/failure results the endpoint returns.
 */
export function BulkAdjustDialog({ open, onOpenChange, onSuccess }: BulkAdjustDialogProps) {
  const [rows, setRows] = useState<BulkRow[]>([newRow()])
  const [reason, setReason] = useState('')
  const [results, setResults] = useState<BulkResult[] | null>(null)

  const reset = () => {
    setRows([newRow()])
    setReason('')
    setResults(null)
  }

  const mutation = useMutation({
    mutationFn: (items: BulkItem[]) =>
      apiClient.post('/inventory/bulk-adjust', { items }).then((r) => r.data),
    onSuccess: (data) => {
      const res: BulkResult[] = data?.results ?? []
      // Merge into any previous results (a destructive-confirm resubmit only
      // returns the retried rows; the rest of the batch keeps its outcome).
      setResults((prev) => {
        if (!prev) return res
        return prev.map(
          (old) =>
            res.find(
              (r) =>
                r.productId === old.productId &&
                (r.variantId ?? null) === (old.variantId ?? null),
            ) ?? old,
        )
      })
      const okCount = res.filter((r) => r.success).length
      if (okCount === res.length) {
        toast.success(`Adjusted ${okCount} item${okCount === 1 ? '' : 's'}`)
      } else if (okCount > 0) {
        toast.warning(`${okCount} of ${res.length} items adjusted — see failures below`)
      } else {
        toast.error('No items were adjusted — see failures below')
      }
      if (okCount > 0) onSuccess?.()
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Bulk adjustment failed'),
  })

  // The backend refuses a deduction that would remove (nearly) all of a
  // product's available stock unless the item carries confirmDestructive —
  // the same guard the single Adjust Stock modal confirms. Those failures
  // come back per-item with "confirmDestructive" in the error text; collect
  // them so the user can explicitly confirm and resubmit just those rows.
  const destructiveFailures = (results ?? []).filter(
    (r) => !r.success && (r.error ?? '').includes('confirmDestructive'),
  )

  const handleConfirmDestructive = () => {
    const items: BulkItem[] = destructiveFailures.map((r) => ({
      productId: r.productId as string,
      variantId: r.variantId ?? undefined,
      quantity: r.quantity,
      reason,
      confirmDestructive: true,
    }))
    if (items.length > 0) mutation.mutate(items)
  }

  const updateRow = (key: number, patch: Partial<BulkRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const handleSubmit = () => {
    if (!reason) {
      toast.error('Please select a reason')
      return
    }
    const items: Array<{ productId: string; variantId?: string; quantity: number; reason: string }> = []
    for (const row of rows) {
      if (!row.picked) continue
      const qty = parseInt(row.quantity, 10)
      if (isNaN(qty) || qty === 0) {
        toast.error(`Enter a valid non-zero quantity for ${row.picked.productName}`)
        return
      }
      items.push({
        productId: row.picked.productId,
        variantId: row.picked.variantId ?? undefined,
        quantity: qty,
        reason,
      })
    }
    if (items.length === 0) {
      toast.error('Add at least one product')
      return
    }
    setResults(null)
    mutation.mutate(items)
  }

  const resultFor = (row: BulkRow): BulkResult | undefined =>
    results?.find(
      (r) => r.productId === row.picked?.productId && (r.variantId ?? null) === (row.picked?.variantId ?? null),
    )

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Bulk Adjust Managed Stock</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-3">
            {rows.map((row, i) => {
              const result = resultFor(row)
              return (
                <div key={row.key} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <ProductSkuCombobox
                        selected={row.picked}
                        onSelect={(picked) => updateRow(row.key, { picked })}
                        label={`Product ${i + 1}`}
                      />
                    </div>
                    <div className="w-28 space-y-1.5 pt-0">
                      <Label className="text-xs">Qty Δ</Label>
                      <Input
                        type="number"
                        placeholder="+5 / -2"
                        value={row.quantity}
                        onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 mt-5 text-destructive shrink-0"
                      onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                      disabled={rows.length === 1}
                      title="Remove row"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {result && (
                    <p className={`flex items-center gap-1.5 text-xs ${result.success ? 'text-green-600' : 'text-destructive'}`}>
                      {result.success ? (
                        <><CheckCircle2 className="h-3.5 w-3.5" /> Adjusted by {result.quantity}</>
                      ) : (
                        <><XCircle className="h-3.5 w-3.5" /> {result.error || 'Failed'}</>
                      )}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setRows((prev) => [...prev, newRow()])}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Product
          </Button>
          <div className="grid gap-2">
            <Label>Reason (applies to all rows)</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {destructiveFailures.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
              <p className="text-sm text-amber-900">
                {destructiveFailures.length} adjustment
                {destructiveFailures.length === 1 ? '' : 's'} would remove nearly
                all available stock and need explicit confirmation:
              </p>
              <ul className="list-disc pl-5 text-xs text-amber-900 space-y-0.5">
                {destructiveFailures.map((r) => {
                  const row = rows.find(
                    (x) =>
                      x.picked?.productId === r.productId &&
                      (x.picked?.variantId ?? null) === (r.variantId ?? null),
                  )
                  return (
                    <li key={`${r.productId}-${r.variantId ?? ''}`}>
                      {row?.picked?.productName ?? r.productId} — Δ {r.quantity}
                    </li>
                  )
                })}
              </ul>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmDestructive}
                disabled={mutation.isPending}
              >
                {mutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Confirm &amp; apply destructive adjustments
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {results ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Apply Adjustments
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

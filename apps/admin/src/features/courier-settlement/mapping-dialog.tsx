import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useColumnMappings, useCourierSettlementMutations } from './hooks'
import type { MappingItem } from './api'

/**
 * Column mapping (§12). A mapping is a CANDIDATE until the operator ticks
 * "Always use this column for this field" — only then does it become active,
 * and only one active column may ever claim a field (conflicts are refused).
 */
export function MappingDialog({
  open,
  onOpenChange,
  courier,
  headers,
  invoiceId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  courier?: string
  headers?: string[]
  invoiceId?: string
}) {
  const { data, isLoading } = useColumnMappings(courier)
  const { saveMapping, activateMapping, deactivateMapping } = useCourierSettlementMutations()
  const [sourceHeader, setSourceHeader] = useState('')
  const [field, setField] = useState('')
  const [alwaysUse, setAlwaysUse] = useState(true)

  const fields = data?.fields ?? []
  const mappings: MappingItem[] = data?.data ?? []
  const mappedHeaders = new Set(mappings.map((m) => m.sourceHeader))
  const freeHeaders = (headers ?? []).filter((h) => !mappedHeaders.has(h))

  const save = () => {
    if (!courier || !sourceHeader || !field) return
    saveMapping.mutate(
      { courier, sourceHeader, field, alwaysUse, invoiceId },
      { onSuccess: () => { setSourceHeader(''); setField('') } },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Column mapping</DialogTitle>
          <DialogDescription>
            Tell the system which source column carries which field for{' '}
            <span className="font-medium capitalize">{courier ?? 'this courier'}</span>. Mappings are
            provider-scoped, and two columns can never claim the same field.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label>Source column</Label>
              <Select value={sourceHeader} onValueChange={setSourceHeader}>
                <SelectTrigger className="tap-h">
                  <SelectValue placeholder={freeHeaders.length ? 'Select column' : 'No unmapped columns'} />
                </SelectTrigger>
                <SelectContent>
                  {freeHeaders.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Field</Label>
              <Select value={field} onValueChange={setField}>
                <SelectTrigger className="tap-h">
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((f) => (
                    <SelectItem key={f.field} value={f.field}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Button onClick={save} disabled={!sourceHeader || !field || saveMapping.isPending} className="tap-h">
                Save
              </Button>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={alwaysUse}
              onCheckedChange={(v) => setAlwaysUse(v === true)}
              className="mt-0.5"
            />
            <span>
              Always use this column for this field
              <span className="block text-muted-foreground">
                Required to activate the mapping — a saved mapping stays a candidate until this is
                checked.
              </span>
            </span>
          </label>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">Saved mappings</h4>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading mappings…</p>
            ) : mappings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No mappings yet. The built-in provider descriptors already cover the standard file
                formats.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {mappings.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{m.sourceHeader}</span>
                      <span className="text-muted-foreground">→</span>
                      <span>{m.fieldLabel}</span>
                      <Badge variant="outline" className="capitalize">
                        {m.courier}
                      </Badge>
                      {m.active ? (
                        <Badge variant="success">active</Badge>
                      ) : (
                        <Badge variant="outline">candidate</Badge>
                      )}
                      {m.conflict ? (
                        <Badge variant="danger">conflict</Badge>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      {m.active ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="tap-h"
                          onClick={() =>
                            deactivateMapping.mutate({ id: m.id, invoiceId })
                          }
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="tap-h"
                          disabled={!!m.conflict}
                          title={m.conflict ? 'Resolve the conflicting mapping first' : undefined}
                          onClick={() => activateMapping.mutate({ id: m.id, invoiceId })}
                        >
                          Always use
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

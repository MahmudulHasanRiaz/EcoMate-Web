import { useState } from 'react'
import { Loader2, Moon, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import {
  useDeactivateShiftPresetMutation,
  useShiftPresetsQuery,
  useUpdateShiftPresetMutation,
} from './hooks'
import { ShiftPresetDialog } from './components/shift-preset-dialog'
import { formatMinutes, type ShiftPreset } from './api'

export function ShiftsPage() {
  const [showInactive, setShowInactive] = useState(false)
  const { data, isLoading, isError, refetch } = useShiftPresetsQuery(showInactive)
  const deactivateMut = useDeactivateShiftPresetMutation()
  const updateMut = useUpdateShiftPresetMutation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ShiftPreset | null>(null)

  const presets = data ?? []

  return (
    <>
      <Header fixed>
        <div className='me-auto' />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Shift Presets</h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              Reusable working-hours templates. Assign them to employees per
              weekday from their Schedule tab; overtime is measured against the
              scheduled hours.
            </p>
          </div>
          <div className='flex items-center gap-3'>
            <div className='flex items-center gap-2'>
              <Switch
                id='show-inactive'
                checked={showInactive}
                onCheckedChange={setShowInactive}
              />
              <label htmlFor='show-inactive' className='text-sm text-muted-foreground'>
                Show retired
              </label>
            </div>
            <Button
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              <Plus className='mr-1 h-4 w-4' />
              New preset
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className='flex justify-center py-12'>
            <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
          </div>
        ) : isError ? (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='text-sm text-muted-foreground'>
              Could not load shift presets.
            </p>
            <Button variant='outline' size='sm' onClick={() => refetch()}>
              <RotateCcw className='mr-1 h-4 w-4' /> Retry
            </Button>
          </div>
        ) : presets.length === 0 ? (
          <div className='py-12 text-center text-sm text-muted-foreground'>
            No shift presets yet. Create one to start tracking overtime.
          </div>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead className='text-right'>Grace</TableHead>
                  <TableHead className='text-right'>Break</TableHead>
                  <TableHead className='text-right'>Scheduled</TableHead>
                  <TableHead className='text-right'>In use</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {presets.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className='font-medium'>{p.name}</TableCell>
                    <TableCell className='font-mono text-xs text-muted-foreground'>
                      {p.code}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      <span className='inline-flex items-center gap-1.5'>
                        {p.startTime} – {p.endTime}
                        {p.overnight && (
                          <Badge
                            variant='secondary'
                            className='gap-1 text-[10px] font-medium'
                          >
                            <Moon className='size-3' />
                            Night
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className='text-right tabular-nums text-muted-foreground'>
                      {p.graceMinutes}m
                    </TableCell>
                    <TableCell className='text-right tabular-nums text-muted-foreground'>
                      {p.breakMinutes}m
                    </TableCell>
                    <TableCell className='text-right font-medium tabular-nums'>
                      {formatMinutes(p.standardMinutes)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums text-muted-foreground'>
                      {p.assignments?.length ?? 0}
                    </TableCell>
                    <TableCell>
                      {p.isActive ? (
                        <Badge
                          variant='secondary'
                          className='bg-[var(--color-success-soft)] text-[var(--color-success-ink)]'
                        >
                          Active
                        </Badge>
                      ) : (
                        <Badge variant='secondary' className='text-muted-foreground'>
                          Retired
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex justify-end gap-1'>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => {
                            setEditing(p)
                            setDialogOpen(true)
                          }}
                        >
                          Edit
                        </Button>
                        {p.isActive ? (
                          <Button
                            variant='ghost'
                            size='sm'
                            className='text-destructive'
                            disabled={deactivateMut.isPending}
                            onClick={() => deactivateMut.mutate(p.id)}
                          >
                            <Trash2 className='h-4 w-4' />
                          </Button>
                        ) : (
                          <Button
                            variant='ghost'
                            size='sm'
                            disabled={updateMut.isPending}
                            onClick={() =>
                              updateMut.mutate({ id: p.id, dto: { isActive: true } })
                            }
                          >
                            Restore
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Main>

      <ShiftPresetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        preset={editing}
      />
    </>
  )
}
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Copy, Plus } from 'lucide-react'

interface Props {
  onRun: (scope: 'db_only' | 'db_files') => void
  isPending: boolean
  /** Id of the backup the last run created (finding 7a) — shown so it can be
      copied into Reconciliation → Apply repairs, which asks for this id. */
  createdBackupId?: string | null
  onClearCreatedId?: () => void
}

export function RunBackupDialog({ onRun, isPending, createdBackupId, onClearCreatedId }: Props) {
  const [scope, setScope] = useState<'db_only' | 'db_files'>('db_only')
  const [open, setOpen] = useState(false)

  const handleOpenChange = (v: boolean) => {
    setOpen(v)
    if (!v) onClearCreatedId?.()
  }

  const handleRun = () => {
    // Do NOT close here: the dialog used to close before the create call
    // settled, discarding the new backup's id. Stay open so the id can be
    // shown (and copied) once the run starts.
    onRun(scope)
  }

  const handleCopyId = () => {
    if (!createdBackupId) return
    navigator.clipboard
      .writeText(createdBackupId)
      .then(() => toast.success('Backup ID copied'))
      .catch(() => toast.error('Could not copy backup ID'))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" />Run Backup</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run Manual Backup</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <RadioGroup value={scope} onValueChange={(v: any) => setScope(v)}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="db_only" id="db_only" />
              <Label htmlFor="db_only">Database Only — faster, smaller</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="db_files" id="db_files" />
              <Label htmlFor="db_files">Database + Content Files — full backup</Label>
            </div>
          </RadioGroup>
          <Button onClick={handleRun} disabled={isPending} className="w-full">
            {isPending ? 'Starting...' : 'Start Backup'}
          </Button>
          {createdBackupId && (
            <div className="space-y-2 rounded-lg border bg-muted/50 p-3">
              <p className="text-sm font-medium">Backup started</p>
              <p className="text-xs text-muted-foreground">
                Copy this backup ID — Reconciliation → Apply repairs asks for it
                (it is recorded there as an audit reference only).
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-background px-2 py-1 font-mono text-xs">
                  {createdBackupId}
                </code>
                <Button variant="outline" size="sm" onClick={handleCopyId}>
                  <Copy className="mr-1 h-3.5 w-3.5" /> Copy
                </Button>
              </div>
              <Button variant="outline" className="w-full" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

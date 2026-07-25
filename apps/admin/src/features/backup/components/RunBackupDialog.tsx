import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Plus } from 'lucide-react'

interface Props {
  onRun: (scope: 'db_only' | 'db_files') => void
  isPending: boolean
}

export function RunBackupDialog({ onRun, isPending }: Props) {
  const [scope, setScope] = useState<'db_only' | 'db_files'>('db_only')
  const [open, setOpen] = useState(false)

  const handleRun = () => {
    onRun(scope)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
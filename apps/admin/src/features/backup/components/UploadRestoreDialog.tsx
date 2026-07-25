import { useState, useRef } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Upload, File, CheckCircle2 } from 'lucide-react'

interface Props {
  onUpload: (file: File) => void
  isPending: boolean
}

export function UploadRestoreDialog({ onUpload, isPending }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleUpload = () => {
    if (file) {
      onUpload(file)
      setOpen(false)
      setFile(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Upload className="mr-2 h-4 w-4" />Upload Backup</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Upload Backup File
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary"
            onClick={() => inputRef.current?.click()}
          >
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <File className="h-5 w-5" />
                <span>{file.name}</span>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Click to select .sql.gz or .tar.gz file
              </p>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".sql.gz,.tar.gz"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Upload a backup file to the server. Then click <strong>Restore</strong> on the backup row to restore it. Max 5GB.
          </p>
          <Button onClick={handleUpload} disabled={!file || isPending} className="w-full">
            {isPending ? 'Uploading...' : 'Upload Backup'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
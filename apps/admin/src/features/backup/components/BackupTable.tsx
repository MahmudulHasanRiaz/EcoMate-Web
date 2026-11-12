import { useState } from 'react'
import { toast } from 'sonner'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDistanceToNow, format } from 'date-fns'
import { Download, Lock, Unlock, Trash2, RotateCcw, FileDown } from 'lucide-react'
import type { BackupJob } from '../types'
import { RestoreConfirmDialog } from './RestoreConfirmDialog'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warning',
  running: 'bg-info',
  completed: 'bg-success',
  failed: 'bg-danger',
  restoring: 'bg-accent-violet',
}

const SCOPE_LABELS: Record<string, string> = {
  db_only: 'DB Only',
  db_files: 'DB + Files',
}

interface Props {
  backups: BackupJob[]
  isLoading: boolean
  totalPages: number
  page: number
  onPageChange: (p: number) => void
  onDownload: (id: string) => void
  onRestore: (id: string) => void
  restorePending: boolean
  onToggleLock: (id: string, locked: boolean) => void
  onDelete: (id: string) => void
}

export function BackupTable({
  backups, isLoading, totalPages, page, onPageChange,
  onDownload, onRestore, restorePending, onToggleLock, onDelete,
}: Props) {
  if (isLoading) return <div className="p-4 text-muted-foreground">Loading...</div>

  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader>
        <CardTitle>Backups</CardTitle>
      </CardHeader>
      <CardContent>
        <Table className="dash-table">
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Backup ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {backups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No backups yet
                </TableCell>
              </TableRow>
            ) : (
              backups.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="text-xs">
                    <div>{format(new Date(b.createdAt), 'PP')}</div>
                    <div className="text-muted-foreground">
                      {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}
                    </div>
                  </TableCell>
                  {/* Finding 7(a): the list showed no record id, so the id
                      Reconciliation → Apply repairs asks for could not be
                      read off here. `id` is the stable backend identifier
                      (Prisma cuid) already returned by the list endpoint —
                      no new id scheme. Click copies it. */}
                  <TableCell>
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(b.id)
                          .then(() => toast.success('Backup ID copied'))
                          .catch(() => toast.error('Could not copy backup ID'))
                      }
                      title="Click to copy backup ID"
                      className="max-w-40 break-all text-left font-mono text-xs text-muted-foreground hover:text-foreground"
                    >
                      {b.id}
                    </button>
                  </TableCell>
                  <TableCell className="capitalize">{b.type}</TableCell>
                  <TableCell>{SCOPE_LABELS[b.scope] || b.scope}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Badge className={`${STATUS_COLORS[b.status]} text-white`}>
                        {b.status}
                      </Badge>
                      {b.errorMessage && (
                        <p className="max-w-48 truncate text-[10px] text-danger" title={b.errorMessage}>
                          {b.errorMessage}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {b.fileSize ? `${(Number(b.fileSize) / 1024 / 1024).toFixed(1)} MB` : '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {b.status === 'completed' && b.fileKey && (
                        <>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onDownload(b.id)}
                            title="Download">
                            <Download className="h-4 w-4" />
                          </Button>
                          <RestoreConfirmDialog
                            onConfirm={() => onRestore(b.id)}
                            isPending={restorePending}
                            trigger={
                              <Button size="icon" variant="ghost" className="h-8 w-8" title="Restore">
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            }
                          />
                        </>
                      )}
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onToggleLock(b.id, !b.locked)}
                        title={b.locked ? 'Unlock' : 'Lock'}>
                        {b.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onDelete(b.id)}
                        title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            <Button variant="outline" size="sm" className="tap-h"
              disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              Previous
            </Button>
            <span className="flex items-center text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button variant="outline" size="sm" className="tap-h"
              disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

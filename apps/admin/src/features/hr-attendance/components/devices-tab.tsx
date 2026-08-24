import { useState, useEffect } from 'react'
import { Loader2, RotateCcw, Plus, Pencil, Trash2, Plug, RefreshCw, Link2, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { employeesApi, type EmployeeResponse } from '@/features/employees/api'
import {
  formatDate,
  formatTime,
  type AttendanceDevice,
  type CreateDeviceDto,
  type DeviceMapping,
  type DeviceSyncStatus,
} from '../api'
import {
  useDevicesQuery,
  useCreateDeviceMutation,
  useUpdateDeviceMutation,
  useDeleteDeviceMutation,
  useTestDeviceMutation,
  useSyncDeviceMutation,
  useDeviceMappingsQuery,
  useCreateMappingMutation,
  useDeleteMappingMutation,
} from '../hooks'

const SYNC_BADGE: Record<DeviceSyncStatus, string> = {
  IDLE: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  CONNECTED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  DISCONNECTED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  SYNCING: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  FAILED: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
}

const CONNECTION_METHODS = ['API', 'PUSH']

function DeviceDialog({
  open,
  onOpenChange,
  device,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  device?: AttendanceDevice | null
}) {
  const isEdit = !!device
  const [name, setName] = useState('')
  const [deviceType, setDeviceType] = useState('')
  const [vendor, setVendor] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [location, setLocation] = useState('')
  const [connectionMethod, setConnectionMethod] = useState('API')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [credentials, setCredentials] = useState('')

  const createMut = useCreateDeviceMutation()
  const updateMut = useUpdateDeviceMutation()

  useEffect(() => {
    if (!open) return
    setName(device?.name ?? '')
    setDeviceType(device?.deviceType ?? '')
    setVendor(device?.vendor ?? '')
    setIdentifier(device?.identifier ?? '')
    setLocation(device?.location ?? '')
    setConnectionMethod(device?.connectionMethod ?? 'API')
    setHost(device?.host ?? '')
    setPort(device?.port != null ? String(device.port) : '')
    setEnabled(device?.enabled ?? false)
    setCredentials('')
  }, [open, device])

  function handleSubmit() {
    if (!name.trim() || !deviceType.trim()) return
    const base: CreateDeviceDto = {
      name: name.trim(),
      deviceType: deviceType.trim(),
      ...(vendor.trim() ? { vendor: vendor.trim() } : {}),
      ...(identifier.trim() ? { identifier: identifier.trim() } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      connectionMethod,
      ...(host.trim() ? { host: host.trim() } : {}),
      ...(port.trim() ? { port: Number(port) } : {}),
      enabled,
    }
    if (isEdit) {
      updateMut.mutate({ id: device.id, dto: base }, { onSuccess: () => onOpenChange(false) })
      return
    }
    createMut.mutate(
      { ...base, ...(credentials.trim() ? { credentialsEncrypted: credentials } : {}) },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  const pending = createMut.isPending || updateMut.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[540px]'>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Device' : 'Add Device'}</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4 sm:grid-cols-2'>
          <div className='grid gap-2'>
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder='Front door scanner' />
          </div>
          <div className='grid gap-2'>
            <Label>Device Type *</Label>
            <Input value={deviceType} onChange={(e) => setDeviceType(e.target.value)} placeholder='FINGERPRINT / CARD / FACE' />
          </div>
          <div className='grid gap-2'>
            <Label>Vendor</Label>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder='zkteco' />
          </div>
          <div className='grid gap-2'>
            <Label>Identifier</Label>
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder='Device serial/ID' />
          </div>
          <div className='grid gap-2'>
            <Label>Location</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder='Main gate' />
          </div>
          <div className='grid gap-2'>
            <Label>Connection Method</Label>
            <Select value={connectionMethod} onValueChange={setConnectionMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONNECTION_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-2'>
            <Label>Host</Label>
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder='192.168.1.50' />
          </div>
          <div className='grid gap-2'>
            <Label>Port</Label>
            <Input
              type='number'
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder='4370'
            />
          </div>
          {!isEdit && (
            <div className='grid gap-2 sm:col-span-2'>
              <Label>Credentials (optional)</Label>
              <Input
                type='password'
                value={credentials}
                onChange={(e) => setCredentials(e.target.value)}
                placeholder='Device password / secret'
              />
            </div>
          )}
          <div className='flex items-center gap-2 sm:col-span-2'>
            <Switch checked={enabled} onCheckedChange={setEnabled} id='device-enabled' />
            <Label htmlFor='device-enabled'>Enabled</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={pending || !name.trim() || !deviceType.trim()}>
            {pending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
            {isEdit ? 'Save Changes' : 'Add Device'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MappingsDialog({
  device,
  open,
  onOpenChange,
}: {
  device: AttendanceDevice | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [employeeId, setEmployeeId] = useState('')
  const [deviceEmployeeId, setDeviceEmployeeId] = useState('')

  const { data: mappings, isLoading, isError, refetch } = useDeviceMappingsQuery(open ? device?.id ?? null : null)
  const createMut = useCreateMappingMutation(device?.id ?? '')
  const deleteMut = useDeleteMappingMutation(device?.id ?? '')

  const { data: employees } = useQuery({
    queryKey: ['employees', 'attendance-device-mapping-picker'],
    queryFn: () => employeesApi.list({ page: 1, perPage: 100 }).then((r) => r.data.data),
  })

  useEffect(() => {
    if (!open) return
    setEmployeeId('')
    setDeviceEmployeeId('')
  }, [open])

  const rows: DeviceMapping[] = Array.isArray(mappings) ? mappings : []

  function handleAdd() {
    if (!employeeId || !deviceEmployeeId.trim() || !device) return
    createMut.mutate(
      { employeeId, deviceEmployeeId: deviceEmployeeId.trim() },
      {
        onSuccess: () => {
          setEmployeeId('')
          setDeviceEmployeeId('')
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>Mappings — {device?.name}</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='grid gap-2 sm:grid-cols-[1fr_1fr_auto]'>
            <div className='grid gap-2'>
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder='Select employee' /></SelectTrigger>
                <SelectContent>
                  {(employees || []).map((e: EmployeeResponse) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.employeeId} · {e.betterAuthUser?.name || '—'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label>Device Employee ID</Label>
              <Input
                value={deviceEmployeeId}
                onChange={(e) => setDeviceEmployeeId(e.target.value)}
                placeholder="Fingerprint enrolment ID"
              />
            </div>
            <div className='flex items-end'>
              <Button size='sm' onClick={handleAdd} disabled={!employeeId || !deviceEmployeeId.trim() || createMut.isPending}>
                {createMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
                <Link2 className='h-4 w-4 mr-1.5' /> Add
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className='flex justify-center py-6'>
              <Loader2 className='animate-spin h-5 w-5 text-muted-foreground' />
            </div>
          ) : isError ? (
            <div className='flex flex-col items-center gap-2 py-6 text-center'>
              <p className='text-sm text-muted-foreground'>Could not load mappings.</p>
              <Button variant='outline' size='sm' onClick={() => refetch()}>
                <RotateCcw className='h-4 w-4 mr-1' /> Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className='py-6 text-center text-sm text-muted-foreground'>No mappings yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Device Employee ID</TableHead>
                  <TableHead className='w-16' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className='font-medium'>
                      {m.employee?.employeeId} · {m.employee?.betterAuthUser?.name || '—'}
                    </TableCell>
                    <TableCell className='text-sm text-muted-foreground'>{m.deviceEmployeeId}</TableCell>
                    <TableCell>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='text-destructive'
                        title='Remove mapping'
                        disabled={deleteMut.isPending}
                        onClick={() => deleteMut.mutate(m.id)}
                      >
                        <X className='h-4 w-4' />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DevicesTab() {
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<AttendanceDevice | null>(null)
  const [deleting, setDeleting] = useState<AttendanceDevice | null>(null)
  const [mappingDevice, setMappingDevice] = useState<AttendanceDevice | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data: devices, isLoading, isError, refetch } = useDevicesQuery()
  const deleteMut = useDeleteDeviceMutation()
  const testMut = useTestDeviceMutation()
  const syncMut = useSyncDeviceMutation()
  const updateMut = useUpdateDeviceMutation()

  const rows: AttendanceDevice[] = Array.isArray(devices) ? devices : []

  function handleTest(d: AttendanceDevice) {
    setBusyId(d.id)
    testMut.mutate(d.id, { onSettled: () => setBusyId(null) })
  }

  function handleSync(d: AttendanceDevice) {
    setBusyId(d.id)
    syncMut.mutate(d.id, { onSettled: () => setBusyId(null) })
  }

  function toggleEnabled(d: AttendanceDevice, enabled: boolean) {
    updateMut.mutate({ id: d.id, dto: { enabled } })
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <CardTitle>Devices</CardTitle>
            <CardDescription>
              Attendance machines, connection status, and employee mappings.
            </CardDescription>
          </div>
          <Button size='sm' onClick={() => setAddOpen(true)}>
            <Plus className='h-4 w-4 mr-1.5' /> Add Device
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className='flex justify-center py-8'>
            <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
          </div>
        ) : isError ? (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='text-sm text-muted-foreground'>Could not load devices.</p>
            <Button variant='outline' size='sm' onClick={() => refetch()}>
              <RotateCcw className='h-4 w-4 mr-1' /> Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className='py-8 text-center text-sm text-muted-foreground'>
            No attendance devices configured yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Host:Port</TableHead>
                <TableHead>Unmapped</TableHead>
                <TableHead>Sync Status</TableHead>
                <TableHead>Last Sync</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className='text-right'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className='font-medium'>
                    {d.name}
                    {d.vendor && <div className='text-xs text-muted-foreground'>{d.vendor}</div>}
                  </TableCell>
                  <TableCell className='text-sm text-muted-foreground'>{d.deviceType}</TableCell>
                  <TableCell className='text-sm text-muted-foreground'>{d.location || '—'}</TableCell>
                  <TableCell className='text-sm text-muted-foreground tabular-nums'>
                    {d.host ? `${d.host}${d.port ? `:${d.port}` : ''}` : '—'}
                  </TableCell>
                  <TableCell>
                    {'unmappedEventCount' in d && (d as any).unmappedEventCount > 0 ? (
                      <Badge
                        className='border-transparent bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        aria-label={`${(d as any).unmappedEventCount} unmapped events`}
                      >
                        {(d as any).unmappedEventCount}
                      </Badge>
                    ) : (
                      <span className='text-muted-foreground'>—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={`border-transparent ${SYNC_BADGE[d.syncStatus]}`}>{d.syncStatus}</Badge>
                    {d.lastSyncError && (
                      <div className='mt-0.5 max-w-[160px] truncate text-xs text-destructive' title={d.lastSyncError}>
                        {d.lastSyncError}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className='text-sm text-muted-foreground'>
                    {d.lastSyncAt ? formatTime(d.lastSyncAt) : '—'}
                    {d.lastSyncAt && <div className='text-xs'>{formatDate(d.lastSyncAt)}</div>}
                  </TableCell>
                  <TableCell>
                    <Switch checked={d.enabled} onCheckedChange={(v) => toggleEnabled(d, v)} disabled={updateMut.isPending} />
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center justify-end gap-1'>
                      <Button
                        variant='ghost'
                        size='sm'
                        title='Test connection'
                        aria-label='Test connection'
                        disabled={busyId === d.id}
                        onClick={() => handleTest(d)}
                      >
                        {busyId === d.id && testMut.isPending ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Plug className='h-3.5 w-3.5' />}
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        title='Sync now'
                        aria-label='Sync now'
                        disabled={busyId === d.id}
                        onClick={() => handleSync(d)}
                      >
                        {busyId === d.id && syncMut.isPending ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <RefreshCw className='h-3.5 w-3.5' />}
                      </Button>
                      <Button variant='ghost' size='sm' title='Mappings' aria-label='Mappings' onClick={() => setMappingDevice(d)}>
                        <Link2 className='h-3.5 w-3.5' />
                      </Button>
                      <Button variant='ghost' size='sm' title='Edit' aria-label='Edit' onClick={() => setEditing(d)}>
                        <Pencil className='h-3.5 w-3.5' />
                      </Button>
                      <Button variant='ghost' size='sm' className='text-destructive' title='Delete' aria-label='Delete' onClick={() => setDeleting(d)}>
                        <Trash2 className='h-3.5 w-3.5' />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <DeviceDialog open={addOpen} onOpenChange={setAddOpen} />
      <DeviceDialog
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null) }}
        device={editing}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null) }}
        title='Delete device'
        desc={
          <div>
            Delete <span className='font-semibold'>{deleting?.name}</span>? Its employee mappings will be removed too.
          </div>
        }
        confirmText='Delete'
        destructive
        isLoading={deleteMut.isPending}
        handleConfirm={() => {
          if (deleting) {
            deleteMut.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
          }
        }}
      />
      <MappingsDialog
        device={mappingDevice}
        open={!!mappingDevice}
        onOpenChange={(o) => { if (!o) setMappingDevice(null) }}
      />
    </Card>
  )
}
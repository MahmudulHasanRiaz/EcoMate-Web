import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Plus, Pencil, Trash2, Loader2, Send, Bell } from 'lucide-react'
import { notifApi, type NotificationSettingResponse, type NotificationLogResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTablePagination } from '@/components/data-table'
import { type PaginationState, getCoreRowModel, useReactTable } from '@tanstack/react-table'

const channelOptions = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
]

const typeOptions = [
  { value: 'order_confirmation', label: 'Order Confirmation' },
  { value: 'payment_received', label: 'Payment Received' },
  { value: 'shipment_update', label: 'Shipment Update' },
  { value: 'low_stock', label: 'Low Stock' },
]

const statusBadgeVariant = (status: string) => {
  switch (status) {
    case 'sent': return 'default'
    case 'failed': return 'destructive'
    case 'pending': return 'secondary'
    default: return 'outline'
  }
}

export function Notifications() {
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState('settings')

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['notif-settings'],
    queryFn: () => notifApi.listSettings().then((r: any) => Array.isArray(r.data) ? r.data : r.data?.data || []),
  })

  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<NotificationSettingResponse | null>(null)
  const [settingForm, setSettingForm] = useState({ channel: 'email', type: 'order_confirmation', enabled: true })

  const [sendForm, setSendForm] = useState({ channel: 'email', eventType: '', recipient: '', subject: '', content: '' })

  const [logPagination, setLogPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [logChannel, setLogChannel] = useState('')
  const [logStatus, setLogStatus] = useState('')

  const logQueryKey = ['notif-logs', logPagination.pageIndex + 1, logPagination.pageSize, logChannel, logStatus]

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: logQueryKey,
    queryFn: () => notifApi.logs({
      page: logPagination.pageIndex + 1,
      perPage: logPagination.pageSize,
      channel: logChannel || undefined,
      status: logStatus || undefined,
    }).then((r: any) => r.data),
  })

  const logsList = Array.isArray(logsData) ? logsData : logsData?.data || []
  const logsMeta = logsData?.meta || { total: 0, page: 1, perPage: 10, totalPages: 0 }

  const createMut = useMutation({
    mutationFn: notifApi.createSetting,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notif-settings'] })
      setShowCreate(false)
      setSettingForm({ channel: 'email', type: 'order_confirmation', enabled: true })
      toast.success('Setting created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => notifApi.updateSetting(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notif-settings'] })
      setEditing(null)
      toast.success('Setting updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const deleteMut = useMutation({
    mutationFn: notifApi.deleteSetting,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['notif-settings'] }); toast.success('Deleted') },
  })

  const sendMut = useMutation({
    mutationFn: notifApi.send,
    onSuccess: () => {
      toast.success('Notification sent')
      setSendForm({ channel: 'email', eventType: '', recipient: '', subject: '', content: '' })
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),
  })

  const toggleEnabled = (setting: NotificationSettingResponse) => {
    updateMut.mutate({ id: setting.id, data: { enabled: !setting.enabled } })
  }

  const openEdit = (setting: NotificationSettingResponse) => {
    setEditing(setting)
    setSettingForm({ channel: setting.channel, type: setting.type, enabled: setting.enabled })
  }

  const allSettings = Array.isArray(settings) ? settings : []

  const logsTable = useReactTable({
    data: logsList,
    columns: [
      { id: 'channel', header: 'Channel', accessorKey: 'channel', cell: ({ row }: any) => (
        <Badge variant='outline'>{row.original.channel}</Badge>
      )},
      { id: 'eventType', header: 'Event Type', accessorKey: 'eventType' },
      { id: 'recipient', header: 'Recipient', accessorKey: 'recipient' },
      { id: 'status', header: 'Status', accessorKey: 'status', cell: ({ row }: any) => (
        <Badge variant={statusBadgeVariant(row.original.status)}>{row.original.status}</Badge>
      )},
      { id: 'sentAt', header: 'Sent At', accessorKey: 'sentAt', cell: ({ row }: any) => (
        format(new Date(row.original.sentAt), 'PPpp')
      )},
    ],
    pageCount: logsMeta.totalPages,
    state: { pagination: logPagination },
    manualPagination: true,
    onPaginationChange: setLogPagination,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Notifications</h2>
            <p className='text-muted-foreground'>Manage notification settings, send notifications, and view logs.</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value='settings'><Bell className='h-4 w-4 mr-1' /> Settings</TabsTrigger>
            <TabsTrigger value='logs'>Logs</TabsTrigger>
          </TabsList>

          <TabsContent value='settings' className='space-y-6'>
            <Card>
              <CardHeader className='flex flex-row items-center justify-between'>
                <CardTitle className='text-lg'>Notification Settings</CardTitle>
                <Button size='sm' onClick={() => { setEditing(null); setSettingForm({ channel: 'email', type: 'order_confirmation', enabled: true }); setShowCreate(true) }}>
                  <Plus className='h-4 w-4' /> Add Setting
                </Button>
              </CardHeader>
              <CardContent>
                {settingsLoading ? (
                  <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8 text-muted-foreground' /></div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Channel</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Enabled</TableHead>
                        <TableHead className='text-right'>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allSettings.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell><Badge variant='outline'>{s.channel}</Badge></TableCell>
                          <TableCell className='capitalize'>{s.type.replace(/_/g, ' ')}</TableCell>
                          <TableCell>
                            <Switch checked={s.enabled} onCheckedChange={() => toggleEnabled(s)} />
                          </TableCell>
                          <TableCell className='text-right'>
                            <div className='flex justify-end gap-1'>
                              <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(s)}>
                                <Pencil className='h-3.5 w-3.5' />
                              </Button>
                              <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => deleteMut.mutate(s.id)}>
                                <Trash2 className='h-3.5 w-3.5 text-destructive' />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {allSettings.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-12 text-muted-foreground'>No notification settings found</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className='text-lg'>Send Notification</CardTitle>
              </CardHeader>
              <CardContent>
                <div className='grid gap-4'>
                  <div className='grid grid-cols-2 gap-4'>
                    <div className='grid gap-2'>
                      <Label>Channel</Label>
                      <Select value={sendForm.channel} onValueChange={v => setSendForm(f => ({ ...f, channel: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {channelOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='grid gap-2'>
                      <Label>Event Type</Label>
                      <Input value={sendForm.eventType} onChange={e => setSendForm(f => ({ ...f, eventType: e.target.value }))} placeholder='e.g. order_confirmation' />
                    </div>
                  </div>
                  <div className='grid gap-2'>
                    <Label>Recipient</Label>
                    <Input value={sendForm.recipient} onChange={e => setSendForm(f => ({ ...f, recipient: e.target.value }))} placeholder='email@example.com or phone' />
                  </div>
                  <div className='grid gap-2'>
                    <Label>Subject</Label>
                    <Input value={sendForm.subject} onChange={e => setSendForm(f => ({ ...f, subject: e.target.value }))} placeholder='Notification subject' />
                  </div>
                  <div className='grid gap-2'>
                    <Label>Content</Label>
                    <Textarea value={sendForm.content} onChange={e => setSendForm(f => ({ ...f, content: e.target.value }))} placeholder='Notification content' rows={4} />
                  </div>
                  <div className='flex justify-end'>
                    <Button onClick={() => sendMut.mutate(sendForm)} disabled={sendMut.isPending || !sendForm.recipient || !sendForm.content}>
                      <Send className='h-4 w-4 mr-1' /> {sendMut.isPending ? 'Sending...' : 'Send'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value='logs'>
            <Card>
              <CardHeader>
                <CardTitle className='text-lg'>Notification Logs</CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='flex gap-4'>
                  <div className='grid gap-1.5'>
                    <Label className='text-xs'>Channel</Label>
                    <Select value={logChannel} onValueChange={v => { setLogChannel(v); setLogPagination(p => ({ ...p, pageIndex: 0 })) }}>
                      <SelectTrigger className='h-8 w-32'><SelectValue placeholder='All' /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value=''>All</SelectItem>
                        {channelOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className='grid gap-1.5'>
                    <Label className='text-xs'>Status</Label>
                    <Select value={logStatus} onValueChange={v => { setLogStatus(v); setLogPagination(p => ({ ...p, pageIndex: 0 })) }}>
                      <SelectTrigger className='h-8 w-32'><SelectValue placeholder='All' /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value=''>All</SelectItem>
                        <SelectItem value='sent'>Sent</SelectItem>
                        <SelectItem value='failed'>Failed</SelectItem>
                        <SelectItem value='pending'>Pending</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {logsLoading ? (
                  <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8 text-muted-foreground' /></div>
                ) : (
                  <div className='space-y-4'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Channel</TableHead>
                          <TableHead>Event Type</TableHead>
                          <TableHead>Recipient</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Sent At</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {logsList.map((log: NotificationLogResponse) => (
                          <TableRow key={log.id}>
                            <TableCell><Badge variant='outline'>{log.channel}</Badge></TableCell>
                            <TableCell>{log.eventType}</TableCell>
                            <TableCell>{log.recipient}</TableCell>
                            <TableCell><Badge variant={statusBadgeVariant(log.status)}>{log.status}</Badge></TableCell>
                            <TableCell>{format(new Date(log.sentAt), 'PPpp')}</TableCell>
                          </TableRow>
                        ))}
                        {logsList.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className='text-center py-12 text-muted-foreground'>No logs found</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                    <DataTablePagination table={logsTable} />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </Main>

      <Dialog open={showCreate || !!editing} onOpenChange={o => { if (!o) { setShowCreate(false); setEditing(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Notification Setting' : 'Add Notification Setting'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label>Channel</Label>
              <Select value={settingForm.channel} onValueChange={v => setSettingForm(f => ({ ...f, channel: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {channelOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label>Type</Label>
              <Select value={settingForm.type} onValueChange={v => setSettingForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {typeOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className='flex items-center gap-2'>
              <Switch checked={settingForm.enabled} onCheckedChange={v => setSettingForm(f => ({ ...f, enabled: v }))} />
              <Label>Enabled</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setShowCreate(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={() => editing
              ? updateMut.mutate({ id: editing.id, data: settingForm })
              : createMut.mutate(settingForm)
            } disabled={createMut.isPending || updateMut.isPending}>
              {editing ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

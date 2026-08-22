import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plug, Plus, Eye, EyeOff, Loader2, Trash2 } from 'lucide-react'
import { marketingApi, fmtDate } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table'

export function MarketingConnections() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [form, setForm] = useState({ name: '', metaAccessToken: '' })

  const { data } = useQuery({
    queryKey: ['marketing-connections'],
    queryFn: () => marketingApi.connections.list().then(r => r.data),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['marketing-connections'] })
    queryClient.invalidateQueries({ queryKey: ['marketing-ad-accounts-funding'] })
  }

  const createMut = useMutation({
    mutationFn: () => marketingApi.connections.create({ provider: 'facebook', name: form.name, accessToken: form.metaAccessToken }),
    onSuccess: () => {
      toast.success('Connection created (token validated with Meta)')
      setDialogOpen(false)
      setForm({ name: '', metaAccessToken: '' })
      invalidate()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Connection failed — check token'),
  })

  const disconnectMut = useMutation({
    mutationFn: (id: string) => marketingApi.connections.disconnect(id),
    onSuccess: () => { toast.success('Disconnected'); invalidate() },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Disconnect failed'),
  })

  const removeMut = useMutation({
    mutationFn: (id: string) => marketingApi.connections.remove(id),
    onSuccess: () => { toast.success('Connection removed'); invalidate() },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Remove failed'),
  })

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Connections</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" />Connect Meta</Button>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="mb-3 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          Tokens are encrypted at rest (AES-256-GCM) and only decrypted for outbound Meta API calls. Disconnect keeps the
          historical data but stops syncs; Remove deletes the connection entirely.
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Connected</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    No connections yet — connect a Meta Business account to start syncing.
                  </TableCell></TableRow>
                )}
                {(data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm font-medium">{c.platform.name}</TableCell>
                    <TableCell>
                      {c.status === 'connected'
                        ? <Badge className="bg-emerald-50 text-emerald-700" variant="outline">connected</Badge>
                        : <Badge variant="outline">disconnected</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">{fmtDate(c.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="sm"
                          onClick={() => (c.status === 'connected' ? disconnectMut.mutate(c.id) : undefined)}>
                          {c.status === 'connected' ? 'Disconnect' : '—'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => removeMut.mutate(c.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Connect Meta (Facebook) Business</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Meta (production)" />
            </div>
            <div>
              <Label>Meta access token</Label>
              <div className="flex gap-2">
                <Input
                  type={showToken ? 'text' : 'password'}
                  value={form.metaAccessToken}
                  onChange={(e) => setForm({ ...form, metaAccessToken: e.target.value })}
                  placeholder="EAAG…"
                  autoComplete="off"
                />
                <Button variant="outline" size="icon" onClick={() => setShowToken(!showToken)}>
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Requires ads_read + business_management + read_insights. Validated immediately with the Meta Graph API.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button disabled={!form.name || !form.metaAccessToken || createMut.isPending} onClick={() => createMut.mutate()}>
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
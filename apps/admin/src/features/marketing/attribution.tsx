import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Target, RefreshCw, GitBranch, Save, Percent } from 'lucide-react'
import { marketingApi, money, fmtDate } from './api'
import { systemSettingsApi } from '../settings/storage-api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const ALLOCATION_MODES = ['product_value', 'equal', 'quantity'] as const
type AllocationMode = (typeof ALLOCATION_MODES)[number]

const METHOD_BADGE: Record<string, 'info' | 'success' | 'warning' | 'violet' | 'outline'> = {
  session: 'info',
  click_id: 'success',
  fbclid: 'success', // legacy records
  utm: 'warning',
  pixel: 'violet',
  conversion_api: 'violet',
  manual: 'outline',
}

/**
 * Campaign matching aliases.
 *
 * An order's campaign is matched from its utm_campaign value. Real values are
 * hand-typed slugs ("fb_ramadan_2"), which almost never equal the ad platform's
 * campaign name ("Ramadan Sale 2") — without a mapping those orders land in the
 * unattributed bucket even though the ad is fully synced. This is that mapping:
 * explicit, one row per value, never guessed.
 */
function CampaignMatchingPanel() {
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<Array<{ utmValue: string; campaignId: string }>>([])
  const [draftValue, setDraftValue] = useState('')
  const [draftCampaignId, setDraftCampaignId] = useState('')

  const { data: aliases } = useQuery({
    queryKey: ['marketing-campaign-aliases'],
    queryFn: () => marketingApi.attribution.aliases().then(r => r.data),
  })
  const { data: campaigns } = useQuery({
    queryKey: ['marketing-campaigns-for-aliases'],
    queryFn: () => marketingApi.campaigns.list({ perPage: 100 }).then(r => r.data),
  })

  useEffect(() => {
    if (aliases) setRows(aliases.map(a => ({ utmValue: a.utmValue, campaignId: a.campaignId })))
  }, [aliases])

  const saveMut = useMutation({
    mutationFn: (next: Array<{ utmValue: string; campaignId: string }>) =>
      marketingApi.attribution.setAliases(next),
    onSuccess: () => {
      toast.success('Campaign matching saved')
      queryClient.invalidateQueries({ queryKey: ['marketing-campaign-aliases'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to save campaign matching'),
  })

  const campaignName = (id: string) =>
    (campaigns?.data ?? []).find(c => c.id === id)?.name ?? id

  const addRow = () => {
    const value = draftValue.trim().toLowerCase()
    if (!value || !draftCampaignId) {
      toast.error('Enter a utm campaign value and pick a campaign')
      return
    }
    if (rows.some(r => r.utmValue === value)) {
      toast.error(`"${value}" is already mapped`)
      return
    }
    setRows(prev => [...prev, { utmValue: value, campaignId: draftCampaignId }])
    setDraftValue('')
    setDraftCampaignId('')
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="text-xs text-muted-foreground">
          Values are matched exactly (case-insensitive, trimmed) after the campaign id and name checks.
          Adding a mapping here does not rewrite orders that were already attributed.
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            className="sm:w-72"
            placeholder="utm_campaign value, e.g. fb_ramadan_2"
            value={draftValue}
            onChange={e => setDraftValue(e.target.value)}
          />
          <Select value={draftCampaignId} onValueChange={setDraftCampaignId}>
            <SelectTrigger className="sm:w-72">
              <SelectValue placeholder="Campaign" />
            </SelectTrigger>
            <SelectContent>
              {(campaigns?.data ?? []).map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={addRow}>Add mapping</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>utm_campaign value</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead className="w-24 text-right">Remove</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                No mappings. UTM campaign values that already equal a campaign id or name match without one.
              </TableCell></TableRow>
            )}
            {rows.map(row => (
              <TableRow key={row.utmValue}>
                <TableCell className="font-mono text-xs">{row.utmValue}</TableCell>
                <TableCell className="text-sm">{campaignName(row.campaignId)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRows(prev => prev.filter(r => r.utmValue !== row.utmValue))}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex justify-end">
          <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate(rows)}>
            {saveMut.isPending ? <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Save mapping
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function MarketingAttribution() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [sessionPage, setSessionPage] = useState(1)
  const perPage = 15

  const [allocationMode, setAllocationMode] = useState<AllocationMode>('product_value')
  const { data: settings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
  })
  useEffect(() => {
    const stored = settings?.marketing_allocation_mode as AllocationMode | undefined
    if (stored && ALLOCATION_MODES.includes(stored)) setAllocationMode(stored)
  }, [settings])

  const saveModeMut = useMutation({
    mutationFn: (mode: AllocationMode) => systemSettingsApi.set('marketing_allocation_mode', mode),
    onSuccess: () => {
      toast.success('Cost allocation method saved')
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to save cost allocation method'),
  })

  const { data } = useQuery({
    queryKey: ['marketing-attributions', page],
    queryFn: () => marketingApi.attribution.list({ page, perPage }).then(r => r.data),
  })
  const { data: sessions } = useQuery({
    queryKey: ['marketing-sessions', sessionPage],
    queryFn: () => marketingApi.attribution.sessions({ page: sessionPage, perPage }).then(r => r.data),
  })

  const rebuildMut = useMutation({
    mutationFn: () => marketingApi.attribution.rebuild({}),
    onSuccess: (r) => {
      const res = r.data as any
      toast.success(`Attribution rebuilt: scanned ${res.scanned ?? 0} orders, attributed ${res.attributed ?? 0}`)
      queryClient.invalidateQueries({ queryKey: ['marketing-attributions'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Rebuild failed'),
  })

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Attribution</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={rebuildMut.isPending} onClick={() => rebuildMut.mutate()}>
            <RefreshCw className={`mr-1 h-4 w-4 ${rebuildMut.isPending ? 'animate-spin' : ''}`} />
            Rebuild missing
          </Button>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="mb-3 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          <GitBranch className="mr-1 inline h-3 w-3" />
                Deterministic single-touch attribution. Orders are matched by tracking session (journey cookie), click ID (provider-agnostic), or exact
          UTM campaign match — first match wins, one record per order, later resolutions never overwrite the first outcome.
          Unmatched orders are simply not attributed (listed under Attribution failures in Reports).
        </div>
        <Card className="mb-4">
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <Label htmlFor="allocation-mode" className="flex items-center gap-1.5 text-sm font-medium">
                <Percent className="h-4 w-4 text-primary" />
                Cost Allocation method
              </Label>
              <Select value={allocationMode} onValueChange={(v) => setAllocationMode(v as AllocationMode)}>
                <SelectTrigger id="allocation-mode" className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="product_value">Product Value</SelectItem>
                  <SelectItem value="equal">Equal</SelectItem>
                  <SelectItem value="quantity">Quantity</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                How daily campaign spend is split across attributed orders. Existing allocations keep their recorded method.
              </p>
            </div>
            <Button size="sm" disabled={saveModeMut.isPending} onClick={() => saveModeMut.mutate(allocationMode)}>
              {saveModeMut.isPending ? (
                <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              Save
            </Button>
          </CardContent>
        </Card>
        <Tabs defaultValue="attributions">
          <TabsList>
            <TabsTrigger value="attributions">Attributed orders</TabsTrigger>
            <TabsTrigger value="sessions">Landing sessions</TabsTrigger>
            <TabsTrigger value="matching">Campaign matching</TabsTrigger>
          </TabsList>
          <TabsContent value="attributions">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Confidence</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Explanation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                        No attributions yet. They appear automatically when an order lands with a matched campaign.
                      </TableCell></TableRow>
                    )}
                    {(data?.data ?? []).map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <p className="font-medium">{a.order.displayId}</p>
                          <p className="text-xs text-muted-foreground">{fmtDate(a.order.createdAt)}</p>
                        </TableCell>
                        <TableCell className="text-sm">{a.campaign?.name ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={METHOD_BADGE[a.method] ?? 'outline'}>{a.method}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{a.confidence}%</TableCell>
                        <TableCell className="text-right tabular-nums">{money(Number(a.order.total))}</TableCell>
                        <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={a.explanation ?? ''}>{a.explanation}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between border-t p-3">
                  <p className="text-sm text-muted-foreground">Page {page} of {data?.totalPages ?? 1} · {data?.total ?? 0}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
                    <Button variant="outline" size="sm" disabled={page >= (data?.totalPages ?? 1)} onClick={() => setPage(page + 1)}>Next</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="sessions">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Session token</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Click ID</TableHead>
                      <TableHead>Started</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(sessions?.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                        No landing sessions. Storefront landings are captured automatically.
                      </TableCell></TableRow>
                    )}
                    {(sessions?.data ?? []).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.sessionToken}</TableCell>
                        <TableCell className="text-sm">{s.campaign?.name ?? '—'}</TableCell>
                        <TableCell className="text-sm">{s.utmSource ?? '—'}{s.utmCampaign ? ` / ${s.utmCampaign}` : ''}</TableCell>
                        <TableCell className="font-mono text-xs">{s.clickId ?? s.fbclid ?? '—'}</TableCell>
                        <TableCell className="text-sm">{fmtDate(s.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between border-t p-3">
                  <p className="text-sm text-muted-foreground">Page {sessionPage} of {sessions?.totalPages ?? 1} · {sessions?.total ?? 0}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={sessionPage <= 1} onClick={() => setSessionPage(sessionPage - 1)}>Prev</Button>
                    <Button variant="outline" size="sm" disabled={sessionPage >= (sessions?.totalPages ?? 1)} onClick={() => setSessionPage(sessionPage + 1)}>Next</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="matching">
            <CampaignMatchingPanel />
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
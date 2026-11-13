import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { mediaUrl } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SafeImage } from '@/components/safe-image'
import { MediaPicker } from '@/components/media-picker'
import { Loader2, Plus, Pencil, Trash2, MapPin, X, ImagePlus } from 'lucide-react'
import {
  storeLocationsApi,
  type StoreLocation,
  type StoreLocationInput,
  type StoreLocationType,
  type StoreSocial,
} from './store-locations-api'

const TYPE_LABELS: Record<StoreLocationType, string> = {
  SHOWROOM: 'Showroom',
  BRANCH: 'Branch',
  OFFICE: 'Office',
}

const SOCIAL_PLATFORMS = [
  'Facebook',
  'WhatsApp',
  'Instagram',
  'Messenger',
  'YouTube',
  'TikTok',
  'Website',
] as const

interface FormState {
  name: string
  type: StoreLocationType
  address: string
  city: string
  district: string
  phone: string
  email: string
  hours: string
  mapUrl: string
  socials: StoreSocial[]
  photo: string
  comingSoon: boolean
  openingDate: string
  isActive: boolean
  sortOrder: string
}

const EMPTY_FORM: FormState = {
  name: '',
  type: 'SHOWROOM',
  address: '',
  city: '',
  district: '',
  phone: '',
  email: '',
  hours: '',
  mapUrl: '',
  socials: [],
  photo: '',
  comingSoon: false,
  openingDate: '',
  isActive: true,
  sortOrder: '0',
}

function toForm(loc: StoreLocation): FormState {
  return {
    name: loc.name,
    type: loc.type,
    address: loc.address,
    city: loc.city ?? '',
    district: loc.district ?? '',
    phone: loc.phone ?? '',
    email: loc.email ?? '',
    hours: loc.hours ?? '',
    mapUrl: loc.mapUrl ?? '',
    socials: Array.isArray(loc.socials) ? loc.socials : [],
    photo: loc.photo ?? '',
    comingSoon: loc.comingSoon,
    openingDate: loc.openingDate ? loc.openingDate.slice(0, 10) : '',
    isActive: loc.isActive,
    sortOrder: String(loc.sortOrder ?? 0),
  }
}

function toPayload(form: FormState): StoreLocationInput {
  return {
    name: form.name.trim(),
    type: form.type,
    address: form.address.trim(),
    city: form.city.trim() || undefined,
    district: form.district.trim() || undefined,
    phone: form.phone.trim() || undefined,
    email: form.email.trim() || undefined,
    hours: form.hours.trim() || undefined,
    mapUrl: form.mapUrl.trim() || undefined,
    socials: form.socials.filter((s) => s.platform.trim() && s.url.trim()),
    photo: form.photo.trim() || undefined,
    comingSoon: form.comingSoon,
    openingDate: form.comingSoon && form.openingDate ? form.openingDate : undefined,
    isActive: form.isActive,
    sortOrder: parseInt(form.sortOrder, 10) || 0,
  }
}

export function StoreLocationsSettings() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<StoreLocation | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<StoreLocation | null>(null)

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['store-locations'],
    queryFn: storeLocationsApi.list,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['store-locations'] })

  const saveMut = useMutation({
    mutationFn: () =>
      editing
        ? storeLocationsApi.update(editing.id, toPayload(form))
        : storeLocationsApi.create(toPayload(form)),
    onSuccess: () => {
      invalidate()
      setDialogOpen(false)
      toast.success(editing ? 'Store location updated' : 'Store location created')
    },
    onError: (err: any) => {
      const message =
        err?.response?.data?.message || err?.message || 'Failed to save store location'
      toast.error(Array.isArray(message) ? message.join(', ') : message)
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => storeLocationsApi.remove(id),
    onSuccess: () => {
      invalidate()
      setDeleteTarget(null)
      toast.success('Store location deleted')
    },
    onError: () => toast.error('Failed to delete store location'),
  })

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (loc: StoreLocation) => {
    setEditing(loc)
    setForm(toForm(loc))
    setDialogOpen(true)
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const updateSocial = (index: number, patch: Partial<StoreSocial>) =>
    set(
      'socials',
      form.socials.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    )

  const canSave = form.name.trim().length > 0 && form.address.trim().length > 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MapPin className="h-6 w-6" /> Store Locations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Showrooms, branches and offices shown on the storefront Stores page.
            Locations with no photo show an empty state — never a placeholder image.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Add Location
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Locations ({locations.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
            </div>
          ) : locations.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No store locations yet. Add one to show it on the storefront Stores page.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((loc) => (
                  <TableRow key={loc.id}>
                    <TableCell className="font-medium">
                      {loc.name}
                      {loc.comingSoon && (
                        <Badge variant="secondary" className="ml-2">
                          Coming soon
                          {loc.openingDate
                            ? ` — ${loc.openingDate.slice(0, 10)}`
                            : ''}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{TYPE_LABELS[loc.type] ?? loc.type}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate">{loc.address}</TableCell>
                    <TableCell>{loc.phone || '—'}</TableCell>
                    <TableCell>
                      {loc.isActive ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>{loc.sortOrder}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(loc)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(loc)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit Store Location' : 'Add Store Location'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sl-name">Name *</Label>
                <Input
                  id="sl-name"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="Dhaka Showroom"
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => set('type', v as StoreLocationType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TYPE_LABELS) as StoreLocationType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sl-address">Address *</Label>
              <Textarea
                id="sl-address"
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="Level 6, Block D, Bashundhara City Shopping Mall, Dhaka"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sl-city">City</Label>
                <Input
                  id="sl-city"
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                  placeholder="Dhaka"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sl-district">District</Label>
                <Input
                  id="sl-district"
                  value={form.district}
                  onChange={(e) => set('district', e.target.value)}
                  placeholder="Dhaka"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sl-phone">Phone</Label>
                <Input
                  id="sl-phone"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  placeholder="+880 1XXX-XXXXXX"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sl-email">Email</Label>
                <Input
                  id="sl-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  placeholder="store@example.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sl-hours">Opening hours</Label>
              <Input
                id="sl-hours"
                value={form.hours}
                onChange={(e) => set('hours', e.target.value)}
                placeholder="Sat – Thu: 9 AM – 9 PM"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sl-map">Google Maps link</Label>
              <Input
                id="sl-map"
                value={form.mapUrl}
                onChange={(e) => set('mapUrl', e.target.value)}
                placeholder="https://maps.app.goo.gl/… or https://www.google.com/maps/…"
              />
              <p className="text-xs text-muted-foreground">
                Must be a Google Maps link — other URLs are rejected.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Photo</Label>
              <div className="flex items-center gap-3">
                {form.photo ? (
                  <SafeImage
                    src={mediaUrl(form.photo)}
                    alt="Store photo"
                    className="h-16 w-24 rounded-lg object-cover border"
                  />
                ) : (
                  <div className="h-16 w-24 rounded-lg border border-dashed flex items-center justify-center text-muted-foreground text-xs text-center px-1">
                    No photo
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPickerOpen(true)}
                  >
                    <ImagePlus className="h-4 w-4 mr-1" /> Choose from library
                  </Button>
                  {form.photo && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => set('photo', '')}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Social links</Label>
              {form.socials.map((social, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select
                    value={social.platform}
                    onValueChange={(v) => updateSocial(i, { platform: v })}
                  >
                    <SelectTrigger className="w-[160px]">
                      <SelectValue placeholder="Platform" />
                    </SelectTrigger>
                    <SelectContent>
                      {SOCIAL_PLATFORMS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={social.url}
                    onChange={(e) => updateSocial(i, { url: e.target.value })}
                    placeholder="https://facebook.com/…"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      set(
                        'socials',
                        form.socials.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  set('socials', [...form.socials, { platform: 'Facebook', url: '' }])
                }
              >
                <Plus className="h-4 w-4 mr-1" /> Add social link
              </Button>
              <p className="text-xs text-muted-foreground">
                Shown on the storefront only when the store has them.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3 pt-6">
                <Switch
                  id="sl-coming-soon"
                  checked={form.comingSoon}
                  onCheckedChange={(v) => set('comingSoon', v)}
                />
                <Label htmlFor="sl-coming-soon">Coming soon</Label>
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch
                  id="sl-active"
                  checked={form.isActive}
                  onCheckedChange={(v) => set('isActive', v)}
                />
                <Label htmlFor="sl-active">Active (shown on storefront)</Label>
              </div>
            </div>

            {form.comingSoon && (
              <div className="space-y-2">
                <Label htmlFor="sl-opening">Opening date</Label>
                <Input
                  id="sl-opening"
                  type="date"
                  value={form.openingDate}
                  onChange={(e) => set('openingDate', e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="sl-sort">Sort order</Label>
              <Input
                id="sl-sort"
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => set('sortOrder', e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={!canSave || saveMut.isPending}
            >
              {saveMut.isPending && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
              {editing ? 'Save changes' : 'Create location'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selected={form.photo ? [form.photo] : []}
        multiple={false}
        onSelect={(urls) => {
          set('photo', urls[urls.length - 1] || '')
          setPickerOpen(false)
        }}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete store location?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            “{deleteTarget?.name}” will be permanently deleted. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Loader2, Plus, Save, Trash2, Search, AlertTriangle } from 'lucide-react'

interface ShippingOption {
  id: string; name: string; amount: number; isActive: boolean; sortOrder: number;
}

interface ShippingZoneGroup {
  id: string; label: string | null; type: 'custom_amount' | 'no_delivery';
  amount: number | null; districts: string[]; isActive: boolean;
}

const BD_DISTRICTS = [
  { name: 'Bagerhat', nameBn: 'বাগেরহাট' }, { name: 'Bandarban', nameBn: 'বান্দরবান' },
  { name: 'Barguna', nameBn: 'বরগুনা' }, { name: 'Barishal', nameBn: 'বরিশাল' },
  { name: 'Bhola', nameBn: 'ভোলা' }, { name: 'Bogura', nameBn: 'বগুড়া' },
  { name: 'Brahmanbaria', nameBn: 'ব্রাহ্মণবাড়িয়া' }, { name: 'Chandpur', nameBn: 'চাঁদপুর' },
  { name: 'Chattogram', nameBn: 'চট্টগ্রাম' }, { name: 'Chuadanga', nameBn: 'চুয়াডাঙ্গা' },
  { name: "Cox's Bazar", nameBn: 'কক্সবাজার' }, { name: 'Cumilla', nameBn: 'কুমিল্লা' },
  { name: 'Dhaka', nameBn: 'ঢাকা' }, { name: 'Dinajpur', nameBn: 'দিনাজপুর' },
  { name: 'Faridpur', nameBn: 'ফরিদপুর' }, { name: 'Feni', nameBn: 'ফেনী' },
  { name: 'Gaibandha', nameBn: 'গাইবান্ধা' }, { name: 'Gazipur', nameBn: 'গাজীপুর' },
  { name: 'Gopalganj', nameBn: 'গোপালগঞ্জ' }, { name: 'Habiganj', nameBn: 'হবিগঞ্জ' },
  { name: 'Jamalpur', nameBn: 'জামালপুর' }, { name: 'Jashore', nameBn: 'যশোর' },
  { name: 'Jhalokati', nameBn: 'ঝালকাঠি' }, { name: 'Jhenaidah', nameBn: 'ঝিনাইদহ' },
  { name: 'Joypurhat', nameBn: 'জয়পুরহাট' }, { name: 'Khagrachhari', nameBn: 'খাগড়াছড়ি' },
  { name: 'Kushtia', nameBn: 'কুষ্টিয়া' }, { name: 'Khulna', nameBn: 'খুলনা' },
  { name: 'Kishoreganj', nameBn: 'কিশোরগঞ্জ' }, { name: 'Lakshmipur', nameBn: 'লক্ষ্মীপুর' },
  { name: 'Lalmonirhat', nameBn: 'লালমনিরহাট' }, { name: 'Madaripur', nameBn: 'মাদারীপুর' },
  { name: 'Magura', nameBn: 'মাগুরা' }, { name: 'Manikganj', nameBn: 'মানিকগঞ্জ' },
  { name: 'Meherpur', nameBn: 'মেহেরপুর' }, { name: 'Moulvibazar', nameBn: 'মৌলভীবাজার' },
  { name: 'Munshiganj', nameBn: 'মুন্সিগঞ্জ' }, { name: 'Mymensingh', nameBn: 'ময়মনসিংহ' },
  { name: 'Naogaon', nameBn: 'নওগাঁ' }, { name: 'Narail', nameBn: 'নড়াইল' },
  { name: 'Narayanganj', nameBn: 'নারায়ণগঞ্জ' }, { name: 'Narsingdi', nameBn: 'নরসিংদী' },
  { name: 'Natore', nameBn: 'নাটোর' }, { name: 'Nawabganj', nameBn: 'নবাবগঞ্জ' },
  { name: 'Netrokona', nameBn: 'নেত্রকোনা' }, { name: 'Nilphamari', nameBn: 'নীলফামারী' },
  { name: 'Noakhali', nameBn: 'নোয়াখালী' }, { name: 'Pabna', nameBn: 'পাবনা' },
  { name: 'Panchagarh', nameBn: 'পঞ্চগড়' }, { name: 'Patuakhali', nameBn: 'পটুয়াখালী' },
  { name: 'Pirojpur', nameBn: 'পিরোজপুর' }, { name: 'Rajbari', nameBn: 'রাজবাড়ী' },
  { name: 'Rajshahi', nameBn: 'রাজশাহী' }, { name: 'Rangamati', nameBn: 'রাঙ্গামাটি' },
  { name: 'Rangpur', nameBn: 'রংপুর' }, { name: 'Satkhira', nameBn: 'সাতক্ষীরা' },
  { name: 'Shariatpur', nameBn: 'শরীয়তপুর' }, { name: 'Sherpur', nameBn: 'শেরপুর' },
  { name: 'Sirajganj', nameBn: 'সিরাজগঞ্জ' }, { name: 'Sunamganj', nameBn: 'সুনামগঞ্জ' },
  { name: 'Sylhet', nameBn: 'সিলেট' }, { name: 'Tangail', nameBn: 'টাঙ্গাইল' },
  { name: 'Thakurgaon', nameBn: 'ঠাকুরগাঁও' },
]

const api = {
  listSystemSettings: () => apiClient.get('/system-settings').then(r => r.data),
  updateSystemSetting: (key: string, value: string) => apiClient.post(`/system-settings/${key}`, { value }),
  listOptions: () => apiClient.get('/shipping/options').then(r => r.data),
  createOption: (d: any) => apiClient.post('/shipping/options', d),
  updateOption: (id: string, d: any) => apiClient.put(`/shipping/options/${id}`, d),
  deleteOption: (id: string) => apiClient.delete(`/shipping/options/${id}`),
  listZones: () => apiClient.get('/shipping/zones').then(r => r.data),
  createZone: (d: any) => apiClient.post('/shipping/zones', d),
  updateZone: (id: string, d: any) => apiClient.put(`/shipping/zones/${id}`, d),
  deleteZone: (id: string) => apiClient.delete(`/shipping/zones/${id}`),
}

export function ShippingSettings() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'general' | 'options' | 'zones'>('general')

  const { data: sysSettings } = useQuery({ queryKey: ['system-settings'], queryFn: api.listSystemSettings })
  const [shippingMode, setShippingMode] = useState('auto_district')
  const [deliveryCharge, setDeliveryCharge] = useState('')
  const [freeDeliveryMin, setFreeDeliveryMin] = useState('')

  useEffect(() => {
    if (sysSettings) {
      setShippingMode(sysSettings['shipping_mode'] || 'auto_district')
      setDeliveryCharge(sysSettings['delivery_charge'] || '0')
      setFreeDeliveryMin(sysSettings['free_delivery_min'] || '0')
    }
  }, [sysSettings])

  const saveGeneralMut = useMutation({
    mutationFn: async () => {
      await api.updateSystemSetting('shipping_mode', shippingMode)
      await api.updateSystemSetting('delivery_charge', deliveryCharge)
      await api.updateSystemSetting('free_delivery_min', freeDeliveryMin)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      toast.success('General settings saved')
    },
  })

  const { data: options = [], isLoading: optsLoading } = useQuery({
    queryKey: ['shipping-options'],
    queryFn: api.listOptions,
    enabled: activeTab === 'options',
  })

  const [optDialog, setOptDialog] = useState(false)
  const [editingOpt, setEditingOpt] = useState<ShippingOption | null>(null)
  const [optName, setOptName] = useState('')
  const [optAmount, setOptAmount] = useState('')

  const createOptMut = useMutation({
    mutationFn: () => api.createOption({ name: optName, amount: parseFloat(optAmount) || 0 }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipping-options'] }); setOptDialog(false); toast.success('Option created') },
  })
  const updateOptMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: any }) => api.updateOption(id, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipping-options'] }); toast.success('Option updated') },
  })
  const deleteOptMut = useMutation({
    mutationFn: (id: string) => api.deleteOption(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipping-options'] }); toast.success('Option deleted') },
  })

  const openNewOption = () => { setEditingOpt(null); setOptName(''); setOptAmount(''); setOptDialog(true) }
  const openEditOption = (o: ShippingOption) => { setEditingOpt(o); setOptName(o.name); setOptAmount(String(o.amount)); setOptDialog(true) }

  const { data: zones = [], isLoading: zonesLoading } = useQuery({
    queryKey: ['shipping-zones'],
    queryFn: api.listZones,
    enabled: activeTab === 'zones',
  })

  const [zoneDialog, setZoneDialog] = useState(false)
  const [editingZone, setEditingZone] = useState<ShippingZoneGroup | null>(null)
  const [zoneLabel, setZoneLabel] = useState('')
  const [zoneType, setZoneType] = useState<'custom_amount' | 'no_delivery'>('custom_amount')
  const [zoneAmount, setZoneAmount] = useState('')
  const [zoneDistricts, setZoneDistricts] = useState<string[]>([])
  const [districtSearch, setDistrictSearch] = useState('')

  const createZoneMut = useMutation({
    mutationFn: () => api.createZone({
      label: zoneLabel || null,
      type: zoneType,
      amount: zoneType === 'custom_amount' ? (parseFloat(zoneAmount) || 0) : null,
      districts: zoneDistricts,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipping-zones'] }); setZoneDialog(false); toast.success('Zone group created') },
  })
  const updateZoneMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: any }) => api.updateZone(id, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipping-zones'] }); toast.success('Zone group updated') },
  })
  const deleteZoneMut = useMutation({
    mutationFn: (id: string) => api.deleteZone(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipping-zones'] }); toast.success('Zone group deleted') },
  })

  const openNewZone = () => { setEditingZone(null); setZoneLabel(''); setZoneType('custom_amount'); setZoneAmount(''); setZoneDistricts([]); setZoneDialog(true) }
  const openEditZone = (z: ShippingZoneGroup) => { setEditingZone(z); setZoneLabel(z.label || ''); setZoneType(z.type); setZoneAmount(z.amount ? String(z.amount) : ''); setZoneDistricts(z.districts as string[]); setZoneDialog(true) }

  const toggleDistrict = (name: string) => {
    setZoneDistricts(prev => prev.includes(name) ? prev.filter(d => d !== name) : [...prev, name])
  }

  const filteredDistricts = BD_DISTRICTS.filter(d =>
    d.name.toLowerCase().includes(districtSearch.toLowerCase()) ||
    d.nameBn.includes(districtSearch)
  )

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Shipping Settings</h1>

      <div className="flex gap-2 border-b pb-2">
        <button onClick={() => setActiveTab('general')} className={`px-4 py-2 text-sm font-medium rounded-t ${activeTab === 'general' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}>General</button>
        <button onClick={() => setActiveTab('options')} className={`px-4 py-2 text-sm font-medium rounded-t ${activeTab === 'options' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}>Shipping Options</button>
        <button onClick={() => setActiveTab('zones')} className={`px-4 py-2 text-sm font-medium rounded-t ${activeTab === 'zones' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}>Zone Groups</button>
      </div>

      {activeTab === 'general' && (
        <Card>
          <CardHeader><CardTitle>General Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Shipping Mode</Label>
              <div className="flex gap-4 mt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="mode" value="options" checked={shippingMode === 'options'} onChange={e => setShippingMode(e.target.value)} />
                  <span>Shipping Options (কাস্টমার নিজে অপশন সিলেক্ট করবে)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="mode" value="auto_district" checked={shippingMode === 'auto_district'} onChange={e => setShippingMode(e.target.value)} />
                  <span>Auto District (জেলা অনুযায়ী অটো চার্জ)</span>
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Default Delivery Charge (৳)</Label><Input type="number" step="0.01" value={deliveryCharge} onChange={e => setDeliveryCharge(e.target.value)} /></div>
              <div><Label>Free Delivery Minimum (৳)</Label><Input type="number" step="0.01" value={freeDeliveryMin} onChange={e => setFreeDeliveryMin(e.target.value)} /></div>
            </div>
            <Button onClick={() => saveGeneralMut.mutate()} disabled={saveGeneralMut.isPending}><Save className="h-4 w-4 mr-1" /> Save General Settings</Button>
          </CardContent>
        </Card>
      )}

      {activeTab === 'options' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Shipping Options</CardTitle>
            <Button size="sm" onClick={openNewOption}><Plus className="h-4 w-4 mr-1" /> Add Option</Button>
          </CardHeader>
          <CardContent>
            {optsLoading ? <Loader2 className="animate-spin" /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Amount</TableHead><TableHead>Active</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(options as ShippingOption[]).length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No shipping options yet. Click "Add Option" to create one.</TableCell></TableRow>
                  )}
                  {(options as ShippingOption[]).map(opt => (
                    <TableRow key={opt.id}>
                      <TableCell className="font-medium">{opt.name}</TableCell>
                      <TableCell>৳{opt.amount}</TableCell>
                      <TableCell><Switch checked={opt.isActive} onCheckedChange={v => updateOptMut.mutate({ id: opt.id, d: { isActive: v } })} /></TableCell>
                      <TableCell className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEditOption(opt)}>Edit</Button>
                        <Button variant="destructive" size="sm" onClick={() => deleteOptMut.mutate(opt.id)}><Trash2 className="h-3 w-3" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'zones' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Zone Groups</CardTitle>
            <Button size="sm" onClick={openNewZone}><Plus className="h-4 w-4 mr-1" /> Add Group</Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">সকল জেলার জন্য ডিফল্ট চার্জ প্রযোজ্য। নিচের গ্রুপগুলোর জন্য ভিন্ন নিয়ম প্রযোজ্য হবে।</p>
            {zonesLoading ? <Loader2 className="animate-spin" /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Label</TableHead><TableHead>Type</TableHead><TableHead>Amount</TableHead><TableHead>Districts</TableHead><TableHead>Active</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(zones as ShippingZoneGroup[]).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No zone groups yet. Click "Add Group" to create one.</TableCell></TableRow>
                  )}
                  {(zones as ShippingZoneGroup[]).map(zone => (
                    <TableRow key={zone.id}>
                      <TableCell className="font-medium">{zone.label || '—'}</TableCell>
                      <TableCell><Badge variant={zone.type === 'no_delivery' ? 'destructive' : 'default'}>{zone.type === 'no_delivery' ? 'No Delivery' : 'Custom Amount'}</Badge></TableCell>
                      <TableCell>{zone.type === 'custom_amount' ? `৳${zone.amount}` : '—'}</TableCell>
                      <TableCell className="text-xs">{zone.districts.length} districts</TableCell>
                      <TableCell><Switch checked={zone.isActive} onCheckedChange={v => updateZoneMut.mutate({ id: zone.id, d: { isActive: v } })} /></TableCell>
                      <TableCell className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEditZone(zone)}>Edit</Button>
                        <Button variant="destructive" size="sm" onClick={() => deleteZoneMut.mutate(zone.id)}><Trash2 className="h-3 w-3" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={optDialog} onOpenChange={setOptDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingOpt ? 'Edit Option' : 'New Shipping Option'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Name</Label><Input value={optName} onChange={e => setOptName(e.target.value)} placeholder="e.g. ঢাকা সিটি" /></div>
            <div><Label>Amount (৳)</Label><Input type="number" step="0.01" value={optAmount} onChange={e => setOptAmount(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOptDialog(false)}>Cancel</Button>
            <Button onClick={() => editingOpt
              ? updateOptMut.mutate({ id: editingOpt.id, d: { name: optName, amount: parseFloat(optAmount) || 0 } })
              : createOptMut.mutate()
            } disabled={!optName || !optAmount}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={zoneDialog} onOpenChange={setZoneDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingZone ? 'Edit Zone Group' : 'New Zone Group'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Label (optional)</Label><Input value={zoneLabel} onChange={e => setZoneLabel(e.target.value)} placeholder="e.g. No Delivery Areas" /></div>
            <div>
              <Label>Type</Label>
              <div className="flex gap-4 mt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="zoneType" value="custom_amount" checked={zoneType === 'custom_amount'} onChange={() => setZoneType('custom_amount')} />
                  <span>Custom Amount</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="zoneType" value="no_delivery" checked={zoneType === 'no_delivery'} onChange={() => setZoneType('no_delivery')} />
                  <span>No Delivery</span>
                </label>
              </div>
            </div>
            {zoneType === 'custom_amount' && (
              <div><Label>Amount (৳)</Label><Input type="number" step="0.01" value={zoneAmount} onChange={e => setZoneAmount(e.target.value)} placeholder="0 for free delivery" /></div>
            )}
            <div>
              <Label>Select Districts</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search district..." value={districtSearch} onChange={e => setDistrictSearch(e.target.value)} />
              </div>
              <div className="border rounded-md mt-2 max-h-48 overflow-y-auto grid grid-cols-2 gap-1 p-2">
                {filteredDistricts.map(d => (
                  <label key={d.name} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted p-1 rounded">
                    <input type="checkbox" checked={zoneDistricts.includes(d.name)} onChange={() => toggleDistrict(d.name)} />
                    <span>{d.nameBn} ({d.name})</span>
                  </label>
                ))}
                {filteredDistricts.length === 0 && <p className="text-xs text-muted-foreground col-span-2 p-2">No matching districts</p>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{zoneDistricts.length} district(s) selected</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setZoneDialog(false)}>Cancel</Button>
            <Button onClick={() => editingZone
              ? updateZoneMut.mutate({ id: editingZone.id, d: { label: zoneLabel || null, type: zoneType, amount: zoneType === 'custom_amount' ? (parseFloat(zoneAmount) || 0) : null, districts: zoneDistricts } })
              : createZoneMut.mutate()
            } disabled={zoneDistricts.length === 0 || (zoneType === 'custom_amount' && !zoneAmount)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

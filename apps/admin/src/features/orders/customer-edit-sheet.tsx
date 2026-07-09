import { useState, useEffect, useMemo } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'

interface CustomerEditSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // current values
  firstName: string
  lastName: string
  email: string
  phone: string
  address: string
  cityId: string
  zoneId: string
  customerNotes: string
  officeNotes: string
  onSave: (data: {
    firstName: string
    lastName: string
    email: string
    phone: string
    address: string
    cityId: string
    zoneId: string
    customerNotes: string
    officeNotes: string
  }) => void
  isSaving?: boolean
}

export function CustomerEditSheet({
  open, onOpenChange,
  firstName: initFirst, lastName: initLast,
  email: initEmail, phone: initPhone,
  address: initAddress, cityId: initCityId, zoneId: initZoneId,
  customerNotes: initCustNotes, officeNotes: initOfficeNotes,
  onSave, isSaving,
}: CustomerEditSheetProps) {
  const [firstName, setFirstName] = useState(initFirst)
  const [lastName, setLastName] = useState(initLast)
  const [email, setEmail] = useState(initEmail)
  const [phone, setPhone] = useState(initPhone)
  const [address, setAddress] = useState(initAddress)
  const [cityId, setCityId] = useState(initCityId)
  const [zoneId, setZoneId] = useState(initZoneId)
  const [customerNotes, setCustomerNotes] = useState(initCustNotes)
  const [officeNotes, setOfficeNotes] = useState(initOfficeNotes)
  const [cities, setCities] = useState<any[]>([])
  const [zones, setZones] = useState<any[]>([])

  // Reset fields whenever sheet opens with fresh values
  useEffect(() => {
    if (open) {
      setFirstName(initFirst); setLastName(initLast)
      setEmail(initEmail); setPhone(initPhone)
      setAddress(initAddress); setCityId(initCityId); setZoneId(initZoneId)
      setCustomerNotes(initCustNotes); setOfficeNotes(initOfficeNotes)
      // Fetch cities
      apiClient.get('/couriers/cities').then(r => setCities(r.data as any[])).catch(() => toast.error('Failed to fetch cities'))
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cityId) {
      apiClient.get(`/couriers/zones?cityId=${cityId}`).then(r => setZones(r.data as any[])).catch(() => toast.error('Failed to fetch zones'))
    } else {
      setZones([])
    }
  }, [cityId])

  const cityOptions = useMemo(() => cities.map((c: any) => ({ id: c.id, label: c.name })), [cities])
  const zoneOptions = useMemo(() => zones.map((z: any) => ({ id: z.id, label: z.name })), [zones])

  function handleSave() {
    onSave({ firstName, lastName, email, phone, address, cityId, zoneId, customerNotes, officeNotes })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='w-full sm:max-w-[480px] overflow-y-auto flex flex-col gap-0 p-0'>
        <SheetHeader className='px-6 pt-6 pb-4 border-b'>
          <SheetTitle>Edit Customer & Shipping</SheetTitle>
        </SheetHeader>

        <div className='flex-1 overflow-y-auto px-6 py-4 space-y-5'>
          {/* Customer Info */}
          <div className='space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Customer Info</p>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-1'>
                <Label className='text-xs'>First Name</Label>
                <Input value={firstName} onChange={e => setFirstName(e.target.value)} className='h-9' />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>Last Name</Label>
                <Input value={lastName} onChange={e => setLastName(e.target.value)} className='h-9' />
              </div>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-1'>
                <Label className='text-xs'>Phone</Label>
                <Input value={phone} onChange={e => setPhone(e.target.value)} className='h-9' />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>Email</Label>
                <Input value={email} onChange={e => setEmail(e.target.value)} className='h-9' />
              </div>
            </div>
          </div>

          <Separator />

          {/* Shipping Address */}
          <div className='space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Shipping Address</p>
            <div className='space-y-1'>
              <Label className='text-xs'>Address</Label>
              <Textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} className='resize-none' />
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-1'>
                <Label className='text-xs'>City</Label>
                <SearchableSelect
                  options={cityOptions}
                  value={cityId}
                  onChange={val => { setCityId(val); setZoneId(''); setZones([]) }}
                  placeholder='Select City...'
                  searchPlaceholder='Search cities...'
                />
              </div>
              <div className='space-y-1'>
                <Label className='text-xs'>Zone</Label>
                <SearchableSelect
                  options={zoneOptions}
                  value={zoneId}
                  onChange={setZoneId}
                  placeholder='Select Zone...'
                  searchPlaceholder='Search zones...'
                  disabled={!cityId}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Notes */}
          <div className='space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>Notes</p>
            <div className='space-y-1'>
              <Label className='text-xs'>Customer Notes</Label>
              <Textarea value={customerNotes} onChange={e => setCustomerNotes(e.target.value)} rows={2} className='resize-none' placeholder='Visible to customer...' />
            </div>
            <div className='space-y-1'>
              <Label className='text-xs'>Office Notes</Label>
              <Textarea value={officeNotes} onChange={e => setOfficeNotes(e.target.value)} rows={2} className='resize-none' placeholder='Internal only...' />
            </div>
          </div>
        </div>

        <SheetFooter className='px-6 py-4 border-t'>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving} className='gap-2'>
            {isSaving ? <Loader2 className='h-4 w-4 animate-spin' /> : <Save className='h-4 w-4' />}
            Save Changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

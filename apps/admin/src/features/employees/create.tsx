'use client'

import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { SelectDropdown } from '@/components/select-dropdown'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { Loader2, Search, ArrowLeft } from 'lucide-react'
import { useDesignationsQuery } from '@/features/designations/hooks'
import { useAccessPresetsQuery } from '@/features/access-presets/hooks'

export default function CreateEmployeePage() {
  const navigate = useNavigate()
  const { data: designations } = useDesignationsQuery()
  const { data: presets } = useAccessPresetsQuery(1, '')

  const [step, setStep] = useState<'search' | 'form'>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedUser, setSelectedUser] = useState<any>(null)

  const [formData, setFormData] = useState({
    designationId: '',
    departmentId: '',
    accessPresetId: '',
    employmentType: 'full_time',
    joiningDate: '',
    salary: '',
    bankAccountNo: '',
    bankName: '',
    notes: '',
  })

  const searchUsers = useCallback(async (q: string) => {
    if (q.length < 2) return
    setSearching(true)
    try {
      const res = await apiClient.get<{ data: any[] }>('/employees/search/ba-users', { params: { q } })
      setSearchResults(res.data.data)
    } catch {
      toast.error('Search failed')
    }
    setSearching(false)
  }, [])

  const selectUser = (user: any) => {
    setSelectedUser(user)
    setStep('form')
  }

  const handleSubmit = async () => {
    if (!selectedUser || !formData.joiningDate) {
      toast.error('Please fill all required fields')
      return
    }
    try {
      await apiClient.post('/employees', {
        betterAuthUserId: selectedUser.id,
        ...formData,
        salary: formData.salary ? parseFloat(formData.salary) : undefined,
      })
      toast.success('Employee created successfully')
      navigate({ to: '/op/employees' })
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to create employee')
    }
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchBar /><ThemeSwitch /><ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6 max-w-3xl mx-auto w-full'>
        <Button variant='ghost' className='w-fit' onClick={() => navigate({ to: '/op/employees' })}>
          <ArrowLeft className='mr-2 h-4 w-4' /> Back to Employees
        </Button>
        <h2 className='text-2xl font-bold tracking-tight'>Register New Employee</h2>

        {step === 'search' && (
          <Card>
            <CardHeader><CardTitle>Step 1: Select a User</CardTitle></CardHeader>
            <CardContent className='space-y-4'>
              <div className='relative'>
                <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                <Input
                  className='pl-10'
                  placeholder='Search by name or email...'
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); searchUsers(e.target.value) }}
                />
              </div>
              {searching && <div className='flex justify-center'><Loader2 className='animate-spin h-5 w-5' /></div>}
              <div className='space-y-2'>
                {searchResults.map((user) => (
                  <div
                    key={user.id}
                    className='flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-muted/50'
                    onClick={() => selectUser(user)}
                  >
                    <div>
                      <p className='font-medium'>{user.name}</p>
                      <p className='text-sm text-muted-foreground'>{user.email}</p>
                    </div>
                    <Button size='sm'>Select</Button>
                  </div>
                ))}
                {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
                  <p className='text-center text-muted-foreground py-4'>No users found</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {step === 'form' && selectedUser && (
          <>
            <Card>
              <CardHeader><CardTitle>Selected User</CardTitle></CardHeader>
              <CardContent>
                <p className='font-medium'>{selectedUser.name}</p>
                <p className='text-sm text-muted-foreground'>{selectedUser.email}</p>
                <Button variant='outline' size='sm' className='mt-2' onClick={() => { setStep('search'); setSelectedUser(null) }}>
                  Change
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>HR Details</CardTitle></CardHeader>
              <CardContent className='grid grid-cols-2 gap-4'>
                <div className='grid gap-2'>
                  <Label>Designation</Label>
                  <SelectDropdown
                    value={formData.designationId}
                    onValueChange={(v) => setFormData({ ...formData, designationId: v })}
                    placeholder='Select designation'
                    items={(designations || []).map((d: any) => ({ label: d.name, value: d.id }))}
                  />
                </div>
                <div className='grid gap-2'>
                  <Label>Access Preset</Label>
                  <SelectDropdown
                    value={formData.accessPresetId}
                    onValueChange={(v) => setFormData({ ...formData, accessPresetId: v })}
                    placeholder='Select preset'
                    items={(presets?.data || []).map((p: any) => ({ label: p.name, value: p.id }))}
                  />
                </div>
                <div className='grid gap-2'>
                  <Label>Employment Type</Label>
                  <SelectDropdown
                    value={formData.employmentType}
                    onValueChange={(v) => setFormData({ ...formData, employmentType: v })}
                    placeholder='Select type'
                    items={[
                      { label: 'Full Time', value: 'full_time' },
                      { label: 'Part Time', value: 'part_time' },
                      { label: 'Contract', value: 'contract' },
                      { label: 'Internship', value: 'internship' },
                    ]}
                  />
                </div>
                <div className='grid gap-2'>
                  <Label>Joining Date *</Label>
                  <Input type='date' value={formData.joiningDate} onChange={(e) => setFormData({ ...formData, joiningDate: e.target.value })} />
                </div>
                <div className='grid gap-2'>
                  <Label>Salary</Label>
                  <Input type='number' value={formData.salary} onChange={(e) => setFormData({ ...formData, salary: e.target.value })} />
                </div>
                <div className='grid gap-2'>
                  <Label>Bank Account No</Label>
                  <Input value={formData.bankAccountNo} onChange={(e) => setFormData({ ...formData, bankAccountNo: e.target.value })} />
                </div>
                <div className='grid gap-2'>
                  <Label>Bank Name</Label>
                  <Input value={formData.bankName} onChange={(e) => setFormData({ ...formData, bankName: e.target.value })} />
                </div>
                <div className='col-span-2 grid gap-2'>
                  <Label>Notes</Label>
                  <textarea
                    className='flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>

            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => navigate({ to: '/op/employees' })}>Cancel</Button>
              <Button onClick={handleSubmit}>Create Employee</Button>
            </div>
          </>
        )}
      </Main>
    </>
  )
}

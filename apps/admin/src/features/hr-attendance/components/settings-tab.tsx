import { useEffect, useState } from 'react'
import { Loader2, RotateCcw, Lock } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { useAttendanceSettingsQuery, useUpdateAttendanceSettingsMutation } from '../hooks'
import type { AttendanceMode } from '../api'

const MODE_OPTIONS: { value: AttendanceMode; title: string; description: string }[] = [
  {
    value: 'APP',
    title: 'App',
    description:
      'Employees check in from the app (admin or self-service). Machine: device events are disabled.',
  },
  {
    value: 'MACHINE',
    title: 'Machine',
    description:
      'Attendance only via machine devices. App check-in is blocked for every employee.',
  },
  {
    value: 'BOTH',
    title: 'Both',
    description:
      'App and machine coexist. Each employee decides via their attendance method (APP or MACHINE).',
  },
]

export function SettingsTab() {
  const permissions = useAuthStore((s) => s.auth.user?.permissions) ?? []
  const canManage = permissions.includes('manage_hr_settings')

  const { data, isLoading, isError, refetch } = useAttendanceSettingsQuery()
  const updateMut = useUpdateAttendanceSettingsMutation()

  const [mode, setMode] = useState<AttendanceMode>('APP')

  useEffect(() => {
    if (data?.mode) setMode(data.mode)
  }, [data])

  function handleSave() {
    updateMut.mutate(mode)
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <CardTitle>Attendance Settings</CardTitle>
            <CardDescription>
              Choose how attendance is recorded: app, machine devices, or both.
            </CardDescription>
          </div>
          {!canManage && (
            <span className='inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>
              <Lock className='h-3.5 w-3.5' /> Requires Manage HR Settings permission
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className='grid gap-4'>
        {isLoading ? (
          <div className='flex justify-center py-8'>
            <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
          </div>
        ) : isError ? (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='text-sm text-muted-foreground'>Could not load attendance settings.</p>
            <Button variant='outline' size='sm' onClick={() => refetch()}>
              <RotateCcw className='h-4 w-4 mr-1' /> Retry
            </Button>
          </div>
        ) : (
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as AttendanceMode)} disabled={!canManage}>
            {MODE_OPTIONS.map((opt) => (
              <Label
                key={opt.value}
                className='flex cursor-pointer items-start gap-3 rounded-lg border p-4 has-data-[state=checked]:border-primary'
              >
                <RadioGroupItem value={opt.value} className='mt-0.5' />
                <span>
                  <span className='block text-sm font-semibold'>{opt.title}</span>
                  <span className='block text-sm text-muted-foreground'>{opt.description}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        )}

        {!isLoading && !isError && (
          <div className='flex justify-end'>
            <Button onClick={handleSave} disabled={!canManage || updateMut.isPending}>
              {updateMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
              Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
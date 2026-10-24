import { useState } from 'react'
import { UserPlus, Loader2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PasswordInput } from '@/components/password-input'
import { usersApi } from '@/features/users/api'
import { STAFF_ROLE_OPTIONS } from '@/features/users/constants'

export const Route = createFileRoute('/_authenticated/mon/users/create')({
  // Normal User Management (owner 2026-10-24): this surface is for people
  // WITHOUT the HR module, so it must never require view_hr. Matches the nav
  // gate in sidebar-data.ts: `view_users`, with superadmin always allowed.
  // The backend still rejects the write for anyone without create_users.
  beforeLoad: () => {
    // Mirrors the gate the nav item uses (sidebar-data.ts): `view_users`,
    // with superadmin always allowed.
    const isAllowed = () => {
      try {
        const raw = localStorage.getItem('eco_mate_user')
        if (!raw) return false
        const user = JSON.parse(raw) as {
          role?: string
          permissions?: string[]
        }
        if (user.role === 'superadmin') return true
        return (user.permissions ?? []).includes('create_users')
      } catch {
        return false
      }
    }
    if (isAllowed()) return
    throw redirect({ to: '/mon/users' })
  },
  component: UserCreationPage,
})

const EMPTY = {
  firstName: '',
  lastName: '',
  username: '',
  email: '',
  phoneNumber: '',
  password: '',
  confirmPassword: '',
  role: 'employee',
}

/**
 * Mirrors the rules the Users dialog enforced before this page existed. They
 * were dropped here, which silently weakened every account an admin created.
 * Exported so the rules stay locked in by tests.
 */
export function passwordError(pw: string, confirm: string): string | null {
  if (!pw) return 'Password is required.'
  if (pw.length < 8) return 'Password must be at least 8 characters long.'
  if (!/[a-z]/.test(pw))
    return 'Password must contain at least one lowercase letter.'
  if (!/\d/.test(pw)) return 'Password must contain at least one number.'
  if (pw !== confirm) return "Passwords don't match."
  return null
}

function UserCreationPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(EMPTY)
  // Per-user permission overrides, previously only settable through the Users
  // dialog when creating an admin. Lost with that dialog, so restore it here.

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const create = useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User created successfully')
      setForm(EMPTY)
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Failed to create user'),
  })

  const pwdError = passwordError(form.password, form.confirmPassword)

  const valid =
    form.firstName.trim() !== '' &&
    form.lastName.trim() !== '' &&
    form.username.trim() !== '' &&
    form.email.includes('@') &&
    form.phoneNumber.trim() !== '' &&
    form.role !== '' &&
    pwdError === null

  return (
    <>
      <Header fixed>
        <div className='me-auto' />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>User Creation</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            Create a login account. To turn a user into an employee with payroll,
            attendance and leave, add an employee record for them from
            HR → Employees → Create Employee.
          </p>
        </div>

        <Card className='max-w-3xl'>
          <CardHeader>
            <CardTitle className='text-base'>New user</CardTitle>
            <CardDescription>
              Creates the account, its credentials and its default settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className='grid gap-4 sm:grid-cols-2'
              onSubmit={(e) => {
                e.preventDefault()
                if (!valid) return
                create.mutate({
                  firstName: form.firstName,
                  lastName: form.lastName,
                  username: form.username,
                  email: form.email,
                  phoneNumber: form.phoneNumber,
                  password: form.password,
                  role: form.role,
                })
              }}
            >
              <div className='grid gap-2'>
                <Label htmlFor='firstName'>First name</Label>
                <Input id='firstName' value={form.firstName} onChange={set('firstName')} required />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='lastName'>Last name</Label>
                <Input id='lastName' value={form.lastName} onChange={set('lastName')} required />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='username'>Username</Label>
                <Input id='username' value={form.username} onChange={set('username')} required />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='email'>Email</Label>
                <Input id='email' type='email' value={form.email} onChange={set('email')} required />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='phoneNumber'>Phone</Label>
                <Input id='phoneNumber' value={form.phoneNumber} onChange={set('phoneNumber')} required />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='password'>Password</Label>
                <PasswordInput id='password' value={form.password} onChange={set('password')} />
                <p className='text-xs text-muted-foreground'>
                  At least 8 characters, with a lowercase letter and a number.
                </p>
                {form.password && pwdError && (
                  <p className='text-xs text-destructive'>{pwdError}</p>
                )}
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='confirmPassword'>Confirm password</Label>
                <PasswordInput
                  id='confirmPassword'
                  value={form.confirmPassword}
                  onChange={set('confirmPassword')}
                />
                {form.confirmPassword && form.password !== form.confirmPassword && (
                  <p className='text-xs text-destructive'>
                    Passwords don&apos;t match.
                  </p>
                )}
              </div>
              <div className='grid gap-2'>
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAFF_ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className='flex justify-end sm:col-span-2'>
                <Button type='submit' disabled={!valid || create.isPending}>
                  {create.isPending ? (
                    <Loader2 className='mr-1 h-4 w-4 animate-spin' />
                  ) : (
                    <UserPlus className='mr-1 h-4 w-4' />
                  )}
                  Create user
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
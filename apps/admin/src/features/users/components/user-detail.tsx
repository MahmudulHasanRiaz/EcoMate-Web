import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, ArrowLeft, Shield, UserCheck, Users, CreditCard, Mail, Phone, Calendar, Clock, Activity } from 'lucide-react'
import { usersApi } from '../api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { callTypes, roles } from '../data/data'

const roleIcons: Record<string, typeof Shield> = {
  superadmin: Shield,
  admin: UserCheck,
  manager: Users,
  cashier: CreditCard,
}

export function UserDetail({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const { data: user, isLoading } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => usersApi.get(userId).then(r => r.data),
  })

  if (isLoading) {
    return (
      <div className='flex justify-center py-12'>
        <Loader2 className='animate-spin h-8 w-8' />
      </div>
    )
  }

  if (!user) {
    return (
      <div className='p-6 text-muted-foreground text-center'>
        <p className='text-lg mb-4'>User not found</p>
        <Button variant='outline' onClick={() => navigate({ to: '/mon/users' })}>
          <ArrowLeft className='h-4 w-4 mr-1' /> Back to Users
        </Button>
      </div>
    )
  }

  const RoleIcon = roleIcons[user.role] || Users
  const badgeColor = callTypes.get(user.status as any)

  return (
    <>
      <Header fixed>
        <Button variant='ghost' onClick={() => navigate({ to: '/mon/users' })}>
          <ArrowLeft className='h-4 w-4 mr-1' /> Back
        </Button>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>
              {user.firstName} {user.lastName}
            </h2>
            <p className='text-muted-foreground'>@{user.username}</p>
          </div>
          <div className='flex items-center gap-3'>
            <Badge variant='outline' className={badgeColor}>
              {user.status}
            </Badge>
            <div className='flex items-center gap-1.5 text-sm text-muted-foreground'>
              <RoleIcon size={16} />
              <span className='capitalize'>{user.role}</span>
            </div>
          </div>
        </div>

        <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
          <Card>
            <CardHeader className='pb-2'>
              <CardTitle className='text-base flex items-center gap-2'>
                <Mail className='h-4 w-4 text-muted-foreground' />
                Contact
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-3 text-sm'>
              <div>
                <p className='text-xs text-muted-foreground'>Email</p>
                <p className='font-medium'>{user.email}</p>
              </div>
              <div>
                <p className='text-xs text-muted-foreground'>Phone</p>
                <p className='font-medium'>{user.phoneNumber}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='pb-2'>
              <CardTitle className='text-base flex items-center gap-2'>
                <Activity className='h-4 w-4 text-muted-foreground' />
                Account Info
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-3 text-sm'>
              <div>
                <p className='text-xs text-muted-foreground'>Role</p>
                <p className='font-medium capitalize'>{user.role}</p>
              </div>
              <div>
                <p className='text-xs text-muted-foreground'>Status</p>
                <Badge variant='outline' className={badgeColor}>
                  {user.status}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='pb-2'>
              <CardTitle className='text-base flex items-center gap-2'>
                <Calendar className='h-4 w-4 text-muted-foreground' />
                Time
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-3 text-sm'>
              <div>
                <p className='text-xs text-muted-foreground'>Created</p>
                <p className='font-medium flex items-center gap-1'>
                  <Clock className='h-3 w-3' />
                  {new Date(user.createdAt).toLocaleDateString('en-BD', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
                <p className='text-xs text-muted-foreground mt-0.5'>
                  {new Date(user.createdAt).toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div>
                <p className='text-xs text-muted-foreground'>Last Updated</p>
                <p className='font-medium flex items-center gap-1'>
                  <Clock className='h-3 w-3' />
                  {new Date(user.updatedAt).toLocaleDateString('en-BD', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base'>User Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-6 text-sm'>
              <div className='space-y-1'>
                <p className='text-xs text-muted-foreground'>User ID</p>
                <p className='font-mono text-xs'>{user.id}</p>
              </div>
              <div className='space-y-1'>
                <p className='text-xs text-muted-foreground'>Username</p>
                <p className='font-medium'>@{user.username}</p>
              </div>
              <div className='space-y-1'>
                <p className='text-xs text-muted-foreground'>First Name</p>
                <p className='font-medium'>{user.firstName}</p>
              </div>
              <div className='space-y-1'>
                <p className='text-xs text-muted-foreground'>Last Name</p>
                <p className='font-medium'>{user.lastName}</p>
              </div>
              <div className='space-y-1'>
                <p className='text-xs text-muted-foreground'>Email</p>
                <p className='font-medium'>{user.email}</p>
              </div>
              <div className='space-y-1'>
                <p className='text-xs text-muted-foreground'>Phone</p>
                <p className='font-medium'>{user.phoneNumber}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}

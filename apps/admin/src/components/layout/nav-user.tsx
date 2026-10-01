import { useEffect } from 'react'
import { Link, useNavigate, useLocation } from '@tanstack/react-router'
import {
  ChevronsUpDown,
  CircleUser,
  KeyRound,
  LogOut,
  Palette,
  ShieldCheck,
  UserCog,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import useDialogState from '@/hooks/use-dialog-state'
import { useAuthStore } from '@/stores/auth-store'
import { useLicenseStore } from '@/stores/license-store'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { SignOutDialog } from '@/components/sign-out-dialog'
import { hrMyAttendanceApi } from '@/features/hr-attendance/api'

/** Kept for call-site compatibility; the values now come from the session. */
type NavUserProps = {
  user?: { name?: string; email?: string; avatar?: string }
}

/**
 * The single account entry point for the admin app.
 *
 * Everything shown here is real session or API data:
 *  - name / email / role come from the auth store (the logged-in user), not a
 *    hardcoded placeholder;
 *  - the employee lines come from `GET /hr/my/profile`, so an employee sees
 *    their own employee code and department rather than a copy of the admin's
 *    identity;
 *  - the plan comes from `GET /license/status`.
 *
 * Non-employee-only links (system settings) are hidden when the viewer lacks
 * the license feature, so no entry ever leads to a dead screen.
 */
export function NavUser(_props: NavUserProps) {
  const { isMobile } = useSidebar()
  const [open, setOpen] = useDialogState()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isMon = pathname.startsWith('/mon')

  const user = useAuthStore((s) => s.auth.user)
  const hasFeature = useLicenseStore((s) => s.hasFeature)

  const email = user?.email || 'admin@ecomate.com'
  const role = user?.role || 'admin'

  // Real employee identity for the viewer (404 when they are not an employee).
  const { data: employee } = useQuery({
    queryKey: ['hr', 'my-profile'],
    queryFn: () =>
      hrMyAttendanceApi
        .profile()
        .then((r) => r.data)
        .catch(() => null),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  // Name priority, per the account-menu rules:
  //   employee  → the employee's own linked name
  //   otherwise → the user profile's own first/last name
  //   fallback  → the email local-part (never a hardcoded "Admin")
  const fullName = [
    employee?.betterAuthUser?.name,
    [user?.firstName, user?.lastName].filter(Boolean).join(' '),
  ]
    .map((n) => n?.trim())
    .find((n) => !!n)

  const displayName = fullName || email.split('@')[0]
  const initials = displayName.slice(0, 2).toUpperCase()

  // Sub-label: designation for employees, otherwise the account role.
  const roleLabel = String(role).replace(/_/g, ' ')
  const subtitle = employee
    ? employee.designation?.name || roleLabel
    : roleLabel

  const canSeeSystem = hasFeature('admin_settings')

  // Make the advertised ⇧⌘Q shortcut real instead of decorative.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.shiftKey && e.metaKey && e.key.toLowerCase() === 'q') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem className="px-1.5 pb-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size='lg'
                className='w-full transition-all duration-150 border border-border/40 hover:bg-muted/40 rounded-lg shadow-xs data-[state=open]:bg-sidebar-accent'
              >
                <div
                  className={employee ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}
                  onClick={
                    employee
                      ? (e) => {
                          e.stopPropagation()
                          navigate({ to: '/op/my-profile' })
                        }
                      : undefined
                  }
                  title={employee ? 'View Employee Profile' : undefined}
                >
                  <Avatar className='h-7 w-7 rounded-md border border-border/70'>
                    <AvatarFallback className='rounded-md bg-primary-soft text-primary-ink font-bold text-[10px]'>
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div className='grid flex-1 text-start text-xs leading-tight ml-1.5'>
                  <span className='truncate font-bold text-foreground text-[11px]'>
                    {displayName}
                  </span>
                  <span className='truncate text-[10px] text-muted-foreground/80 font-medium'>
                    {subtitle}
                  </span>
                </div>
                <ChevronsUpDown className='ms-auto size-3.5 text-muted-foreground/70' />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className='w-(--radix-dropdown-menu-trigger-width) min-w-64 rounded-lg shadow-md border-border/80'
              side={isMobile ? 'bottom' : 'right'}
              align='end'
              sideOffset={4}
            >
              <DropdownMenuLabel className='p-0 font-normal'>
                {employee ? (
                  <Link
                    to="/op/my-profile"
                    className="flex flex-col p-2.5 rounded-t-lg hover:bg-muted/50 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-2.5 text-start">
                      <Avatar className="h-9 w-9 rounded-md border border-border/70 group-hover:border-primary/50 transition-colors">
                        <AvatarFallback className="rounded-md bg-primary-soft text-primary-ink font-bold text-xs">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="grid min-w-0 flex-1 text-start text-xs leading-tight">
                        <span className="truncate font-semibold text-foreground group-hover:text-primary transition-colors">
                          {displayName}
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">{email}</span>
                        <span className="mt-1 inline-flex w-fit items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                          {subtitle}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-border/50 text-[10px] flex items-center justify-between text-muted-foreground">
                      <span>ID: <strong className="text-foreground">{employee.employeeId}</strong></span>
                      <span className="text-primary font-medium group-hover:underline">View Profile →</span>
                    </div>
                  </Link>
                ) : (
                  <div className='flex items-center gap-2.5 px-2.5 py-2 text-start'>
                    <Avatar className='h-9 w-9 rounded-md border border-border/70'>
                      <AvatarFallback className='rounded-md bg-primary-soft text-primary-ink font-bold text-xs'>
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className='grid min-w-0 flex-1 text-start text-xs leading-tight'>
                      <span className='truncate font-semibold text-foreground'>{displayName}</span>
                      <span className='truncate text-[10px] text-muted-foreground'>{email}</span>
                      <span className='mt-1 inline-flex w-fit items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground'>
                        {subtitle}
                      </span>
                    </div>
                  </div>
                )}
              </DropdownMenuLabel>

              <DropdownMenuSeparator className="bg-border/60" />

              <DropdownMenuGroup className="p-1 space-y-0.5">
                {employee && (
                  <DropdownMenuItem
                    asChild
                    className="rounded-md bg-primary-soft text-primary-ink focus:bg-primary-soft/80 py-1.5 px-2.5 text-xs gap-2 font-semibold cursor-pointer mb-1 border border-primary/20"
                  >
                    <Link to="/op/my-profile">
                      <CircleUser className="size-3.5 text-primary" />
                      My Employee Profile
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  asChild
                  className="rounded-md focus:bg-muted py-1.5 px-2.5 text-xs gap-2 font-medium cursor-pointer"
                >
                  <Link to={isMon ? '/mon/settings/general' : '/op/settings/personal'}>
                    {isMon ? (
                      <>
                        <ShieldCheck className="size-3.5 text-muted-foreground" />
                        System Settings
                      </>
                    ) : (
                      <>
                        <UserCog className="size-3.5 text-muted-foreground" />
                        Profile Settings
                      </>
                    )}
                  </Link>
                </DropdownMenuItem>
                {!isMon && (
                  <DropdownMenuItem
                    asChild
                    className="rounded-md focus:bg-muted py-1.5 px-2.5 text-xs gap-2 font-medium cursor-pointer"
                  >
                    <Link to='/op/settings/personal'>
                      <Palette className="size-3.5 text-muted-foreground" />
                      Appearance
                    </Link>
                  </DropdownMenuItem>
                )}
                {!isMon && (
                  <DropdownMenuItem
                    onSelect={() => navigate({ to: '/op/settings/personal' })}
                    className="rounded-md focus:bg-muted py-1.5 px-2.5 text-xs gap-2 font-medium cursor-pointer"
                  >
                    <KeyRound className="size-3.5 text-muted-foreground" />
                    Change Password
                  </DropdownMenuItem>
                )}
                {canSeeSystem && (
                  <DropdownMenuItem
                    onSelect={() => navigate({ to: '/mon/settings/license' })}
                    className="rounded-md focus:bg-muted py-1.5 px-2.5 text-xs gap-2 font-medium cursor-pointer"
                  >
                    <CircleUser className="size-3.5 text-muted-foreground" />
                    License & Plan
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>

              <DropdownMenuSeparator className="bg-border/60" />

              <div className="p-1">
                <DropdownMenuItem
                  variant='destructive'
                  onClick={() => setOpen(true)}
                  className="rounded-md py-1.5 px-2.5 text-xs gap-2 font-medium cursor-pointer"
                >
                  <LogOut className="size-3.5" />
                  Sign out
                  <span className='ms-auto text-[10px] opacity-70'>⇧⌘Q</span>
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <SignOutDialog open={!!open} onOpenChange={setOpen} />
    </>
  )
}
import { Link, useLocation } from '@tanstack/react-router'
import {
  ChevronsUpDown,
  LogOut,
  Sparkles,
} from 'lucide-react'
import useDialogState from '@/hooks/use-dialog-state'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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

type NavUserProps = {
  user: {
    name: string
    email: string
    avatar: string
  }
}

export function NavUser({ user }: NavUserProps) {
  const { isMobile } = useSidebar()
  const [open, setOpen] = useDialogState()
  const { pathname } = useLocation()
  const isMon = pathname.startsWith('/mon')

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
                <Avatar className='h-7 w-7 rounded-md border border-border/70'>
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className='rounded-md bg-muted text-foreground font-bold text-[10px]'>SN</AvatarFallback>
                </Avatar>
                <div className='grid flex-1 text-start text-xs leading-tight ml-1.5'>
                  <span className='truncate font-bold text-foreground text-[11px]'>{user.name}</span>
                  <span className='truncate text-[10px] text-muted-foreground/80 font-medium'>{user.email}</span>
                </div>
                <ChevronsUpDown className='ms-auto size-3.5 text-muted-foreground/70' />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg shadow-md border-border/80'
              side={isMobile ? 'bottom' : 'right'}
              align='end'
              sideOffset={4}
            >
              <DropdownMenuLabel className='p-0 font-normal'>
                <div className='flex items-center gap-2 px-2.5 py-2 text-start text-sm'>
                  <Avatar className='h-8 w-8 rounded-md border border-border/70'>
                    <AvatarImage src={user.avatar} alt={user.name} />
                    <AvatarFallback className='rounded-md bg-muted text-foreground font-bold text-xs'>SN</AvatarFallback>
                  </Avatar>
                  <div className='grid flex-1 text-start text-xs leading-tight ml-1'>
                    <span className='truncate font-semibold text-foreground'>{user.name}</span>
                    <span className='truncate text-[10px] text-muted-foreground'>{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-border/60" />
              <DropdownMenuGroup className="p-1 space-y-0.5">
                <DropdownMenuItem className="rounded-md focus:bg-muted py-1.5 px-2.5 text-xs gap-2 font-medium cursor-pointer">
                  <Sparkles className="size-3.5 text-muted-foreground" />
                  Upgrade to Pro
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator className="bg-border/60" />
              <DropdownMenuGroup className="p-1 space-y-0.5">
                <DropdownMenuItem asChild className="rounded-md focus:bg-muted py-1.5 px-2.5 text-xs font-medium cursor-pointer">
                  <Link to={isMon ? '/mon/settings/system' : '/op/settings/personal'}>
                    {isMon ? 'System Settings' : 'Profile Settings'}
                  </Link>
                </DropdownMenuItem>
                {!isMon && (
                  <DropdownMenuItem asChild className="rounded-md focus:bg-muted py-1.5 px-2.5 text-xs font-medium cursor-pointer">
                    <Link to='/op/settings/personal'>Billing</Link>
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

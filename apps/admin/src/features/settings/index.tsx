import { Outlet, useLocation } from '@tanstack/react-router'
import { Monitor, Bell, Palette, Wrench, UserCog, HardDrive, CreditCard, Settings as SettingsIcon, Truck, RefreshCw } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { SidebarNav } from './components/sidebar-nav'

export function Settings() {
  const { pathname } = useLocation()
  const isMon = pathname.includes('/mon/')

  const opNavItems = [
    { title: 'Profile', href: '/op/settings/personal', icon: <UserCog size={18} /> },
    { title: 'Account', href: '/op/settings/account', icon: <Wrench size={18} /> },
    { title: 'Appearance', href: '/op/settings/appearance', icon: <Palette size={18} /> },
    { title: 'Notifications', href: '/op/settings/notifications', icon: <Bell size={18} /> },
    { title: 'Display', href: '/op/settings/display', icon: <Monitor size={18} /> },
  ]

  const monNavItems = [
    { title: 'System', href: '/mon/settings/system', icon: <SettingsIcon size={18} /> },
    { title: 'Gateways', href: '/mon/settings/gateways', icon: <CreditCard size={18} /> },
    { title: 'Storage', href: '/mon/settings/storage', icon: <HardDrive size={18} /> },
    { title: 'Courier', href: '/mon/settings/courier', icon: <Truck size={18} /> },
    { title: 'Order Statuses', href: '/mon/settings/order-statuses', icon: <RefreshCw size={18} /> },
  ]

  const items = isMon ? monNavItems : opNavItems

  return (
    <>
      <Header>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main fixed>
        <div className='space-y-0.5'>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
            {isMon ? 'System Configuration' : 'Settings'}
          </h1>
          <p className='text-muted-foreground'>
            {isMon 
              ? 'Manage system-level configurations and third-party integrations.' 
              : 'Manage your account settings and preferences.'}
          </p>
        </div>
        <Separator className='my-4 lg:my-6' />
        <div className='flex flex-1 flex-col space-y-2 overflow-hidden md:space-y-2 lg:flex-row lg:space-y-0 lg:space-x-12'>
          <aside className='top-0 lg:sticky lg:w-1/5'>
            <SidebarNav items={items} />
          </aside>
          <div className='flex w-full overflow-y-auto p-1 pr-4'>
            <Outlet />
          </div>
        </div>
      </Main>
    </>
  )
}

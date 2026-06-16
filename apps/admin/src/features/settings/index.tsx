import { useState } from 'react'
import { Outlet, useLocation } from '@tanstack/react-router'
import { Monitor, Palette, UserCog, HardDrive, CreditCard, Settings as SettingsIcon, Truck, RefreshCw, Store, Package, FileText, Radio, List } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Skeleton } from '@/components/ui/skeleton'
import { SidebarNav } from './components/sidebar-nav'

export function Settings() {
  const { pathname } = useLocation()
  const isMon = pathname.includes('/mon/')
  const [isLoading] = useState(false)

  const opNavGroups = [
    {
      groupLabel: 'Profile',
      items: [
        { title: 'Profile', href: '/op/settings/personal', icon: <UserCog size={18} /> },
      ],
    },
  ]

  const monNavGroups = [
    {
      groupLabel: 'General',
      items: [
        { title: 'System Settings', href: '/mon/settings/general', icon: <SettingsIcon size={18} /> },
      ],
    },
    {
      groupLabel: 'Storefront',
      items: [
      { title: 'Storefront', href: '/mon/settings/storefront', icon: <Store size={18} /> },
      { title: 'Branding & Identity', href: '/mon/settings/branding', icon: <Palette size={18} /> },
      ],
    },
    {
      groupLabel: 'Integrations',
      items: [
        { title: 'Payment Gateways', href: '/mon/settings/gateways', icon: <CreditCard size={18} /> },
        { title: 'Courier', href: '/mon/settings/courier', icon: <Truck size={18} /> },
        { title: 'Shipping', href: '/mon/settings/shipping', icon: <Package size={18} /> },
        { title: 'Tracking & Analytics', href: '/mon/settings/tracking', icon: <Radio size={18} /> },
      ],
    },
    {
      groupLabel: 'Content',
      items: [
        { title: 'CMS Pages', href: '/mon/settings/pages', icon: <FileText size={18} /> },
        { title: 'Menu', href: '/mon/settings/menu', icon: <List size={18} /> },
        { title: 'Storage', href: '/mon/settings/storage', icon: <HardDrive size={18} /> },
      ],
    },
    {
      groupLabel: 'System',
      items: [
        { title: 'Order Statuses', href: '/mon/settings/order-statuses', icon: <RefreshCw size={18} /> },
      ],
    },
  ]

  const navGroups = isMon ? monNavGroups : opNavGroups

  if (isLoading) {
    return (
      <Main>
        <div className='p-6 space-y-4'>
          <Skeleton className='h-8 w-48' />
          <Skeleton className='h-96 w-full rounded-lg' />
        </div>
      </Main>
    )
  }

  return (
    <>
      <Header>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main fixed>
        <div className='space-y-0.5'>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>Settings</h1>
          <p className='text-muted-foreground'>
            {isMon
              ? 'Configure system-level settings, storefront appearance, and third-party integrations.'
              : 'Manage your account settings and preferences.'}
          </p>
        </div>
        <Separator className='my-4 lg:my-6' />
        <div className='flex flex-1 flex-col space-y-2 overflow-hidden md:space-y-2 lg:flex-row lg:space-y-0 lg:space-x-12'>
          <aside className='top-0 lg:sticky lg:w-1/5'>
            <SidebarNav groups={navGroups} />
          </aside>
          <div className='flex w-full overflow-y-auto p-1 pr-4'>
            <Outlet />
          </div>
        </div>
      </Main>
    </>
  )
}

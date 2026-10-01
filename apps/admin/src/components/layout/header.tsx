import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { ThemeSwitch } from '@/components/theme-switch'
import { HeaderChromeContext } from '@/context/header-chrome-provider'

type HeaderProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean
  ref?: React.Ref<HTMLElement>
}

export function Header({ className, fixed, children, ...props }: HeaderProps) {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      setOffset(document.body.scrollTop || document.documentElement.scrollTop)
    }
    document.addEventListener('scroll', onScroll, { passive: true })
    return () => document.removeEventListener('scroll', onScroll)
  }, [])

  // Canvas top bar: 56px, 1px hairline + 2px panel accent line under it.
  // --panel-accent is inherited from the [data-panel] ancestor (set in the layout).
  const scrolling = offset > 10 && fixed

  return (
    <header
      className={cn(
        'z-50 h-14 border-b border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70',
        fixed && 'header-fixed peer/header sticky top-0 w-[inherit]',
        className
      )}
      style={{
        boxShadow: `${scrolling ? '0 1px 2px rgb(15 22 48 / 0.06)' : ''}${
          scrolling ? ', ' : ''
        }inset 0 -2px 0 0 var(--panel-accent, transparent)`,
      }}
      {...props}
    >
      <div className='relative flex h-full flex-wrap items-center gap-2.5 px-3 sm:gap-3 sm:px-4'>
        <SidebarTrigger className='size-8' />
        <Separator orientation='vertical' className='h-5' />
        {/* Page-supplied header content is marked "chrome already provided" so
            a screen that still renders its own ThemeSwitch/ProfileDropdown
            collapses to nothing instead of duplicating them. The header's own
            cluster below sits OUTSIDE this provider, so it is unaffected. */}
        <HeaderChromeContext value={true}>
          {children}
        </HeaderChromeContext>
        {/* Right-hand cluster: theme toggle first, then the attendance clock
            immediately beside it, sharing one container so the pair reads as
            a single control. The avatar/profile menu intentionally lives only
            in the sidebar footer — duplicating it here left the bar crowded
            and gave two competing account entry points. The clock portals into
            this slot so it can never float over anything. */}
        <div className='ms-auto flex shrink-0 items-center gap-0.5 rounded-lg border border-border/60 bg-surface-raised/60 p-0.5'>
          <ThemeSwitch />
          <div data-attendance-clock-slot className='flex shrink-0 items-center' />
        </div>
      </div>
    </header>
  )
}

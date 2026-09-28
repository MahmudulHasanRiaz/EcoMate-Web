import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

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
        'z-50 h-14 border-b border-border bg-background',
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
      <div className='relative flex h-full items-center gap-2.5 px-3 sm:gap-3 sm:px-4'>
        <SidebarTrigger className='size-8' />
        <Separator orientation='vertical' className='h-5' />
        {children}
      </div>
    </header>
  )
}

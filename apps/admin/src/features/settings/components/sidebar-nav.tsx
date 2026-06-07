import { useState, type JSX } from 'react'
import { useLocation, useNavigate, Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type SidebarNavItem = {
  href: string
  title: string
  icon: JSX.Element
}

type SidebarNavGroup = {
  groupLabel: string
  items: SidebarNavItem[]
}

type SidebarNavProps = React.HTMLAttributes<HTMLElement> & {
  items?: SidebarNavItem[]
  groups?: SidebarNavGroup[]
}

export function SidebarNav({ className, items, groups, ...props }: SidebarNavProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [val, setVal] = useState(pathname ?? '')

  const allItems: SidebarNavItem[] = groups
    ? groups.flatMap(g => g.items)
    : items ?? []

  const handleSelect = (e: string) => {
    setVal(e)
    navigate({ to: e })
  }

  return (
    <>
      <div className='p-1 md:hidden'>
        <Select value={val} onValueChange={handleSelect}>
          <SelectTrigger className='h-12 sm:w-48'>
            <SelectValue placeholder='Select setting' />
          </SelectTrigger>
          <SelectContent>
            {groups
              ? groups.flatMap(group =>
                  group.items.map(item => (
                    <SelectItem key={item.href} value={item.href}>
                      <div className='flex gap-x-4 px-2 py-1'>
                        <span className='scale-125'>{item.icon}</span>
                        <span className='text-md'>{item.title}</span>
                      </div>
                    </SelectItem>
                  ))
                )
              : allItems.map(item => (
                  <SelectItem key={item.href} value={item.href}>
                    <div className='flex gap-x-4 px-2 py-1'>
                      <span className='scale-125'>{item.icon}</span>
                      <span className='text-md'>{item.title}</span>
                    </div>
                  </SelectItem>
                ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea
        orientation='horizontal'
        type='always'
        className='hidden w-full min-w-40 bg-background px-1 py-2 md:block'
      >
        <nav
          className={cn(
            'flex space-x-2 py-1 lg:flex-col lg:space-y-1 lg:space-x-0',
            className
          )}
          {...props}
        >
          {groups
            ? groups.map(group => (
                <div key={group.groupLabel} className='lg:space-y-0.5'>
                  <h4 className='hidden px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 lg:block'>
                    {group.groupLabel}
                  </h4>
                  {group.items.map(item => (
                    <Link
                      key={item.href}
                      to={item.href}
                      className={cn(
                        buttonVariants({ variant: 'ghost' }),
                        pathname === item.href
                          ? 'bg-muted hover:bg-accent'
                          : 'hover:bg-accent hover:underline',
                        'justify-start w-full'
                      )}
                    >
                      <span className='me-2'>{item.icon}</span>
                      {item.title}
                    </Link>
                  ))}
                </div>
              ))
            : allItems.map(item => (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    buttonVariants({ variant: 'ghost' }),
                    pathname === item.href
                      ? 'bg-muted hover:bg-accent'
                      : 'hover:bg-accent hover:underline',
                    'justify-start'
                  )}
                >
                  <span className='me-2'>{item.icon}</span>
                  {item.title}
                </Link>
              ))}
        </nav>
      </ScrollArea>
    </>
  )
}

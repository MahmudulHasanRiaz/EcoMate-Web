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

      {/* Medium screens (horizontal scroll) */}
      <ScrollArea
        orientation='horizontal'
        type='always'
        className='hidden w-full min-w-40 bg-background px-1 py-2 md:block lg:hidden'
      >
        <nav
          className={cn(
            'flex space-x-2 py-1',
            className
          )}
          {...props}
        >
          {groups
            ? groups.map(group => (
                <div key={group.groupLabel} className='flex space-x-2'>
                  {group.items.map(item => (
                    <Link
                      key={item.href}
                      to={item.href}
                      className={cn(
                        buttonVariants({ variant: 'ghost' }),
                        pathname === item.href
                          ? 'bg-muted hover:bg-accent'
                          : 'hover:bg-accent hover:underline',
                        'justify-start whitespace-nowrap'
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
                    'justify-start whitespace-nowrap'
                  )}
                >
                  <span className='me-2'>{item.icon}</span>
                  {item.title}
                </Link>
              ))}
        </nav>
      </ScrollArea>

      {/* Large screens (vertical scrollable sidebar) */}
      <ScrollArea
        orientation='vertical'
        className='hidden lg:block w-full min-w-40 bg-background px-1 py-2 max-h-[calc(100vh-12rem)] overflow-y-auto pr-3'
      >
        <nav
          className={cn(
            'flex flex-col space-y-1',
            className
          )}
          {...props}
        >
          {groups
            ? groups.map(group => (
                <div key={group.groupLabel} className='space-y-0.5'>
                  <h4 className='px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60'>
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
                    'justify-start w-full'
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

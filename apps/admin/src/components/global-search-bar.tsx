import { SearchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSearch } from '@/context/search-provider'
import { Button } from './ui/button'

export function GlobalSearchBar({
  className,
  ...props
}: React.ComponentProps<'button'>) {
  const { openSearch, open } = useSearch()

  return (
    <Button
      {...props}
      variant='outline'
      aria-expanded={open}
      aria-keyshortcuts='Meta+K Control+K'
      className={cn(
        'group relative h-8 w-full flex-1 justify-start rounded-md bg-muted/25 text-sm font-normal text-muted-foreground shadow-none hover:bg-accent sm:w-48 sm:pe-12 md:flex-none lg:w-64 xl:w-80',
        className,
      )}
      onClick={openSearch}
    >
      <SearchIcon
        aria-hidden='true'
        className='absolute inset-s-1.5 top-1/2 -translate-y-1/2'
        size={16}
      />
      <span className='ms-6 truncate'>
        Search orders, products, customers...
      </span>
      <kbd className='pointer-events-none absolute inset-e-[0.3rem] top-[0.3rem] hidden h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 select-none sm:flex'>
        <span className='text-xs'>⌘</span>K
      </kbd>
    </Button>
  )
}

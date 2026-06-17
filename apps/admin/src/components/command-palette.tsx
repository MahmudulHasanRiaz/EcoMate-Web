import React from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  ChevronRight,
  Laptop,
  Loader2,
  Moon,
  Sun,
  SearchX,
  AlertCircle,
  RotateCcw,
  Clock,
} from 'lucide-react'
import { useSearch } from '@/context/search-provider'
import { useTheme } from '@/context/theme-provider'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { sidebarData } from './layout/data/sidebar-data'
import { ScrollArea } from './ui/scroll-area'

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

export function CommandPalette() {
  const navigate = useNavigate()
  const { setTheme } = useTheme()
  const {
    open,
    setOpen,
    mode,
    query,
    results,
    isLoading,
    error,
    recentSearches,
    search,
    clearRecentSearches,
    addRecentSearch,
  } = useSearch()

  const runCommand = React.useCallback(
    (command: () => unknown) => {
      setOpen(false)
      command()
    },
    [setOpen],
  )

  const handleSelect = (
    type: 'order' | 'product' | 'customer',
    id: string,
    label: string,
  ) => {
    addRecentSearch(label)
    runCommand(() => {
      const paths: Record<string, string> = {
        order: `/op/orders/${id}`,
        product: `/op/products/${id}`,
        customer: `/op/customers/${id}`,
      }
      navigate({ to: paths[type] })
    })
  }

  const hasApiResults =
    results.orders.length > 0 ||
    results.products.length > 0 ||
    results.customers.length > 0

  const showApiSection = query.length >= 2 && !isLoading && !error

  return (
    <CommandDialog modal shouldFilter={false} open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder={mode === 'search' ? 'Search orders, products, customers...' : 'Type a command or search...'}
        value={query}
        onValueChange={search}
      />
      <CommandList>
        <ScrollArea type='hover' className='h-72 pe-1'>
          {/* Loading state */}
          {isLoading && (
            <div className='flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground'>
              <Loader2 className='h-4 w-4 animate-spin' />
              Searching...
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className='flex items-center justify-center gap-2 py-8 text-sm text-red-500'>
              <AlertCircle className='h-4 w-4' />
              {error}
              <button
                className='underline hover:no-underline ms-2'
                onClick={() => search(query)}
              >
                <RotateCcw className='h-3 w-3 inline me-1' />
                Retry
              </button>
            </div>
          )}

          {/* No results */}
          {!isLoading && !error && query.length >= 2 && !hasApiResults && (
            <div className='flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground'>
              <SearchX className='h-8 w-8' />
              <span>
                No results found for &ldquo;{query}&rdquo;
              </span>
            </div>
          )}

          {/* API Results */}
          {showApiSection && hasApiResults && (
            <>
              {results.orders.length > 0 && (
                <CommandGroup heading='Orders'>
                  {results.orders.map((order) => (
                    <CommandItem
                      key={`order-${order.id}`}
                      value={`order-${order.displayId}`}
                      onSelect={() =>
                        handleSelect(
                          'order',
                          order.id,
                          `#${order.displayId}`,
                        )
                      }
                    >
                      <div className='flex w-full items-center justify-between gap-2'>
                        <div className='flex items-center gap-2 min-w-0'>
                          <ArrowRight className='size-3 shrink-0 text-muted-foreground/80' />
                          <span className='font-medium'>
                            #{order.displayId}
                          </span>
                          {order.customerName && (
                            <span className='text-muted-foreground truncate'>
                              {order.customerName}
                            </span>
                          )}
                        </div>
                        <div className='flex items-center gap-2 shrink-0'>
                          {order.total != null && (
                            <span className='text-xs tabular-nums'>
                              {formatCurrency(order.total)}
                            </span>
                          )}
                          {order.status && (
                            <span className='text-[10px] px-1.5 py-0.5 rounded-full bg-muted'>
                              {order.status}
                            </span>
                          )}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {results.products.length > 0 && (
                <CommandGroup heading='Products'>
                  {results.products.map((product) => (
                    <CommandItem
                      key={`product-${product.id}`}
                      value={`product-${product.name}`}
                      onSelect={() =>
                        handleSelect(
                          'product',
                          product.id,
                          product.name || '',
                        )
                      }
                    >
                      <div className='flex w-full items-center justify-between gap-2'>
                        <div className='flex items-center gap-2 min-w-0'>
                          <ArrowRight className='size-3 shrink-0 text-muted-foreground/80' />
                          <span className='truncate'>{product.name}</span>
                        </div>
                        <div className='flex items-center gap-2 shrink-0'>
                          {product.sku && (
                            <span className='text-[10px] text-muted-foreground'>
                              {product.sku}
                            </span>
                          )}
                          {product.price != null && (
                            <span className='text-xs tabular-nums'>
                              {formatCurrency(product.price)}
                            </span>
                          )}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {results.customers.length > 0 && (
                <CommandGroup heading='Customers'>
                  {results.customers.map((customer) => (
                    <CommandItem
                      key={`customer-${customer.id}`}
                      value={`customer-${customer.name}`}
                      onSelect={() =>
                        handleSelect(
                          'customer',
                          customer.id,
                          customer.name || '',
                        )
                      }
                    >
                      <div className='flex w-full items-center gap-2'>
                        <ArrowRight className='size-3 shrink-0 text-muted-foreground/80' />
                        <span>{customer.name}</span>
                        <span className='text-xs text-muted-foreground'>
                          {customer.phone}
                        </span>
                        {customer.email && (
                          <span className='text-xs text-muted-foreground hidden sm:inline'>
                            {customer.email}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              <CommandSeparator />
            </>
          )}

          {/* Recent Searches (only when input is empty) */}
          {query.length === 0 && recentSearches.length > 0 && (
            <CommandGroup heading='Recent Searches'>
              {recentSearches.map((s, i) => (
                <CommandItem
                  key={`recent-${i}`}
                  value={`recent-${s}`}
                  onSelect={() => search(s)}
                >
                  <Clock className='size-3 text-muted-foreground/80' />
                  <span>{s}</span>
                </CommandItem>
              ))}
              <CommandItem onSelect={clearRecentSearches}>
                <span className='text-xs text-muted-foreground'>
                  Clear recent searches
                </span>
              </CommandItem>
            </CommandGroup>
          )}

          {/* Navigation + Theme (only in command mode with no query) */}
          {mode === 'command' && query.length === 0 && !isLoading && !error && (
            <>
              {sidebarData.navGroups.map((group) => (
                <CommandGroup
                  key={group.title || 'nav'}
                  heading={group.title}
                >
                  {group.items.map((navItem, i) => {
                    if (navItem.url) {
                      return (
                        <CommandItem
                          key={`nav-${navItem.url}-${i}`}
                          value={navItem.title}
                          onSelect={() =>
                            runCommand(() =>
                              navigate({ to: navItem.url }),
                            )
                          }
                        >
                          <div className='flex size-4 items-center justify-center'>
                            <ArrowRight className='size-2 text-muted-foreground/80' />
                          </div>
                          {navItem.title}
                        </CommandItem>
                      )
                    }
                    return navItem.items?.map((subItem, si) => (
                      <CommandItem
                        key={`nav-${navItem.title}-${subItem.url}-${si}`}
                        value={`${navItem.title}-${subItem.url}`}
                        onSelect={() =>
                          runCommand(() =>
                            navigate({ to: subItem.url }),
                          )
                        }
                      >
                        <div className='flex size-4 items-center justify-center'>
                          <ArrowRight className='size-2 text-muted-foreground/80' />
                        </div>
                        {navItem.title}{' '}
                        <ChevronRight className='size-3' /> {subItem.title}
                      </CommandItem>
                    ))
                  })}
                </CommandGroup>
              ))}
              <CommandSeparator />
              <CommandGroup heading='Theme'>
                <CommandItem
                  onSelect={() => runCommand(() => setTheme('light'))}
                >
                  <Sun className='size-3' /> <span>Light</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => runCommand(() => setTheme('dark'))}
                >
                  <Moon className='size-3' /> <span>Dark</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => runCommand(() => setTheme('system'))}
                >
                  <Laptop className='size-3' /> <span>System</span>
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </ScrollArea>
      </CommandList>
    </CommandDialog>
  )
}

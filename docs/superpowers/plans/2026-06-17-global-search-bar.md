# Global Search Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the header search into a hybrid global search bar that searches Orders (by ID, phone, customer name), Products (by name, SKU), and Customers (by name, phone, email) via Postgres Full-Text Search, while keeping Cmd+K navigation.

**Architecture:** Backend (NestJS) adds a `SearchModule` with a `GET /api/admin/search` endpoint that runs 3 parallel Postgres FTS queries using `tsvector` + GIN indexes. Frontend evolves the existing `SearchProvider` + replaces `CommandMenu` with a new `CommandPalette` component and `GlobalSearchBar` component.

**Tech Stack:** NestJS, Prisma, PostgreSQL FTS (tsvector), cmdk, TanStack Router

---

### Task 1: Database migration — Add FTS columns + GIN indexes

**Files:**
- Create: `apps/backend/prisma/migrations/..._add_fts_search/migration.sql`
- Read: `apps/backend/prisma/schema.prisma:355-400` (Order fields), `:227-264` (Product fields), `:64-89` (User/Customer fields)

**Design notes for FTS column contents:**

| Table | Fields in tsvector | Why |
|-------|--------------------|-----|
| `orders` | `displayId`, `customer.firstName`, `customer.lastName`, `guestName`, `phone` (from customer or guest) | Cover order lookup by ID, name, phone |
| `products` | `name`, `sku` | Cover product search |
| `users` | `firstName`, `lastName`, `email`, `phoneNumber` | Cover customer search (filter by role) |

Use `'simple'` dictionary (not `'english'`) so order IDs like `ORD-1024` and phone numbers are not stemmed.

- [ ] **Step 1: Create migration SQL file**

Create `apps/backend/prisma/migrations/20260617000000_add_fts_search/migration.sql`:

```sql
-- Add tsvector column to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fts tsvector;

-- Update with data from display_id, guest fields, and customer relation
-- We use a subquery to pull customer name/phone
UPDATE orders SET fts = (
  to_tsvector('simple',
    coalesce(display_id, '') || ' ' ||
    coalesce(guest_name, '') || ' ' ||
    coalesce(guest_phone, '') || ' ' ||
    coalesce((SELECT first_name FROM users WHERE users.id = orders.customer_id), '') || ' ' ||
    coalesce((SELECT last_name FROM users WHERE users.id = orders.customer_id), '') || ' ' ||
    coalesce((SELECT phone_number FROM users WHERE users.id = orders.customer_id), '')
  )
);

CREATE INDEX orders_fts_idx ON orders USING GIN(fts);

-- Auto-update trigger on orders
CREATE OR REPLACE FUNCTION orders_fts_update() RETURNS trigger AS $$
BEGIN
  NEW.fts := to_tsvector('simple',
    coalesce(NEW.display_id, '') || ' ' ||
    coalesce(NEW.guest_name, '') || ' ' ||
    coalesce(NEW.guest_phone, '') || ' ' ||
    coalesce((SELECT first_name FROM users WHERE users.id = NEW.customer_id), '') || ' ' ||
    coalesce((SELECT last_name FROM users WHERE users.id = NEW.customer_id), '') || ' ' ||
    coalesce((SELECT phone_number FROM users WHERE users.id = NEW.customer_id), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_fts ON orders;
CREATE TRIGGER trg_orders_fts
  BEFORE INSERT OR UPDATE OF display_id, guest_name, guest_phone, customer_id
  ON orders FOR EACH ROW EXECUTE FUNCTION orders_fts_update();

-- Products
ALTER TABLE products ADD COLUMN IF NOT EXISTS fts tsvector;

UPDATE products SET fts = to_tsvector('simple',
  coalesce(name, '') || ' ' || coalesce(sku, '')
);

CREATE INDEX products_fts_idx ON products USING GIN(fts);

CREATE OR REPLACE FUNCTION products_fts_update() RETURNS trigger AS $$
BEGIN
  NEW.fts := to_tsvector('simple', coalesce(NEW.name, '') || ' ' || coalesce(NEW.sku, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_fts ON products;
CREATE TRIGGER trg_products_fts
  BEFORE INSERT OR UPDATE OF name, sku
  ON products FOR EACH ROW EXECUTE FUNCTION products_fts_update();

-- Users (customers)
ALTER TABLE users ADD COLUMN IF NOT EXISTS fts tsvector;

UPDATE users SET fts = to_tsvector('simple',
  coalesce(first_name, '') || ' ' ||
  coalesce(last_name, '') || ' ' ||
  coalesce(email, '') || ' ' ||
  coalesce(phone_number, '')
);

CREATE INDEX users_fts_idx ON users USING GIN(fts);

CREATE OR REPLACE FUNCTION users_fts_update() RETURNS trigger AS $$
BEGIN
  NEW.fts := to_tsvector('simple',
    coalesce(NEW.first_name, '') || ' ' ||
    coalesce(NEW.last_name, '') || ' ' ||
    coalesce(NEW.email, '') || ' ' ||
    coalesce(NEW.phone_number, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_fts ON users;
CREATE TRIGGER trg_users_fts
  BEFORE INSERT OR UPDATE OF first_name, last_name, email, phone_number
  ON users FOR EACH ROW EXECUTE FUNCTION users_fts_update();
```

- [ ] **Step 2: Run migration**

```bash
cd apps/backend && npx prisma migrate dev --name add_fts_search
```

Verify: Check that the migration applied and FTS indexes exist.

---

### Task 2: Backend — Create SearchModule (controller + service)

**Files:**
- Create: `apps/backend/src/search/search.module.ts`
- Create: `apps/backend/src/search/search.controller.ts`
- Create: `apps/backend/src/search/search.service.ts`
- Create: `apps/backend/src/search/dto/search-query.dto.ts`
- Read: `apps/backend/src/orders/orders.service.ts:88-164` (existing search pattern)

- [ ] **Step 1: Create DTO**

`apps/backend/src/search/dto/search-query.dto.ts`:
```ts
import { IsOptional, IsString, MinLength } from 'class-validator';

export class SearchQueryDto {
  @IsString()
  @MinLength(2)
  q: string;

  @IsOptional()
  limit?: number;
}
```

- [ ] **Step 2: Create SearchService**

`apps/backend/src/search/search.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface SearchResult {
  orders: Array<{ id: string; displayId: string; total: number; status: string; customerName: string | null; phone: string | null }>;
  products: Array<{ id: string; name: string; sku: string | null; price: number }>;
  customers: Array<{ id: string; name: string; phone: string; email: string }>;
}

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async search(query: string, limit = 5): Promise<SearchResult> {
    const tsquery = query.trim().split(/\s+/).map(w => w + ':*').join(' & ');

    const [orders, products, customers] = await Promise.all([
      this.searchOrders(tsquery, limit),
      this.searchProducts(tsquery, limit),
      this.searchCustomers(tsquery, limit),
    ]);

    return { orders, products, customers };
  }

  private async searchOrders(tsquery: string, limit: number) {
    type OrderRow = { id: string; displayId: string; total: number; status: string; customerName: string | null; phone: string | null };
    const rows = await this.prisma.$queryRawUnsafe<OrderRow[]>(
      `SELECT o.id, o.display_id AS "displayId", o.total::text AS total,
              os.name AS status,
              COALESCE(u.first_name || ' ' || u.last_name, o.guest_name) AS "customerName",
              COALESCE(u.phone_number, o.guest_phone) AS phone
       FROM orders o
       LEFT JOIN order_statuses os ON os.id = o.status_id
       LEFT JOIN users u ON u.id = o.customer_id
       WHERE o.fts @@ to_tsquery('simple', $1)
       ORDER BY ts_rank(o.fts, to_tsquery('simple', $1)) DESC
       LIMIT $2`,
      tsquery,
      limit
    );
    return rows.map(r => ({ ...r, total: Number(r.total) }));
  }

  private async searchProducts(tsquery: string, limit: number) {
    type ProductRow = { id: string; name: string; sku: string | null; price: number };
    const rows = await this.prisma.$queryRawUnsafe<ProductRow[]>(
      `SELECT id, name, sku, COALESCE(sale_price, base_price)::text AS price
       FROM products
       WHERE is_active = true AND fts @@ to_tsquery('simple', $1)
       ORDER BY ts_rank(fts, to_tsquery('simple', $1)) DESC
       LIMIT $2`,
      tsquery,
      limit
    );
    return rows.map(r => ({ ...r, price: Number(r.price) }));
  }

  private async searchCustomers(tsquery: string, limit: number) {
    type CustomerRow = { id: string; name: string; phone: string; email: string };
    const rows = await this.prisma.$queryRawUnsafe<CustomerRow[]>(
      `SELECT id,
              first_name || ' ' || last_name AS name,
              phone_number AS phone,
              email
       FROM users
       WHERE role = 'customer' AND fts @@ to_tsquery('simple', $1)
       ORDER BY ts_rank(fts, to_tsquery('simple', $1)) DESC
       LIMIT $2`,
      tsquery,
      limit
    );
    return rows;
  }
}
```

- [ ] **Step 3: Create SearchController**

`apps/backend/src/search/search.controller.ts`:
```ts
import { Controller, Get, Query, ValidationPipe } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

@Controller('admin/search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Roles('admin', 'manager', 'superadmin', 'cashier')
  @Get()
  async search(@Query(new ValidationPipe({ transform: true })) query: SearchQueryDto) {
    return this.searchService.search(query.q, query.limit ?? 5);
  }
}
```

- [ ] **Step 4: Create SearchModule**

`apps/backend/src/search/search.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [PrismaModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
```

---

### Task 3: Backend — Register SearchModule in AppModule

**Files:**
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Add import and module registration**

```ts
import { SearchModule } from './search/search.module';
```

Add `SearchModule` to the `imports` array in `@Module({...})`:
```ts
SearchModule,
```

- [ ] **Step 2: Verify the backend builds**

```bash
cd apps/backend && npx nest build
```

---

### Task 4: Backend — Tests for SearchController + SearchService

**Files:**
- Create: `apps/backend/src/search/search.service.spec.ts`
- Create: `apps/backend/src/search/search.controller.spec.ts`

- [ ] **Step 1: SearchService test**

`apps/backend/src/search/search.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { SearchService } from './search.service';

describe('SearchService', () => {
  let service: SearchService;
  const mockPrisma = {
    $queryRawUnsafe: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [SearchService, { provide: 'PrismaService', useValue: mockPrisma }],
    }).compile();
    service = module.get(SearchService);
  });

  it('returns empty results when nothing matches', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    const result = await service.search('zzz_no_match');
    expect(result).toEqual({ orders: [], products: [], customers: [] });
  });

  it('searches all three entity types in parallel', async () => {
    const mockOrder = { id: '1', displayId: 'ORD-1', total: 100, status: 'Pending', customerName: 'Test', phone: null };
    const mockProduct = { id: '2', name: 'Test Product', sku: 'TP-1', price: 50 };
    const mockCustomer = { id: '3', name: 'Test User', phone: '017...', email: 't@t.com' };

    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([mockOrder])
      .mockResolvedValueOnce([mockProduct])
      .mockResolvedValueOnce([mockCustomer]);

    const result = await service.search('test');

    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(3);
    expect(result.orders).toHaveLength(1);
    expect(result.products).toHaveLength(1);
    expect(result.customers).toHaveLength(1);
    expect(result.orders[0].displayId).toBe('ORD-1');
  });
});
```

- [ ] **Step 2: SearchController test**

`apps/backend/src/search/search.controller.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

describe('SearchController', () => {
  let controller: SearchController;
  const mockService = { search: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [{ provide: SearchService, useValue: mockService }],
    }).compile();
    controller = module.get(SearchController);
  });

  it('returns search results for a valid query', async () => {
    mockService.search.mockResolvedValue({ orders: [], products: [], customers: [] });
    const result = await controller.search({ q: 'test', limit: 5 });
    expect(mockService.search).toHaveBeenCalledWith('test', 5);
    expect(result).toEqual({ orders: [], products: [], customers: [] });
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd apps/backend && npx jest search
```

---

### Task 5: Frontend — Evolve SearchProvider with search state and API integration

**Files:**
- Modify: `apps/admin/src/context/search-provider.tsx`
- Modify: `apps/admin/src/context/search-provider.test.tsx`

- [ ] **Step 1: Rewrite SearchProvider**

`apps/admin/src/context/search-provider.tsx`:
```ts
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { CommandPalette } from '@/components/command-palette'

interface SearchResultItem {
  id: string
  displayId?: string
  name?: string
  total?: number
  status?: string
  customerName?: string
  phone?: string
  sku?: string
  price?: number
  email?: string
}

interface SearchResults {
  orders: SearchResultItem[]
  products: SearchResultItem[]
  customers: SearchResultItem[]
}

type SearchContextType = {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  query: string
  setQuery: React.Dispatch<React.SetStateAction<string>>
  results: SearchResults
  isLoading: boolean
  error: string | null
  recentSearches: string[]
  search: (q: string) => void
  clearRecentSearches: () => void
  addRecentSearch: (q: string) => void
}

const SearchContext = createContext<SearchContextType | null>(null)

const RECENT_SEARCHES_KEY = 'global-search-recent'
const MAX_RECENT = 5

function loadRecentSearches(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveRecentSearches(items: string[]) {
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(items))
}

type SearchProviderProps = {
  children: React.ReactNode
}

export function SearchProvider({ children }: SearchProviderProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>({ orders: [], products: [], customers: [] })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecentSearches)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults({ orders: [], products: [], customers: [] })
      setError(null)
    }
  }, [open])

  const search = (q: string) => {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (q.length < 2) {
      setResults({ orders: [], products: [], customers: [] })
      setError(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await apiClient.get<SearchResults>('/admin/search', {
          params: { q, limit: 5 },
        })
        setResults(res.data)
      } catch (err: any) {
        setError(err?.response?.data?.message || 'Search unavailable')
        setResults({ orders: [], products: [], customers: [] })
      } finally {
        setIsLoading(false)
      }
    }, 300)
  }

  const addRecentSearch = (q: string) => {
    setRecentSearches(prev => {
      const next = [q, ...prev.filter(s => s !== q)].slice(0, MAX_RECENT)
      saveRecentSearches(next)
      return next
    })
  }

  const clearRecentSearches = () => {
    setRecentSearches([])
    saveRecentSearches([])
  }

  return (
    <SearchContext
      value={{
        open,
        setOpen,
        query,
        setQuery,
        results,
        isLoading,
        error,
        recentSearches,
        search,
        clearRecentSearches,
        addRecentSearch,
      }}
    >
      {children}
      <CommandPalette />
    </SearchContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSearch = () => {
  const searchContext = useContext(SearchContext)
  if (!searchContext) {
    throw new Error('useSearch has to be used within SearchProvider')
  }
  return searchContext
}
```

- [ ] **Step 2: Update test placeholder constant**

The test references `COMMAND_MENU_PLACEHOLDER = 'Type a command or search...'`. The new CommandPalette uses the same placeholder. No change needed to the test constant, but other tests may need updating.

---

### Task 6: Frontend — Create GlobalSearchBar component

**Files:**
- Create: `apps/admin/src/components/global-search-bar.tsx`

- [ ] **Step 1: Create GlobalSearchBar**

`apps/admin/src/components/global-search-bar.tsx`:
```tsx
import { SearchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSearch } from '@/context/search-provider'
import { Button } from './ui/button'

export function GlobalSearchBar({
  className,
  ...props
}: React.ComponentProps<'button'>) {
  const { setOpen, open } = useSearch()

  return (
    <Button
      {...props}
      variant='outline'
      aria-expanded={open}
      aria-keyshortcuts='Meta+K Control+K'
      className={cn(
        'group relative h-8 w-full flex-1 justify-start rounded-md bg-muted/25 text-sm font-normal text-muted-foreground shadow-none hover:bg-accent sm:w-48 sm:pe-12 md:flex-none lg:w-64 xl:w-80',
        className
      )}
      onClick={() => setOpen(true)}
    >
      <SearchIcon
        aria-hidden='true'
        className='absolute inset-s-1.5 top-1/2 -translate-y-1/2'
        size={16}
      />
      <span className='ms-6 truncate'>Search orders, products, customers...</span>
      <kbd className='pointer-events-none absolute inset-e-[0.3rem] top-[0.3rem] hidden h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 select-none sm:flex'>
        <span className='text-xs'>⌘</span>K
      </kbd>
    </Button>
  )
}
```

---

### Task 7: Frontend — Create CommandPalette component

**Files:**
- Create: `apps/admin/src/components/command-palette.tsx`
- Read: `apps/admin/src/components/command-menu.tsx` (existing patterns to follow)
- Read: `apps/admin/src/components/layout/data/sidebar-data.ts` (navigation groups)

- [ ] **Step 1: Create CommandPalette**

`apps/admin/src/components/command-palette.tsx`:
```tsx
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
    query,
    setQuery,
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
    [setOpen]
  )

  const handleSelect = (type: 'order' | 'product' | 'customer', id: string, label: string) => {
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

  const hasApiResults = results.orders.length > 0 || results.products.length > 0 || results.customers.length > 0
  const showApiSection = query.length >= 2 && !isLoading && !error

  return (
    <CommandDialog modal open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder='Type a command or search...'
        value={query}
        onValueChange={search}
        autoFocus
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
              <span>No results found for &ldquo;{query}&rdquo;</span>
            </div>
          )}

          {/* API Results */}
          {showApiSection && hasApiResults && (
            <>
              {results.orders.length > 0 && (
                <CommandGroup heading='Orders'>
                  {results.orders.map(order => (
                    <CommandItem
                      key={`order-${order.id}`}
                      value={`order-${order.displayId}`}
                      onSelect={() => handleSelect('order', order.id, `#${order.displayId}`)}
                    >
                      <div className='flex w-full items-center justify-between gap-2'>
                        <div className='flex items-center gap-2 min-w-0'>
                          <ArrowRight className='size-3 shrink-0 text-muted-foreground/80' />
                          <span className='font-medium'>#{order.displayId}</span>
                          {order.customerName && (
                            <span className='text-muted-foreground truncate'>{order.customerName}</span>
                          )}
                        </div>
                        <div className='flex items-center gap-2 shrink-0'>
                          {order.total != null && (
                            <span className='text-xs tabular-nums'>{formatCurrency(order.total)}</span>
                          )}
                          {order.status && (
                            <span className='text-[10px] px-1.5 py-0.5 rounded-full bg-muted'>{order.status}</span>
                          )}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {results.products.length > 0 && (
                <CommandGroup heading='Products'>
                  {results.products.map(product => (
                    <CommandItem
                      key={`product-${product.id}`}
                      value={`product-${product.name}`}
                      onSelect={() => handleSelect('product', product.id, product.name || '')}
                    >
                      <div className='flex w-full items-center justify-between gap-2'>
                        <div className='flex items-center gap-2 min-w-0'>
                          <ArrowRight className='size-3 shrink-0 text-muted-foreground/80' />
                          <span className='truncate'>{product.name}</span>
                        </div>
                        <div className='flex items-center gap-2 shrink-0'>
                          {product.sku && (
                            <span className='text-[10px] text-muted-foreground'>{product.sku}</span>
                          )}
                          {product.price != null && (
                            <span className='text-xs tabular-nums'>{formatCurrency(product.price)}</span>
                          )}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {results.customers.length > 0 && (
                <CommandGroup heading='Customers'>
                  {results.customers.map(customer => (
                    <CommandItem
                      key={`customer-${customer.id}`}
                      value={`customer-${customer.name}`}
                      onSelect={() => handleSelect('customer', customer.id, customer.name || '')}
                    >
                      <div className='flex w-full items-center gap-2'>
                        <ArrowRight className='size-3 shrink-0 text-muted-foreground/80' />
                        <span>{customer.name}</span>
                        <span className='text-xs text-muted-foreground'>{customer.phone}</span>
                        {customer.email && (
                          <span className='text-xs text-muted-foreground hidden sm:inline'>{customer.email}</span>
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
                <span className='text-xs text-muted-foreground'>Clear recent searches</span>
              </CommandItem>
            </CommandGroup>
          )}

          {/* Navigation sections (always visible when no query) */}
          {query.length === 0 && !isLoading && !error && (
            <>
              {sidebarData.navGroups.map(group => (
                <CommandGroup key={group.title || 'nav'} heading={group.title}>
                  {group.items.map((navItem, i) => {
                    if (navItem.url) {
                      return (
                        <CommandItem
                          key={`nav-${navItem.url}-${i}`}
                          value={navItem.title}
                          onSelect={() => runCommand(() => navigate({ to: navItem.url }))}
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
                        onSelect={() => runCommand(() => navigate({ to: subItem.url }))}
                      >
                        <div className='flex size-4 items-center justify-center'>
                          <ArrowRight className='size-2 text-muted-foreground/80' />
                        </div>
                        {navItem.title} <ChevronRight className='size-3' /> {subItem.title}
                      </CommandItem>
                    ))
                  })}
                </CommandGroup>
              ))}
              <CommandSeparator />
              <CommandGroup heading='Theme'>
                <CommandItem onSelect={() => runCommand(() => setTheme('light'))}>
                  <Sun className='size-3' /> <span>Light</span>
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => setTheme('dark'))}>
                  <Moon className='size-3' /> <span>Dark</span>
                </CommandItem>
                <CommandItem onSelect={() => runCommand(() => setTheme('system'))}>
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
```

- [ ] **Step 2: Delete old command-menu.tsx**

```bash
rm apps/admin/src/components/command-menu.tsx
```

---

### Task 8: Frontend — Update SearchProvider test for new features

**Files:**
- Modify: `apps/admin/src/context/search-provider.test.tsx`

- [ ] **Step 1: Rewrite tests**

`apps/admin/src/context/search-provider.test.tsx` (full replacement):
```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SearchProvider } from '@/context/search-provider'

const COMMAND_PALETTE_PLACEHOLDER = 'Type a command or search...'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setTheme: vi.fn(),
  apiGet: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

vi.mock('@/context/theme-provider', () => ({
  useTheme: () => ({ setTheme: mocks.setTheme }),
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mocks.apiGet },
}))

type ShortcutModifier = 'Control' | 'Meta'

async function renderWithSearchProvider() {
  return await render(<SearchProvider>{null}</SearchProvider>)
}

async function openCommandPalette(
  screen: ReturnType<typeof render>,
  modifier: ShortcutModifier = 'Control'
) {
  await vi.waitFor(
    async () => {
      const isOpen = document.querySelector(`[placeholder="${COMMAND_PALETTE_PLACEHOLDER}"]`) !== null
      if (!isOpen) {
        await userEvent.keyboard(`{${modifier}>}k{/${modifier}}`)
      }
      await expect.element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER)).toBeInTheDocument()
    },
    { interval: 50, timeout: 5000 }
  )
}

describe('SearchProvider and CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders the command palette when opened via shortcut', async () => {
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    await expect.element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER)).toBeInTheDocument()
    await expect.element(screen.getByText('Theme')).toBeInTheDocument()
    await expect.element(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('does not show the dialog content when search is closed', async () => {
    const screen = await renderWithSearchProvider()
    await expect.element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER)).not.toBeInTheDocument()
  })

  it.each([
    ['Ctrl', 'Control'],
    ['Cmd', 'Meta'],
  ] as const)('opens when %s + K is pressed', async (_label, modifier) => {
    const screen = await renderWithSearchProvider()
    await expect.element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER)).not.toBeInTheDocument()
    await openCommandPalette(screen, modifier)
    await expect.element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER)).toBeInTheDocument()
  })

  it('navigates to a top-level route on nav item select', async () => {
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    await userEvent.click(screen.getByText('Tasks'))
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/tasks' })
    await expect.element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER)).not.toBeInTheDocument()
  })

  it('applies theme on theme command select', async () => {
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    await userEvent.click(screen.getByText('Dark'))
    expect(mocks.setTheme).toHaveBeenCalledWith('dark')
    await expect.element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER)).not.toBeInTheDocument()
  })

  it('calls API when user types a search query', async () => {
    mocks.apiGet.mockResolvedValue({ data: { orders: [], products: [], customers: [] } })
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    const input = screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER)
    await userEvent.fill(input, 'te')
    await vi.waitFor(() => {
      expect(mocks.apiGet).toHaveBeenCalledWith('/admin/search', expect.any(Object))
    })
  })

  it('shows API results in categorized sections', async () => {
    mocks.apiGet.mockResolvedValue({
      data: {
        orders: [{ id: '1', displayId: 'ORD-1', total: 100, status: 'Pending', customerName: 'Test', phone: null }],
        products: [{ id: '2', name: 'Phone', sku: 'PH-1', price: 500 }],
        customers: [{ id: '3', name: 'John', phone: '017...', email: 'j@t.com' }],
      },
    })
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    await userEvent.fill(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER), 'test')
    await vi.waitFor(() => expect(screen.getByText('#ORD-1')).toBeInTheDocument())
    await expect.element(screen.getByText('Phone')).toBeInTheDocument()
    await expect.element(screen.getByText('John')).toBeInTheDocument()
  })

  it('shows empty state when API returns nothing', async () => {
    mocks.apiGet.mockResolvedValue({ data: { orders: [], products: [], customers: [] } })
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    await userEvent.fill(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER), 'zzzzz')
    await vi.waitFor(() => expect(screen.getByText(/No results found/)).toBeInTheDocument())
  })

  it('shows error state on API failure', async () => {
    mocks.apiGet.mockRejectedValue(new Error('Network error'))
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    await userEvent.fill(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER), 'test')
    await vi.waitFor(() => expect(screen.getByText('Search unavailable')).toBeInTheDocument())
  })
})
```

---

### Task 9: Frontend — Replace Search with GlobalSearchBar in all pages

**Files:**
- Modify (20 files): Each feature page that uses `<Search />` → `<GlobalSearchBar />`

Files to modify:

| # | File | Change |
|---|------|--------|
| 1 | `apps/admin/src/features/dashboard/components/DashboardWrapper.tsx` | `import { Search }` → `import { GlobalSearchBar }`; `<Search` → `<GlobalSearchBar` |
| 2 | `apps/admin/src/features/tasks/index.tsx` | same |
| 3 | `apps/admin/src/features/users/index.tsx` | same |
| 4 | `apps/admin/src/features/products/index.tsx` | same |
| 5 | `apps/admin/src/features/orders/index.tsx` | same |
| 6 | `apps/admin/src/features/orders/incomplete-leads.tsx` | same |
| 7 | `apps/admin/src/features/inventory/index.tsx` | same |
| 8 | `apps/admin/src/features/categories/index.tsx` | same |
| 9 | `apps/admin/src/features/tags/index.tsx` | same |
| 10 | `apps/admin/src/features/attributes/index.tsx` | same |
| 11 | `apps/admin/src/features/size-charts/index.tsx` | same |
| 12 | `apps/admin/src/features/combos/index.tsx` | same |
| 13 | `apps/admin/src/features/coupons/index.tsx` | same |
| 14 | `apps/admin/src/features/payments/index.tsx` | same |
| 15 | `apps/admin/src/features/refunds/index.tsx` | same |
| 16 | `apps/admin/src/features/shipments/index.tsx` | same |
| 17 | `apps/admin/src/features/settings/index.tsx` | same |
| 18 | `apps/admin/src/features/chats/index.tsx` | same |
| 19 | `apps/admin/src/features/apps/index.tsx` | same |
| 20 | `apps/admin/src/routes/_authenticated/errors/$error.tsx` | same |

Pattern for each file:
```tsx
// Import change:
// Remove: import { Search } from '@/components/search'
// Add:    import { GlobalSearchBar } from '@/components/global-search-bar'

// JSX change:
// Remove: <Search className='me-auto' />
// Add:    <GlobalSearchBar className='me-auto' />
```

- [ ] **Step 1-20: Update each file sequentially**, verifying the import and JSX change per file.

---

### Task 10: Frontend — Remove old Search component, verify build

**Files:**
- Delete: `apps/admin/src/components/search.tsx`

- [ ] **Step 1: Delete search.tsx**

```bash
rm apps/admin/src/components/search.tsx
```

- [ ] **Step 2: Verify frontend builds**

```bash
cd apps/admin && npx tsc --noEmit
```

- [ ] **Step 3: Verify tests pass**

```bash
cd apps/admin && npx vitest run --reporter=verbose 2>&1 | tail -40
```

---

### Task 11: End-to-end verification

- [ ] **Step 1: Start backend dev server**

```bash
cd apps/backend && npm run start:dev
```

- [ ] **Step 2: Start admin dev server**

```bash
cd apps/admin && npm run dev
```

- [ ] **Step 3: Manual verification checklist**

1. Open admin → see search bar in header with "Search orders, products, customers..."
2. Press Cmd+K → palette opens with navigation + theme
3. Type an order ID (e.g. "ORD-1024") → see order result with ID, status, total
4. Type a product name → see product results with name, SKU, price
5. Type a customer name/phone → see customer results
6. Click a result → navigates to correct detail page
7. Check recent searches appear when palette reopens with empty input
8. Type gibberish → see "No results found" state
9. Disconnect backend → see error state with retry button
10. Verify keyboard navigation (↑↓ arrows, Enter, Esc)

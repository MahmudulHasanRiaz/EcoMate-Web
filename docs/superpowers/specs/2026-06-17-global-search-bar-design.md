# Global Search Bar Design

## Overview
Upgrade the admin app's header search from a navigation-only Cmd+K palette to a hybrid global search bar. Users see a sleek search bar in the header; focusing it opens a powerful overlay that searches Orders (by ID, phone), Products (by name, SKU), and Customers (by name, phone, email) via Postgres Full-Text Search — all while keeping the existing Cmd+K navigation and quick actions.

## Routes
- Header search bar: present on **all authenticated pages** (`_authenticated` layout)
- No new routes. Search results navigate to existing detail pages:
  - Order → `/op/orders/:id`
  - Product → `/op/products/:id`
  - Customer → `/op/customers/:id`

## Architecture

```
AuthenticatedLayout
  -> SearchProvider (context + Cmd+K listener)
       -> GlobalSearchBar (header input/button)
       -> CommandPalette (overlay/dialog)
  -> API: GET /api/admin/search?q=...
       -> Postgres FTS (tsvector + GIN index)
```

### Data Flow
1. User types in search bar (or presses Cmd+K)
2. CommandPalette opens with auto-focused input
3. 300ms debounce → API call `GET /api/admin/search?q=<term>&limit=5`
4. Backend runs 3 parallel FTS queries (orders, products, customers)
5. Results rendered in categorized sections
6. On select → navigate to detail page + close palette + save to recent searches

## Backend: Postgres Full-Text Search

### FTS Column Setup
Add a `tsvector` column to each table with a GIN index:

```sql
-- Orders: search by display_id, phone, customer_name
ALTER TABLE orders ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(display_id,'') || ' ' ||
                coalesce(phone,'') || ' ' ||
                coalesce(customer_name,''))
  ) STORED;
CREATE INDEX orders_fts_idx ON orders USING GIN(fts);

-- Products: search by name, sku
ALTER TABLE products ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(name,'') || ' ' ||
                coalesce(sku,''))
  ) STORED;
CREATE INDEX products_fts_idx ON products USING GIN(fts);

-- Customers: search by name, phone, email
ALTER TABLE customers ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(name,'') || ' ' ||
                coalesce(phone,'') || ' ' ||
                coalesce(email,''))
  ) STORED;
CREATE INDEX customers_fts_idx ON customers USING GIN(fts);
```

Use `'simple'` dictionary (not `'english'`) so order IDs like `ORD-1024` and phone numbers are not stemmed.

### API Endpoint: `GET /api/admin/search?q=<term>&limit=5`

**Response shape:**
```json
{
  "orders": [
    { "id": "abc123", "displayId": "ORD-1024", "total": 45000, "status": "pending", "customerName": "Riaz Ahmed", "phone": "017..." }
  ],
  "products": [
    { "id": "xyz789", "name": "iPhone 15 Pro", "sku": "IP15P-BLK", "price": 99900 }
  ],
  "customers": [
    { "id": "u456", "name": "Riaz Ahmed", "phone": "017...", "email": "riaz@example.com" }
  ]
}
```

**Query pattern (orders example):**
```sql
SELECT id, display_id AS "displayId", total, status,
       customer_name AS "customerName", phone,
       ts_rank(fts, plainto_tsquery('simple', $1)) AS rank
FROM orders
WHERE fts @@ plainto_tsquery('simple', $1)
ORDER BY rank DESC
LIMIT $2;
```

Run 3 queries in parallel (application-level concurrency, not DB-level).

**Empty query (`q` blank or < 2 chars):** Return empty arrays + recent searches from frontend.

## Frontend Components

### 1. GlobalSearchBar (replaces current Search button)
- Location: `apps/admin/src/components/global-search-bar.tsx`
- Visually an `<Input>`-like button: SearchIcon, placeholder "Search orders, products, customers...", Cmd+K badge
- Sits in Header: `<GlobalSearchBar className="me-auto" />`
- Props: extends `React.ComponentProps<'button'>`
- On click/focus → opens CommandPalette
- `aria-expanded` reflects palette state
- Remove old `Search` component from header in all pages

### 2. CommandPalette (replaces current CommandMenu)
- Location: `apps/admin/src/components/command-palette.tsx`
- cmdk-based overlay (`CommandDialog`)
- States:

| State | Behaviour |
|-------|-----------|
| **Idle** (empty input) | Recent Searches section + Quick Actions (New Order, New Product) + Theme switcher |
| **Loading** | Skeleton placeholders per category (3 lines each) |
| **Results** | Categorized: Orders → Products → Customers → Quick Actions → Theme |
| **No results** | "No results found for '{query}'" |
| **Error** | "Search unavailable" + Retry button |

### 3. SearchContext (evolve existing SearchProvider)
- Location: `apps/admin/src/context/search-provider.tsx`
- Add state: `query`, `results`, `isLoading`, `error`, `recentSearches`
- Store recent searches (max 5) in localStorage
- Add `search(query)` action with 300ms debounce + API call
- Cmd+K toggles palette (unchanged)

## Entity Display in Results

| Entity | Fields shown | Navigation target | Badge |
|--------|-------------|-------------------|-------|
| **Order** | `#{displayId}`, customerName, total (currency), status | `/op/orders/:id` | Status badge (pending/shipped/etc) |
| **Product** | Name, SKU, price (currency) | `/op/products/:id` | — |
| **Customer** | Name, phone, email | `/op/customers/:id` | — |

## Keyboard Navigation

| Key | Action |
|-----|--------|
| `Cmd+K` / `Ctrl+K` | Toggle palette |
| `Esc` | Close palette |
| `↑` / `↓` | Navigate results |
| `Enter` | Select highlighted item |
| `Tab` | Move between result sections (optional) |

## States Summary

**Search Bar (Header):**
- Default: Sleek button with "Search..." placeholder
- Active: On click → palette opens
- Disabled: N/A (always available)

**CommandPalette (Overlay):**
- Empty/Idle: Recent Searches + Quick Actions + Theme
- Loading: Spinner per section
- Results: Categorized list
- No Results: Message with query shown
- Error: Error message + retry

## Migration
- Remove old `command-menu.tsx` component
- Remove old `Search` component from **all 20 page headers** → replace with single `<GlobalSearchBar />`
- Evolving `SearchProvider` but keeping the same context name — add new state without breaking existing consumers
- `orders-page.test.tsx`: remove the `vi.mock('@/components/config-drawer')` line (already done) + update to mock `GlobalSearchBar` if needed

## Future Considerations (out of scope)
- Typo tolerance (pg_trgm extension for similarity search)
- Search analytics dashboard
- "Quick action" extensibility (custom commands per role)
- Real-time updates via WebSocket

# Product Management: Creation & Duplication Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all gaps in product creation and duplication flows — frontend bugs, missing validation, error handling, UX issues, and backend gaps — without introducing production instability.

**Architecture:** Four-phase approach — Phase 1 (zero-risk frontend), Phase 2 (low-risk bug fixes), Phase 3 (backend changes — requires sign-off), Phase 4 (enhancements). No schema migrations needed.

**Tech Stack:** React 19 (admin), NestJS 11 (backend), Prisma 7, TanStack Query/Router, Vitest/Playwright

## Global Constraints

- Any backend endpoint change must preserve existing API contracts.
- No Prisma schema migrations required (all gaps are app-layer).
- Follow existing patterns in admin: `apiClient` for HTTP, TanStack Query for server state.
- Existing `handleDuplicate` in index.tsx is the sole duplication entry point — all duplication fixes touch it or the form.
- No floating-point for money (use Prisma Decimal).
- Follow admin rules from `.claude/rules/admin.md`.

## Business Rules (from stakeholder)

- **Duplication = shortcut for product creation.** It's a quick way to create a new product with similar settings, not a perfect clone.
- **Stock is NEVER carried over on duplicate.** Whether MANAGED_STOCK or INVENTORY_CONTROLLED, stock always starts at 0. User adds stock after creation.
- **Combo products' stock is from children.** No special duplication handling needed for combo stock since combo items' stock derives from child products.
- **Variant SKUs should be unique and clean.** Regeneration during duplication must use the new product's modified SKU to avoid collisions with the original.


---

## Risk Classification

| Tier | Label | Meaning | Examples |
|------|-------|---------|----------|
| 🟢 | Zero-risk | Frontend-only, no behavior change | Text, UI state, error display |
| 🟡 | Low-risk | Logic change but easily revertible | Bug fix in state management |
| 🟠 | Moderate-risk | Backend change, new endpoint | New API, validation rule |
| 🔴 | High-risk | Destructive or data-affecting | Delete endpoint, schema change |

**Items marked 🔴 or 🟠 require your explicit sign-off before implementation.**

---

## File Map

All locations relative to `apps/` unless prefixed.

| Role | File | Responsibility |
|------|------|---------------|
| Initiate | `admin/src/features/products/index.tsx` | `handleDuplicate`, wiring |
| Columns | `admin/src/features/products/components/products-columns.tsx` | Duplicate button |
| Table | `admin/src/features/products/components/products-table.tsx` | Prop passthrough |
| Form | `admin/src/features/products/components/product-form.tsx` | Clone logic, variants, save |
| API | `admin/src/features/products/api.ts` | HTTP client, types |
| API | `admin/src/features/products/hooks.ts` | Query hooks |
| Controller | `backend/src/products/products.controller.ts` | REST endpoints |
| Service | `backend/src/products/products.service.ts` | Business logic |
| DTO | `backend/src/products/dto/product.dto.ts` | Validation rules |
| Filter | `backend/src/common/filters/global-exception.filter.ts` | Error formatting |
| Schema | `backend/prisma/schema.prisma` | Data model (no changes) |

---

## Phase 1: Zero-Risk Frontend Fixes 🟢

These are UI-only changes — no API calls modified, no backend changes. Can be deployed independently.

### Task 1.1: Fix dialog title during duplication

**Files:**
- Modify: `admin/src/features/products/index.tsx:276-281`
- Modify: `admin/src/features/products/components/product-form.tsx:35,653`

**Problem (#7):** Dialog always shows "Add New Product" even during duplication.

**Fix:**
- In `index.tsx`, pass `formMode` (including a new `'duplicate'` value) instead of always `'add'`
- Or simpler: pass a `isDuplicate` boolean prop to `ProductForm`
- In `ProductForm`, show "Duplicate Product" when mode is duplicate:

```tsx
// index.tsx:279
currentRow={formMode === 'edit' ? editRow : duplicateSourceRow || undefined}
mode={formMode === 'edit' ? 'edit' : duplicateSourceRow ? 'duplicate' : 'add'}
```

```tsx
// product-form.tsx:35
type Props = { open: boolean; onOpenChange: (v: boolean) => void; currentRow?: ProductResponse; mode: 'add' | 'edit' | 'duplicate' }

// product-form.tsx:39
const isEdit = mode === 'edit'
const isDuplicate = mode === 'duplicate'
```

```tsx
// product-form.tsx:653
<DialogTitle>
  {isEdit ? `Edit: ${currentRow?.name}` : isDuplicate ? `Duplicate: ${currentRow?.name}` : 'Add New Product'}
</DialogTitle>
```

**Validation:** Open duplicate → title shows "Duplicate: [product name]". Open add → "Add New Product". Open edit → "Edit: [product name]".

### Task 1.2: Stock starts at 0 on duplication (business rule)

**Files:**
- Modify: `admin/src/features/products/index.tsx:148-155`
- Modify: `admin/src/features/products/components/product-form.tsx:830-842`

**Problem (#9):** During duplication, stock from original product was carried over. Per business rule, duplicate = quick creation — stock must start at 0.

**Fix:**
- In `handleDuplicate`, add `managedStockQuantity: 0` to the source row override
- In the form, detect duplication and show stock as 0 with appropriate messaging:

```tsx
// In handleDuplicate (index.tsx)
setDuplicateSourceRow({
  ...source,
  name: `Copy of ${source.name}`,
  slug: `${source.slug}-copy-${Date.now()}`,
  managedStockQuantity: 0, // ← stock always 0 on duplicate
})

// Inside the NON-edit Managed Stock block (~line 830-842):
) : isDuplicate ? (
  <div className='flex flex-col sm:flex-row items-start sm:items-center gap-6'>
    <div className='space-y-1.5 w-full sm:w-40'>
      <Label>Low Stock Alert</Label>
      <Input type='number' value={lowStockQty} onChange={e => setLowStockQty(e.target.value)} placeholder='5' />
    </div>
    <div className='flex-1 bg-muted/30 border rounded-md px-3 py-2'>
      <p className='text-xs text-muted-foreground'>
        Stock starts at 0. Use <strong>Inventory &gt; Stock</strong> to add stock after creation.
      </p>
    </div>
  </div>
) : (
  <div className='flex flex-col ...'>
    {/* existing "Starting stock cannot be set here" block */}
  </div>
)
```

### Task 1.3: Clean "Copy of" name stacking

**Files:**
- Modify: `admin/src/features/products/index.tsx:148-162`

**Problem (#29):** Repeated duplication creates "Copy of Copy of Copy of Product Name".

**Fix:**
- In `handleDuplicate`, strip existing "Copy of" prefixes before adding new one:

```tsx
// index.tsx - inside handleDuplicate
const cleanName = source.name.replace(/^(Copy of\s*)+/i, '')
const copyIndex = source.name.match(/\(copy (\d+)\)$/)?.[1]
const nextIndex = copyIndex ? parseInt(copyIndex) + 1 : 2
const newName = nextIndex > 1 ? `${cleanName} (copy ${nextIndex})` : `Copy of ${cleanName}`
```

This produces: "Product" → "Copy of Product" → "Product (copy 2)" → "Product (copy 3)"

### Task 1.4: Cleaner variant SKU on duplication

**Files:**
- Modify: `admin/src/features/products/components/product-form.tsx:192-198`

**Problem (#18):** Variant SKUs become `ORIGINAL-SKU-RED-XL-copy-1700000000000`.

**Fix:**
- Generate cleaner variant SKUs using a shorter suffix and simpler format:

```tsx
// line 192-198
if (isDuplicate) {
  const dupSuffix = `-CP${Date.now().toString(36).toUpperCase()}`
  setLocalVariants(currentRow.variants?.map((v: any) => ({
    ...v,
    id: undefined,
    productId: undefined,
    sku: v.sku ? `${v.sku}${dupSuffix}` : '',
  })) || [])
}
```

This produces: `SKU-RED-XL-CP1A2B3C4` instead of `SKU-RED-XL-copy-1709876543210`.

### Task 1.5: Add field highlight on slug conflict

**Files:**
- Modify: `admin/src/features/products/components/product-form.tsx:266-272,706-709`

**Problem (#24):** After backend slug conflict error, no field-level error shown.

**Fix:**
- Track slug field error state and show error styling:

```tsx
// Add state
const [slugError, setSlugError] = useState('')

// In handleBackendError
if (typeof msg === 'string' && msg.toLowerCase().includes('slug')) {
  setSlugError(msg)
  setTab('general')
  toast.error(msg)
  return
}

// In slug input JSX (~line 706-709)
<div className='space-y-1.5'>
  <Label>Slug</Label>
  <Input
    value={slug}
    onChange={e => { setSlug(e.target.value); setSlugError('') }}
    placeholder='product-slug'
    className={slugError ? 'border-destructive' : ''}
  />
  {slugError && <p className='text-xs text-destructive'>{slugError}</p>}
</div>
```

### Task 1.6: Add inline slug/SKU existence validation UI (frontend placeholder)

**Files:**
- Modify: `admin/src/features/products/components/product-form.tsx:704-709,732-735`

**Problem (#22 frontend portion):** No visual indicator that slug/SKU is being checked.

**Fix:**
- Add loading state and visual indicator for slug/SKU checking (the actual API endpoint comes in Phase 3):

```tsx
// Add state
const [slugChecking, setSlugChecking] = useState(false)
const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null)
const [skuChecking, setSkuChecking] = useState(false)
const [skuAvailable, setSkuAvailable] = useState<boolean | null>(null)

// In slug input, debounce onChange to call check endpoint (when available)
// For Phase 1: just add the UI skeleton without the API call
```

For Phase 1, add the debounce hook structure. The actual API call will be wired in Phase 3.

---

## Phase 2: Low-Risk Bug Fixes 🟡

These change logic but are frontend-only and easily revertible.

### Task 2.1: Modify parent SKU during duplication

**Files:**
- Modify: `admin/src/features/products/index.tsx:148-162`

**Problem (#16):** Duplicated product keeps the same SKU as original.

**Fix:**
- Generate a new SKU for the duplicated product:

```tsx
// In handleDuplicate (index.tsx)
const newSku = source.sku
  ? `${source.sku}-CP${Date.now().toString(36).toUpperCase()}`
  : undefined

setDuplicateSourceRow({
  ...source,
  name: `Copy of ${cleanName}`,
  slug: `${source.slug}-copy-${Date.now()}`,
  sku: newSku, // ← ADD THIS
})
```

**Validation:** After duplication, created product has unique SKU.

### Task 2.2: Fix variant regenerate SKU collision

**Files:**
- Modify: `admin/src/features/products/components/product-form.tsx:459-491`

**Problem (#17):** Regenerating variants during duplication produces SKUs matching original product's variants.

**Fix:**
- In the local generation path, use the new product SKU (which now has `-CP...` suffix):

```tsx
// In handleGenerateVariants local mode branch (~line 459-491)
const effectiveSku = sku || 'PRD'
// The sku now has -CP suffix because Task 2.1 modified it
const fullSku = `${effectiveSku}-${values.join('-').replace(...)}`
```

This works automatically after Task 2.1 because `sku` in the form state will have the `-CP` suffix.

### Task 2.3: Fix stale variant SKU when parent SKU changes

**Files:**
- Modify: `admin/src/features/products/components/product-form.tsx:` around line 704

**Problem (#20):** If user changes product SKU after generating variants locally, variant SKUs still have old prefix.

**Fix:**
- Add effect to update local variant SKUs when parent SKU changes:

```tsx
// Add after line 214 (the type change effect)
const prevSku = useRef(sku)
useEffect(() => {
  if (isLocalMode && sku !== prevSku.current && localVariants.length > 0) {
    setLocalVariants(prev => prev.map(v => ({
      ...v,
      sku: v.sku.replace(new RegExp(`^${escapeRegex(prevSku.current)}`), sku),
    })))
  }
  prevSku.current = sku
}, [sku])
```

### Task 2.4: Fix validation messages lost in error handler

**Files:**
- Modify: `admin/src/features/products/components/product-form.tsx:266-272`

**Problem (#21):** Array validation messages from NestJS show as generic "An error occurred".

**Fix:**
- Handle both string and array message formats:

```tsx
const handleBackendError = (e: any) => {
  const raw = e.response?.data?.message
  // Handle array from ValidationPipe, string from HttpException
  const msg = Array.isArray(raw) ? raw.join('. ') : raw || 'Error'
  const code = e.response?.data?.statusCode

  if (code === 409 || (typeof raw === 'string' && raw.toLowerCase().includes('slug'))) {
    setSlugError(typeof raw === 'string' ? raw : 'This slug is already taken')
    setTab('general')
  }

  toast.error(typeof msg === 'string' ? msg : 'An error occurred')
}
```

### Task 2.5: Unify error handling across all mutations

**Files:**
- Modify: `admin/src/features/products/components/product-form.tsx:291-351`

**Problem (#25):** Three different error handling patterns create inconsistent UX.

**Fix:**
- Replace all inline `onError` handlers with `handleBackendError`:

```tsx
// Before (line 313):
onError: (e: any) => toast.error(e.response?.data?.message || 'Error'),

// After:
onError: handleBackendError,
```

Apply to: `genVariantMut`, `updateVariantMut`, `reorderVariantsMut`, `addAttrValueMut`, `upsertOverrideMut`.

### Task 2.6: Fix rapid duplicate slug collision

**Files:**
- Modify: `admin/src/features/products/index.tsx:148-162`

**Problem (#6):** `Date.now()` millisecond precision can collide.

**Fix:**
- Add random component to slug:

```tsx
slug: `${source.slug}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
```

### Task 2.7: Add "Clear All Variants" button (local mode)

**Files:**
- Modify: `admin/src/features/products/components/product-form.tsx:1063-1110`

**Problem (#19 local):** No way to clear all locally-generated variants.

**Fix:**
- Add a "Clear All" button next to "Bulk Update" in the variants header:

```tsx
// In the variants header section (~line 1068)
<div className='flex items-center gap-2'>
  {isLocalMode && localVariants.length > 0 && (
    <Button
      variant='outline'
      size='sm'
      onClick={() => {
        setLocalVariants([])
        toast.success('All variants cleared')
      }}
    >
      <Trash2 className='h-4 w-4 mr-1.5' />
      Clear All
    </Button>
  )}
  <Button variant='outline' size='sm' onClick={() => setBulkUpdateOpen(true)} disabled={variantList.length === 0}>
    Bulk Update
  </Button>
</div>
```

---

## Phase 3: Backend Changes 🟠🔴 — Requires Sign-Off

These involve new endpoints, backend logic, or validation rules. Each item includes a **Risk Explanation** block. **Do not implement without your approval.**

### Task 3.1: Add `POST /products/:id/duplicate` endpoint

**Files:**
- Create: `backend/src/products/dto/duplicate-product.dto.ts`
- Modify: `backend/src/products/products.controller.ts` — add route
- Modify: `backend/src/products/products.service.ts` — add `duplicate()` method

**Risk Explanation for #1+#11:**

> **What changes:** New POST endpoint `POST /products/:id/duplicate` that reads a product by ID and creates a copy server-side in one atomic transaction.
>
> **Risk:** Low — this is a NEW endpoint that doesn't modify any existing endpoint or behavior. The existing GET→modify→POST client-side flow continues to work untouched. The new endpoint only adds data (INSERT), never deletes or updates existing records. The atomic transaction ensures no partial state. Main risk is implementation bugs in the deep-clone logic (variants, tags, images) which could produce inconsistent copies.
>
> **If things go wrong:** Worst case: a malformed duplicate is created. It can be deleted via existing delete endpoint. No existing data is affected.
>
> **Rollback:** Revert the controller route and service method. Existing client-side flow carries on.

**Only proceed if you approve this risk.**

```ts
// dto/duplicate-product.dto.ts
import { IsOptional, IsString, MinLength } from 'class-validator'

export class DuplicateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string // optional override; defaults to "Copy of {original}"

  @IsOptional()
  @IsString()
  slug?: string // optional override; auto-generated if omitted
}
```

```ts
// controller
@Roles('superadmin', 'admin', 'manager')
@RequiresFeature('admin_products')
@Post(':id/duplicate')
duplicate(@Param('id') id: string, @Body() dto: DuplicateProductDto) {
  return this.svc.duplicate(id, dto)
}
```

```ts
// Service method — expand on existing create() logic
async duplicate(id: string, dto: DuplicateProductDto) {
  const source = await this.findOne(id) // reuse existing findOne
  const newSlug = dto.slug || `${source.slug}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const newName = dto.name || `Copy of ${source.name}`

  const createDto: CreateProductDto = {
    name: newName,
    slug: newSlug,
    type: source.type,
    description: source.description,
    shortDesc: source.shortDesc,
    basePrice: Number(source.basePrice),
    salePrice: source.salePrice ? Number(source.salePrice) : undefined,
    sku: source.sku ? `${source.sku}-CP${Date.now().toString(36).toUpperCase()}` : undefined,
    managedStockQuantity: source.type === 'variable' ? 0 : source.managedStockQuantity,
    lowStockQty: source.lowStockQty || undefined,
    categoryId: source.categoryId || undefined,
    brandId: source.brandId || undefined,
    categoryIds: source.productCategories?.map((pc: any) => pc.categoryId) || undefined,
    tags: source.tags || [],
    images: source.images || [],
    seoMeta: source.seoMeta || {},
    isFeatured: source.isFeatured,
    isActive: source.isActive,
    availabilityMode: source.availabilityMode,
    standardCost: source.standardCost ? Number(source.standardCost) : undefined,
    sizeChartId: source.sizeChartId || undefined,
    variants: source.type === 'variable' && source.variants
      ? source.variants.map((v: any) => ({
          sku: `${v.sku}-CP${Date.now().toString(36).toUpperCase()}`,
          price: Number(v.price || source.basePrice),
          salePrice: v.salePrice ? Number(v.salePrice) : undefined,
          managedStockQuantity: v.managedStockQuantity || 0,
          standardCost: v.standardCost ? Number(v.standardCost) : undefined,
          image: v.image || undefined,
          images: v.images || [],
          attributeValues: v.attributeValues?.map((av: any) => ({
            attributeValueId: av.attributeValue?.id || av.attributeValueId,
          })) || [],
        }))
      : undefined,
  }

  const result = await this.create(createDto)

  // Update ledger note to indicate duplication
  await this.prisma.managedStockLedger.updateMany({
    where: { productId: result.id, type: 'INITIAL' },
    data: { note: `Initial stock from duplicate of ${id}` },
  })

  return result
}
```

### Task 3.2: Update ledger note for duplicate detection

**Files:**
- Modify: `backend/src/products/products.service.ts:737`

**Risk Explanation for #5:**

> **What changes:** Change the ledger note text in `create()` from hardcoded `'Initial stock on product creation'` to accept a custom note parameter.
>
> **Risk:** Negligible. It's a text string change in audit trail data. No logic change. No schema change. Ledger data is append-only.
>
> **Rollback:** Revert the one line.

**Only proceed if you approve this risk.**

```ts
// Accept optional note parameter
async create(dto: CreateProductDto, stockNote?: string) {
  // ...
  await this.prisma.managedStockLedger.create({
    data: {
      // ...
      note: stockNote || 'Initial stock on product creation',
      // ...
    },
  })
}
```

### Task 3.3: Add variant SKU/slug existence check endpoints

**Files:**
- Modify: `backend/src/products/products.controller.ts — add routes`
- Modify: `backend/src/products/products.service.ts — add methods`
- Modify: `admin/src/features/products/components/product-form.tsx — wire up`

**Risk Explanation for #22+#23:**

> **What changes:** Two new read-only GET endpoints:
> - `GET /products/check-slug/:slug` — returns `{ available: boolean }`
> - `GET /products/check-sku/:sku?excludeId=:id` — returns `{ available: boolean }` (excludeId to exclude current product on edit)
>
> **Risk:** Very low. Read-only endpoints. No mutations. Standard pattern for uniqueness checks. The `excludeId` parameter prevents false positives during edit. These are called on debounced input, not on every keystroke.
>
> **If things go wrong:** Worst case: a race condition where check says available but another request claims it first. This is already handled by the backend's ConflictException on create/update. The check is a UX improvement, not a guarantee.
>
> **Rollback:** Remove the routes.

**Only proceed if you approve this risk.**

```ts
// controller
@Public()
@Get('check-slug/:slug')
checkSlug(@Param('slug') slug: string) {
  return this.svc.checkSlugAvailability(slug)
}

@Public()
@Get('check-sku/:sku')
checkSku(@Param('sku') sku: string, @Query('excludeId') excludeId?: string) {
  return this.svc.checkSkuAvailability(sku, excludeId)
}
```

```ts
// service
async checkSlugAvailability(slug: string) {
  const existing = await this.prisma.product.findUnique({ where: { slug }, select: { id: true } })
  return { available: !existing }
}

async checkSkuAvailability(sku: string, excludeId?: string) {
  // Check product-level SKU
  const productWithSku = await this.prisma.product.findFirst({
    where: { sku, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  })
  if (productWithSku) return { available: false }

  // Check variant-level SKU
  const variantWithSku = await this.prisma.productVariant.findUnique({
    where: { sku },
    select: { id: true },
  })
  return { available: !variantWithSku }
}
```

**Frontend wiring** (in product-form.tsx):

```tsx
// Debounced slug check
useEffect(() => {
  if (!slug || slug.length < 2) { setSlugAvailable(null); return }
  const timer = setTimeout(async () => {
    setSlugChecking(true)
    try {
      const res = await apiClient.get(`/products/check-slug/${encodeURIComponent(slug)}`)
      setSlugAvailable(res.data.available)
    } catch { setSlugAvailable(null) }
    setSlugChecking(false)
  }, 500)
  return () => clearTimeout(timer)
}, [slug])

// In slug input JSX
<Input ... />
{slugChecking && <Loader2 className='h-3 w-3 animate-spin' />}
{!slugChecking && slugAvailable === false && (
  <p className='text-xs text-destructive'>Slug already taken</p>
)}
{!slugChecking && slugAvailable === true && (
  <p className='text-xs text-green-600'>Available</p>
)}
```

### Task 3.4: Add "Clear All Variants" button (API mode)

**Files:**
- Modify: `backend/src/products/products.controller.ts — add route`
- Modify: `backend/src/products/products.service.ts — add method`
- Modify: `admin/src/features/products/components/product-form.tsx — add button`

**Risk Explanation for #19 API-mode:**

> **What changes:** New endpoint `DELETE /products/:id/variants` that deletes all variants of a product. A confirm dialog warns the user. Requires manager+ role.
>
> **Risk:** Moderate — this is a **destructive** operation (bulk delete). Risk is mitigated by: (1) role-gated (manager+), (2) requires feature flag, (3) frontend shows confirmation dialog, (4) the existing `generateVariants` already does `deleteMany` on variants, so this isn't a new capability — just exposing it as a standalone action. Also, the check for existing order items (from `generateVariants`) prevents deleting variants that have orders.
>
> **If things go wrong:** Variants with order items are blocked from deletion (same guard as generateVariants). For un-ordered variants, deletion is safe — variants can be recreated via generateVariants.
>
> **Rollback:** Revert the route and service method.

**Only proceed if you approve this risk.**

```ts
// controller
@Roles('superadmin', 'admin', 'manager')
@RequiresFeature('admin_products')
@Delete(':id/variants')
removeAllVariants(@Param('id') id: string) {
  return this.svc.removeAllVariants(id)
}
```

```ts
// service
async removeAllVariants(productId: string) {
  const existingOrderItems = await this.prisma.orderItem.findFirst({
    where: { variant: { productId } },
    select: { id: true },
  })
  if (existingOrderItems) {
    throw new BadRequestException(
      'Cannot remove variants — product has existing orders linked to current variants.',
    )
  }

  await this.prisma.productVariant.deleteMany({ where: { productId } })
  await this.prisma.product.update({
    where: { id: productId },
    data: { type: 'simple', managedStockQuantity: 0, manageStock: true },
  })
  await this.cache.invalidateByPrefix('product:')
  return { message: 'All variants removed. Product reset to simple type.' }
}
```

**Frontend** — Add confirmation dialog + clear button (same area as Task 2.7):

```tsx
// State
const [clearVariantConfirm, setClearVariantConfirm] = useState(false)

// Button (only for API mode — existing product with variants)
{!isLocalMode && variantList.length > 0 && (
  <Button
    variant='outline'
    size='sm'
    className='text-destructive'
    onClick={() => setClearVariantConfirm(true)}
  >
    <Trash2 className='h-4 w-4 mr-1.5' />
    Clear All
  </Button>
)}

// Confirmation dialog
{clearVariantConfirm && (
  <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
    <div className='bg-background rounded-lg shadow-lg max-w-sm w-full mx-4 p-6 space-y-4'>
      <h3 className='font-semibold text-lg'>Remove All Variants?</h3>
      <p className='text-sm text-muted-foreground'>
        This will delete all {variantList.length} variant(s) and convert the product to Simple type.
      </p>
      <div className='flex justify-end gap-2'>
        <Button variant='outline' onClick={() => setClearVariantConfirm(false)}>Cancel</Button>
        <Button
          variant='destructive'
          disabled={clearVariantMut.isPending}
          onClick={() => clearVariantMut.mutate(currentRow?.id || createdProductId!)}
        >
          Remove All
        </Button>
      </div>
    </div>
  </div>
)}
```

### Task 3.5: Add salePrice validation

**Files:**
- Modify: `backend/src/products/dto/product.dto.ts`
- Modify: `backend/src/products/products.service.ts:638-640`

**Risk Explanation for #28:**

> **What changes:** Add validation in `CreateProductDto` and the service's `create()` and `update()` methods that rejects `salePrice >= basePrice` (sale price should be lower than regular price).
>
> **Risk:** Moderate — this could block existing update payloads if any product in the database was saved with salePrice >= basePrice. The `update()` method would reject those payloads with a 400 error. This is a business rule enforcement that needs to be applied carefully.
>
> **Mitigation:** Only validate on CREATE (new products), not on UPDATE (existing products may have legitimately different pricing where sale > base for display purposes like showing a "premium" variant price). Actually — better approach: use a warning (not an error) in the frontend form, and only enforce as an error on the backend if the difference is clearly wrong.
>
> **If things go wrong:** Users getting blocked from updating products. Would need to temporarily remove the validation.
>
> **Rollback:** Remove the `@Validate` decorator / service check.

**Only proceed if you approve this risk.**

**Recommended approach:** Frontend validation only (warning in the form), backend validation as soft reject:

```tsx
// Frontend — in handleSaveClick validation function
if (salePrice && basePrice && parseFloat(salePrice) > parseFloat(basePrice)) {
  errors.push('Sale price cannot be higher than regular price')
}
```

### Task 3.6: Improve backend variant SKU generation

**Files:**
- Modify: `backend/src/products/products.service.ts:1028-1030`

**Risk Explanation for #27:**

> **What changes:** Improve fallback from `'PRD'` to something more meaningful. Low-risk.
>
> **Risk:** Very low. Only affects new variant generation. Existing variant SKUs are unchanged.

**Fix:**

```ts
const baseSku = product.sku || `PRD-${product.name.substring(0, 3).toUpperCase()}`
const sku = `${baseSku}-${values.replace(/\s+/g, '-').replace(/\//g, '_').toUpperCase()}`
```

### Task 3.7: Add SEO meta full preservation

**Files:**
- Modify: `admin/src/features/products/components/product-form.tsx:189-191,388`

**Problem (#3):** Only title/description/keywords of seoMeta are preserved.

**Fix:**
- Store the full seoMeta object instead of individual fields:

```tsx
// State
const [seoMetaRaw, setSeoMetaRaw] = useState<Record<string, any>>({})

// In clone logic
setSeoMetaRaw(currentRow.seoMeta || {})

// In handleSave
seoMeta: Object.keys(seoMetaRaw).length > 0 ? seoMetaRaw : undefined,
```

This is a safe frontend change. ✅

### Task 3.8: Duplicate payment overrides

**Files:**
- Modify: `admin/src/features/products/index.tsx:148-162`
- Modify: `admin/src/features/products/components/product-form.tsx`

**Problem (#4):** Payment overrides aren't duplicated.

**Fix:**
- When duplicating, fetch payment overrides and include them in the duplicate flow.
- For the backend `duplicate()` endpoint (Task 3.1): clone `paymentOptionOverrides` from source.
- For client-side flow: fetch overrides after product creation and create them.

This is best handled in the backend `duplicate()` from Task 3.1, since it needs to happen atomically with product creation.

---

## Phase 4: Enhancements (Optional)

These are quality-of-life improvements with no production impact.

### Task 4.1: Add duplicate confirmation dialog

**Files:**
- Modify: `admin/src/features/products/index.tsx:148-162`

Add a `ConfirmDialog` before opening the form:

```tsx
// State
const [duplicateConfirm, setDuplicateConfirm] = useState<ProductResponse | null>(null)

// In handleDuplicate, show confirm instead of directly opening form
setDuplicateConfirm(row)

// Confirm dialog
<ConfirmDialog
  open={!!duplicateConfirm}
  onOpenChange={() => setDuplicateConfirm(null)}
  title='Duplicate Product'
  desc={`Create a copy of "${duplicateConfirm?.name}" with all variants, images, and settings?`}
  confirmText='Duplicate'
  handleConfirm={async () => {
    if (!duplicateConfirm) return
    await handleDuplicate(duplicateConfirm)
    setDuplicateConfirm(null)
  }}
/>
```

### Task 4.2: Add created product orphan warning

**Files:**
- Modify: `admin/src/features/products/components/product-form.tsx`

When closing the form after creating a variable product without saving variants, warn:

```tsx
// Track whether form was explicitly closed vs saved
const handleClose = (v: boolean) => {
  if (!v && createdProductId && type === 'variable' && localVariants.length === 0) {
    // Ask user: "Product was created without variants. Continue?"
  }
  onOpenChange(v)
  if (!v) reset()
}
```

### Task 4.3: Add tests for duplication flow

**Files:**
- Modify: `admin/src/features/products/components/products-table.test.tsx`
- Create: `admin/src/features/products/__tests__/duplication-flow.test.ts`
- Modify: `backend/src/products/products.service.spec.ts`

Add Vitest browser tests for:
- "Duplicate" button is visible in row actions
- Clicking duplicate opens product form with pre-filled data
- Name shows "Copy of ..."
- Slug shows "...-copy-..."
- Variant rows are rendered with modified SKUs

Add backend Jest tests for duplication endpoint (when implemented).

---

## Execution Order Summary

| Phase | Tasks | Risk | Needs Sign-Off? | Status |
|-------|-------|------|-----------------|--------|
| 1 | 1.1–1.6 | 🟢 Zero | No | ✅ Done |
| 2 | 2.1–2.7 | 🟡 Low | No | ✅ Done |
| 3 | 3.3, 3.4, 3.5 | 🟢/🟠 Varies | User approved | ✅ Done |
| 4 | 4.1–4.3 | 🟢 Zero | No | ➡️ Tests pending |

### Completed Changes

**Frontend (`product-form.tsx` + `index.tsx` + `api.ts`):**
| # | Change | Files |
|---|--------|-------|
| 1.1 | Dialog title "Duplicate" mode | `product-form.tsx` |
| 1.2 | Stock = 0 on duplicate, clear UX message | `index.tsx`, `product-form.tsx` |
| 1.3 | "Copy of" name stacking fix | `index.tsx` |
| 1.4 | Clean variant SKU (`-CP{hex}` format) | `product-form.tsx` |
| 1.5 | Slug error highlight (border + inline text) | `product-form.tsx` |
| 1.6 | Inline slug/SKU existence check (UI + API) | `product-form.tsx` |
| 2.1 | Parent SKU auto-generated on duplicate | `index.tsx` |
| 2.2 | Variant SKU collision on regenerate fixed | auto (2.1) |
| 2.3 | Stale variant SKU on parent SKU change | `product-form.tsx` |
| 2.4 | Validation messages no longer lost | `product-form.tsx` |
| 2.5 | Consistent error handling (all mutations) | `product-form.tsx` |
| 2.6 | Random slug suffix for collision prevention | `index.tsx` |
| 2.7 | Clear All Variants (local + API mode) | `product-form.tsx` |

**Backend (`controller.ts` + `service.ts`):**
| # | Change | Endpoint |
|---|--------|----------|
| 3.3 | Slug availability check | `GET /products/check-slug/:slug` |
| 3.3 | SKU availability check (with excludeId) | `GET /products/check-sku/:sku?excludeId=` |
| 3.4 | Delete all variants + convert to simple | `DELETE /products/:id/variants` |

### Skipped Items (Stakeholder confirmation)
- **3.1** Backend `duplicate()` endpoint — client-side flow sufficient for quick creation
- **3.2** Ledger note — stock is 0 on duplicate, not relevant
- **3.7** SEO full preservation — current behavior acceptable
- **3.8** Payment overrides — out of scope for quick creation
- **4.1** Duplicate confirmation dialog — adds friction, quick creation should be fast

### Pending
- **4.3** Test coverage for duplication flow

---

## Items Where I Recommend SKIP

---

## Items Where I Recommend SKIP

These gaps are either intended behavior or not worth fixing:

- **#14 INVENTORY_CONTROLLED duplication** — Physical inventory SHOULD NOT be copied (each product instance has its own stock). No fix needed, just clearer messaging (Task 1.2 already covers this).
- **#13 Warehouse/bin locations** — These are location assignments, not copyable properties. Intentional gap.
- **#27 Backend SKU fallback** — The `'PRD'` fallback is acceptable for edge cases; improving it adds minimal value.

# Convert Lead Page — Design Spec

## Goal

Replace the current modal-based "Convert with Edit" for checkout leads with a full-page convert experience matching the order edit page's functionality and UX quality.

## Approach

Dedicated convert page at `/op/orders/incomplete-leads/:id/convert` (new route), modeled on the order edit page's 2/3 + 1/3 grid layout, with inline editing, live calculations, and one-click conversion.

---

## 1. Route

| Route | Component | Description |
|---|---|---|
| `/op/orders/incomplete-leads/:id/convert` | `convert-lead.tsx` | Full-page convert/edit experience |
| `/op/orders/incomplete-leads` | `incomplete-leads.tsx` | Existing list (updated: "Convert with Edit" navigates) |

---

## 2. Page Layout

### Header Bar
- Back button ← "Incomplete Leads"
- Lead display ID + customer name (e.g., "LEAD-20260616-0001 — Riaz Ahmed")
- Status badge (PENDING)
- "Convert to Order" primary button (right side, loading state)

### Left Column (2/3)

**2.1 Items Section**
- Editable items table with columns: image, name, price, quantity, total, remove
- Price input (number), quantity +/- buttons
- Remove item button (trash icon, confirmation optional)
- Product search bar (Cmd+K-style) to add new items:
  - Search by name or SKU (debounced 400ms)
  - Results in Command dropdown: thumbnail, name, SKU, price
  - Variable products → variant selection dialog
- Subtotal line (live calculation from items)

**2.2 Notes Section**
- Customer notes textarea
- Office notes textarea

### Right Column (1/3)

**3.1 Customer Card**
- Name input
- Phone input
- Email input

**3.2 Shipping Address Card**
- District select (cascading from API)
- Thana/Zone select (cascading, depends on district)
- Address textarea

**3.3 Pricing Card**
- Shipping charge input (number)
- Discount input (number) + type toggle: Flat (৳) / Percentage (%)
- Live cost breakdown: Subtotal → Shipping → Discount → Total

**3.4 Payment Card**
- Payment method select: COD / bKash / Nagad / Rocket

---

## 3. Backend Changes

### ConvertOrderDto (extended)

```typescript
class ConvertOrderDto {
  @IsOptional() items?: ConvertItemDto[];
  @IsOptional() guestName?: string;
  @IsOptional() guestPhone?: string;
  @IsOptional() shippingAddress?: any;
  @IsOptional() paymentMethod?: string;
  // NEW fields:
  @IsOptional() shippingCharge?: number;
  @IsOptional() discount?: number;
  @IsOptional() discountType?: string; // 'flat' | 'percentage'
  @IsOptional() customerNotes?: string;
  @IsOptional() officeNotes?: string;
  @IsOptional() district?: string;
  @IsOptional() thana?: string;
}
```

### CheckoutLeadsService.convertToOrder (updated)

Apply new fields when creating the order:
- `shippingCharge`, `discount`, `discountType` → order-level fields
- `customerNotes`, `officeNotes` → order-level fields
- `district`, `thana` → include in shipping address (merged with existing address)
- Recalculate total: `subtotal + shippingCharge - discountAmount`

---

## 4. List Page Updates

- "Convert with Edit" dropdown item → router.navigate to `/op/orders/incomplete-leads/:id/convert`
- Remove the convert modal entirely (no longer needed)
- "Quick Convert" stays as-is (one-click API call)

---

## 5. States

### Loading
- Skeleton layout matching the 2-column grid while fetching lead data
- Spinner on "Convert to Order" button during submission

### Empty / Error
- Lead not found → "Lead not found" message with back link
- API errors → toast.error with server message
- Validation errors (inline before submit):
  - No items → disable convert button
  - Invalid phone → inline error
  - No customer name → inline error

### Edge Cases
- Lead already CONVERTED → redirect to order detail page
- Lead status changed by another admin → refetch on error, show toast
- All items removed → "Add at least one item" disabled state

---

## 6. Files

### New Files
| File | Purpose |
|---|---|
| `apps/admin/src/features/orders/convert-lead.tsx` | Main convert page component |
| `apps/admin/src/routes/_authenticated/op/orders/incomplete-leads/$id/convert.tsx` | TanStack Router route |

### Modified Files
| File | Purpose |
|---|---|
| `apps/admin/src/features/orders/incomplete-leads.tsx` | Update "Convert with Edit" to navigate |
| `apps/backend/src/checkout-leads/dto/convert-order.dto.ts` | Add new optional fields |
| `apps/backend/src/checkout-leads/checkout-leads.service.ts` | Apply new fields in convertToOrder |

---

## 7. Non-Goals (Out of Scope)

- Updating the lead's existing data (editing the lead itself, not the order)
- Partial payments / gateway selection during conversion
- Dispatch to courier (handled on order edit page after conversion)
- Timeline display (order edit page handles this after conversion)
- Bulk convert (stays on list page as quick convert per row)

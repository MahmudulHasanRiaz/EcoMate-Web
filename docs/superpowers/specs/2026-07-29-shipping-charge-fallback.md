# Shipping Charge Auto-Fallback Behavior

## Problem

In both shipping charge modes, when no explicit selection is made (no shipping option chosen on the checkout page, or no district selected in auto-district mode), the shipping charge shows 0/empty instead of falling back to the configured default delivery charge.

## Scope

- **No new models or migrations** — uses existing `ShippingOption`, `ShippingZoneGroup`, and `delivery_charge` system setting.
- **Minimal changes** — frontend checkout calculation, backend order creation validation.
- **Backward compatible** — existing orders and configuration unaffected.

## Current Behavior vs Expected

| Scenario | Current | Expected |
|---|---|---|
| Options mode — no option selected yet | `deliveryCharge = 0`; `useEffect` auto-selects after render | Auto-select highest option immediately during render; backend provides fallback |
| District mode — no district selected | `deliveryCharge = config.delivery.charge` (may be 0 before config loads) | Show default delivery charge immediately; use server-side SSR config |
| District mode — district with zone selected | Works correctly | Same |

## Changes

### 1. Frontend — Checkout Page (options mode)

In `apps/storefront/app/(main)/checkout/page.tsx`:

#### Compute highest option inline
Instead of relying on a `useEffect` that runs after render, compute the fallback `deliveryCharge` inline during render. When `shippingMode === 'options'` and no option is selected, pick the highest amount option and treat its charge as the delivery charge:

```ts
if (config.shippingMode === 'options') {
  if (selectedShippingOptionId) {
    const opt = config.shippingOptions?.find(o => o.id === selectedShippingOptionId);
    deliveryCharge = opt?.amount ?? 0;
  } else if (config.shippingOptions?.length > 0) {
    const highest = [...config.shippingOptions].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
    deliveryCharge = highest.amount;
    // Also auto-select in state so submission sends the ID
    if (!selectedShippingOptionId) {
      // Use a separate effect or inline state set
    }
  }
}
```

#### Keep auto-select useEffect for the `selectedShippingOptionId` state
The useEffect still sets the state so the form submission sends the option ID.

#### Update validation
Remove the `shippingOption` validation when there are shipping options available (since auto-fallback handles it).

### 2. Frontend — Checkout Page (district mode)

No change needed for the calculation logic — it already falls back to `config.delivery.charge`. The issue of showing 0 before config loads is mitigated by SSR config injection.

### 3. Backend — Orders Service (options mode)

In `apps/backend/src/orders/orders.service.ts`: instead of throwing an error when `selectedShippingOptionId` is missing, fall back to the highest-amount active shipping option:

```ts
if (shippingMode === 'options') {
  const hasOptions = await tx.shippingOption.findFirst({ where: { isActive: true }, select: { id: true } });
  if (hasOptions) {
    let optionId = dto.selectedShippingOptionId;
    if (!optionId) {
      // Auto-select highest amount option
      const highest = await tx.shippingOption.findFirst({
        where: { isActive: true },
        orderBy: { amount: 'desc' },
      });
      optionId = highest?.id;
    }
    if (optionId) {
      const shippingOption = await tx.shippingOption.findUnique({ where: { id: optionId } });
      if (shippingOption && shippingOption.isActive) {
        derivedShippingCharge = Number(shippingOption.amount);
      }
    }
  }
}
```

### 4. Backend — Orders Service (district mode — no change needed)

The backend already reads `delivery_charge` system setting as default fallback (line 876). No change required.

## Compatibility

- Existing orders with `selectedShippingOptionId` — unchanged.
- Existing orders without shipping options configured — charge stays 0 (no options = no charge).
- Old checkout pages without auto-fallback — server now provides fallback.

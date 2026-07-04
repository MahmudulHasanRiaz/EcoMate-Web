# Pricing Engine Standardization

## Problem
Pricing logic is inconsistent across the project:
- Some places use `salePrice ?? basePrice` (correct)
- Others use `basePrice` only (ignores sale price)
- Order creation ignores `variant.salePrice` entirely
- Sorting/filtering by price uses `basePrice` instead of effective price

## Rules
1. **Effective price** = `salePrice ?? basePrice/price` everywhere
2. **Variable products**: all variants same → single price; different → `min - max`
3. **Sorting by price**: ORDER BY effective price (COALESCE(salePrice, basePrice))
4. **Filtering by price**: WHERE effective price BETWEEN min AND max
5. **Admin order create**: use effective price chain: variant.salePrice ?? variant.price ?? product.salePrice ?? product.basePrice

## Files to Change

### Backend
- `products.service.ts` — sort/filter by effective price, not raw basePrice
- `orders.service.ts` — use variant.salePrice ?? variant.price
- `feed.service.ts` — correct fallback chain

### Storefront
- `transformBackendProduct()` — already mostly correct
- Product page sort params — pass correct sort field to API

### Admin
- `products-columns.tsx` — variable product range use effective price
- `create.tsx` — use salePrice fallback chain

### POS
- `product-grid.tsx` — already correct (`salePrice || basePrice`)

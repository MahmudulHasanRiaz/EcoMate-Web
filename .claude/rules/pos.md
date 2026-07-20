---
paths:
  - "apps/pos/src/**/*.{ts,tsx}"
---

# POS Rules

- Assume network interruption, retries, duplicate clicks, and stale stock can occur.
- Keep cart totals, discounts, tax, payment status, and stock validation server-authoritative.
- Preserve idempotency for checkout/payment submission and prevent duplicate orders.
- Reuse the established API client, TanStack Query, Zustand, and UI component patterns.
- Verify keyboard/barcode workflows and loading, offline, empty, and error states when affected.
- Run `npm run build --workspace=pos` before completion.

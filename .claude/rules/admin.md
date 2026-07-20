---
paths:
  - "apps/admin/src/**/*.{ts,tsx}"
---

# Admin Frontend Rules

- Use `apiClient` rather than raw `fetch`.
- Use TanStack Query for server state and TanStack Router for navigation.
- Reuse components from `@/components/ui/`, `SafeImage`, and `MediaPicker` before creating alternatives.
- Preserve the existing product variant `images: string[]` contract.
- Cover meaningful behavior with Vitest browser tests; use Playwright for multi-page or end-to-end flows.
- Run `npm run build --workspace=admin` before completion.

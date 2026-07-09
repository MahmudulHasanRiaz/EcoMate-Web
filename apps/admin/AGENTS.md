# Admin Frontend Agent Rules

## Code Quality

- Run `npx tsc --noEmit` after modifying any `.tsx` or `.ts` file
- No new TypeScript errors allowed
- Prefer `useQuery` over `useEffect` for data fetching
- Use `apiClient` from `@/lib/api-client` for API calls (not raw fetch)

## Component Conventions

- Use shadcn/ui components from `@/components/ui/`
- Use TanStack Router for navigation
- Use TanStack Query for server state
- Use `toast` from `sonner` for notifications
- Use `SafeImage` from `@/components/safe-image` for all images
- Use `MediaPicker` from `@/components/media-picker` for image selection

## Product Form Rules

- Variants tab: "Generate" button computes locally for new products, calls API for existing
- Variant images: use `images[]` array (not single `image`)
- Local variant state stores `images: string[]` (not `image: string`)
- `handleSave` includes `variants` payload when `localVariants.length > 0`

## State Management

- Server state: TanStack Query
- UI state: React useState
- Form state: local useState (no form library)
- Complex shared state: React Context (CartContext, AuthContext)

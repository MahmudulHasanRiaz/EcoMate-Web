# Backend Agent Rules

## Prisma / Database Rules

See root `AGENTS.md` for full schema migration rules.

### Backend-Specific

- **ALWAYS** run `npx nest build` after modifying any `.ts` file
- **ALWAYS** run `npx prisma generate` after schema changes
- **ALWAYS** run `npx prisma migrate dev --name <name>` after schema changes
- Never commit without successful build
- Use class-validator decorators on all DTOs
- Use `@Roles()` and `@RequiresFeature()` decorators on all endpoints
- Wrap mutations in `PrismaService.$transaction` when multiple writes are needed

### Endpoint Conventions

- `GET /` — List (paginated)
- `GET /:id` — Get one
- `POST /` — Create
- `PUT /:id` — Update
- `DELETE /:id` — Delete
- `POST /:id/variants/generate` — Generate variants (not PATCH)
- `PUT /:id/variants/:variantId` — Update single variant

### Stock Rules

- `managedStockQuantity` is the source of truth for physical stock
- Never allow direct editing of stock via product/variant update endpoints
- Always use `/inventory/adjust` for stock changes (creates ledger entry)
- Set `availabilityMode: 'MANAGED_STOCK'` for variable products by default

Storefront MUST:
- Optimize Core Web Vitals
- Optimize LCP
- Optimize CLS
- Optimize TTFB

---

# ARCHITECTURE INVARIANTS (OVERRIDES ALL OTHER RULES)

ALL developers and AI agents MUST read and obey `docs/1-BUSINESS/ARCHITECTURE_INVARIANTS.md`.

These are NOT optional. If code violates an invariant, fix the code — not the invariant.

Key invariants summarized:
- INV-001: Only StockService may mutate managedStockQuantity or reservedStock
- INV-003: Ledger records are append-only
- INV-012: Business Requirements override Implementation
- INV-014: Architecture Decisions must be documented as ADRs
- INV-015: StockService centralizes ALL stock operations (Managed + Physical)
- INV-016: Physical Inventory must support reservation (reservedQuantity)
- INV-017: ALWAYS_OUT_OF_STOCK blocks order creation
- INV-019: Dispatch never owns stock (requests via StockService only)

See full file at `docs/1-BUSINESS/ARCHITECTURE_INVARIANTS.md` for all 19 invariants with violation tracking.

Dual-mode architecture: When Inventory Management is ENABLED, Physical Inventory is primary
and Managed Stock is secondary (per-product syncManagedStock toggle). When DISABLED, 
Managed Stock is the sole system. See docs/2-ARCHITECTURE/STATE_MACHINES.md §5 for full matrix.

---

# TESTING RULES

MANDATORY TEST TYPES:

Backend:
- Unit tests
- Integration tests
- E2E tests

Frontend:
- Component tests
- E2E flows

Critical flows MUST be tested:
- Checkout
- Payment
- Inventory updates
- Order lifecycle
- Authentication
- RBAC
- Refunds

---

# DEVOPS & DEPLOYMENT RULES

Primary deployment:
- VPS + Docker

Architecture MUST ALSO remain deployable to:
- Vercel (storefront)
- Vercel or Cloudflare Pages (admin)

System MUST:
- Work in unified VPS deployment
- Work in separated deployments
- Use environment-based configuration

MANDATORY:
- Dockerized services
- Health checks
- Graceful shutdown
- Reverse proxy support
- Zero-downtime deployment readiness

Preferred:
- Traefik or Nginx
- GitHub Actions CI/CD

---

# MONOREPO RULES

Monorepo MUST:
- Share types safely
- Share validation schemas carefully
- Avoid circular dependencies
- Maintain strict boundaries

Preferred structure:
- packages/ui
- packages/types
- packages/config
- packages/utils
- packages/sdk

---

# CODE QUALITY RULES

MANDATORY:
- Strict TypeScript
- ESLint
- Prettier
- Husky
- Lint-staged

NEVER:
- Use any recklessly
- Ignore TypeScript errors
- Disable lint rules without reason

---

# DOCUMENTATION RULES

ALL major systems MUST include:
- Architecture notes
- Flow explanations
- Sequence diagrams where helpful
- Environment documentation
- Failure scenarios
- Recovery procedures

---

# AI AGENT BEHAVIOR RULES

AI agents MUST:

- Think before implementing
- Analyze scalability impact
- Analyze security impact
- Analyze database impact
- Analyze operational impact
- Analyze failure scenarios

Before coding ANY feature:
1. Evaluate architecture impact
2. Evaluate DB impact
3. Evaluate scaling impact
4. Evaluate security impact
5. Evaluate observability impact

AI agents MUST:
- Prefer maintainability over shortcuts
- Prefer explicitness over magic
- Prefer reliability over cleverness
- Prefer modularity over speed of implementation

NEVER:
- Make assumptions silently
- Introduce breaking schema changes casually
- Generate incomplete business logic
- Skip validation
- Skip authorization
- Skip error handling
- Skip logging
- Skip edge cases

---

# PRODUCTION SAFETY RULES

NEVER:
- Run destructive migrations automatically
- Delete production data casually
- Disable security for convenience
- Expose admin APIs publicly
- Store sensitive logs insecurely

MANDATORY:
- Backups
- Rollback strategy
- Migration safety checks
- Queue failure recovery
- Disaster recovery awareness

---

# SCHEMA MIGRATION RULES (OVERRIDES ALL OTHER APPROACHES)

## HARD RULE — AI agents AND developers MUST obey:

**Every single change to `schema.prisma` REQUIRES an equivalent Prisma migration file (`prisma/migrations/`) generated via `npx prisma migrate dev --name <descriptive-name>`.**

This is NON-NEGOTIABLE. Exceptions: local-only development databases with no production deployment history.

## Rationale

- `prisma db push --accept-data-loss` is FORBIDDEN for schema delivery. It silently drops columns/tables, has no rollback, and creates irreversible drift between Prisma client and database.
- Migration files are version-controlled, reversible (`prisma migrate diff`), auditable, and can be reviewed in PRs.
- A schema change without a migration == data loss waiting to happen.

## Workflow for ANY schema change

1. Edit `schema.prisma`
2. Run `npx prisma migrate dev --name <short-description-of-change>`
3. Review the generated migration SQL in `prisma/migrations/<timestamp>_<name>/migration.sql`
4. Commit BOTH the schema change AND the migration directory
5. For production: `npx prisma migrate deploy` (NEVER `db push`)

## Special cases

- **Adding optional nullable columns only**: migration is still required (generates empty/safe SQL)
- **Renaming fields**: use a two-step migration (add new → backfill → drop old) — write the migration SQL manually if Prisma cannot infer intent
- **Prod with existing data**: generate migration against a staging DB first, verify rollback, then apply to production
- **Hotfix that needs instant schema change**: generate migration, apply via `prisma migrate deploy`, never via raw SQL on production console

## CI enforcement

CI/CD pipeline MUST reject PRs that modify `schema.prisma` without a corresponding new migration directory in `prisma/migrations/`.

---

# FINAL QUALITY STANDARD

EcoMate is NOT a demo project.

It MUST behave like:
- Shopify-grade operational software
- Enterprise commerce infrastructure
- High-scale production system

Every implementation decision MUST prioritize:
- Reliability
- Security
- Scalability
- Maintainability
- Performance
- Operational stability

If uncertain:
- Choose the safer architecture
- Choose the more maintainable implementation
- Choose the more observable system
- Choose the more scalable design


# REALTIME ARCHITECTURE RULES

Realtime infrastructure MUST remain optional and enhancement-oriented.

The platform MAY use:
- WebSocket
- Socket.io
- Redis Pub/Sub

ONLY for:
- admin live updates
- notifications
- operational dashboards
- realtime monitoring
- internal operational tooling

Core commerce functionality MUST remain API-first.

The following systems MUST work fully WITHOUT websocket connectivity:
- checkout
- order placement
- payment processing
- inventory operations
- authentication
- storefront browsing

Realtime systems MUST NEVER become a hard dependency for core business operations.

If websocket infrastructure fails:
- the platform MUST remain fully operational
- only realtime UX enhancements may degrade

DO NOT prematurely over-engineer realtime architecture before operational systems become stable.

END OF PROTOCOL 
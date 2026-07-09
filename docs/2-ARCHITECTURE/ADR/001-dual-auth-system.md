# ADR 001: Dual Auth System (Legacy JWT + Better Auth)

**Status:** Accepted  
**Date:** 2026-06 (inferred from plan dates)  
**Decider:** Lead Architect  

## Context

EcoMate originally used a custom JWT-based auth system (Passport `jwt` strategy). During platform expansion, team decided to adopt **Better Auth** — a full-featured auth library with session management, OAuth, MFA, and organization support. A cut-over would break existing sessions.

## Decision

Run **both auth systems in parallel** for the migration period:

- **DualModeAuthGuard** (global guard, registered in app.module.ts):  
  1. Check `Authorization: Bearer <token>` → verify as legacy JWT  
  2. If no valid JWT, check Better Auth session via `auth.api.getSession()`  
  3. Auto-provision UserProfile if Better Auth user is new  
  4. Allow public routes through

- **Legacy JWT** still active for: existing integrations, API tokens  
- **Better Auth** handles: new sessions, OAuth, MFA, organization roles

## Consequences

- **Positive:** Zero-downtime migration. No forced re-login.  
- **Positive:** DualAuthGuard can be removed once legacy JWT usage drops to zero.  
- **Negative:** Two auth code paths to maintain.  
- **Negative:** Session invalidation must be coordinated across both systems.  
- **Status:** Migration in progress — legacy JWT still primary for some APIs.

## Implementation

- `apps/backend/src/common/guards/dual-mode-auth.guard.ts` — logic  
- `apps/backend/src/auth/auth.guard.ts` — legacy JWT guard  
- `apps/backend/src/app.module.ts:167` — global guard registration  
- Client libs: `admin/src/lib/better-auth-client.ts`, `storefront/lib/better-auth-client.ts`

## References

- `docs/3-DOMAINS/09-auth.md`
- `docs/7-SUPERSEDED/plans/2026-07-06-better-auth-migration.md`
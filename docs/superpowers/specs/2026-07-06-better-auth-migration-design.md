# Better Auth Migration Design
> **Superseded by:** `docs/3-DOMAINS/09-auth.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

**Date:** 2026-07-06
**Status:** Reviewed
**Owner:** AI Agent

## Overview

Migrate authentication system from custom Passport JWT strategy + Bcrypt JS to Better Auth across NestJS backend (Fastify), React admin panel (Vite), Next.js storefront, and React POS terminal. Zero-downtime phased migration.

## Current System

### Backend (NestJS + Fastify + Prisma + PostgreSQL)

- **Auth module:** Custom Passport JWT strategies with access token (15m) + refresh token (7d)
- **Password hashing:** bcryptjs, 12 salt rounds
- **Session storage:** `RefreshToken` DB table (rotation on each refresh)
- **Account lockout:** 5 failed attempts → 15-min lockout (Redis + in-memory)
- **Rate limiting:** Per-endpoint (5-10 req/min on sensitive routes)
- **Global guards:** `JwtAuthGuard`, `RolesGuard`, `LicenseGuard`, `ThrottlerGuard`, `FeatureGuard`
- **IP blocking:** Via `BlockedIp` table, tracked by `SecurityService`

### Database (User-related tables)

| Table | Purpose |
|-------|---------|
| `User` | Profile: firstName, lastName, username, email, phoneNumber, password (bcrypt), role, status, emailVerified, failedLoginAttempts, lockoutUntil, lastIp |
| `RefreshToken` | JWT refresh tokens: token, userId, expiresAt |
| `VerificationToken` | OTP tokens: email, token, type, expiresAt |

### Clients

| Client | Framework | Auth approach |
|--------|-----------|--------------|
| Admin panel | React/Vite + TanStack Router + Zustand | accessToken in cookie, axios interceptor with refresh |
| Storefront | Next.js | Thin API client (`lib/api/auth.ts`) |
| POS | React/Vite | accessToken in localStorage |

## Target System (Better Auth)

### Architecture

```
                             ┌─────────────────────────────┐
                             │     NestJS + Fastify         │
                             │                              │
                             │  /api/better-auth/*          │
                             │  └─ Better Auth handler      │
                             │                              │
                             │  /api/* (all other routes)   │
                             │  └─ DualModeAuthGuard        │
                             │     ├─ Check BA session      │
                             │     └─ Fallback: legacy JWT  │
                             │                              │
                             │  /api/auth/* (legacy)        │
                             │  └─ Existing auth module   │
                             └──────────┬──────────────────┘
                                        │
                             ┌──────────▼──────────────────┐
                             │     PostgreSQL               │
                             │  ┌─────────────────────┐    │
                             │  │ Better Auth tables   │    │
                             │  │ user, session,       │    │
                             │  │ account, verification│    │
                             │  ├─────────────────────┤    │
                             │  │ UserProfile (legacy) │    │
                             │  │ + betterAuthUserId   │    │
                             │  │ (all existing fields)│    │
                             │  └─────────────────────┘    │
                             └─────────────────────────────┘
```

### Better Auth Configuration

**File:** `apps/backend/src/better-auth/auth.config.ts`

```typescript
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "../prisma/prisma.service";

export const auth = betterAuth({
  basePath: "/api/better-auth",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  socialProviders: {
    // Configured per Phase 2
  },
  advanced: {
    generateId: false, // Use Prisma-generated UUIDs
  },
  user: {
    modelName: "user",
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days (same as current refresh token)
    updateAge: 60 * 60 * 24, // refresh every 1 day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 min cache — avoids DB hit on every request
    },
  },
  plugins: [
    customSession(async ({ user, session }) => {
      // Attach profile data to session response to avoid N+1
      const profile = await prisma.userProfile.findUnique({
        where: { betterAuthUserId: user.id },
      });
      return {
        user: {
          ...user,
          profile: profile || null,
        },
        session,
      };
    }),
  ],
});
```

### Database Schema Changes

#### New Tables (Better Auth managed)

```prisma
model User {
  id          String    @id
  name        String
  email       String    @unique
  emailVerified Boolean  @default(false)
  image       String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  accounts    Account[]
  sessions    Session[]
}

model Session {
  id        String    @id
  token     String    @unique
  userId    String
  expiresAt DateTime
  ipAddress String?
  userAgent String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Account {
  id                    String    @id
  userId                String
  accountId             String
  providerId            String
  accessToken           String?
  refreshToken          String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  idToken               String?
  password              String?      // ← Bcrypt hash for credential provider
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt
  user                  User         @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Verification {
  id         String    @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
}
```

#### Modified Table

```prisma
model UserProfile {           // Renamed from User
  id                  String     @id @default(uuid())
  betterAuthUserId     String?    @unique  // Link to Better Auth user.id
  firstName           String
  lastName            String
  username            String     @unique
  email               String     @unique
  phoneNumber         String
  password            String?    // Nullable after migration complete
  emailVerified       Boolean    @default(false)
  failedLoginAttempts Int       @default(0)
  lockoutUntil        DateTime?
  lastIp              String?
  status              UserStatus @default(active)
  role                UserRole   @default(admin)
  createdAt           DateTime   @default(now())
  updatedAt           DateTime   @updatedAt
  // ... all existing relations (orders, addresses, etc.) unchanged
}
```

## Migration Phases

**Important:** Better Auth generates its own `user` table model in Prisma schema. To avoid naming conflict with the existing `User` model, rename existing `User` → `UserProfile` BEFORE running `npx auth generate`. This way BA generates `user` and your existing model becomes `UserProfile`.

**Table naming conflict avoidance:** Better Auth's generated `user` model defaults to table name `user` (singular). Your existing `User` model maps to `users` (plural via `@@map("users")`). These are different tables — no actual conflict. However for maximum clarity, configure Better Auth's user model to map to `@@map("better_auth_users")` in the generated Prisma schema. This keeps auth tables visually separated from business tables.

All existing Prisma relations (`User → Order`, `User → Address`, `User → RefreshToken`, `User → UserSettings`, etc.) must be updated from `User` to `UserProfile` in the schema file and their corresponding relation fields. The database table name stays `users` (via `@@map("users")`) — only the Prisma model name changes.

**Phase 1 → Phase 2 guard ordering:** In `app.module.ts`, `DualModeAuthGuard` must be registered BEFORE `RolesGuard` in the `APP_GUARD` array. `DualModeAuthGuard` sets `request.user` with the profile including `role`, which `RolesGuard` then checks. No other guard order changes needed.

### Phase 1: Foundation (Deploy 1)

**Changes:**
1. Rename Prisma model `User` → `UserProfile`, update all relation references
2. Install Better Auth + Prisma adapter
3. Run `npx auth generate` to add BA tables (`user`, `session`, `account`, `verification`)
4. Add `betterAuthUserId` column to `UserProfile`
5. Create `apps/backend/src/better-auth/` with auth config
6. Register Better Auth Fastify handler in `main.ts` (at `/api/better-auth/*`)
7. Create `DualModeAuthGuard` that checks BA session then falls back to JWT
8. Replace `JwtAuthGuard` with `DualModeAuthGuard` in `app.module.ts` (order: DualModeAuthGuard first, RolesGuard second)
9. All code references to Prisma `User` model updated to `UserProfile`

**Validation:**
- All existing API routes return correct data
- JWT auth still works (guard falls back to legacy)
- Better Auth endpoints are reachable at `/api/better-auth/*`
- No downtime or user-visible changes

### Phase 2: Password Migration (Deploy 2)

**Migration logic** — since Better Auth's admin user creation APIs require authentication, the migration uses direct Prisma inserts into BA tables, then delegates session creation to BA's `signInEmail`:

```typescript
async legacyLogin(email: string, password: string) {
  const profile = await this.prisma.userProfile.findUnique({ where: { email } });
  if (!profile || !profile.password) throw new UnauthorizedException();

  const valid = await bcrypt.compare(password, profile.password);
  if (!valid) throw new UnauthorizedException();

  // If user not yet migrated to Better Auth
  if (!profile.betterAuthUserId) {
    // Generate UUID for BA user (consistent with existing pattern)
    const baUserId = crypto.randomUUID();
    
    // Create Better Auth user directly via Prisma
    await this.prisma.user.create({
      data: {
        id: baUserId,
        name: `${profile.firstName} ${profile.lastName}`,
        email: profile.email,
        emailVerified: profile.emailVerified,
      },
    });
    
    // Create credential account with existing bcrypt hash
    await this.prisma.account.create({
      data: {
        id: crypto.randomUUID(),
        userId: baUserId,
        accountId: baUserId,
        providerId: "credential",
        password: profile.password, // existing bcrypt hash — BA supports bcrypt natively
      },
    });
    
    // Link profile
    await this.prisma.userProfile.update({
      where: { id: profile.id },
      data: { betterAuthUserId: baUserId },
    });
  }

  // Delegate to Better Auth signInEmail to create session + set cookies
  // This finds the Account with bcrypt hash and verifies user-entered password
  return auth.api.signInEmail({ body: { email, password } });
}
```

### Phase 3: Client Updates (Deploy 3-5)

#### Admin Panel

**Before:**
```typescript
// stores/auth-store.ts
interface AuthState {
  user: User | null;
  accessToken: string | null;
  login: (email: string, password: string) => Promise<void>;
}
```

**After:**
```typescript
// lib/auth-client.ts
import { createAuthClient } from "better-auth/client";
export const authClient = createAuthClient({
  baseURL: `${import.meta.env.VITE_API_URL}/api/better-auth`,
});

// In components — replace axios auth calls:
const { data: session } = authClient.useSession();  // replaces /api/auth/me
await authClient.signIn.email({ email, password });   // replaces /api/auth/login
await authClient.signOut();                            // replaces /api/auth/logout
```

Remove:
- `stores/auth-store.ts` — replaced by BA session reactivity
- `lib/api-client.ts` axios interceptor — replaced by BA cookies

Keep:
- `lib/auth-guard.tsx` — role checks still use profile data
- `components/layout/authenticated-layout.tsx` — adjusted to use BA session

The backend `DualModeAuthGuard` reads BA session cookies (auto-sent with fetch). Existing axios calls for business data (orders, products) continue working because the session cookie is sent automatically.

#### Storefront

**Before:** `lib/api/auth.ts` with manual fetch calls.

**After:** Same BA client pattern. React hooks for session.

#### POS

**Before:** `localStorage` token, manual fetch

**Challenge:** POS may run on localhost, different IP, or native wrapper where third-party cookie blocking prevents BA session cookies from being sent.

**After:** BA client with bearer token fallback.

On backend, enable Better Auth's `bearer` plugin:

```typescript
import { bearer } from "better-auth/plugins";

export const auth = betterAuth({
  // ...
  plugins: [
    bearer(),
    // ...
  ],
});
```

POS client creates a bearer token on login and stores it in `localStorage` (same as current pattern). The `DualModeAuthGuard` already checks BA session cookies first; the bearer plugin handles POS requests with `Authorization: Bearer <token>` header.

POS login flow:
1. `authClient.signIn.email({ email, password })` → get session
2. Call `authClient.getSession()` to verify
3. For subsequent requests, store session token in `localStorage` and send as Bearer header
4. `DualModeAuthGuard` → BA session check → if no cookie, fallback to bearer token

### Phase 4: Cutover (Deploy 6)

**When:** 30 days after Phase 1 or when < 1% of requests still use legacy JWT.

**Changes:**
1. Remove `DualModeAuthGuard` fallback to JWT
2. Remove legacy auth module (controller, service, strategies, DTOs)
3. Remove `RefreshToken` model from Prisma
4. Make `UserProfile.password` nullable (or drop column)
5. Move Better Auth from `/api/better-auth/*` → `/api/auth/*`
6. Update BA `basePath` to `/api/auth`
7. Remove `passport`, `passport-jwt`, `bcryptjs`, `@nestjs/jwt`, `@nestjs/passport` from dependencies
8. Remove `SecurityService` lockout logic (Better Auth has built-in rate limiting)

## Client SDK Architecture

### Admin Panel Auth Flow

```
┌──────────┐     ┌──────────────┐     ┌─────────────────┐
│  Browser  │────▶│  BA Client   │────▶│  /api/better-auth│
│  (React)  │     │  (cookies)   │     │  (Fastify handler)│
└──────────┘     └──────────────┘     └────────┬────────┘
                                               │
                         ┌─────────────────────▼──────────┐
                         │  DualModeAuthGuard (NestJS)     │
                         │  Validates BA session cookie    │
                         │  → user + UserProfile           │
                         └─────────────────────────────────┘
```

- BA client manages session cookies automatically
- No access token in JavaScript memory → safer against XSS
- Session refresh happens transparently via BA client
- Business API calls (axios) include session cookies from browser

### Dual-Mode Request Handling

```typescript
// In app.module.ts: global guard registration — ORDER IS CRITICAL
// DualModeAuthGuard must be BEFORE RolesGuard so request.user is set
{
  provide: APP_GUARD,
  useClass: DualModeAuthGuard,  // replaces JwtAuthGuard
},
{
  provide: APP_GUARD,
  useClass: RolesGuard,
},

// DualModeAuthGuard
async canActivate(context: ExecutionContext): Promise<boolean> {
  const request = context.switchToHttp().getRequest();
  
  // 1. Check @Public() decorator
  if (Reflect.getMetadata(PUBLIC_KEY, context.getHandler())) return true;

  // 2. Try Better Auth session (profile attached via customSession plugin, cached by cookieCache)
  const headers = fromNodeHeaders(request.headers);
  const session = await auth.api.getSession({ headers }).catch(() => null);
  if (session?.user?.profile) {
    request.user = { ...session.user.profile, betterAuthSession: session };
    return true;
  }

  // 3. Fallback to legacy JWT
  const token = extractBearerToken(request);
  if (token) {
    try {
      const payload = await jwtService.verifyAsync(token);
      const user = await prisma.userProfile.findUnique({ where: { id: payload.sub } });
      if (user) {
        request.user = user;
        return true;
      }
    } catch {}
  }

  return false;
}
```

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Password migration fails | BA uses bcrypt natively — existing hashes work without re-hashing. Migration happens per-user on next login, not bulk. |
| BA handler errors affect existing routes | BA only handles `/api/better-auth/*`. All other routes unaffected. |
| Session cookie not forwarded | BA cookies set on same domain. Browser auto-sends with all requests. For cross-origin clients (POS), BA `bearer` plugin provides token fallback. |
| BA client conflicts with axios token | Remove axios token interceptor in Phase 2. Admin already sends cookies automatically. |
| Role/permission system breaks | Roles stay in UserProfile. DualModeGuard attaches profile to request. `@Roles()` decorator unchanged. |
| Rate limiting removed | Better Auth has built-in rate limiter. Configure same limits. |
| Account lockout removed | Better Auth password config has lockout. Configure 5 attempts / 15 min. |
| POS cookies blocked (3rd-party) | BA `bearer` plugin for token-based auth. POS stores session token in localStorage same as before. |
| Guard ordering wrong | DualModeGuard must be before RolesGuard. Order verified via integration test. |

## Rollback Plan

**If issues discovered after Phase 1 deploy:**
- Better Auth tables can be dropped (no production data in them yet)
- `UserProfile.betterAuthUserId` column can be removed
- Revert to `JwtAuthGuard`
- Zero impact on users

**If issues discovered after Phase 2 deploy:**
- Disable BA Fastify handler
- Revert to `JwtAuthGuard`
- Users who migrated still have `betterAuthUserId` set but BA is unused
- Legacy login still works because password hasn't changed
- Harmless orphan BA data — can clean up later

## Pre-Deploy Validation Checklist

Before each production deploy, validate locally:

1. **Legacy token integrity:** Pre-existing JWT access/refresh tokens return 200 (not 401) on protected routes
2. **Bcrypt compatibility:** Migrate a test bcrypt hash to BA `account` table; verify `auth.api.signInEmail` with matching password returns a valid session
3. **Guard ordering:** Integration test confirms `DualModeAuthGuard` runs before `RolesGuard` in APP_GUARD chain — `request.user` is always set when `RolesGuard` fires
4. **Rollback automation:** Script to instantly revert to `JwtAuthGuard` and disable BA handler. Test on staging first.

## Success Criteria

1. All existing user passwords migrated without data loss
2. Existing sessions remain valid until natural expiry
3. New sign-in (email/password) works via BA
4. Social OAuth works via BA
5. Protected routes secure under BA session validation
6. Admin panel, storefront, POS all functional
7. Zero downtime during migration
8. All existing routes return same data shapes

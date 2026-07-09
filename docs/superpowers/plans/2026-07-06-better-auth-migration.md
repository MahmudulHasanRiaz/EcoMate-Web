# Better Auth Migration — Implementation Plan
> **Superseded by:** `docs/3-DOMAINS/09-auth.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 — Deploy Better Auth foundation alongside existing auth. Zero downtime. No user-visible changes.

**Architecture:** Better Auth instance with Fastify handler at `/api/better-auth/*`. Existing auth stays at `/api/auth/*`. DualModeAuthGuard checks BA session first, falls back to legacy JWT. Profile table (`UserProfile`) linked to BA `user` via `betterAuthUserId`. BA `cookieCache` + `customSession` plugin attaches profile to session — no N+1 queries.

**Tech Stack:** NestJS + Fastify, Prisma (PostgreSQL), Better Auth v1.6, `@better-auth/prisma-adapter`

---

## File Structure

### New files
| File | Purpose |
|------|---------|
| `apps/backend/src/better-auth/auth.config.ts` | Better Auth instance |
| `apps/backend/src/better-auth/better-auth.module.ts` | NestJS module for BA |
| `apps/backend/src/common/guards/dual-mode-auth.guard.ts` | Dual-mode guard |

### Modified files (Phase 1)
| File | Change |
|------|--------|
| `apps/backend/package.json` | Add `better-auth`, `@better-auth/prisma-adapter` |
| `apps/backend/prisma/schema.prisma` | Rename `User` → `UserProfile`, add `betterAuthUserId`, add BA tables |
| `apps/backend/src/prisma/prisma.service.ts` | Update `seedAdminUser`, `validateSchemaCompleteness` for `UserProfile` |
| `apps/backend/src/auth/auth.service.ts` | Rename all `prisma.user` → `prisma.userProfile` |
| `apps/backend/src/auth/auth.controller.ts` | Rename `prisma.user` → `prisma.userProfile` references |
| `apps/backend/src/main.ts` | Register BA Fastify handler before NestJS routes |
| `apps/backend/src/app.module.ts` | Replace `JwtAuthGuard` with `DualModeAuthGuard` |

### Modified files (Phase 2 — password migration)
| File | Change |
|------|--------|
| `apps/backend/src/auth/auth.service.ts` | Add migration logic in `login()` |

### Modified files (Phase 3 — client updates)
| File | Change |
|------|--------|
| `apps/admin/src/lib/auth-client.ts` | New BA client |
| `apps/admin/src/stores/auth-store.ts` | Remove zustand, use BA |
| `apps/admin/src/lib/api-client.ts` | Remove token interceptor |
| `apps/admin/src/features/auth/sign-in/components/user-auth-form.tsx` | Use BA client |
| `apps/admin/src/components/layout/authenticated-layout.tsx` | Use BA session |
| `apps/storefront/lib/api/auth.ts` | Use BA client |
| `apps/pos/src/lib/auth-client.ts` | New BA client |

---

## Phase 1: Foundation (Deploy 1)

### Task 1: Install dependencies

**Files:**
- Modify: `apps/backend/package.json`

- [ ] **Step 1: Add better-auth packages**

```bash
cd apps/backend
npm install better-auth @better-auth/prisma-adapter
```

The packages:
- `better-auth` — core auth framework
- `@better-auth/prisma-adapter` — Prisma ORM adapter
- No other BA packages needed for Phase 1

- [ ] **Step 2: Verify install**

Run: `node -e "require('better-auth'); console.log('OK')"`
Expected: `OK`

---

### Task 2: Update Prisma Schema

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Rename existing `User` model to `UserProfile` + add `betterAuthUserId`**

Current:
```prisma
model User {
  id                  String     @id @default(uuid())
  firstName           String
  lastName            String
  username            String     @unique
  email               String     @unique
  phoneNumber         String
  password            String
  emailVerified       Boolean    @default(false)
  failedLoginAttempts Int        @default(0)
  lockoutUntil        DateTime?
  lastIp              String?
  status              UserStatus @default(active)
  role                UserRole   @default(admin)
  createdAt           DateTime   @default(now())
  updatedAt           DateTime   @updatedAt

  refreshTokens  RefreshToken[]
  settings       UserSettings?
  // ... other relations
}
```

Change to:
```prisma
model UserProfile {
  id                  String     @id @default(uuid())
  betterAuthUserId     String?    @unique
  firstName           String
  lastName            String
  username            String     @unique
  email               String     @unique
  phoneNumber         String
  password            String
  emailVerified       Boolean    @default(false)
  failedLoginAttempts Int        @default(0)
  lockoutUntil        DateTime?
  lastIp              String?
  status              UserStatus @default(active)
  role                UserRole   @default(admin)
  createdAt           DateTime   @default(now())
  updatedAt           DateTime   @updatedAt

  refreshTokens  RefreshToken[]
  settings       UserSettings?
  // ... other relations
}
```

- [ ] **Step 2: Update all relation references from `User` to `UserProfile`**

Find every `user User @relation(fields: [userId], references: [id], ...)` in the schema and update the referenced model from `User` to `UserProfile`.

Example — `RefreshToken`:
```prisma
model RefreshToken {
  id        String         @id @default(uuid())
  token     String         @unique
  userId    String
  expiresAt DateTime
  createdAt DateTime       @default(now())
  user      UserProfile    @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Also update `UserSettings`:
```prisma
model UserSettings {
  id     String      @id @default(uuid())
  userId String      @unique
  user   UserProfile @relation(fields: [userId], references: [id], onDelete: Cascade)
  // ...
}
```

- [ ] **Step 3: Add Better Auth tables via prism generator**

Run:
```bash
npx auth@latest generate
```

This generates the BA core schema. Add the output models to `schema.prisma`. The generated models will be:

```prisma
model user {
  id            String    @id
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  accounts      account[]
  sessions      session[]
}

model session {
  id        String   @id
  token     String   @unique
  userId    String
  expiresAt DateTime
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      user     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model account {
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
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  user                  user      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

Add `@@map("better_auth_users")` to the `user` model for clear table separation:
```prisma
model user {
  @@map("better_auth_users")
  id            String    @id
  // ...
}
```

- [ ] **Step 4: Run Prisma generate to update client**

```bash
cd apps/backend && npx prisma generate
```

Expected output: Prisma Client regenerated with `userProfile`, `user`, `session`, `account`, `verification` models.

- [ ] **Step 5: Commit schema changes**

```bash
git add apps/backend/prisma/schema.prisma
git add apps/backend/package.json
git commit -m "feat: add Better Auth tables, rename User -> UserProfile"
```

---

### Task 3: Update PrismaService

**Files:**
- Modify: `apps/backend/src/prisma/prisma.service.ts`

- [ ] **Step 1: Update `seedAdminUser()` method**

Change `this.user.upsert(...)` to `this.userProfile.upsert(...)`:

```typescript
private async seedAdminUser(): Promise<void> {
  try {
    const email = process.env.ADMIN_EMAIL || process.env.ADMIN_USER || 'admin@ecomate.com';
    const plainPassword = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || 'Admin@123';
    const adminPassword = await bcrypt.hash(plainPassword, 12);

    await this.userProfile.upsert({
      where: { email },
      update: { password: adminPassword },
      create: {
        firstName: 'Super',
        lastName: 'Admin',
        username: 'superadmin',
        email,
        phoneNumber: '+8801700000000',
        password: adminPassword,
        role: 'superadmin',
        status: 'active',
      },
    });
    this.logger.log(`[License/Seed] Admin user synced/seeded: ${email}`);
  } catch (err: any) {
    this.logger.warn(`Failed to auto-seed admin user: ${err.message}`);
  }
}
```

- [ ] **Step 2: Update `validateSchemaCompleteness()`**

Change `'User'` to `'UserProfile'` in the `allModels` array:

```typescript
const allModels = [
  // ...
  'UserProfile',
  // ...
];
```

- [ ] **Step 3: Verify compilation**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/prisma/prisma.service.ts
git commit -m "fix: update PrismaService for UserProfile rename"
```

---

### Task 4: Update AuthService

**Files:**
- Modify: `apps/backend/src/auth/auth.service.ts`

- [ ] **Step 1: Rename all `this.prisma.user` → `this.prisma.userProfile`**

Replace ALL occurrences. There are 14+ occurrences in:
- `register()` — line 32, 48
- `login()` — line 77, 104, 139
- `refresh()` — line 173
- `me()` — line 192
- `updateProfile()` — line 235
- `changePassword()` — line 260, 277
- `resetPassword()` — line 373
- `sendVerificationEmail()` — line 396
- `verifyEmail()` — line 436

- [ ] **Step 2: Update `forgotPassword()` to use `userProfile`**

```typescript
async forgotPassword(email: string) {
  const user = await this.prisma.userProfile.findUnique({
    where: { email },
    select: { id: true },
  });
  // ... rest stays same
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: No errors (except other files that may still reference `prisma.user`)

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/auth/auth.service.ts
git commit -m "fix: update AuthService for UserProfile rename"
```

---

### Task 5: Create Better Auth Module

**Files:**
- Create: `apps/backend/src/better-auth/auth.config.ts`
- Create: `apps/backend/src/better-auth/better-auth.module.ts`

- [ ] **Step 1: Create auth config**

`apps/backend/src/better-auth/auth.config.ts`:

```typescript
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { customSession } from "better-auth/plugins";
import { prisma } from "../prisma/prisma.service";

export const auth = betterAuth({
  basePath: "/api/better-auth",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  advanced: { generateId: false },
  user: { modelName: "user" },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  plugins: [
    customSession(async ({ user, session }) => {
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

Note: `prisma` here is the PrismaService singleton. Since PrismaService uses dependency injection, we need to export the prisma instance. Update PrismaService to expose the instance:

In `apps/backend/src/prisma/prisma.service.ts`, add a static instance:
```typescript
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static instance: PrismaService;

  constructor() {
    // ... existing constructor
    PrismaService.instance = this;
  }

  static getInstance(): PrismaService {
    return PrismaService.instance;
  }
}
```

Alternatively, create a simpler approach — export a shared Prisma client instance from a separate file:

Actually the simplest approach: use a separate prisma client instance specifically for BA (not the NestJS-managed one).

Better approach — create a standalone Prisma client for BA to avoid DI complexity:

`apps/backend/src/better-auth/prisma.ts`:
```typescript
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);

export const baPrisma = new PrismaClient({ adapter });
```

And update `auth.config.ts` to use `baPrisma` instead:
```typescript
import { baPrisma } from "./prisma";
```

Also update the customSession callback to use `baPrisma`.

This avoids any DI conflicts.

- [ ] **Step 2: Create NestJS module**

`apps/backend/src/better-auth/better-auth.module.ts`:

```typescript
import { Module } from '@nestjs/common';

@Module({})
export class BetterAuthModule {}
```

This is an empty module — BA is configured as a standalone instance, not via NestJS DI. The module exists for NgModule registration in `app.module.ts`.

- [ ] **Step 3: Verify file creation**

Run: `ls apps/backend/src/better-auth/`
Expected: `auth.config.ts` `better-auth.module.ts` `prisma.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/better-auth/
git commit -m "feat: add Better Auth configuration and module"
```

---

### Task 6: Create DualModeAuthGuard

**Files:**
- Create: `apps/backend/src/common/guards/dual-mode-auth.guard.ts`

- [ ] **Step 1: Create the guard**

```typescript
import { Injectable, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../../better-auth/auth.config';
import { baPrisma } from '../../better-auth/prisma';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class DualModeAuthGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();

    // 1. Try Better Auth session (profile attached via customSession plugin, cached by cookieCache)
    const headers = fromNodeHeaders(request.headers);
    const session = await auth.api.getSession({ headers }).catch(() => null);

    if (session?.user?.profile) {
      request.user = { ...session.user.profile, betterAuthSession: session };
      return true;
    }

    // 2. Try legacy JWT
    const authHeader = request.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        const payload = await this.jwtService.verifyAsync(token, {
          secret: process.env['JWT_SECRET'],
        });
        const user = await baPrisma.userProfile.findUnique({
          where: { id: payload.sub },
        });
        if (user) {
          request.user = user;
          return true;
        }
      } catch {
        // Invalid token — continue
      }
    }

    // 3. Public routes: allow through (optionally with parsed user)
    if (isPublic) return true;

    return false;
  }
}
```

- [ ] **Step 2: Export guard from barrel**

If there's an index file in guards, add:
```typescript
export { DualModeAuthGuard } from './dual-mode-auth.guard';
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/common/guards/dual-mode-auth.guard.ts
git commit -m "feat: add DualModeAuthGuard with BA session + JWT fallback"
```

---

### Task 7: Update AppModule

**Files:**
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Replace JwtAuthGuard with DualModeAuthGuard**

Import:
```typescript
import { JwtAuthGuard } from './auth/auth.guard';
// Remove or keep — DualModeAuthGuard replaces it globally
```

Update providers — replace `JwtAuthGuard` with `DualModeAuthGuard`:
```typescript
import { DualModeAuthGuard } from './common/guards/dual-mode-auth.guard';

// In providers array:
{ provide: APP_GUARD, useClass: DualModeAuthGuard },  // WAS: JwtAuthGuard
{ provide: APP_GUARD, useClass: RolesGuard },
```

- [ ] **Step 2: Add BetterAuthModule import**

Add to imports array:
```typescript
import { BetterAuthModule } from './better-auth/better-auth.module';

// In imports:
BetterAuthModule,
```

- [ ] **Step 3: Verify compilation**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/app.module.ts
git commit -m "feat: replace JwtAuthGuard with DualModeAuthGuard globally"
```

---

### Task 8: Register BA Fastify Handler in main.ts

**Files:**
- Modify: `apps/backend/src/main.ts`

- [ ] **Step 1: Register BA Fastify handler BEFORE NestJS routes**

```typescript
import { auth } from './better-auth/auth.config';

async function bootstrap() {
  // ... existing code up to CORS setup

  // Register Better Auth Fastify handler (must be after CORS, before global prefix)
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    url: '/api/better-auth/*',
    async handler(request, reply) {
      try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        const req = new Request(url.toString(), {
          method: request.method,
          headers,
          body: request.body ? JSON.stringify(request.body) : undefined,
        });
        const response = await auth.handler(req);
        reply.status(response.status);
        response.headers.forEach((value, key) => reply.header(key, value));
        return reply.send(response.body ? await response.text() : null);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Authentication error' });
      }
    },
  });

  // Remove the JWT_SECRET/env check since BA + dual-mode doesn't strictly require them
  // (keep existing check for backward compat)

  // ... rest of bootstrap
}
```

- [ ] **Step 2: Verify the handler is registered after `cookie` plugin and `app.enableCors`**

The BA handler must be registered AFTER:
- `app.register(cookie)` — cookies must be parsed
- `app.enableCors(...)` — CORS headers must be set

And BEFORE:
- `app.setGlobalPrefix('api', ...)` — BA has its own path handling

Current order (line numbers reference):
1. Line 82: `app.register(cookie)` ✓ before
2. Line 89: `app.enableCors(...)` ✓ before
3. Line 113: `app.useGlobalFilters(...)` — after is fine
4. Line 114: `app.setGlobalPrefix('api', ...)` — after is fine

Insert the BA handler between line 101 (after CORS, after onResponse hook) and line 113.

- [ ] **Step 3: Verify compilation**

Run: `cd apps/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/main.ts
git commit -m "feat: register Better Auth Fastify handler at /api/better-auth/*"
```

---

### Task 9: Fix remaining `prisma.user` references across backend

**Files:**
- Modify: All files referencing `prisma.user` (not `this.prisma.user` which was already handled)

- [ ] **Step 1: Find all remaining references**

Run: `cd apps/backend && grep -rn "prisma\.user\b" src/ | grep -v "prisma\.userProfile\b" | grep -v "prisma\.userSettings\b" | grep -v "prisma\.user\|\.user"`

Also check: `grep -rn "\.user\." src/` — filter for the Prisma model access pattern.

Files that likely reference `prisma.user`:
- `src/auth/auth.service.ts` — already handled in Task 4
- `src/auth/auth.controller.ts` — check
- `src/prisma/prisma.service.ts` — already handled in Task 3
- Other modules (users, orders, etc.) — check

Run the grep:
```bash
rg "prisma\.user\b" --include="*.ts" apps/backend/src/ | grep -v "node_modules" | grep -v "\.userProfile"
```

For each hit, rename `prisma.user` → `prisma.userProfile`.

- [ ] **Step 2: Fix each file**

Example — if `users.service.ts` has `prisma.user.findUnique(...)`, change to `prisma.userProfile.findUnique(...)`.

- [ ] **Step 3: Fix auth controller imports if needed**

The `auth.controller.ts` uses `this.authService` — it doesn't directly access `prisma.user`, so it should be fine. Verify.

- [ ] **Step 4: Verify compilation**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: Zero errors. If errors remain, check each file and fix.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/
git commit -m "fix: update all remaining prisma.user references to userProfile"
```

---

### Task 10: Local validation tests

- [ ] **Step 1: Start backend**

```bash
cd apps/backend && npm run start:dev
```

Expected: Server starts on port 4000. Log shows `Schema drift check: all required columns verified ✓`.

- [ ] **Step 2: Test BA endpoint is reachable**

```bash
curl -s http://localhost:4000/api/better-auth/session | head -c 200
```

Expected: Empty session response (no cookies sent) — like `{}` or `null`.

- [ ] **Step 3: Test legacy auth still works**

```bash
# Login with existing credentials
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ecomate.com","password":"Admin@123"}' \
  -c /tmp/cookies.txt
```

Expected: Returns accessToken + user. Status 200.

- [ ] **Step 4: Test legacy JWT still protects routes**

```bash
# Use the accessToken from step 3
TOKEN="<access_token from step 3>"
curl -s http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

Expected: Returns user profile. Status 200.

- [ ] **Step 5: Test legacy JWT on public routes**

```bash
curl -s -X POST http://localhost:4000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

Expected: Status 200 (or 201). No auth required.

- [ ] **Step 6: Test 401 on protected route without auth**

```bash
curl -s http://localhost:4000/api/auth/me
```

Expected: Status 401.

---

### Task 11: Rollback verification

- [ ] **Step 1: Create rollback script**

Create `scripts/rollback-auth-migration.sh`:

```bash
#!/bin/bash
# Rollback Phase 1 of Better Auth migration
# Reverts to JwtAuthGuard only

echo "=== Rollback Auth Migration Phase 1 ==="

# 1. Revert app.module.ts to use JwtAuthGuard
git checkout apps/backend/src/app.module.ts

# 2. Disable BA Fastify handler in main.ts
git checkout apps/backend/src/main.ts

# 3. Remove BA tables from Prisma schema (keep BA models — no data loss risk)
# UserProfile stays, user/session/account/verification tables stay (empty)

# 4. Restart
echo "Run: cd apps/backend && npm run build && npm run start:prod"
```

- [ ] **Step 2: Test rollback**

```bash
# Roll back
git checkout apps/backend/src/app.module.ts
git checkout apps/backend/src/main.ts
# Restart
cd apps/backend && npm run build && npm run start:prod || true
```

Expected: Server starts with old auth only. All routes work as before.

- [ ] **Step 3: Re-apply our changes for testing**

```bash
git checkout HEAD -- apps/backend/src/app.module.ts apps/backend/src/main.ts
```

---

## Phase 2: Password Migration (Deploy 2)

### Task 12: Add migration logic to legacy login

**Files:**
- Modify: `apps/backend/src/auth/auth.service.ts`

- [ ] **Step 1: Add BA import**

```typescript
import { auth } from '../better-auth/auth.config';
import { baPrisma } from '../better-auth/prisma';
```

- [ ] **Step 2: Modify `login()` method — migrate to BA but keep returning JWT**

In Phase 2, the legacy login endpoint STILL returns JWT tokens (clients haven't switched yet). The BA user+account is created silently so the next signIn from the BA client will work. The response stays the same.

After the bcrypt compare succeeds (and before generating JWT tokens), add:

```typescript
// Online migration: create BA user if not yet migrated
if (!profile.betterAuthUserId) {
  const baUserId = crypto.randomUUID();
  await baPrisma.user.create({
    data: {
      id: baUserId,
      name: `${profile.firstName} ${profile.lastName}`.trim(),
      email: profile.email,
      emailVerified: profile.emailVerified,
    },
  });
  await baPrisma.account.create({
    data: {
      id: crypto.randomUUID(),
      userId: baUserId,
      accountId: baUserId,
      providerId: "credential",
      password: profile.password,
    },
  });
  await baPrisma.userProfile.update({
    where: { id: profile.id },
    data: { betterAuthUserId: baUserId },
  });
  this.logger.log(`Migrated user ${profile.email} to Better Auth`);
}
```

The existing `generateTokens()` call stays unchanged. The JWT response goes to the client as before.

- [ ] **Step 3: No controller changes needed for Phase 2**

The legacy login endpoint continues returning JWT. No cookie forwarding needed. Clients switch to BA in Phase 3.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/auth/auth.service.ts
git commit -m "feat: silent Better Auth migration on legacy login (keeps JWT)"
```

---

## Phase 3: Client Updates (Deploy 3-5)

### Task 13: Admin panel BA client

**Files:**
- Create: `apps/admin/src/lib/auth-client.ts`

- [ ] **Step 1: Create BA client**

```typescript
import { createAuthClient } from "better-auth/client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export const authClient = createAuthClient({
  baseURL: `${API_URL}/better-auth`,
});
```

- [ ] **Step 2: Update sign-in form**

`apps/admin/src/features/auth/sign-in/components/user-auth-form.tsx`:

Replace the axios POST call:
```typescript
import { authClient } from "@/lib/auth-client";

async function onSubmit(data: z.infer<typeof formSchema>) {
  setIsLoading(true);
  const { data: session, error } = await authClient.signIn.email({
    email: data.email,
    password: data.password,
  });
  if (error) {
    toast.error(error.message || "Invalid email or password");
    setIsLoading(false);
    return;
  }
  const targetPath = redirectTo || "/";
  navigate({ to: targetPath, replace: true });
  toast.success("Welcome back!");
  setIsLoading(false);
}
```

Remove:
- `axios` import
- `useAuthStore` import
- `auth.setUser()` and `auth.setAccessToken()` calls

- [ ] **Step 3: Update authenticated layout**

`apps/admin/src/components/layout/authenticated-layout.tsx`:

Replace:
```typescript
const accessToken = useAuthStore((s) => s.auth.accessToken);
```
With:
```typescript
import { authClient } from "@/lib/auth-client";
// In component:
const { data: session, isPending } = authClient.useSession();
const sessionUser = session?.user?.profile;
```

Replace the accessToken checks with session checks:
```typescript
useEffect(() => {
  if (!sessionUser) {
    navigate({ to: '/sign-in', replace: true });
  }
}, [sessionUser, navigate]);
```

Replace `/auth/me` fetch:
```typescript
useEffect(() => {
  if (!sessionUser) return;
  const { setUser } = useAuthStore.getState().auth;
  setUser({ id: sessionUser.id, email: sessionUser.email, role: sessionUser.role });
  if (sessionUser.role === 'packing_assistant') {
    // ... existing logic
  }
}, [sessionUser, navigate]);
```

- [ ] **Step 4: Update axios interceptor**

`apps/admin/src/lib/api-client.ts`:

Remove the request interceptor that attaches Bearer token (BA manages this via cookies).

Keep the response interceptor for 401 handling — but change it to redirect to sign-in without attempting refresh (BA handles refresh automatically):

```typescript
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // BA handles session refresh automatically — if 401, session is truly invalid
      window.location.href = '/admin/sign-in';
    }
    return Promise.reject(error);
  },
);
```

- [ ] **Step 5: Remove auth-store.ts (optional)**

If no other code uses the zustand auth store, remove it. Otherwise keep it and update to use BA session.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/
git commit -m "feat: update admin panel to use Better Auth client"
```

---

### Task 14: Storefront BA client

**Files:**
- Modify: `apps/storefront/lib/api/auth.ts`

- [ ] **Step 1: Update storefront auth functions**

Replace the axios-based functions with BA client calls:

```typescript
import { createAuthClient } from "better-auth/client";
import type { User } from "../types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export const authClient = createAuthClient({
  baseURL: `${API_URL}/better-auth`,
});

export async function login(email: string, password: string) {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

export async function register(data: {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phoneNumber: string;
  password: string;
}) {
  const { data: result, error } = await authClient.signUp.email({
    email: data.email,
    password: data.password,
    name: `${data.firstName} ${data.lastName}`.trim(),
  });
  if (error) throw new Error(error.message);
  return result;
}

export async function getMe(): Promise<User> {
  const { data: session } = await authClient.getSession();
  return session?.user?.profile as User;
}

export async function logout(): Promise<void> {
  await authClient.signOut();
}

export { authClient };
```

---

### Task 15: POS BA client with bearer token

**Files:**
- Create: `apps/pos/src/lib/auth-client.ts`

- [ ] **Step 1: Create BA client**

```typescript
import { createAuthClient } from "better-auth/client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export const authClient = createAuthClient({
  baseURL: `${API_URL}/better-auth`,
  fetchOptions: {
    // POS may need credentials: 'include' for cookies if same-origin
  },
});
```

- [ ] **Step 2: Update POS login page**

Replace localStorage token management with BA session. If cookies don't work (cross-origin), use BA's bearer plugin:

```typescript
import { authClient } from "@/lib/auth-client";

async function handleLogin(username: string, password: string) {
  const { data, error } = await authClient.signIn.email({
    email: username,
    password,
  });
  if (error) throw new Error(error.message);
  
  // Store session token in localStorage as fallback
  const session = await authClient.getSession();
  if (session.data?.session?.token) {
    localStorage.setItem('session_token', session.data.session.token);
  }
  
  return data;
}
```

---

## Phase 4: Cutover (Deploy 6)

### Task 16: Remove legacy auth

**Files:**
- Modify: Multiple

- [ ] **Step 1: Disable legacy auth module**

In `app.module.ts`, remove `AuthModule` from imports. Keep `DualModeAuthGuard` but remove the JWT fallback.

- [ ] **Step 2: Update guard to BA-only**

Remove JWT fallback from `DualModeAuthGuard`.

- [ ] **Step 3: Move BA to /api/auth/**

Change `basePath: "/api/better-auth"` → `basePath: "/api/auth"` in `auth.config.ts`.

- [ ] **Step 4: Remove old auth files**

Delete: `auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `jwt.strategy.ts`, `refresh-jwt.strategy.ts`, `auth.guard.ts`, `roles.guard.ts`, `refresh-jwt.guard.ts`, all auth DTOs.

- [ ] **Step 5: Remove dependencies**

```bash
npm uninstall passport passport-jwt @nestjs/jwt @nestjs/passport bcryptjs
```

- [ ] **Step 6: Remove RefreshToken + VerificationToken from Prisma**

Drop the tables and models.

- [ ] **Step 7: Update client BA base URLs**

Change `baseURL` in all auth-client.ts files to `/api/auth`.

- [ ] **Step 8: Commit**

---

## Validation Tests

### Pre-deploy validation (run before each deploy)

```bash
# 1. Verify legacy tokens still work
echo "=== Legacy Token Test ==="
# Get a token from the running system before deploy
TOKEN="<pre-generated legacy JWT>"
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
# Expected: 200

echo ""

# 2. Verify BA endpoint
echo "=== BA Endpoint Test ==="
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:4000/api/better-auth/session
# Expected: 200 (empty session is fine)

echo ""

# 3. Verify public routes work
echo "=== Public Route Test ==="
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:4000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com"}'
# Expected: 200

echo ""

# 4. Verify 401 on protected without auth
echo "=== 401 Test ==="
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:4000/api/auth/me
# Expected: 401
```

### Rollback test

```bash
echo "=== Rollback Test ==="
git checkout apps/backend/src/app.module.ts
git checkout apps/backend/src/main.ts
npm run build && npm run start:prod &
sleep 3
# Test legacy auth still works
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ecomate.com","password":"Admin@123"}'
# Expected: 200
kill %1
```

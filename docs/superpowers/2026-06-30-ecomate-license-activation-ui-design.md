# EcoMate License Activation UI Design

## Overview

Add a UI-based license activation flow to the self-hosted EcoMate Web application. Currently, license credentials are configured via environment variables (`LICENSE_KEY`, `KEYMATE_API_URL`, etc.) on the server. This design replaces that with an in-app activation wizard that prompts the user for their license key on first access, validates it against the KeyMate licensing server, encrypts and persists it to the database, and gates all app access behind a valid license.

## Motivation

- Eliminate server-level env-var configuration for license keys
- Provide a polished first-run experience for clients
- Prevent unauthorized use without server-side key management
- Allow license updates/changes from within the admin panel

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  EcoMate Web (Client Server)                                      │
│                                                                    │
│  ┌──────────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │ Admin Panel       │    │ License      │    │ FeatureGuard    │  │
│  │ (React/TanStack)  │───▶│ Module       │───▶│ (global,        │  │
│  │                   │    │ (NestJS)     │    │  checks routes) │  │
│  │ activation UI     │    │              │    │                  │  │
│  │ license mgmt      │    │ LicenseGuard │    │ LicenseEngine   │  │
│  └──────────────────┘    │ (global,     │    │ (API client +   │  │
│                          │  checks      │    │  7-day cache)   │  │
│  ┌──────────────────┐    │  activation) │    └────────┬────────┘  │
│  │ Storefront        │    └──────┬───────┘             │          │
│  │ (Next.js)         │           │                     │          │
│  │ license check     │           │                     │          │
│  │ block if inactive │           ▼                     ▼          │
│  └──────────────────┘    ┌─────────────────────────────────┐      │
│                          │  Prisma DB                       │      │
│                          │  license_activation table        │      │
│                          │  (encrypted credentials)         │      │
│                          └─────────────────────────────────┘      │
│                                                                    │
└──────────────────────────────────────────────────────┬─────────────┘
                                                       │
                                              POST /v1/saas/licenses/verify
                                                       │
                                                       ▼
                                          ┌──────────────────────────┐
                                          │  KeyMate Server           │
                                          │  (keygen-keymate.         │
                                          │   commerciaans.com)       │
                                          │  License validation +     │
                                          │  feature/limit resolution │
                                          └──────────────────────────┘
```

## Data Model

Add `license_activation` table to Prisma schema:

```prisma
model LicenseActivation {
  id            String   @id @default(uuid())
  licenseKey    String                        // AES-256 encrypted at application layer
  keymateUrl    String                        // KeyMate API base URL (plaintext)
  domain        String?                       // Auto-detected from Host header
  apiKey        String?                       // AES-256 encrypted (per-order token)
  licenseInfo   Json?     @db.JsonB           // Last valid verify response from KeyMate
  status        String    @default("pending") // pending | active | expired | invalid
  errorMessage  String?
  activatedAt   DateTime?
  expiresAt     DateTime?
  lastCheckIn   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

Encryption:
- `LICENSE_ENCRYPTION_KEY` env var (64 hex chars = 256-bit AES key)
- AES-256-GCM with random IV per encryption
- Encrypted at NestJS service layer (not DB-level)

## Backend Changes

### New: `LicenseActivationService`

Service that handles all license activation CRUD with encryption:

```typescript
class LicenseActivationService {
  async find()           // get current activation (singleton)
  async activate(dto)    // validate + encrypt + save
  async deactivate()     // clear activation + set status
  async refresh()        // re-validate against KeyMate, update cache
}
```

### Modified: `LicenseService`

- `onModuleInit()` now reads from DB instead of env vars
- If no activation record → app starts in "unactivated" state (no blocking during startup)
- If activation exists with status `active` → calls KeyMate verify via existing engine
- Falls back to 7-day cached `licenseInfo` if KeyMate unreachable

### New: `POST /api/license/activate`

- `@Public()` + `@SkipLicenseCheck()` decorator
- Body: `{ licenseKey: string, apiKey?: string }`
- Domain auto-detected from `request.hostname`
- Validates against KeyMate: `POST /v1/saas/licenses/verify { licenseKey, domain }`
- On validation success:
  - Encrypts credentials with AES-256-GCM
  - Upserts into `LicenseActivation` table
  - Updates `FeatureFlagsService` in-memory state
  - Returns `{ success: true, license: LicenseInfo }`
- On failure: returns `{ success: false, error: string }`

### New: `LicenseGuard`

Global guard that runs before `FeatureGuard`:

```typescript
@Injectable()
class LicenseGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip for @Public() + @SkipLicenseCheck() routes
    if (this.isPublicAndSkipped(context)) return true;
    
    const activation = await this.prisma.licenseActivation.findFirst();
    if (!activation || activation.status !== 'active') {
      throw new ForbiddenException('License not activated');
    }
    return true;
  }
}
```

### Guard Order in `AppModule`

```
JwtAuthGuard → RolesGuard → LicenseGuard (NEW) → ThrottlerGuard → FeatureGuard
```

### Routes that skip LicenseGuard

| Route | Reason |
|-------|--------|
| `POST /api/auth/login` | Login needed before activation page |
| `POST /api/auth/register` | Registration needed before activation |
| `GET /api/license/status` | Public status check |
| `POST /api/license/activate` | Activation endpoint itself |
| `GET /api/license/check` | Admin panel uses to redirect |

### New: `@SkipLicenseCheck()` Decorator

```typescript
export const SKIP_LICENSE_CHECK = 'skip_license_check';
export const SkipLicenseCheck = () => SetMetadata(SKIP_LICENSE_CHECK, true);
```

## Frontend Changes

### Admin Panel: Activation Page

New route: `apps/admin/src/routes/(auth)/license/activate.tsx`

- **Outside** `_authenticated` group (accessible without auth token)
- Centered card layout, no sidebar
- Fields:
  - License Key (required, text input)
  - API Key (optional, password input, help text explaining it enables auto-validation)
- Domain shown as read-only (auto-detected)
- "Activate License" submit button
- States: idle → validating → success → redirect | error → inline message

### Admin Panel: `AuthenticatedLayout` Modification

- After auth check passes, add license check
- Fetch `GET /api/license/status`
- If status is not active → redirect to `/license/activate`
- TanStack Router `beforeLoad` hook or component-level `useEffect`

### Storefront: License Check

In `apps/storefront/app/layout.tsx` (same pattern as existing maintenance mode):

- Fetch `GET /api/license/status` from backend
- If `active === false` → show `<LicenseRequiredPage />` component instead of normal content
- Message: "This site requires a valid license. Please contact your administrator."
- Grace period: on fetch error, show cached state (allow access for up to 24 hours)

## User Flow

```
1. Deploy EcoMate (Docker Compose / Portainer)
   │
2. Access admin panel URL → sign-in page
   │
3. Create account / log in → JwtAuthGuard passes
   │
4. LicenseGuard checks for active license → NOT FOUND
   │
5. Redirect to /license/activate
   │
   ┌────────────────────────────────────┐
   │  Activate Your License             │
   │                                    │
   │  License Key                       │
   │  [______________________________]  │
   │                                    │
   │  API Key (optional)                │
   │  [______________________________]  │
   │                                    │
   │  Domain: client-store.com          │
   │  (auto-detected from server)       │
   │                                    │
   │  [✔] Activate License              │
   │                                    │
   │  Need a license? Contact us.       │
   └────────────────────────────────────┘
   │
6. POST /api/license/activate
   → Backend calls KeyMate verify
   │
7. SUCCESS:
   → License encrypted & saved to DB
   → FeatureFlagsService initialized with features/limits
   → Redirect to admin dashboard
   → Storefront now accessible
   │
   FAILURE:
   → Stay on activation page
   → Show error (invalid key, domain mismatch, expired, etc.)
   │
8. License active → all guards pass → normal operation
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid license key | Return error, stay on activation page |
| Domain mismatch | Return error with message about domain restriction |
| License expired | Return error with expiry date |
| KeyMate unreachable | Return error, suggest retrying later |
| Already activated | Return current status, allow re-activation (updates credentials) |
| Encryption key missing | App won't start (missing `LICENSE_ENCRYPTION_KEY` env var) |

## Security

- License credentials encrypted at rest with AES-256-GCM
- Encryption key from env var `LICENSE_ENCRYPTION_KEY` (not in DB)
- Domain auto-detected from `Host` header — user cannot tamper with domain validation
- API key stored encrypted — only decrypted in-memory when calling KeyMate
- No license data exposed in logs (keys masked)
- `@SkipLicenseCheck()` routes minimal — only auth + license endpoints

## Configuration

### New Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LICENSE_ENCRYPTION_KEY` | Yes | AES-256 key for encrypting stored license credentials (64 hex chars) |

### Existing Env Vars (Behavior Change)

| Variable | Old Behavior | New Behavior |
|----------|-------------|--------------|
| `LICENSE_KEY` | Read on startup | Ignored (read from DB instead) |
| `KEYMATE_API_URL` | Required for validation | Used as fallback; hardcoded default `https://keygen-keymate.commercians.com/api/v1/saas` |
| `KEYMATE_API_KEY` | Used for validation | Ignored (stored in DB via activation UI) |
| `LICENSE_TOKEN` | Fallback token | Still used as last-resort fallback if DB + KeyMate both fail |
| `DOMAIN` | Read on startup | Ignored (auto-detected from request) |

## Files Changed

### EcoMate Web

| File | Action |
|------|--------|
| `apps/backend/prisma/schema.prisma` | ADD `LicenseActivation` model |
| `apps/backend/src/license/license.module.ts` | ADD `LicenseActivationService`, `LicenseGuard` to providers |
| `apps/backend/src/license/license.service.ts` | REWRITE `onModuleInit()` — read from DB |
| `apps/backend/src/license/license.controller.ts` | ADD `POST /activate` endpoint |
| `apps/backend/src/license/license-activation.service.ts` | NEW — CRUD + encryption |
| `apps/backend/src/license/license.guard.ts` | NEW — global license check guard |
| `apps/backend/src/common/decorators/skip-license-check.decorator.ts` | NEW |
| `apps/backend/src/app.module.ts` | ADD `LicenseGuard` to `APP_GUARD` providers |
| `apps/admin/src/routes/(auth)/license/activate.tsx` | NEW — activation page |
| `apps/admin/src/components/layout/authenticated-layout.tsx` | MODIFY — add license check redirect |
| `apps/storefront/app/layout.tsx` | MODIFY — add license status check + block |
| `packages/feature-flags/src/index.ts` | MODIFY — support re-initialization post-startup |
| `apps/backend/.env.example` | ADD `LICENSE_ENCRYPTION_KEY` |

### KeyMate-2

| File | Action |
|------|--------|
| (none) | No changes needed on KeyMate server |

## Migration

- No migration needed for existing deployments (env var → DB switch)
- Existing env vars will be ignored after deployment
- Users will see activation page on next login — they enter their existing license key
- `LICENSE_TOKEN` env var still respected as fallback (backward compat)

# Unified User, Customer & Employee Management — Design Spec

## Overview

Restructure the existing dual-purpose `UserProfile` (legacy auth + customer CRM) into a
clean 3-entity architecture: `betterAuthUser` (auth only), `CustomerProfile` (CRM),
and `Employee` (HR, built on BA user). Add Access Preset permission builder, OAuth
dynamic config, and profile merging logic.

## 1. Data Model Architecture

### betterAuthUser (extend via BA customFields plugin)

| Field                | Type         | Notes                                      |
| -------------------- | ------------ | ------------------------------------------ |
| `role`               | String       | `'customer' \| 'employee' \| 'admin'`      |
| `override_permissions` | String[]?  | Per-user permission overrides (JSON array) |

### CustomerProfile (new CRM model)

| Field              | Type     | Notes                                |
| ------------------ | -------- | ------------------------------------ |
| id                 | String   | @id @default(uuid())                 |
| betterAuthUserId   | String?  | FK → betterAuthUser.id (nullable)    |
| phone              | String   | @unique, primary guest identifier    |
| email              | String?  | nullable, unique if present          |
| name               | String   |
| createdAt          | DateTime |
| updatedAt          | DateTime |

Relations:
- `betterAuthUser` (optional)
- `orders Order[]` (migrate from UserProfile)
- `addresses Address[]` (migrate from UserProfile)

### Employee (restructure existing)

Remove duplicate identity fields (`firstName`, `lastName`, `email`, `phone`).
Identity sourced from linked BA user.

| Field              | Type       | Notes                                |
| ------------------ | ---------- | ------------------------------------ |
| id                 | String     | @id @default(uuid())                 |
| betterAuthUserId   | String     | @unique, FK → betterAuthUser.id      |
| employeeId         | String     | @unique, HR identifier               |
| designationId      | String?    | FK → Designation.id                  |
| departmentId       | String?    | FK → Department.id                   |
| accessPresetId     | String?    | FK → AccessPreset.id                 |
| salary             | Decimal?   |
| bankAccountNo      | String?    |
| bankName           | String?    |
| employmentType     | EmploymentType | enum: full_time, part_time, contract, internship |
| status             | EmployeeStatus | enum: active, inactive, terminated, resigned |
| joiningDate        | DateTime   |
| exitDate           | DateTime?  |
| profilePictureUrl  | String?    |
| notes              | String?    |

### Designation (exists, kept as-is)

```prisma
model Designation {
  id        String     @id @default(uuid())
  name      String     @unique
  slug      String     @unique
  level     Int        @default(0)
  isActive  Boolean    @default(true)
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  employees Employee[]
}
```

### AccessPreset (new)

```prisma
model AccessPreset {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?  @db.Text
  permissions  String[]  // JSON array of permission keys
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  employees   Employee[]
}
```

### AuthSettings (new, for OAuth dynamic config)

```prisma
model AuthSettings {
  id            String  @id @default(uuid())
  provider_name  String  @unique
  is_enabled    Boolean @default(false)
  client_id     String  // encrypted at rest
  client_secret String  // encrypted at rest
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### Address (add CustomerProfile relation)

During migration, add `customerProfileId` (nullable FK → CustomerProfile.id) to the
existing Address model. Post-migration, customer addresses use this FK; employee/admin
addresses keep `userId` → UserProfile.id. Both FKs are nullable but exactly one is set.

### UserProfile (legacy — transition phase, not dropped)

Kept for operational records (posSessions, packingLocks, tasks). Customers
role=customer migrated to CustomerProfile. `betterAuthUserId` field stays as link.

## 2. Permission System

### Centralized Permission Registry

Hardcoded constant in backend, no DB lookup at guard time:

```typescript
export const PERMISSIONS = {
  DASHBOARD:   ['view_analytics', 'view_financial_summary'],
  USER_MGMT:   ['view_users', 'create_users', 'edit_users', 'delete_users'],
  CUSTOMER:    ['view_customers', 'edit_customers', 'delete_customers'],
  EMPLOYEE:    ['view_employees', 'create_employees', 'edit_employees',
                 'delete_employees', 'manage_designations', 'manage_presets'],
  SALES:       ['create_orders', 'view_orders', 'refund_orders', 'apply_discounts'],
  INVENTORY:   ['view_products', 'create_products', 'edit_products',
                 'delete_products', 'manage_stock'],
  SETTINGS:    ['view_system_settings', 'modify_integrations'],
} as const;
```

### AccessPreset CRUD

- Admin sub-route: `/mon/employees/presets/`
- Create/edit: name, description, checkbox matrix (modules → Select All + individual)
- Permissions stored as `String[]` in database
- On save, selected keys compiled into array

### Reusable PermissionCheckboxMatrix Component

Shared React component used in TWO contexts:

1. **AccessPreset form** — defines a named template (saves to `access_presets.permissions`)
2. **User Management form** — assigns permissions directly to a BA user (saves to
   `betterAuthUser.override_permissions`)

Props: `selected: string[], onChange: (perms: string[]) => void`
Renders: module-sectioned checkbox matrix with "Select All" toggles per module.

### Permission Guard

- NestJS `@Permissions('view_orders')` decorator
- Guard reads `request.session.user.permissions` (from extended BA session)
- No DB call at guard time — permissions embedded in session payload
- 403 on missing permission

## 3. Session Extension

`customSession` plugin (existing) extended to inject:

```typescript
{
  user: {
    ...user,
    role: 'customer' | 'employee' | 'admin',
    permissions: string[],      // preset ∪ override_permissions
    customerProfileId?: string, // if linked
    employeeId?: string,        // if employee
  },
  session
}
```

Computed at login/session refresh:
1. Fetch BA user `role` + `override_permissions`
2. If employee (employeeId exists):
   - Query `AccessPreset.permissions` for assigned preset
   - `permissions = presetPermissions ∪ override_permissions`
3. If admin without employee record (standalone mode):
   - No AccessPreset lookup — Employee module may be disabled
   - `permissions = override_permissions` (directly assigned in User Management)
4. If customer: query `CustomerProfile.betterAuthUserId` → inject `customerProfileId`

## 4. Profile Merging & Account Linking

Service: `CustomerLinkingService`
Trigger points:
1. **Email-based** — On CustomerProfile create/update: if email matches BA user, link
2. **Phone-based** — On order placed by logged-in BA user: order phone matches
   unlinked CustomerProfile → link
3. **OAuth/OTP signup** — On BA account creation with email matching existing
   CustomerProfile → link immediately

Rules:
- No temporary dummy emails for phone-only customers (email null until captured)
- Existing linked profile skips re-linking (idempotent)

## 5. Employee Registration Flow

Admin route: `/op/employees/create` (dedicated create page)

1. **Search BA User combobox** — fetches BA users where:
   - `role != 'customer'` OR no existing Employee record
   - Shows name + email
2. **Auto-populated read-only fields** — name, email from BA user
3. **Designation dropdown** — from Designation list, with inline "add new" popover
4. **Access Preset dropdown** — from AccessPreset list
5. **HR fields** — employeeId, employmentType, joiningDate, salary, bank details,
   profile picture upload
6. **On save** — create Employee, set BA user `role = 'employee'`

## 6. OAuth Dynamic Config

### Storage
- `AuthSettings` table: provider_name, is_enabled, client_id (encrypted), client_secret (encrypted)
- Encryption via NestJS crypto service

### Loading strategy (auth.config.ts)
1. Query DB for enabled OAuth providers
2. If DB has entries → decrypt + use as BA OAuth config
3. If DB empty → fall back to env vars
4. Graceful fallback: if DB query fails, use env vars

### Admin UI
- Route: `/mon/settings/auth/`
- Provider cards: toggle switch, credential fields, redirect URI (read-only)
- Validation: warning if toggled-on provider has empty credentials

## 7. Standalone User Management (Fallback Path)

### When Employee Module Is Active
- User Management `/mon/users/` shows the existing CRUD (list, detail).
- To create an employee → redirect to `/op/employees/create`.
- Permissions managed via AccessPresets.

### When Employee Module Is Disabled / Standalone Mode
- User Management `/mon/users/` gains the permission matrix in create/edit dialogs.
- No Employee or AccessPreset tables involved.
- Permissions saved directly to BA user's `override_permissions` field.
- Same `PermissionCheckboxMatrix` component, same visual UI.

### Backend Save Logic
```typescript
// User create/edit — standalone mode (no employee)
await baPrisma.betterAuthUser.update({
  where: { id },
  data: {
    role: 'admin',
    override_permissions: selectedPermissions,
  },
});
```

Use `baPrisma` (BA-dedicated lazy-init Prisma client) for all Better Auth user
mutations, keeping concerns strictly separated from the main PrismaService.

## 8. Data Migration

### Customer migration script
1. Query `UserProfile` where `role = 'customer'`
2. For each: create `CustomerProfile` with name, phone, email, `betterAuthUserId`
   (if linked)
3. Update `Order.customerId` → new `CustomerProfile.id`
4. Update `Address.userId` → new `CustomerProfile.id` (via polymorphic or explicit
   relation)

### Testing protocol
1. Run on local copy of production data
2. Verify: no orphan orders, all customers migrated, addresses intact
3. Validate: order history links, customer detail page renders, no constraint
   violations

## 9. Component Tree

```
Backend:
  prisma/schema.prisma          — all models
  src/better-auth/
    auth.config.ts              — BA init + OAuth loading + customSession
    prisma.ts                   — lazy-init baPrisma
  src/customers/
    customers.module.ts
    customers.service.ts        — + linking logic
    customers.controller.ts
    customer-linking.service.ts — profile merging
  src/employees/
    employees.module.ts
    employees.service.ts        — + BA user search
    employees.controller.ts
  src/access-presets/
    access-presets.module.ts
    access-presets.service.ts
    access-presets.controller.ts
  src/auth-settings/
    auth-settings.module.ts
    auth-settings.service.ts    — encrypt/decrypt
    auth-settings.controller.ts
  src/common/guards/
    permissions.guard.ts        — @Permissions decorator
  src/common/permissions/
    registry.ts                 — PERMISSIONS constant

Admin Frontend:
  src/components/permissions/
    PermissionCheckboxMatrix.tsx — shared component (used in 2 contexts)
  src/features/customers/        — enhance with linking display
  src/features/employees/        — enhance with dedicated create page
  src/features/access-presets/   — new (preset list + matrix form)
  src/features/auth-settings/    — new (OAuth config cards)
  src/features/designations/     — new if not existing
  src/features/users/            — enhance: add permission matrix to create/edit
  src/routes/_authenticated/mon/employees/presets/  — route
  src/routes/_authenticated/mon/settings/auth/      — route
  src/routes/_authenticated/op/employees/create/     — route
```

## 10. Implementation Order

1. Prisma schema changes (CustomerProfile, AccessPreset, AuthSettings, Employee restructure)
2. Data migration script + test
3. Permission registry constant + PermissionCheckboxMatrix component (shared)
4. AccessPreset backend CRUD
5. AccessPreset admin UI (preset list + checkbox matrix form)
6. Designation CRUD admin UI
7. CustomerProfile backend + linking service
8. Employee backend (BA user search endpoint) + dedicated create page
9. User Management enhancement: add permission matrix to create/edit dialogs
10. Session extension (customSession) + @Permissions guard
11. OAuth AuthSettings (backend + admin UI)
12. Integration test & verify

## 11. Rejected Alternatives

- **Option 1 (Minimal Change):** Keeps legacy `UserProfile` coupling — rejected.
- **Option 3 (Hybrid):** Creates fractured customer data — rejected.
- **Employee creation as dialog:** Too complex for a modal — rejected for dedicated page.
- **OAuth creds in plaintext:** Security risk at DB level — rejected in favor of encryption.

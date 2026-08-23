# HR Management Module — Implementation-Ready Technical Plan (v2 — FINAL DECISIONS APPLIED)

> **Status:** PLAN v2 — all 14 open questions resolved; Phase 0 implementation AUTHORIZED (pre-flight blockers only).
> **Branch:** `feature/hr-management` (baseline: `main` @ `d3ff067a` + 1 untracked user spec file `meta-payload-forensic.spec.ts` — must stay untouched).
> **Date:** 2026-08-23 (updated per final architecture approval)

**Goal:** A dedicated "HR Management" dashboard/switcher in the EcoMate admin app covering employment lifecycle, compensation, payroll + payments, commission, leave, weekly-off, employee self-service ("My HR"), with User Management relocated from the Monitoring panel without breaking existing routes/APIs/permissions.

**Architecture:** Third admin panel `/hr/*` (alongside Operational `/op/*`, Monitoring `/mon/*`), NestJS domain modules extending existing `employees`/`payroll`/`designations`/`access-presets` + new `departments`, `hr-payments`, `hr-ledgers`, `commissions`, `hr-leave`, `hr-schedule`, `hr-self-service`; effective-dated + immutable-ledger Prisma model; preset-driven access via scoped ANY-mode PermissionsGuard enforcement; idempotent order-driven commission (`@@unique([orderId, ruleId])`); self-service `/hr/my/*` backend-scoped, mirrored in storefront `/account` "My HR".

**Tech Stack:** NestJS + Prisma (Postgres, 93 migrations, Prisma 7), Better Auth + legacy-JWT dual-mode auth, TanStack Router file-based routes, TanStack Query v5, shadcn/Radix UI, Tailwind v4, sonner, react-day-picker v9, zod/RHF. Feature gating: `@ecomate/feature-flags` (`@RequiresFeature`) + `packages/shared-types` license catalog.

---

## 0. Audit Findings — Current State (source of truth)

### 0.1 What already exists (do not rebuild)

| Area | Exists | Where |
|---|---|---|
| Employee CRUD | YES | `apps/backend/src/employees/` (`/api/employees`, `@Roles('superadmin','admin','manager')` + `@RequiresFeature('admin_employees')`); admin `features/employees/` (list + create wizard `/op/employees/create`) |
| Designation CRUD | YES | `apps/backend/src/designations/` (no feature flag — inconsistent); admin `features/designations/` (`/op/employees/designations`) |
| Department model | Model only — **no controller, no UI** | schema.prisma:1866-1876 |
| AccessPreset | YES | `apps/backend/src/access-presets/`; `/mon/users/presets`; `AccessPreset.permissions String[]` + registry `common/permissions/registry.ts` (7 modules, 25 keys) |
| User management | YES | `apps/backend/src/users/`; `/mon/users`, `/mon/users/$id` |
| Salary | `Employee.salary Decimal` + `SalaryStructure` (effective-dated, single active version) | payroll module (`POST /payroll/salary-structure`) — **no UI calls it** |
| Payslip | YES | `Payslip` + `PayslipItem`; status `draft/approved/paid/cancelled` (`approved` unreachable — approve jumps draft→paid); admin `features/payroll/` = stub list + approve |
| Better Auth user | YES | `betterAuthUser.role String` loose str (`'employee'` used), `override_permissions String[]`, `Employee.betterAuthUserId @unique` (1:0..1 link) |
| Order engine | YES | Relational `OrderStatus` + code-map `ORDER_TRANSITIONS` (orders.service.ts:49); rxjs event bus → SSE only; **tracking outbox = the idempotent async infra**; `Order.assignedToId` = who-sold (first-mutation auto-assign) |
| Feature catalog | YES | `packages/shared-types/src/license-types.ts` — HR & Ops (I): `admin_payroll`, `admin_employees`, `admin_tasks` |

### 0.2 What does NOT exist (greenfield)

`Payroll` model, `Attendance`, `Leave`, `WeeklyOff`, `Commission` (zero code), `Bonus`/`Incentive`/`Fine`/`Deduction` models, employee self-service, `My HR` storefront surface.

### 0.3 Role model today

- `UserProfile.role` enum: `superadmin, admin, cashier, manager, packing_assistant, customer` — **no `employee`**.
- `betterAuthUser.role`: loose string — `'employee'` assignable. Dual-mode auth: JWT path loads `UserProfile.role` ONLY (no permissions); BA path loads session role + preset/override permissions (customSession plugin auth.config.ts:62-117).
- **Drift risk (will be fixed):** manager in UserProfile + employee in BA → legacy-JWT login yields manager privileges without preset permissions.
- `@Roles` = string match, superadmin bypass. `PermissionsGuard` registered globally but **dormant** (zero `@Permissions` usage; passes on empty metadata). Semantics today: ALL-required.

### 0.4 Real gaps discovered during audit (Phase 0 blockers — see §20.0)

1. **Employee status/exitDate silently dropped:** `UpdateEmployeeDto` lacks them → `ValidationPipe({whitelist:true})` strips → status never changes via API.
2. **Payslip `approved` unreachable** — approve jumps draft→paid; no REVIEWED/PARTIALLY_PAID.
3. **Payroll admin UI broken:** backend returns `employee:{employeeId,betterAuthUser:{name}}`; UI types expect `{firstName,lastName}` → "undefined undefined". No period filter/UI for salary-structure/generate/detail.
4. **Dead `departmentId` form field** in employee create (no Department controller).
5. **Unregistered feature keys:** `admin_staff_users`, `admin_access_presets` absent from license catalog (pass only via SKIP_LICENSE_CHECK / `'*'`).
6. **`override_permissions` dead end-to-end:** user DTOs whitelist-strip it; admin UI sends it; nothing persisted.
7. **Latent order bug:** `verifyPayment` writes non-existent `internalNote` (orders.service.ts:2810) → runtime Prisma error when `?note=` passed.
8. `EmployeesService.remove()` resets BA role to hardcoded `'admin'`.
9. `employees.service.update` doesn't re-validate department/designation/preset existence; `DesignationsController` lacks `@RequiresFeature`.
10. `/users/invite` is a stub (out of scope — note only).

---

## 1. Current Architecture Findings (summary)

- **Admin**: 2 panels via TeamSwitcher (`team-switcher.tsx:19-23`), `PanelType='operational'|'monitoring'` (`context/panel-provider.tsx:4`), sidebar groups per panel (`sidebar-data.ts`, `sidebar-filter.ts` feature-gated), file-based TanStack Router (`routes/_authenticated/{op,mon}/*`), no `beforeLoad` auth guards — gating = sidebar visibility + backend 403.
- **Backend**: global chain `DualModeAuthGuard → RolesGuard → LicenseGuard → FeatureGuard → PermissionsGuard` (app.module.ts:178-182); `ValidationPipe({whitelist:true, transform:true})`; interactive `prisma.$transaction`; pagination `{data, meta:{total,page,perPage,totalPages}}`; jest specs mocking PrismaService + `baPrisma`; migrations `YYYYMMDDHHMMSS_snake_case`, `prisma migrate dev`, no destructive ops.
- **Orders**: commission hook targets = `updateStatus` Confirmed side effects (2644-2677), `verifyPayment` Confirmed (2805-2858), POS create (Confirmed/Delivered). Idempotency substrate: unique constraints + `skipDuplicates` or catch-P2002 in-tx.
- **Storefront**: `/account` = single client page, `Section` state machine ('profile'|'orders'|'addresses'|'settings'), legacy-JWT `AuthContext`; zero employee references.
- **UI**: shadcn/Radix inventory; feature-folder template `api.ts`+`hooks.ts`+`index.tsx`+`components/*` + vitest browser tests; status badge = `Record<status, classes>` maps; KPI stat-card pattern; `DatePicker` canonical.

---

## 2. Proposed Architecture (FINAL: third panel)

```
┌─ Admin (React, TanStack Router) ────────────────────────────────┐
│  TeamSwitcher: Operational | Monitoring | HR Management (new)   │
│  /hr/overview          HR dashboard (KPIs, queues)              │
│  /hr/employees         list + filters (relocated from /op)      │
│  /hr/employees/:id     detail hub — 10 tabs (see §14)           │
│  /hr/employees/create  wizard (relocated)                       │
│  /hr/employees/designations, /hr/departments, /hr/presets       │
│  /hr/payroll           periods + payslips + payments            │
│  /hr/commissions       rules + earnings review                  │
│  /hr/leave             types + requests + calendar              │
│  /hr/weekly-off        schedules + calendar                     │
│  /hr/users             User Management (relocated from /mon)    │
│  legacy redirect aliases kept ≥ 1 release: /op/employees*,      │
│  /op/payroll, /mon/users*, /mon/users/presets                   │
└─────────────────────────────────────────────────────────────────┘

┌─ Backend (NestJS, /api) ────────────────────────────────────────┐
│  employees (extend)  designations  departments (new)            │
│  access-presets (extend)  users (routes unchanged)              │
│  payroll (extend)     → payslip lifecycle + periodKey + sums    │
│  hr-payments (new)    → PayrollPayment ledger (partial ok)      │
│  hr-ledgers (new)     → EmployeeEarning + EmployeeDeduction     │
│  commissions (new)    → rules + earnings (order-hooked)         │
│  hr-leave (new)       → types, requests, balances               │
│  hr-schedule (new)    → weekly off + employment history         │
│  hr-self-service (new)→ /hr/my/* (employeeId from session)      │
│  effective-permissions (new) shared helper — deterministic      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Model

### 3.1 Enum extensions (Postgres `ALTER TYPE ... ADD VALUE` — safe, no table rewrite)

| Enum | Add | Final decision ref |
|---|---|---|
| `UserRole` | `employee` | #4 — pure-staff role; UserProfile sync never downgrades manager/cashier/admin |
| `EmployeeStatus` | `on_leave`, `suspended` | #6 — full lifecycle earlier-active/inactive/terminated/resigned; history preserved; valid transitions enforced (Phase 2) |
| `PayslipStatus` | `reviewed`, `partially_paid` | #2 — lifecycle DRAFT→REVIEWED→APPROVED→PARTIALLY_PAID→PAID; cancel only from pre-final states |

### 3.2 New models

```
EmploymentHistory      employeeId, field (status|department|designation|reportingManager|
                       employmentType|weeklyOff), oldValue?, newValue?, effectiveFrom,
                       changedById, createdAt        @@index([employeeId, effectiveFrom])
                       → effective-dated; history append-on-change (Phase 2)

WeeklyOff              employeeId, dayOfWeek Int (0=Sun..6=Sat; single day per row,
                       multiple rows = multiple days), effectiveFrom, effectiveTo?,
                       createdById, note?            @@index([employeeId, effectiveFrom])
                       → change = close old (effectiveTo=now) + insert new; history kept.
                       Date-specific one-off exceptions: OUT OF MVP (decision #8)

LeaveType              name @unique, code @unique, daysPerYear Int, isPaid Boolean @default(true),
                       isActive Boolean @default(true)   SEEDS: Casual 10 / Sick 14 / Annual 20
                       (configurable — decision #9; no accrual engine in MVP)

LeaveRequest           employeeId, typeId, startDate, endDate, days Int, reason,
                       status (pending|approved|rejected|cancelled) @default(pending),
                       approvedById?, approvedAt?, decisionNote?, createdById
                       @@index([employeeId, startDate])  @@index([status])

EmployeeEarning        employeeId, type (bonus|incentive|commission|other), amount Decimal(10,2),
                       reason, applicableFrom?, applicableTo?, status LedgerStatus
                       (draft|approved|paid), approvedById?, approvedAt?, payslipId?,
                       createdById                          @@index([employeeId, applicableFrom])
                       → immutable after approved; approved records later than an APPROVED
                         payslip do NOT mutate it (decision #2 snapshot rule)

EmployeeDeduction      employeeId, type (fine|other), amount Decimal(10,2), reason,
                       applicableFrom?, applicableTo?, status LedgerStatus, approvedById?,
                       approvedAt?, payslipId?, createdById

CommissionRule         employeeId, triggerStatusId? (nullable OrderStatus rel → default
                       Confirmed; null = manual-only), amountType (fixed|percent),
                       amount Decimal(10,2), valueBasis = orderTotal (fixed for MVP, #5),
                       minOrderAmount?, capPerOrder?, isActive @default(true), createdById

CommissionEarning      employeeId, ruleId, orderId, amount Decimal(10,2),
                       status LedgerStatus @default(approved), payslipId?, createdAt
                       @@unique([orderId, ruleId])   ← idempotency anchor (decision #5)
                       @@index([employeeId, createdAt])
                       → multi-employee-per-order allowed via distinct rules; same
                         (order, rule) can never duplicate; immutable; cancel = record

PayrollPayment         payslipId, amount Decimal(10,2), paidAt, method?, referenceNo?,
                       note?, recordedById           → actual-payment ledger; partial
                       allowed; total ≤ netPay enforced in tx; auto-status
                       PARTIALLY_PAID/PAID (decision #2 payroll≠payment)
```

### 3.3 Existing-model modifications

| Model | Change | Ref |
|---|---|---|
| `Employee` | + `reportingToId?` (self-relation); + index `[status, departmentId]`. `salary` = **read-only cached mirror** of active SalaryStructure — UI exposes no independent editable salary field | #7 |
| `SalaryStructure` | + `effectiveTo?` (closed on deactivate); old rows preserved | #7 |
| `Payslip` | + `periodKey?` (unique-per-employee `YYYY-MM`, Phase 4 creates + backfills + unique index), + `reviewedAt?`, `approvedAt?` | #2 |
| `UserProfile` | role enum gains `employee`; sync rule: employee creation sets `role='employee'` ONLY if current ∈ {customer}; manager/cashier/admin never downgraded | #4 |
| `Order` / `OrderStatus` | **no change** — commission uses existing code-map statuses; no new order statuses | #5 |
| `betterAuthUser` | `override_permissions` wired end-to-end (additive grants; deterministic union with preset permissions, server-enforced) | #10 |

---

## 4. Schema / Migration Strategy (FINAL)

| # | Name | Contents | Phase |
|---|---|---|---|
| M0a | `add_employee_user_role` | `UserRole ADD VALUE 'employee'` | Phase 0 |
| M1 | `add_payslip_lifecycle_groundwork` | `PayslipStatus ADD VALUE 'reviewed','partially_paid'`; Payslip + `reviewedAt?`, `approvedAt?`, `periodKey?` (nullable) | Phase 0 |
| M2 | `add_employment_domain` | `EmployeeStatus ADD VALUE 'on_leave','suspended'`; Employee `reportingToId`; EmploymentHistory, WeeklyOff tables | Phase 2 |
| M3 | `add_hr_ledgers` | EmployeeEarning, EmployeeDeduction + enum types (EarningType, DeductionType, LedgerStatus) | Phase 3 |
| M4 | `add_hr_commission` | CommissionRule, CommissionEarning + `@@unique([orderId, ruleId])` | Phase 5 |
| M5 | `add_hr_leave` | LeaveType, LeaveRequest + enum | Phase 6 |
| M6 | `seed_hr_leave_types` | Seed Casual 10 / Sick 14 / Annual 20 (idempotent upsert) | Phase 6 |

Rules (AGENTS.md): every schema edit → dedicated migration; no `db push`/`migrate reset`/destructive flags; schema+migration committed together; `nest build` after backend changes. All migrations additive → zero DB rollback risk; no existing-data migration required.

---

## 5. API / Backend Changes (FINAL)

### 5.1 Payroll architecture (decision #2)

**Current State:** `Payslip` = per-employee-period totals; lifecycle draft→paid (approved unreachable); no payments.
**Problem:** separate payroll-vs-payment concepts; explicit REVIEW/APPROVE; approved = accounting snapshot; corrections without silent edits.
**Proposed Solution:** evolve `Payslip` into the payroll-period entity (no duplicate Payroll table — **explicitly approved**). Lifecycle `DRAFT → REVIEWED → APPROVED → PARTIALLY_PAID → PAID`; cancel only from DRAFT/REVIEWED (CANCELLED). REVIEW and APPROVE are separate explicit actions.

- **`PATCH /payslips/:id/approve` — NO silent reinterpretation (approved constraint).** Phase 4 process: (1) audit all callers (known today: admin `features/payroll/index.tsx` approve button → `api.ts approvePayslip`; verify no others at Phase 4); (2) compatibility decision: keep legacy endpoint with its EXACT current semantics (`draft → paid`) but mark deprecated (warning log + deprecation notice), because an existing caller is migrated same release; (3) introduce explicit semantics via a NEW transition endpoint `PATCH /payslips/:id/status` accepting `{status: REVIEWED|APPROVED}` with the transition map (draft→reviewed, reviewed→approved — both explicit); (4) UI moves to review→approve→pay flow; (5) legacy endpoint removed after ≥1 release.
- **Accounting snapshot:** after APPROVED — totals locked server-side (status check on every mutation path); newly approved earnings/deductions/commissions for the same period are excluded from the approved payslip (period reconciliation in generation + ledger approval checks the payslip's locked status); corrections = explicit mechanism: cancel (DRAFT/REVIEWED) → regenerate, or adjustment entry on next period (MVP Phase 4: cancel+regenerate only; adjustment entry deferred, documented). Historical records preserved.
- **Payroll ≠ payment:** `PayrollPayment` ledger on payslip; one/multiple/partial/delayed payments; sum ≤ netPay; auto status PARTIALLY_PAID/PAID.
- **Calculation (no arbitrary net edits, §5.4):** earnings = active SalaryStructure (basic+allowances, pro-rated by joining date within period) + approved EmployeeEarning ∪ CommissionEarning in [periodStart, periodEnd] + SalaryStructure deductions + approved EmployeeDeduction; Net = Gross − Deductions. Server-side only; `PayslipItem` rows persist every component; duplicate `periodKey` → 409.

### 5.2 Endpoint map

| Module | Endpoints | Guard |
|---|---|---|
| `departments` (NEW) | CRUD `/api/departments` | `@Roles('superadmin','admin','manager')` + `@RequiresFeature('admin_hr')` + `@PermissionsAny('manage_employees')`; delete blocked while employees assigned |
| `employees` (extend) | `PUT /:id` gains `status`/`exitDate` (persist fix) + FK re-validation; status transitions vs EmployeeStatus map (Phase 2 + history); `remove()` role-reset → match UserProfile.role (safe default 'customer') | existing + `@RequiresFeature('admin_employees')` |
| `payroll` (extend) | period filter `?periodKey=` on `GET /payslips` (Phase 0); lifecycle endpoints (Phase 4, §5.1) | `@Roles('superadmin','admin','manager')` + `@PermissionsAny('manage_payroll')` + `@RequiresFeature('admin_payroll')` |
| `hr-payments` (NEW) | `POST/GET /payroll/payslips/:id/payments`, `DELETE .../:id` (only while DRAFT/REVIEWED; else adjustment) | superadmin/admin/manager + `manage_payroll` + `admin_payroll` |
| `hr-ledgers` (NEW) | `POST/GET /hr/earnings`, `POST/GET /hr/deductions` (+ approval) — immutability after approved | superadmin/admin/manager + `manage_payroll`/`manage_employees` + `admin_hr` |
| `commissions` (NEW) | rules CRUD `/commissions/rules`, `GET /commissions/earnings`, `POST /commissions/evaluate/:orderId` (idempotent manual) | superadmin/admin/manager + `manage_commissions` + `admin_hr` |
| `hr-leave` (NEW) | LeaveType CRUD; requests CRUD + approve/reject | superadmin/admin/manager + `manage_leave` + `admin_hr` |
| `hr-schedule` (NEW) | `GET/POST /weekly-off/:employeeId`, `GET /employees/:id/history` | superadmin/admin/manager + `manage_schedule` + `admin_hr` |
| `hr-self-service` (NEW) | `/hr/my/*` — profile, salary, payslips, payments, commissions, earnings, deductions, leave (submit/cancel own), weekly-off | `@Roles('employee')`; employeeId server-resolved from session; every read/write scoped `findFirst({ where: { id: <resolvedId>, betterAuthUserId: <session id> } })` → 404 on mismatch |
| `hr-dashboard` (NEW) | `GET /hr/overview` — single aggregation query | superadmin/admin/manager + `view_hr` + `admin_hr` |
| `users`/`access-presets` | user create/update DTOs gain `override_permissions?: string[]` → persisted to betterAuthUser (registry-validated, unknown keys stripped) | unchanged routes/decorators |

**HR managerial guard pattern (decision #3, resolves RolesGuard/PermissionsGuard interplay):** HR admin controllers use `@Roles('superadmin','admin','manager')` + `@PermissionsAny(<key>)` + `@RequiresFeature('admin_hr')` (or narrower existing key). Enforcement: superadmin passes RolesGuard (bypass) + has all keys; admin passes both; **manager passes RolesGuard but only reaches endpoints whose ANY-permission key is in his effective permissions (preset ∪ override)**; cashier/packing_assistant/employee excluded by RolesGuard; employee excluded from all managerial HR by role list. UI hiding alone is never sufficient — server enforcement mandatory.

### 5.3 Commission hooks (decision #5)

`CommissionService.evaluateOrder(orderId, tx)` called inside the interactive transactions at exactly: `handleConfirmedSideEffects` (updateStatus:2644) + Confirmed branch of `verifyPayment` (2805) + POS `create` (status Confirmed/Delivered). In-tx: load active rules (`triggerStatusId = order.statusId` or null = manual-only), compute (fixed | percent×order.total; skip if total < minOrderAmount; cap at capPerOrder), `createMany({ skipDuplicates: true })` → unique `[orderId, ruleId]` = exactly-once under re-trigger/race/double-path; catch P2002 → no-op. Multiple employees per order = distinct rules per employee. No new order statuses. Percent basis = order total (MVP).

### 5.4 Payroll calculation — see §5.1.

### 5.5 Effective permissions — deterministic + server-enforced (decision #10)

**Current State:** BA customSession computes `preset ∪ override` only for `role==='employee'`; admin/superadmin get ALL keys; JWT path carries NO permissions at all; `/auth/me` fallback computes for admin/superadmin only.
**Problem:** HR ANY-mode PermissionsGuard must behave identically regardless of auth path (JWT bearer in admin app vs BA cookie), and manager-with-preset must get preset keys on BOTH paths. Duplicated logic = drift.
**Proposed Solution (Phase 0):** single shared helper `computeEffectivePermissions(role, employeeLink, overridePermissions)` in `apps/backend/src/common/permissions/effective-permissions.ts`:
- `superadmin`/`admin` → all registry keys (unchanged admin behavior);
- otherwise → union(AccessPreset.permissions, betterAuthUser.override_permissions) (both additive grants, deduped, deterministic order — **no deny semantics**, decision #10); empty when no employee link/no preset;
- used by: BA customSession (refactored to call it — outputs must be byte-identical to today for existing users), DualModeAuthGuard JWT path (populate `request.user.permissions`), `/auth/me` fallback.
Unknown keys stripped at write time (persistence) AND at read time (defense in depth).

---

## 6. Authorization Model (FINAL)

| Layer | Decision |
|---|---|
| Panels | TeamSwitcher gains HR panel (Phase 1): visible to superadmin/admin + anyone with `view_hr` persistence… (UI: role ∈ {superadmin, admin} OR hasFeature admin_hr AND effectivePermissions contains view_hr) |
| HR admin APIs | `@Roles('superadmin','admin','manager')` + `@PermissionsAny(HR key)` + `@RequiresFeature(admin_hr | narrower)` — manager needs preset key; cashier/employee blocked (decision #3) |
| PermissionsGuard | Scoped ANY-mode: new `@PermissionsAny(...)` decorator + `PERMISSIONS_ANY_KEY`; default `@Permissions(...)` stays ALL-mode (no existing usage → no behavior change anywhere); guard passes when `some(key ∈ user.permissions)` |
| EMPLOYEE role | `UserRole.employee`; sync rule never downgrades manager/cashier/admin (decision #4); excluded from HR admin by role list; sole role allowed on `/hr/my/*` |
| Self-service | `@Roles('employee')` + server-resolved employeeId + own-data 404s |
| Preset keys (new, registry) | `view_hr`, `manage_employees`, `manage_payroll`, `manage_commissions`, `manage_leave`, `manage_schedule` (decision #3) |
| Legacy JWT parity | JWT path permissions = helper; employee via JWT gets preset∪override, NOT role privileges (decision #10) |

---

## 7–10. Commission / Leave / Weekly-off / User-Employee (FINAL — decisions #5/#8/#9/#4)

- **Commission:** §3.2 + §5.3. Default trigger Confirmed; percent basis order total; fixed+percent; multi-rule per employee; multi-employee per order; `@@unique([orderId, ruleId])` + transactional idempotent creation; no new Order statuses; earnings immutable, payroll-integrated.
- **Leave:** configurable types; seeds Casual 10 / Sick 14 / Annual 20 (seed-defaults only, admin-configurable, no accrual engine); requests + approval workflow (pending/approved/rejected/cancelled); balance = daysPerYear − approved in calendar year (computed); list + month calendar; self-service submit/cancel-own.
- **Weekly off:** effective-dated recurring weekday rows; multiple rows = multiple days; change preserves history (close+insert); one-off date exceptions out of MVP.
- **User/Employee:** `User 1:0..1 Employee` (existing unique stays). User Role ≠ Employee ≠ Designation ≠ Access Preset. Manager/cashier/admin may hold an Employee record (role untouched). Pure staff → EMPLOYEE role. Auth identity stays in User domain; employment/compensation domain in Employee.

---

## 11–13. Relocation, Dashboard, Self-Service (FINAL — decisions #12/#1/#2-ref)

- **Relocation (Phase 1):** `/mon/users`, `/mon/users/$id`, `/mon/users/presets` → `/hr/users`, `/hr/users/$id`, `/hr/presets`; `/op/employees*` → `/hr/employees*`; `/op/payroll` → `/hr/payroll`. Backend APIs unchanged. Old routes = `<Navigate replace/>` aliases kept ≥1 release. Sidebar entries moved to hr panel.
- **HR dashboard (Phase 1):** `/hr/overview` — ≤8 StatCards (Total/Active Employees, Payroll Last Period, Pending Approvals queue, Paid This Month, Pending Dues, Commission This Month, Pending Leave) + Recent Payments + Pending Leave lists. One aggregation endpoint. No widget jungle.
- **Self-service (Phase 7):** backend `/hr/my/*` (§5.2) + storefront `/account` gains `'hr'` Section + "My HR" sidebar item (visible when `user.role==='employee'`); `sections/HrSection.tsx` pills: Profile/Salary/Payslips/Payments/Commission/Leave/Schedule. Server-enforced scope; security tests mandatory.

---

## 14. UI/UX Information Architecture (FINAL — decision #13)

Employee detail = `/hr/employees/:id` with overview header + **10 tabs** (approved): Overview, Employment, Compensation, Payroll, Payments, Commission, Earnings, Deductions, Leave, Schedule & History. Consolidation later ONLY on implementation evidence. List page: search + facet filters (status, department, designation, type, payroll-status). Conventions: feature folders, RHF+zod forms, `DatePicker`, ConfirmDialog, sonner, status badge Record maps, `tabular-nums`, `Header fixed`+`Main`.

---

## 15. Feature Flags (FINAL — decision #11)

- Umbrella: **`admin_hr`** (panel + shell + dashboard + new modules). Narrower existing `admin_employees`, `admin_payroll` reused where appropriate.
- Register **all missing keys properly** in `packages/shared-types/src/license-types.ts`: `admin_hr` (new), `admin_staff_users`, `admin_access_presets` (existing-but-unregistered) → rebuild shared-types package (node_modules dist sync). No license-check bypass reliance (SKIP_LICENSE_CHECK remains dev-only).
- KeyMate production license must include `admin_hr` (ops note).

---

## 16. Testing Strategy (FINAL)

| Layer | Coverage |
|---|---|
| Unit (jest) | effective-permissions determinism (admin→all, preset∪override union/dedupe, unknown keys stripped at write+read, EMPLOYEE vs manager parity), PermissionsGuard ANY-mode, employee status/exitDate DTO persistence, department CRUD, payroll period filter, legacy `internalNote` fix, salary mirror sync (Phase 3) |
| Integration | payroll workflow DRAFT→REVIEWED→APPROVED→PARTIALLY_PAID→PAID (Phase 4), correction/regeneration, snapshot-lock (later ledgers don't mutate approved payslip), payment partials, commission hooks on all 3 paths + duplicate prevention, leave approval, weekly-off history |
| Security | employee B cannot read A via `/hr/my/*`; manager without preset key → 403; cashier → 403; employee → 403 HR admin; JWT-vs-BA permission parity; override_permissions additive only |
| Regression | full suites each phase: backend (1670+ baseline), admin vitest (308+), storefront (199+) — re-baselined Phase 0 |
| E2E (playwright) | HR dashboard KPIs, employee create→status transitions, payslip generate→review→approve→pay, commission order→single earning, leave request→approve, self-service own-data-only |

---

## 17. Security Risks

1. Legacy-JWT role drift → UserProfile.role enum + sync + effective-permissions helper on both paths. 2. Cross-employee access → server-resolved id + 404s + tests. 3. Preset bypass → server-side `@PermissionsAny` (not UI-only). 4. Payroll tampering → status lock + no net edits + immutable ledgers. 5. Duplicate/race commission → unique constraint + skipDuplicates + in-tx. 6. PermissionsGuard global-regression → ANY-mode metadata scoped to HR controllers only (all-mode default untouched; full regression). 7. Manager/cashier accidental HR role grants → RolesGuard list excludes cashier; manager needs preset key.

---

## 18. Performance Considerations

All new FKs indexed; server pagination + facets; tab-scoped lazy queries on employee detail; payroll generation via batch groupBy + createMany; `/hr/overview` single aggregation query; no N+1; Phase 0 `EXPLAIN` spot-check on employee list + payslip period queries.

---

## 19. Backward-Compatibility Risks & Mitigations (FINAL)

| Risk | Mitigation |
|---|---|
| Route moves break bookmarks | `<Navigate replace/>` aliases ≥1 release (decision #12) |
| `PATCH /payslips/:id/approve` semantics | audit callers first; legacy endpoint keeps EXACT current semantics, deprecated; new explicit `PATCH /:id/status` review/approve; callers migrated; removal ≥1 release (decision #2) |
| JWT path gains `permissions` field | additive; `/auth/me` + guard behavior consistent via helper; tests |
| UserRole/EmployeeStatus enum extension | additive; admin badge maps + roles list extended when UI lands |
| PermissionsGuard activation | metadata only on HR controllers; no-metadata → pass (unchanged); full regression |
| `Employee.salary` → read-only mirror | Phase 3 UI edit removed; employee create keeps salary field which syncs to SalaryStructure (single source) |
| Order tx latency (commission) | indexed lookups; measured Phase 5 |
| override_permissions additive semantics | union only, no deny; deterministic helper; registry validation |

---

## 20. Implementation Phases (FINAL)

### Phase 0 — Pre-flight blockers (AUTHORIZED — scope strictly limited)

| # | Item | Files (anchor) |
|---|---|---|
| P0-A | **Effective permissions + auth groundwork:** shared `computeEffectivePermissions` helper; JWT path populates `request.user.permissions`; BA customSession refactored to helper (identical output); `/auth/me` consistency | `common/permissions/effective-permissions.ts` (new), `auth/dual-mode-auth.guard.ts`, `better-auth/auth.config.ts`, `auth/auth.controller.ts` |
| P0-B | **PermissionsGuard scoped ANY-mode** (`@PermissionsAny`) + HR keys in registry (`view_hr`, `manage_employees`, `manage_payroll`, `manage_commissions`, `manage_leave`, `manage_schedule`) | `common/guards/permissions.guard.ts`, `common/decorators/permissions.decorator.ts`, `common/permissions/registry.ts` |
| P0-C | **UserRole.employee enum + sync rule:** migration M0a; employee create/update syncs UserProfile.role='employee' iff ∈ {customer}; remove() role-reset fix (mirror UserProfile.role, default 'customer'); BA role writes consistent | migration M0a, `employees/employees.service.ts`, `users/` |
| P0-D | **Employee status/exitDate DTO + lifecycle writes** (stop the strip); FK re-validation on update | `employees/dto/update-employee.dto.ts`, `employees.service.ts` |
| P0-E | **Departments module** (controller/service/DTO/spec) + admin UI (list/CRUD dialog) + employee create wizard department dropdown (fix dead field) | `src/departments/` (new), `features/departments/` (new), `features/employees/create.tsx` |
| P0-F | **Payroll UI data-shape + period filter:** fix undefined-name rendering; backend `?periodKey=` filter on `GET /payslips`; admin list filter UI | `payroll/payroll.service.ts`+controller, `features/payroll/{api.ts,index.tsx}` |
| P0-G | **Payslip lifecycle groundwork:** migration M1 (enum values + reviewedAt/approvedAt/periodKey nullable); DTO/type groundwork only — lifecycle endpoints are Phase 4 | migration M1, `payroll/` |
| P0-H | **Latent `internalNote` bug fix** in verifyPayment | `orders/orders.service.ts:2810` + spec |
| P0-I | **Feature-key registration:** `admin_hr`, `admin_staff_users`, `admin_access_presets` in license catalog + rebuild shared-types | `packages/shared-types/src/license-types.ts` (+ spec) |
| P0-J | **override_permissions end-to-end:** user create/update DTOs + persistence to betterAuthUser (registry-validated, additive) | `users/dto/*`, `users.service.ts` |
| P0-K | **Baseline re-verification** — full backend jest + nest build; admin vitest + tsc; storefront test + tsc | — |

**Explicitly NOT in Phase 0:** panel/routes relocation (Ph1), EmploymentHistory/WeeklyOff tables (Ph2), ledgers (Ph3), payslip lifecycle endpoints + PayrollPayment (Ph4), commission (Ph5), leave (Ph6), self-service (Ph7). No premature HR-phase features.

### Phases 1–8 (unchanged intent; details from v1)

1. **HR shell:** third panel + TeamSwitcher + PanelType `'hr'`; `/hr/*` routes + sidebar groups + redirect aliases; `/hr/overview` dashboard.
2. **Employment domain:** M2 (EmployeeStatus + reportingToId + EmploymentHistory + WeeklyOff) + APIs/UI + status transition machine + calendar.
3. **Compensation + ledgers:** M3; SalaryStructure UI (single source of truth; `Employee.salary` read-only mirror, edit removed); earnings/deductions CRUD + approval + immutability; Compensation tabs.
4. **Payroll lifecycle + payments:** M1 extension usage; `PATCH /:id/status` (REVIEWED/APPROVED explicit), snapshot lock, periodKey unique+backfill, pro-ration, ledger sums; `hr-payments` + PayrollPayment UI; legacy approve deprecation per §5.1.
5. **Commission:** M4; rules CRUD + 3 hooks + evaluate endpoint + earnings UI + tests.
6. **Leave:** M5+M6; types/requests/approvals/balances/calendar.
7. **Self-service:** `/hr/my/*` + storefront My HR.
8. **Final:** full regression ×3, E2E, performance pass, docs, alias cleanup (≥1 release).

---

## 21. File/Module-Level Change Map (key files)

**Backend:** `prisma/schema.prisma` + `prisma/migrations/M0a..M6/`; `src/employees/*`; `src/payroll/*`; `src/departments/*` (new); `src/hr-payments/*`, `src/hr-ledgers/*`, `src/commissions/*`, `src/hr-leave/*`, `src/hr-schedule/*`, `src/hr-self-service/*` (new); `src/orders/orders.service.ts` (hooks + internalNote fix); `src/pos-orders/*` (hook); `src/users/*` + `src/access-presets/*` (override_permissions); `src/common/permissions/{effective-permissions.ts, registry.ts}`; `src/common/guards/permissions.guard.ts`; `src/common/decorators/permissions.decorator.ts`; `src/auth/dual-mode-auth.guard.ts`; `src/better-auth/auth.config.ts`; `src/auth/auth.controller.ts`; `src/app.module.ts`; `packages/shared-types/src/license-types.ts`.

**Admin:** `components/layout/{team-switcher,types}.tsx`; `context/panel-provider.tsx`; `components/layout/data/sidebar-data.ts`; `routes/_authenticated/hr/**` (new); redirect aliases in `routes/_authenticated/{op,mon}`; `features/employees/` (detail hub), `features/payroll/`, `features/users/`+`features/access-presets/` (relocate), `features/designations/`; new `features/{departments, hr-dashboard, commissions, hr-leave, hr-schedule, hr-ledgers}/`; `components/layout/data/sidebar-filter.test.ts`.

**Storefront:** `app/(main)/account/page.tsx` (+ `'hr'` Section), `components/account/Sidebar.tsx`, new `sections/HrSection.tsx`, `lib/api/hr.ts`.

---

## 22. Dependency Graph

```
commissions ──> orders (hooks)            hr-ledgers ──> payroll (reconciliation), employees
payroll ──> salary-structure, ledgers, commissions (approved sums only)
hr-payments ──> payroll (lock/status)     hr-leave, hr-schedule ──> employees
hr-self-service ──> all read models + leave writes
hr-dashboard ──> employees, payroll, ledgers, commissions
auth: dual-mode-auth.guard ──> effective-permissions ──> registry; customSession ──> same helper
admin/hr routes ──> features/* (per page) ; Phase 0 agents: A(auth) ✕ B(employees) ✕ C(payroll) — see §20 note
```

## 23. Rollback Considerations

All migrations additive → drop new tables/columns/enum values documented per migration. Feature flip `admin_hr` off → UI hidden + API 403 instantly. Legacy approve endpoint + old routes remain until ≥1 release after cutover.

## 24. Explicit Assumptions

1. Baselines re-verified Phase 0 on `main@d3ff067a` (differs from last-recorded branch numbers).
2. Currency BDT, `Decimal(10,2)`; dev/QA `SKIP_LICENSE_CHECK=true`; production KeyMate license gains `admin_hr` (ops).
3. Storefront auth = legacy JWT on `/account`; employee role flows via UserProfile.
4. No attendance/time-clock module (spec doesn't demand; `on_leave` covers state).
5. Leave balances = entitlement − used (no accrual); commission MVP basis = order total; multi-employee per order allowed (distinct rules).
6. No deletes for history: cancel/adjustment records; ledgers immutable after approval.
7. Deferred: PDF/email payslips, bulk payroll generation, multi-company.
8. Untracked `meta-payload-forensic.spec.ts` untouched (excluded from commits).

## 25. Open Questions — ALL RESOLVED (final answers)

| # | Question | Resolution |
|---|---|---|
| 1 | Panel model | **Third dedicated panel `/hr/*`** (decision #1) |
| 2 | Payslip vs new Payroll table | **Evolve Payslip**; no Payroll table (decision #2) |
| 3 | `PATCH /payslips/:id/approve` semantics | **No reinterpretation** — keep exact semantics deprecated; new explicit `PATCH /:id/status` (REVIEWED/APPROVED) (decision #2 + §5.1) |
| 4 | Manager HR access via preset | **Approved** — `@Roles('superadmin','admin','manager')` + `@PermissionsAny` scoped ANY-mode, 6 HR keys (decision #3) |
| 5 | Commission trigger/basis | Confirmed default; percent basis = order total; multi-rule/multi-employee; `@@unique([orderId, ruleId])` (decision #5) |
| 6 | Multi-employee per order | Allowed (distinct rules) (decision #5) |
| 7 | EmployeeStatus additions | `on_leave`, `suspended` (decision #6) |
| 8 | `Employee.salary` | Read-only cached mirror of active SalaryStructure; UI edit removed (decision #7) |
| 9 | Weekly off | Effective-dated weekday rows; multi rows = multi days; one-off date exceptions OUT of MVP (decision #8) |
| 10 | Leave seeds | Casual 10 / Sick 14 / Annual 20 — configurable seeds (decision #9) |
| 11 | override_permissions | **Wired end-to-end, additive grants, union with preset, deterministic + server-enforced** (decision #10) |
| 12 | Feature key | `admin_hr` umbrella + reuse narrower keys; **register all missing keys** (decision #11) |
| 13 | User Management location | `/hr/users` + `/hr/presets`, backend stable, redirect aliases (decision #12) |
| 14 | Employee detail tabs | **10 tabs as proposed** (decision #13) |

---

## Phase 0 execution notes (sub-agent coordination)

- Schema/migrations (M0a, M1): created centrally by primary thread BEFORE agent work — no agent creates or edits migrations.
- Ownership boundaries (no overlapping files): **Agent A — auth/permissions/users** (P0-A,B,C-partial,J,I); **Agent B — employees/departments** (P0-C-partial,D,E); **Agent C — payroll/orders** (P0-F,G,H).
- Shared-interface coordination: `computeEffectivePermissions` signature fixed by primary thread; Agents B/C consume `request.user.permissions` presence only (no signature coupling).
- Authorization changes reviewed as ONE coherent change (Agent A output + primary-thread review before integration).
- Every agent result verified (tests + build) before merge; full regression after integration; single commit; worktree clean (excluding untracked user file).
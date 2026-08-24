# HR Production Hardening — Implementation Plan

> **For agentic workers:** execute phase-by-phase via sub-agents (ownership map below). Steps are phase-level tasks with exact contracts; every phase must add tests and keep suites green. Primary thread owns ALL migrations, cross-domain financial invariants, integration, final verification.

**Goal:** Close G-01…G-32 from the Production Readiness Gap Audit — make HR Management safe for real payroll/commission/attendance/lifecycle operations.

**Architecture:** Extend the existing modules (commissions, payroll, employees, hr-attendance, hr-leave, hr-self-service, attendance-devices, storefront My HR) — no new panels, no redesign. Financial changes follow one principle: **originals immutable, corrections/voids/reversals auditable**. Attendance follows: **business date = Asia/Dhaka, derived flags instead of silent mutations**.

**Tech stack:** NestJS + Prisma 7 (Postgres), TanStack Router/Query, Radix + shadcn, Next.js storefront, Vitest/Jest, Playwright.

**Branch:** `feature/hr-production-hardening` (off `main` @ `49cad562`). NO merge, NO destructive ops, `meta-payload-forensic.spec.ts` untouched.

---

## Finding Map (re-verified against current code)

| ID | Root cause | Required change | Deps | Phase | Verification |
| --- | --- | --- | --- | --- | --- |
| G-01 | no commission reversal on cancel/refund/edit | order hooks → auditable `CommissionReversal` | M02, order status flow | P1 | unit: full/partial refund reversal; idempotency; live API |
| G-02 | `generatePayslip` excludes commission | include approved+unreversed CommissionEarning as distinct `Commission` items; mark `payslipId` (snapshot lock) | M02 | P1 | payslip item test; double-inclusion blocked |
| G-03 | no way to create a day without an event (absence) | `POST /hr/attendance/days` (ABSENT/ON_LEAVE/WEEKLY_OFF, reason, adjustment entry, `manage_attendance_adjustments`) | — | P3 | unit + browser |
| G-04 | UTC business date | Dhaka-based date in check-in/session/day queries; UI stops sending date; ingestion uses Dhaka range | — | P3 | 00:30 BDT boundary test |
| G-05 | payslip/salary actors missing | `reviewedById/approvedById` on Payslip; `createdById/updatedById` on SalaryStructure | M01 | P1 | actor-assert tests |
| G-06 | no employee search/filter/sort | server search (name/email/employeeId ILIKE) + filters (status/dept/desig/manager/method) + sort + perPage 25/50 | — | P2 | list tests + browser 5k-ish |
| G-07 | hard delete destroys/collides financial rows | `remove()` blocked with friendly 409 when financial/history rows exist; status-based archive documented | — | P2 | delete-guard tests |
| G-08 | no rehire | transitions: terminated/resigned → active (requires new joiningDate, clears exit) + history entry | — | P2 | rehire test |
| G-09 | My HR lacks leave balance | `GET /hr/my/leave-balances` + storefront display | — | P4 | self-service test |
| G-10 | dual-role loses My HR | eligibility = Employee record exists; `/auth/me` exposes `isEmployee`; hr-self-service guard accepts any role for staff w/ Employee; ownership = resolved id | — | P4 | security tests |
| G-11 | picker caps | attendance today/adjustments pickers → server search select | G-06 | P3/P5 | browser |
| G-12 | open sessions never settle | derived `MISSING_CHECKOUT` flag (open session older than Dhaka day end); admin close-session action (adjustment, reason) | — | P3 | unit/browser |
| G-13 | device ops | device list: lastSync, failure, unmapped count; retry = sync button; retention deferred | — | P6 | tests |
| G-14 | leave overlap | overlap guard (pending/approved) on create + approve; balance restored via derived calc (cancelled/approved excluded) | — | P4 | overlap tests |
| G-15 | create contradictions | nested create: optional SalaryStructure + BankAccountDto + attendanceMethod in one tx; admin create flow rework (review step) | — | P2 | create tests |
| G-16 | bank verification frozen | verificationStatus editable via PATCH (workflow: PENDING→VERIFIED/REJECTED with actor) | — | P2 | test |
| G-17 | commission UX | earnings: order displayId, rule name, reversed badge, inPayroll badge, totals/filters | G-01 | P1/P6 | vitest |
| G-18 | attendance reporting | `GET /hr/attendance/report` (present/absent/leave/weekly-off/missing-checkout/minutes; derived joins — no auto-generation) | P3 | P3 | tests |
| G-19 | personal edits unaudited | EmploymentHistory rows for personal/bank/salary changes (JSON old/new) | — | P6 | audit test |
| G-20 | payment delete silent | DELETE replaced by void (`voidedAt/ById/voidReason`, reason required, sums exclude voided) | M03 | P1 | void tests |
| G-21 | session expiry UX | admin api-client 401 interceptor → sign-out + friendly message; storefront same | — | P5 | browser |
| G-22 | enum/label raw + NID copy | gender label map; NID masked in list views, plain in edit (admin only) | — | P5 | vitest |
| G-23 | payroll totals | list endpoint returns `summary` (counts/gross/commission/deductions/net/paid/outstanding per period) | G-02 | P1 | test + UI |
| G-24 | weekly-off | no code change (effective-dated engine correct); UI diff/history already exists — document as OK; dept schedules deferred P3 | — | — | — |
| G-25 | avatar.svg 404 | pre-existing; left (documented, non-blocking) | — | — | — |
| G-26 | 11-tab mobile | tab strip stays scrollable; add active-tab pill markers + `aria-label`s; P3 polish | — | P5 | browser mobile |
| G-27 | no export | DECISION D8: deferred (P3, documented) | — | — | — |
| G-28 | raw events growth | indexed by idempotencyKey; retention deferred (P3, documented) | — | — | — |
| G-29 | help gaps | extend help: missing checkout, devices, My HR, troubleshooting | — | P7 | render test |
| G-30 | double-submit | audit dialogs; ensure `isPending` disable everywhere | — | P5 | code audit |
| G-31 | future structure UX | show "pending structure (effectiveFrom X)" when effectiveFrom > today | — | P5 | vitest |
| G-32 | terminology | Bangla/English consistency pass (approved Bangla strings, English terms) | — | P5 | copy review |

**Deferred (documented, non-blocking):** G-24 (weekly-off dept schedules), G-25, G-27 (payslip export, D8), G-28 (retention).

## Product Decisions (safe defaults — auditable, documented)

- **D1 Commission reversal:** original earning immutable. Full order cancel/refund → full reversal. Partial refund → proportional reversal `min(1, refundedAmount/orderTotal)`; reversal rows idempotent per (earningId, orderId). Manual reversal endpoint for operator (reason required).
- **D2 Commission in payroll:** distinct `Commission` payslip items; `CommissionEarning.payslipId` set at generation → excluded from later payslips (snapshot lock). Reversal after approval: NOT payable retroactively; payslip unchanged; reversal reduces future payable + report shows adjusted.
- **D3 Absence recording:** admin-only endpoint, `manage_attendance_adjustments`, creates Day (no session) + adjustment row (reason). No client employeeId authority.
- **D4 Missing checkout:** derived flag only; admin close action writes an adjustment (original checkOutAt null → corrected). No auto-checkout, no overnight split.
- **D5 Leave:** stay calendar-day counting (documented policy); add overlap guard; balances derived from startDate-year approved requests; cancelling approved restores balance (derived).
- **D6 Mid-month salary:** deterministic day-basis: structural earnings prorated by days each effective window covers within the period (windows from SalaryStructure.effectiveFrom..effectiveTo/period-end); joining-date pro-ration retained as floor. Single test fixture per window.
- **D7 Employee deletion:** hard delete allowed only when NO financial/history records exist (bank accounts, payslips, earnings, deductions, commissions, attendance days, leave, salary structures, history) → else 409 "archive instead". Rehire = transition with new joiningDate.
- **D8 Payslip export:** deferred.

## Migrations (PRIMARY THREAD — applied before Phase 1 agents)

1. `20260830000000_hr_hardening_actors` — `ALTER TABLE "Payslip" ADD COLUMN "reviewedById" TEXT, ADD COLUMN "approvedById" TEXT;` `ALTER TABLE "SalaryStructure" ADD COLUMN "createdById" TEXT, ADD COLUMN "updatedById" TEXT;`
2. `20260830000001_hr_commission_reversal` — `CREATE TABLE "CommissionReversal" ("id" TEXT NOT NULL PRIMARY KEY, "commissionEarningId" TEXT NOT NULL, "orderId" TEXT, "amount" DECIMAL(10,2) NOT NULL, "reason" TEXT NOT NULL, "refundedAmount" DECIMAL(10,2), "reversedById" TEXT, "reversedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);` + FK → CommissionEarning (ON DELETE CASCADE) + `CREATE UNIQUE INDEX "CommissionReversal_earning_order_key" ON "CommissionReversal"("commissionEarningId","orderId") WHERE "orderId" IS NOT NULL;` + index on earningId.
3. `20260830000002_hr_payment_void` — `ALTER TABLE "PayrollPayment" ADD COLUMN "voidedAt" TIMESTAMP(3), ADD COLUMN "voidedById" TEXT, ADD COLUMN "voidReason" TEXT;`

Applied via `npx prisma migrate deploy` + `npx prisma generate`. No destructive ops.

## Phase ownership (disjoint files)

| Phase | Agent | Owns |
| --- | --- | --- |
| P0 | PRIMARY | branch, migrations, plan |
| P1 Financial | B | commissions (reversal service/controller/order hooks), payroll (commission items, summary, actors), hr-payments (void), admin: commission earnings UI, payroll list totals, payments void UI, related tests |
| P2 Employee | A | employees backend (nested create, remove guard, transitions/rehire, search/filters/sort, bank verification workflow, personal audit rows), admin employees list + create flow + tests |
| P3 Attendance | D | hr-attendance backend (business date, absence days, close-session, report), attendance-devices (Dhaka ranges), admin attendance UI, storefront My HR attendance date fixes, tests |
| P4 Leave+Self | E | hr-leave (overlap guard), hr-self-service (leave-balances, guard change), auth/me isEmployee, storefront My HR gating + balance UI, tests |
| P5 UX | F | admin api-client 401 interceptor, session-expiry messaging, labels/aria/terminology, future-structure chip, double-submit audit, mobile tab polish |
| P6 Audit/Perf/Sec | G | audit rows wiring, permission matrix tests, device unmapped metrics, performance pass, security re-run |
| P7 Help | H | `/hr/help` extension (Bangla), glossary, troubleshooting |
| P8 QA | PRIMARY | full regression ×3 + builds + browser smoke + adversarial + independent re-audit + forensic report |

## Global invariants (agents must not violate)

- Original financial/attendance records are NEVER mutated; corrections create audit rows.
- `Employee.salary` = read-only mirror (SalaryStructure canonical).
- Payroll resolution: structure windows (D6); commission inclusion only when `payslipId IS NULL` and not reversed; snapshot via PayslipItem rows.
- Attendance date: stored UTC-midnight = Dhaka date; server derives Dhaka boundaries; client never overrides today for check-in.
- Backend authorization authoritative; no UI-hiding-only changes; ownership = resolved session employee.
- Every new endpoint: `@Roles` + `@PermissionsAny` + `@RequiresFeature('admin_hr')` (or self-service scoping), friendly errors (no raw Prisma/SQL).

## Verification gates per phase

Backend: `npx jest` + `npx nest build`. Admin: `npx tsc --noEmit` + `npm test`. Storefront: `npx tsc --noEmit` + `npm test`. Phase 8: production builds ×4 + full browser smoke + adversarial matrix + finding matrix report.
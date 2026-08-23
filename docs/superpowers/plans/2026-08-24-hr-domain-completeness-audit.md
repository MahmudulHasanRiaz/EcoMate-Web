# HR Management — Domain Completeness Audit & Architecture Expansion (Plan v3)

**Status:** PROPOSED — pending review/approval. No code written.
**Branch note:** planning artifact only; do NOT merge to `main` this round.
**Baseline:** shipped HR module on `main` (`b99ba986` + `269aa8f7`), 11-tab employee profile, manual attendance, canonical SalaryStructure.

---

## A. Gap Audit — Employee Master Data

| HR Information | Current | Required | Proposed model | UI location |
| --- | --- | --- | --- | --- |
| Employee ID | ✅ `employeeId` unique | keep | — | header / Employment |
| Full Name | ✅ via `betterAuthUser.name` (single source) | keep — do NOT duplicate | — | header |
| Profile photo | ⚠️ `profilePictureUrl` exists, unused | keep (URL) | `Employee.profilePictureUrl` | header |
| User account | ✅ `betterAuthUserId` unique | keep | — | Overview |
| Employee status | ✅ enum (active/inactive/terminated/resigned/on_leave/suspended) | keep | — | Employment |
| Date of Birth | ❌ | optional | `Employee.dateOfBirth?` | Overview → Personal card |
| Gender | ❌ | optional | `EmployeeGender` enum (male/female/others) | Personal card |
| Nationality | ❌ | optional | `Employee.nationality?` | Personal card |
| NID Number | ❌ | optional (number only; no doc storage — no safe attachment infra) | `Employee.nidNumber?` | Personal card |
| Phone | ✅ `UserProfile.phoneNumber` | keep at User level (read-only display) | — | Personal card (read-only) |
| Email | ✅ `UserProfile.email` | keep at User level | — | Personal card (read-only) |
| Present Address | ❌ | optional | `Employee.presentAddress?` | Personal card |
| Permanent Address | ❌ | optional | `Employee.permanentAddress?` | Personal card |
| Emergency Contact (name/phone/relation) | ❌ | optional (3 fields) | `Employee.emergencyContactName? / Phone? / Relation?` | Personal card |
| Joining Date | ✅ | keep | — | Employment |
| Employment Type | ✅ | keep | — | Employment |
| Department / Designation | ✅ | keep | — | Employment |
| Reporting Manager | ✅ | keep | — | Employment |
| Confirmation Date | ❌ | optional | `Employee.confirmationDate?` | Employment |
| Exit Date | ✅ | keep | — | Employment |
| Exit Reason | ❌ | optional | `Employee.exitReason?` | Employment |
| Bank (structured) | ❌ only `bankName` + `bankAccountNo` flat | proper section | `EmployeeBankAccount` (1..n) | Overview → Bank card |
| Salary | ✅ read-only mirror | keep mirror semantics | — | Compensation |
| Salary Structure (canonical) | ✅ | keep; ❌ `effectiveFrom` absent from DTO/UX; ❌ no structure-history UI | add `effectiveFrom` + history endpoint | Compensation |
| Payroll snapshot / Total paid / Outstanding | ⚠️ payslips+payments exist, no summary | computed summary (net − paid for approved+) | payroll summary endpoint | Payroll / Payments |
| Attendance Method (per employee) | ❌ | NEW `Employee.attendanceMethod` (APP/MACHINE/NONE) | Employee column | Employment / Attendance |
| Device mapping | ❌ | NEW `DeviceEmployeeMapping[deviceEmployeeId]` | new models | Attendance → Devices |
| HR Help (Bangla) | ❌ | NEW page | route + static content | Sidebar → Help |

**User vs Employee split (decision):** identity (name/email/phone, auth) lives in the User domain and is displayed read-only. HR-only info (DOB, NID, addresses, emergency contact, bank, confirmation, exit reason, device id) lives in the `Employee` domain. No duplication of identity.

---

## B. Updated Architecture

### Employee profile
- `employees` module extended: personal fields, confirmation/exit-reason, `attendanceMethod`; bank accounts as a sub-resource of employee (module `employees`, service + routes inline or small `employee-bank` service).
- Bank section is HR/payment profile data — never mixed into salary numbers; never logged. API returns bank data only to HR-roles.

### Compensation
- `SetSalaryStructureDto` gains required `effectiveFrom` (≥ joiningDate).
- On save: close active structure `effectiveTo = effectiveFrom − 1 day`, insert new structure `[effectiveFrom, null)`, mirror `Employee.salary = netSalary` (unchanged canonical rule).
- Payroll picks the structure whose window contains the period (keep `isActive` as convenience flag; rules documented).
- New `GET /payroll/salary-structure/history/:employeeId` and Compensation-tab history list (window, net, status).
- Compensation tab shows: current structure, mirror, history, recent payroll + total paid + outstanding (computed).

### Attendance — two-mode architecture
Replaces the simple one-row-per-day model with an event-faithful, auditable model while keeping the *day* as the business atom:

```
AttendanceSettings (singleton, mode APP|MACHINE|BOTH)
AttendanceDay        (employee × date, status, effective method, worked/breakMinutes, @@unique([employeeId,date]))
  └── AttendanceSession (checkInAt, checkOutAt?, source APP|MACHINE|ADMIN, deviceId?)
        └── AttendanceBreak (startedAt, endedAt?)
AttendanceAdjustment (field, originalValue, correctedValue, reason, adjustedById) — audit/correction
AttendanceDevice     (name, type, vendor, identifier, location, connectionMethod, host, port,
                      enabled, syncStatus, lastSyncAt, lastSyncError, credentialsEncrypted — never exposed)
DeviceEmployeeMapping(deviceId × deviceEmployeeId @unique → Employee)
RawAttendanceEvent   (idempotencyKey @unique, deviceId, employeeId?, eventType, occurredAt, rawPayload)
```

- **Mode APP**: app check-in/break/check-out events are authoritative; machine endpoints reject.
- **Mode MACHINE**: only device ingestion; app check-in blocked server-side.
- **Mode BOTH**: per-employee `attendanceMethod` decides; APP-only employee can't be referenced by machine mapping (rejected), MACHINE-only employee can't app-check-in.
- **Source of truth is explicit** per day × method; no silent merging of APP + MACHINE into one day (duplicate-source conflict → 409 with guidance; reconciliation out of scope).
- **Manual correction** = `AttendanceAdjustment` (original preserved; silent edits of raw events removed). Admin may still record absence etc. through adjustment with mandatory reason.
- Legacy `AttendanceRecord` table: **retired in place** (no destructive ops), rows migrated into `AttendanceDay` + one `AttendanceSession` (source `ADMIN`), status preserved.

### Self-service (My HR)
- New `My HR → Attendance` state machine UI: Check In / Working since … (Start Break, Check Out) / On Break since … (End Break) / Checked Out — `Worked 7h 42m`. Human labels only; no raw states.
- All app attendance actions server-scoped to the resolved employee (existing ownership pattern).

### Device integration (plan only — no vendor code)
- Abstraction: `AttendanceDeviceGateway` interface (testConnection, fetchEvents).
- Connector implementations only after approval (§30 below); first potential connector = generic pull/API + CSV import; idempotent ingestion via `idempotencyKey = deviceId|deviceEmployeeId|eventTimestamp`.
- Device credentials encrypted via existing `EncryptionService`; never serialized to API responses.

### HR Help
- New `/hr/help` page, Bangla-explanatory / English-terms, sections per §24 of the request; sidebar entry (all HR roles).

---

## C. Data Model (additive only)

New enums:
`AttendanceMethod { APP, MACHINE, NONE }`, `AttendanceModeSetting { APP, MACHINE, BOTH }`,
`AttendanceSessionSource { APP, MACHINE, ADMIN }`, `BankAccountType { SAVINGS, CURRENT, OTHERS }`,
`BankVerificationStatus { PENDING, VERIFIED, REJECTED }`, `AttendanceDeviceSyncStatus { IDLE, CONNECTED, DISCONNECTED, SYNCING, FAILED }`,
`EmployeeGender { MALE, FEMALE, OTHERS }`.

`Employee` + (nullable): `dateOfBirth`, `gender`, `nationality`, `nidNumber`, `presentAddress Text`, `permanentAddress Text`, `emergencyContactName`, `emergencyContactPhone`, `emergencyContactRelation`, `confirmationDate`, `exitReason Text`, `attendanceMethod AttendanceMethod @default(APP)`, `bankAccounts`.

`EmployeeBankAccount`: employee FK, bankName, branchName?, accountName, accountNumber, accountType?, routingNumber?, isPrimary (partial-unique per employee on primary — Postgres partial index), verificationStatus, notes?, createdById, updatedById, timestamps.

`AttendanceSettings`: singleton `id @default("global")`, mode, updatedById, updatedAt.

`AttendanceDay`: employee, date @db.Date, status, attendanceMethod, workedMinutes Int?, breakMinutes Int?, note?, `@@unique([employeeId,date])`.

`AttendanceSession`: day FK, source (default APP), deviceId?, checkInAt, checkOutAt?; service-transaction guard: at most one open session per day.

`AttendanceBreak`: session FK, startedAt, endedAt?.

`AttendanceAdjustment`: employeeId, dayId?, field, originalValue, correctedValue, reason (required), adjustedById?, adjustedAt.

`AttendanceDevice`: name, deviceType, vendor?, identifier?, location?, connectionMethod, host?, port?, enabled, syncStatus, lastSyncAt?, lastSyncError?, credentialsEncrypted? (encrypted via EncryptionService), timestamps, createdById.

`DeviceEmployeeMapping`: deviceId, employeeId, deviceEmployeeId, `@@unique([deviceId, deviceEmployeeId])`.

`RawAttendanceEvent`: deviceId?, deviceEmployeeId?, employeeId?, eventType (CHECK_IN/CHECK_OUT/BREAK_START/BREAK_END/PUNCH), occurredAt, rawPayload Json?, idempotencyKey @unique, status, ingestedAt.

Derived (computed, no columns): day worked/break minutes are materialized at check-out / last event of the day; daily status derived when a day is closed (check-out or machine day close), otherwise PRESENT*/*OPEN* handled in UI; absent/weekly-off/leave stay corrected-by-adjustment or manual, no auto-engine this round.

---

## D. API Map

**Employee profile (manage_employees + view_hr):**
- `GET /employees/:id` (adds personal/bank/attendanceMethod)
- `PATCH /employees/:id` (extends DTO)
- `GET /employees/:id/bank-accounts` · `POST /employees/:id/bank-accounts` · `PATCH /bank-accounts/:id` · `DELETE /bank-accounts/:id` · `POST /bank-accounts/:id/primary`

**Compensation (manage_payroll):**
- `POST /payroll/salary-structure` (dto + `effectiveFrom`)
- `GET /payroll/salary-structure/history/:employeeId`
- `GET /payroll/summary/:employeeId` (recent payslips, total paid, outstanding)

**Attendance (manage_attendance; settings/devices/adjustments variants below):**
- `GET/PATCH /hr/attendance/settings` (mode; `manage_hr_settings`)
- `POST /hr/attendance/check-in` · `POST /hr/attendance/break/start` · `POST /hr/attendance/break/end` · `POST /hr/attendance/check-out` (manager-recordable for a target employeeId)
- `GET /hr/attendance/today?employeeId` (current state view)
- `GET /hr/attendance/summary?employeeId&from&to`
- `POST /hr/attendance/adjustments` (`manage_attendance_adjustments`; reason required) · `GET /hr/attendance/adjustments?employeeId`
- Devices (`manage_attendance_devices`): `GET/POST /hr/attendance/devices` · `PATCH /hr/attendance/devices/:id` · `POST /hr/attendance/devices/:id/test` · `POST /hr/attendance/devices/:id/sync` · `GET/POST /hr/attendance/devices/:id/mappings` · `DELETE /hr/attendance/devices/:id/mappings/:mappingId`
- Ingestion (machine): `POST /hr/attendance/devices/:id/events` (idempotent) · `GET /hr/attendance/devices/:id/events` (audit)

**Self-service (`/hr/my`, `@Roles('employee')`, server-resolved id):**
- `POST /hr/my/attendance/check-in` · `break/start` · `break/end` · `check-out`
- `GET /hr/my/attendance/today` · `GET /hr/my/attendance?from&to` (includes worked/break durations)

---

## E. Permission Model

Existing: `view_hr, manage_employees, manage_payroll, manage_commissions, manage_leave, manage_schedule, manage_attendance`.

New keys (3): `manage_hr_settings` (attendance mode + future HR settings), `manage_attendance_devices` (devices/mappings/ingestion), `manage_attendance_adjustments` (corrections). All class-scoped `@PermissionsAny` (ANY-mode), `admin_hr` feature, Roles superadmin/admin/manager; devices/adjustments additionally require the specific key — `manage_attendance` alone cannot correct or configure devices.

Self-service: unchanged ownership model (resolved employee; no client id).

---

## F. UI Information Architecture

**HR Sidebar (final):** Overview · Employees · Payroll · Commission · Leave · Attendance · Departments · Designations · Access Presets · Settings · **Help**.

**Attendance page** gains sub-tabs: **Today / Calendar** (existing list + day calendar) / **Adjustments** / **Devices** / **Settings**.

**Employee detail — 11 tabs kept** (no new tabs). Reasoning:
- Master data (identity + bank) has a natural **single** home: the **Overview** tab, expanded with two cards: *Personal Information* and *Bank Accounts* — avoids adding 2 extra tabs and keeps master data out of operational tabs.
- Compensation/Earnings/Deductions — grouping was considered (§8). Three separate tabs were retained because: (a) they are distinct ledger classes with different approval lifecycles; (b) merging reduces scannability of the compensation area; (c) the existing 11-tab pattern is already tested and navigable. Visual grouping improvement is limited to ordering only.
- Attendance tab shows the day-list + per-day working/break breakdown + adjustments affecting that employee.

**Compensation tab** gains: effective-from input on set/change, salary history list, mirror note, recent payroll + paid/outstanding summary.

**My HR → Attendance**: state-machine UI (friendly labels per §12). **HR Help**: Bangla tutorial page (§23–25).

---

## G. Migration Plan (additive only, ordered)

1. `add_attendance_modes_bank_enums` — enums only.
2. `add_employee_hr_profile_fields` — Employee columns (+gender/nationality/etc., attendanceMethod default APP).
3. `add_employee_bank_account` — table + partial unique on primary.
4. `add_attendance_settings` — table + seed row `{id:'global', mode:'APP'}` (idempotent, `ON CONFLICT DO NOTHING`).
5. `attendance_day_session_break` — new tables + data-copy of `AttendanceRecord` → Day + Session(source ADMIN, checkIn/checkOut preserved, status preserved, workedMinutes computed where both times exist). `AttendanceRecord` retained (retired in place — no destructive ops).
6. `add_attendance_adjustment`.
7. `add_attendance_device_tables` — device, mapping, raw event.
All migrations hand-written + `prisma migrate deploy` (repo precedent; Prisma 7 `migrate dev` avoided). No `db push`, no reset.

---

## H. Testing Plan

**Backend (unit + integration):**
- Attendance state machine: check-in→break→break-end→check-out transitions; impossible sequences (break-end before break-start, checkout before check-in, double check-in) → 400/409 friendly; duration math (worked, break); multiple breaks.
- Concurrency: two simultaneous check-ins on same day → exactly one open session (tx guard; second → 409 `এই Employee-এর জন্য আজকের Attendance ইতিমধ্যে শুরু হয়েছে।`).
- Mode enforcement: APP blocks machine ingestion; MACHINE blocks app check-in; BOTH per-employee method; contradictions → 409.
- Idempotency: device event re-push → no duplicate (idempotencyKey unique); mapping missing → event parked `UNMAPPED` (not silently dropped).
- Adjustments: original preserved, reason mandatory, actor recorded; permissions: `manage_attendance` alone cannot adjust/configure devices (403).
- Salary: effectiveFrom validation (≥ joiningDate; overlap → old window closed), history endpoint, payroll picks correct window for period.
- Bank: create/patch/delete/primary swap (single primary invariant), never in logs.
- Self-service ownership: own-only; cross-user → 404; device endpoints → 403 for employees.

**Admin (vitest):** attendance Today state render, devices table + test/sync status badges, adjustments list + dialog, settings form, bank card + primary badge, Compensation history list, help page render.

**Storefront (vitest):** My HR attendance state-machine labels; own-data only; error/empty states.

**Browser (Playwright):** full smoke: profile personal+bank editing, salary effectiveFrom flow, attendance check-in/break/out real-time state, adjustments, devices CRUD + test-connection, help page, permission matrix, legacy redirects.

**Security:** cross-employee 404 matrix, role 403 matrix for 3 new keys, no credential leakage in device API.

---

## I. Rollout Plan (APP / MACHINE / BOTH)

1. **Phase A (back-compat):** settings default `APP`; legacy records migrated; existing manual flows continue (admin records = adjustment-based).
2. **Phase B (APP live):** My HR check-in/break/out enabled; day derivation live; app authority enforced.
3. **Phase C (device infra):** devices/mappings/ingestion shipped but **gated** — enabled only when mode `MACHINE` or `BOTH`; no vendor connector built until approved.
4. **Phase D (BOTH):** per-employee method selection; authority per employee; conflicting sources → 409 with guidance.
5. Reconciliation engine and deduction/payroll coupling: explicitly deferred (documented, not built).

---

## J. Open Questions (genuine product decisions)

1. **Gender**: enum (male/female/others) recommended — confirm?
2. **NID document/photo attachment**: skipped (no file-storage safety infra) — NID *number* only OK?
3. **Bank account type set** for BD: SAVINGS / CURRENT / OTHERS — confirm or extend (e.g., salary account flag)?
4. **Approved-leave / weekly-off auto day records**: generate automatically (day rows with ON_LEAVE/WEEKLY_OFF) vs stay derived/absent-until-recorded? Recommend NO auto-generation this round.
5. **Break policy**: unlimited breaks tracked (recommend) vs max-count rule?
6. **Shift config / auto late / half-day classification**: requires shift concept — confirm OUT of scope this round (statuses stay manual/derived).
7. **Device vendor**: none selected. Abstraction + generic pull/CSV first connector OK, or is a specific hardware vendor in use?
8. **Legacy AttendanceRecord table**: retire in place (recommend) vs formal drop in a later destructive maintenance window.
9. **Employee addresses**: store on Employee (recommend) vs reuse customer `Address` model — confirm.
10. **Primary-bank uniqueness**: Postgres partial unique index (recommend, DB-enforced) vs transaction-only enforcement.

---

## K. Explicitly Out of Scope (avoid over-engineering)

- Shift scheduling / rota, overtime rules, time-clock approvals engine, payroll-absence deduction automation, biometric template storage, vendor SDK code, document/file storage, reconciliation/attribution engines.
---

## L. FINAL DECISIONS (APPROVED — incorporate into implementation)

1. Gender enum: `MALE | FEMALE | OTHER` (NOT "OTHERS").
2. NID number only, no attachment, stored `String` (not numeric), never in logs/errors.
3. BankAccountType `SAVINGS | CURRENT | OTHERS`; `accountNumber` and `routingNumber` are `String`.
4. No auto-generated AttendanceDay rows for approved leave / weekly-off this phase. Leave/WeeklyOff remain authoritative HR concepts; attendance stays recorded/derived.
5. Breaks unlimited; invalid transitions rejected; concurrent duplicates prevented; checkout blocked while a break is open (friendly business error).
6. Shift / auto-late / half-day / overtime: OUT OF SCOPE. Existing statuses remain manual/derived.
7. Devices: vendor-neutral (`AttendanceDevice`, `DeviceEmployeeMapping`, `RawAttendanceEvent`, idempotent ingestion foundation, generic CSV import). NO vendor SDK/protocol code, NO vendor assumptions (no ZKTeco/Hikvision/Suprema).
8. Legacy `AttendanceRecord`: retired in place; M5 copies data into AttendanceDay/Session (day.attendanceMethod=APP, session.source=ADMIN); NO drop/destructive op.
9. Addresses on Employee (`presentAddress`, `permanentAddress`). Customer `Address` model untouched.
10. One primary bank per employee enforced by PostgreSQL partial unique index (`WHERE "isPrimary"`), not tx-only.

### Consistency check (pre-implementation) — VERIFIED with 3 documented implementation notes
- N1: Prisma cannot declare partial unique indexes → created in M3 SQL only; `migrate dev` would flag drift (repo workflow is `migrate deploy` — acceptable, documented).
- N2: legacy rows migrated as day.method=APP, session.source=ADMIN (only sensible mapping; no method existed in the old model).
- N3: the existing manual "Add Attendance Record" dialog is replaced by the state-machine + `AttendanceAdjustment` model (list/daily-overview/history contracts preserved over the new Day model).
- Salary: `effectiveFrom` DTO required (model column already exists); payroll resolves the structure whose window contains `periodStart`; no second salary source; mirror rule unchanged.
- Migrations M1–M7 additive, ordered, timestamps > 20260828000000.
- No silent breakage identified: employee create/update additive; attendance list/overview/history endpoints re-implemented over Day.

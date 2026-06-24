# Phase 6: Finance & HR — Implementation Plan (TDD)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> **TDD Rule:** Write failing test → implement → make pass → commit. Every file must have a corresponding test.

**Goal:** Add Employee Management, Payroll, and Basic Accounting modules.

**Architecture:** Each module = Prisma model + NestJS module (with test) + Admin UI. Test-first for every backend module.

---

### Task 1: Employee Management

**Models:** Department, Designation, Employee

```
model Department {
  id        String     @id @default(uuid())
  name      String     @unique
  slug      String     @unique
  description String?  @db.Text
  isActive  Boolean    @default(true)
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  employees Employee[]
}

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

enum EmploymentType {
  full_time
  part_time
  contract
  internship
}

enum EmployeeStatus {
  active
  inactive
  terminated
  resigned
}

model Employee {
  id              String          @id @default(uuid())
  userId          String?
  employeeId      String          @unique
  firstName       String
  lastName        String
  email           String          @unique
  phone           String?
  departmentId    String?
  designationId   String?
  employmentType  EmploymentType  @default(full_time)
  status          EmployeeStatus  @default(active)
  joiningDate     DateTime
  exitDate        DateTime?
  salary          Decimal?        @db.Decimal(10, 2)
  bankAccountNo   String?
  bankName        String?
  address         String?
  city            String?
  emergencyContact String?
  notes           String?         @db.Text
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  department  Department?  @relation(fields: [departmentId], references: [id], onDelete: SetNull)
  designation Designation? @relation(fields: [designationId], references: [id], onDelete: SetNull)

  @@index([departmentId])
  @@index([designationId])
  @@index([status])
}

**Files:**
- Create: `apps/backend/prisma/schema.prisma` (add models)
- Create: `apps/backend/src/employees/__tests__/employees.service.spec.ts`
- Create: `apps/backend/src/employees/employees.service.ts`
- Create: `apps/backend/src/employees/employees.controller.ts`
- Create: `apps/backend/src/employees/employees.module.ts`
- Create: `apps/backend/src/employees/dto/*.ts`
- Create: `apps/admin/src/features/employees/`
- Create: `apps/admin/src/routes/_authenticated/op/employees/`

### Task 2: Payroll Management

**Models:** SalaryStructure, Payslip, PayslipItem

### Task 3: Basic Accounting

**Models:** Account (chart of accounts), JournalEntry, JournalEntryLine, FinancialPeriod

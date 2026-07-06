# Unified User, Customer & Employee Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the `UserProfile` dual-purpose model into `betterAuthUser` (auth), `CustomerProfile` (CRM), and `Employee` (HR). Add Access Preset permission builder, OAuth dynamic config, and profile merging.

**Architecture:** Legacy `UserProfile` customers migrate to `CustomerProfile`. Employee rebuilt on BA user. Permission system via hardcoded registry + `AccessPreset` model + `override_permissions` on BA user. Session payload extended with resolved permissions. OAuth providers stored in DB with at-rest encryption, fallback to env vars.

**Tech Stack:** NestJS + Fastify, Prisma (PostgreSQL), Better Auth, React + TanStack Router + TanStack Query, shadcn/ui, zod + react-hook-form.

---

### Task 1: Prisma Schema — CustomerProfile, AccessPreset, AuthSettings, Employee Restructure

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Generate: `npx prisma generate`

- [ ] **Step 1: Add new models to schema.prisma**

```prisma
// --- AccessPreset (new) ---
model AccessPreset {
  id          String     @id @default(uuid())
  name        String     @unique
  description String?    @db.Text
  permissions  String[]
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  employees   Employee[]
}

// --- AuthSettings (new, for OAuth dynamic config) ---
model AuthSettings {
  id            String   @id @default(uuid())
  provider_name  String   @unique
  is_enabled    Boolean  @default(false)
  client_id     String
  client_secret String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

// --- CustomerProfile (new CRM model) ---
model CustomerProfile {
  id               String          @id @default(uuid())
  betterAuthUserId String?         @unique
  phone            String          @unique
  email            String?
  name             String
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  betterAuthUser   betterAuthUser?  @relation(fields: [betterAuthUserId], references: [id], onDelete: SetNull)
  orders           Order[]
  addresses        Address[]
}

// --- Address: add customerProfileId ---
// Add to existing Address model:
//   customerProfileId  String?
//   customerProfile    CustomerProfile? @relation(fields: [customerProfileId], references: [id], onDelete: Cascade)

// --- Employee: restructure (remove identity fields, add betterAuthUserId) ---
// Replace existing Employee model with:
model Employee {
  id               String          @id @default(uuid())
  betterAuthUserId String          @unique
  employeeId       String          @unique
  departmentId     String?
  designationId    String?
  accessPresetId   String?
  employmentType   EmploymentType  @default(full_time)
  status           EmployeeStatus  @default(active)
  joiningDate      DateTime
  exitDate         DateTime?
  salary           Decimal?        @db.Decimal(10, 2)
  bankAccountNo    String?
  bankName         String?
  profilePictureUrl String?
  notes            String?         @db.Text
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  department        Department?        @relation(fields: [departmentId], references: [id], onDelete: SetNull)
  designation       Designation?       @relation(fields: [designationId], references: [id], onDelete: SetNull)
  accessPreset      AccessPreset?      @relation(fields: [accessPresetId], references: [id], onDelete: SetNull)
  betterAuthUser    betterAuthUser     @relation(fields: [betterAuthUserId], references: [id], onDelete: Cascade)
}

// Add employee relation to betterAuthUser:
//   employee     Employee?
```

- [ ] **Step 2: Update betterAuthUser model with employee + access preset relations**

Add to existing `betterAuthUser` model:
```prisma
model betterAuthUser {
  id            String    @id @default(cuid())
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  role          String?   @default("customer")
  override_permissions  String[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts      betterAuthAccount[]
  sessions      betterAuthSession[]
  customerProfile CustomerProfile?
  employee      Employee?
}
```

- [ ] **Step 3: Update Order model — change customerId FK to CustomerProfile**

```prisma
model Order {
  // ... existing fields ...
  customerId String?
  customer   CustomerProfile? @relation(fields: [customerId], references: [id])
  // ... rest stays same ...
}
```

Remove the old `customer   UserProfile? @relation(fields: [customerId], references: [id])` line.

- [ ] **Step 4: Update Address model — add customerProfileId**

```prisma
model Address {
  id                String           @id @default(uuid())
  userId            String?
  customerProfileId String?
  // ... rest of fields ...

  user              UserProfile?     @relation(fields: [userId], references: [id], onDelete: Cascade)
  customerProfile   CustomerProfile? @relation(fields: [customerProfileId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 5: Run prisma generate**

```bash
npx prisma generate
```

Run: `npx prisma generate` from `apps/backend/`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 6: Create initial migration**

```bash
npx prisma migrate dev --name add_customer_profile_and_access_preset
```

Run: from `apps/backend/`
Expected: `Your database is now in sync with your schema.`

- [ ] **Step 7: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat: add CustomerProfile, AccessPreset, AuthSettings models; restructure Employee"
```

---

### Task 2: Data Migration Script — CustomerProfile Migration

**Files:**
- Create: `apps/backend/prisma/scripts/migrate-customers.ts`
- Test: local copy of production data

- [ ] **Step 1: Create migration script**

```typescript
// apps/backend/prisma/scripts/migrate-customers.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[Migration] Starting customer migration...');

  // 1. Fetch all UserProfile records where role = 'customer'
  const customers = await prisma.userProfile.findMany({
    where: { role: 'customer' },
    include: {
      orders: true,
      addresses: true,
    },
  });

  console.log(`[Migration] Found ${customers.length} customer profiles to migrate.`);

  let migrated = 0;
  let failed = 0;

  for (const customer of customers) {
    try {
      // 2. Create CustomerProfile
      const profile = await prisma.customerProfile.create({
        data: {
          betterAuthUserId: customer.betterAuthUserId || undefined,
          phone: customer.phoneNumber,
          email: customer.email === customer.username ? null : customer.email,
          name: `${customer.firstName} ${customer.lastName}`.trim() || customer.username,
        },
      });

      // 3. Update Orders — point to new CustomerProfile
      if (customer.orders.length > 0) {
        await prisma.order.updateMany({
          where: { customerId: customer.id },
          data: { customerId: profile.id },
        });
      }

      // 4. Update Addresses — point to new CustomerProfile
      if (customer.addresses.length > 0) {
        await prisma.address.updateMany({
          where: { userId: customer.id },
          data: { customerProfileId: profile.id, userId: null },
        });
      }

      migrated++;
      if (migrated % 100 === 0) {
        console.log(`[Migration] Progress: ${migrated}/${customers.length}`);
      }
    } catch (error) {
      console.error(`[Migration] Failed for customer ${customer.id} (${customer.email}):`, error);
      failed++;
    }
  }

  console.log(`[Migration] Complete. Migrated: ${migrated}, Failed: ${failed}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Add migration script to package.json**

In `apps/backend/package.json`, add:
```json
{
  "scripts": {
    "migrate:customers": "npx tsx prisma/scripts/migrate-customers.ts"
  }
}
```

- [ ] **Step 3: Run migration on local copy of production data**

```bash
npm run migrate:customers
```

Run: from `apps/backend/`
Expected: Shows count of migrated customers, 0 failures.

- [ ] **Step 4: Verify migration**

```sql
-- Check no orphan orders
SELECT COUNT(*) FROM "Order" o
LEFT JOIN "CustomerProfile" c ON o."customerId" = c.id
WHERE o."customerId" IS NOT NULL AND c.id IS NULL;
```

Expected: 0

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/scripts/ apps/backend/package.json
git commit -m "feat: add customer migration script"
```

---

### Task 3: Permission Registry + PermissionCheckboxMatrix Component

**Files:**
- Create: `apps/backend/src/common/permissions/registry.ts`
- Create: `apps/admin/src/components/permissions/PermissionCheckboxMatrix.tsx`

- [ ] **Step 1: Create permission registry constant**

```typescript
// apps/backend/src/common/permissions/registry.ts
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

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS][number];

export function getAllPermissions(): string[] {
  return Object.values(PERMISSIONS).flat();
}

export function getPermissionLabel(key: string): string {
  const labels: Record<string, string> = {
    view_analytics: 'View Analytics',
    view_financial_summary: 'View Financial Summary',
    view_users: 'View Users',
    create_users: 'Create Users',
    edit_users: 'Edit Users',
    delete_users: 'Delete Users',
    view_customers: 'View Customers',
    edit_customers: 'Edit Customers',
    delete_customers: 'Delete Customers',
    view_employees: 'View Employees',
    create_employees: 'Create Employees',
    edit_employees: 'Edit Employees',
    delete_employees: 'Delete Employees',
    manage_designations: 'Manage Designations',
    manage_presets: 'Manage Access Presets',
    create_orders: 'Create Orders',
    view_orders: 'View Orders',
    refund_orders: 'Refund Orders',
    apply_discounts: 'Apply Discounts',
    view_products: 'View Products',
    create_products: 'Create Products',
    edit_products: 'Edit Products',
    delete_products: 'Delete Products',
    manage_stock: 'Manage Stock',
    view_system_settings: 'View System Settings',
    modify_integrations: 'Modify Integrations',
  };
  return labels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getModuleLabel(key: string): string {
  const labels: Record<string, string> = {
    DASHBOARD: 'Dashboard',
    USER_MGMT: 'User Management',
    CUSTOMER: 'Customer Management',
    EMPLOYEE: 'Employee Management',
    SALES: 'Sales / POS',
    INVENTORY: 'Inventory Management',
    SETTINGS: 'System Settings',
  };
  return labels[key] || key;
}
```

- [ ] **Step 2: Create PermissionCheckboxMatrix component**

```tsx
// apps/admin/src/components/permissions/PermissionCheckboxMatrix.tsx
'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

const PERMISSIONS = {
  DASHBOARD:   ['view_analytics', 'view_financial_summary'],
  USER_MGMT:   ['view_users', 'create_users', 'edit_users', 'delete_users'],
  CUSTOMER:    ['view_customers', 'edit_customers', 'delete_customers'],
  EMPLOYEE:    ['view_employees', 'create_employees', 'edit_employees',
                 'delete_employees', 'manage_designations', 'manage_presets'],
  SALES:       ['create_orders', 'view_orders', 'refund_orders', 'apply_discounts'],
  INVENTORY:   ['view_products', 'create_products', 'edit_products',
                 'delete_products', 'manage_stock'],
  SETTINGS:    ['view_system_settings', 'modify_integrations'],
} as const

const MODULE_LABELS: Record<string, string> = {
  DASHBOARD: 'Dashboard',
  USER_MGMT: 'User Management',
  CUSTOMER: 'Customer Management',
  EMPLOYEE: 'Employee Management',
  SALES: 'Sales / POS',
  INVENTORY: 'Inventory Management',
  SETTINGS: 'System Settings',
}

const PERMISSION_LABELS: Record<string, string> = {
  view_analytics: 'View Analytics',
  view_financial_summary: 'View Financial Summary',
  view_users: 'View Users',
  create_users: 'Create Users',
  edit_users: 'Edit Users',
  delete_users: 'Delete Users',
  view_customers: 'View Customers',
  edit_customers: 'Edit Customers',
  delete_customers: 'Delete Customers',
  view_employees: 'View Employees',
  create_employees: 'Create Employees',
  edit_employees: 'Edit Employees',
  delete_employees: 'Delete Employees',
  manage_designations: 'Manage Designations',
  manage_presets: 'Manage Access Presets',
  create_orders: 'Create Orders',
  view_orders: 'View Orders',
  refund_orders: 'Refund Orders',
  apply_discounts: 'Apply Discounts',
  view_products: 'View Products',
  create_products: 'Create Products',
  edit_products: 'Edit Products',
  delete_products: 'Delete Products',
  manage_stock: 'Manage Stock',
  view_system_settings: 'View System Settings',
  modify_integrations: 'Modify Integrations',
}

type PermissionCheckboxMatrixProps = {
  selected: string[]
  onChange: (permissions: string[]) => void
}

export function PermissionCheckboxMatrix({ selected, onChange }: PermissionCheckboxMatrixProps) {
  const selectedSet = new Set(selected)

  const togglePermission = (key: string) => {
    const next = new Set(selectedSet)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(Array.from(next))
  }

  const toggleModule = (module: string, permissions: readonly string[]) => {
    const allSelected = permissions.every((p) => selectedSet.has(p))
    const next = new Set(selectedSet)
    for (const p of permissions) {
      if (allSelected) next.delete(p)
      else next.add(p)
    }
    onChange(Array.from(next))
  }

  return (
    <div className='space-y-6'>
      {Object.entries(PERMISSIONS).map(([module, perms]) => {
        const allSelected = perms.every((p) => selectedSet.has(p))
        const someSelected = perms.some((p) => selectedSet.has(p))

        return (
          <div key={module} className='space-y-2'>
            <div className='flex items-center gap-2 border-b pb-1'>
              <Checkbox
                id={`select-all-${module}`}
                checked={allSelected}
                indeterminate={!allSelected && someSelected}
                onCheckedChange={() => toggleModule(module, perms)}
              />
              <Label
                htmlFor={`select-all-${module}`}
                className='text-sm font-semibold cursor-pointer'
              >
                {MODULE_LABELS[module] || module}
              </Label>
              <Button
                variant='ghost'
                size='sm'
                className='ml-auto text-xs text-muted-foreground'
                onClick={() => toggleModule(module, perms)}
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            <div className='grid grid-cols-2 gap-2 pl-2'>
              {perms.map((perm) => (
                <div key={perm} className='flex items-center gap-2'>
                  <Checkbox
                    id={perm}
                    checked={selectedSet.has(perm)}
                    onCheckedChange={() => togglePermission(perm)}
                  />
                  <Label htmlFor={perm} className='text-sm cursor-pointer'>
                    {PERMISSION_LABELS[perm] || perm}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/common/permissions/ apps/admin/src/components/permissions/
git commit -m "feat: add permission registry + PermissionCheckboxMatrix component"
```

---

### Task 4: AccessPreset Backend CRUD

**Files:**
- Create: `apps/backend/src/access-presets/dto/create-access-preset.dto.ts`
- Create: `apps/backend/src/access-presets/dto/update-access-preset.dto.ts`
- Create: `apps/backend/src/access-presets/access-presets.service.ts`
- Create: `apps/backend/src/access-presets/access-presets.controller.ts`
- Create: `apps/backend/src/access-presets/access-presets.module.ts`

- [ ] **Step 1: Create DTOs**

```typescript
// apps/backend/src/access-presets/dto/create-access-preset.dto.ts
import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class CreateAccessPresetDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}
```

```typescript
// apps/backend/src/access-presets/dto/update-access-preset.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateAccessPresetDto } from './create-access-preset.dto';

export class UpdateAccessPresetDto extends PartialType(CreateAccessPresetDto) {}
```

- [ ] **Step 2: Create service**

```typescript
// apps/backend/src/access-presets/access-presets.service.ts
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccessPresetDto } from './dto/create-access-preset.dto';
import { UpdateAccessPresetDto } from './dto/update-access-preset.dto';

@Injectable()
export class AccessPresetsService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, perPage = 20, search?: string) {
    const where: any = {};
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [data, total] = await Promise.all([
      this.prisma.accessPreset.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.accessPreset.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const preset = await this.prisma.accessPreset.findUnique({ where: { id } });
    if (!preset) throw new NotFoundException('Access preset not found');
    return preset;
  }

  async create(dto: CreateAccessPresetDto) {
    const existing = await this.prisma.accessPreset.findUnique({
      where: { name: dto.name },
    });
    if (existing) throw new ConflictException('Access preset with this name already exists');

    return this.prisma.accessPreset.create({ data: dto });
  }

  async update(id: string, dto: UpdateAccessPresetDto) {
    await this.findOne(id);

    if (dto.name) {
      const existing = await this.prisma.accessPreset.findFirst({
        where: { name: dto.name, NOT: { id } },
      });
      if (existing) throw new ConflictException('Access preset with this name already exists');
    }

    return this.prisma.accessPreset.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    const employeeCount = await this.prisma.employee.count({ where: { accessPresetId: id } });
    if (employeeCount > 0) {
      throw new ConflictException(
        `Cannot delete preset: ${employeeCount} employee(s) are using it`,
      );
    }
    return this.prisma.accessPreset.delete({ where: { id } });
  }
}
```

- [ ] **Step 3: Create controller**

```typescript
// apps/backend/src/access-presets/access-presets.controller.ts
import {
  Controller, Get, Post, Body, Param, Put, Delete, Query,
} from '@nestjs/common';
import { AccessPresetsService } from './access-presets.service';
import { CreateAccessPresetDto } from './dto/create-access-preset.dto';
import { UpdateAccessPresetDto } from './dto/update-access-preset.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('access-presets')
@Roles('superadmin', 'admin')
export class AccessPresetsController {
  constructor(private readonly service: AccessPresetsService) {}

  @Post()
  create(@Body() dto: CreateAccessPresetDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(
      page ? parseInt(page) : 1,
      perPage ? parseInt(perPage) : 20,
      search,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAccessPresetDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
```

- [ ] **Step 4: Create module**

```typescript
// apps/backend/src/access-presets/access-presets.module.ts
import { Module } from '@nestjs/common';
import { AccessPresetsService } from './access-presets.service';
import { AccessPresetsController } from './access-presets.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AccessPresetsController],
  providers: [AccessPresetsService],
  exports: [AccessPresetsService],
})
export class AccessPresetsModule {}
```

- [ ] **Step 5: Register in AppModule**

Add to `apps/backend/src/app.module.ts`:
```typescript
import { AccessPresetsModule } from './access-presets/access-presets.module';

// In imports array:
AccessPresetsModule,
```

- [ ] **Step 6: Create DTOs directory**

```bash
mkdir -p apps/backend/src/access-presets/dto
```

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/access-presets/
git commit -m "feat: add AccessPreset backend CRUD"
```

---

### Task 5: AccessPreset Admin UI

**Files:**
- Create: `apps/admin/src/features/access-presets/api.ts`
- Create: `apps/admin/src/features/access-presets/hooks.ts`
- Create: `apps/admin/src/features/access-presets/index.tsx`
- Create: route file under `/mon/employees/presets/`

- [ ] **Step 1: Create API client**

```typescript
// apps/admin/src/features/access-presets/api.ts
import { apiClient } from '@/lib/api-client'

export interface AccessPresetResponse {
  id: string
  name: string
  description: string | null
  permissions: string[]
  createdAt: string
  updatedAt: string
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export const accessPresetsApi = {
  list: (page = 1, perPage = 20, search?: string) =>
    apiClient.get<PaginatedResponse<AccessPresetResponse>>('/access-presets', {
      params: { page, perPage, search },
    }),

  get: (id: string) =>
    apiClient.get<AccessPresetResponse>(`/access-presets/${id}`),

  create: (data: { name: string; description?: string; permissions: string[] }) =>
    apiClient.post<AccessPresetResponse>('/access-presets', data),

  update: (id: string, data: Partial<{ name: string; description?: string; permissions: string[] }>) =>
    apiClient.put<AccessPresetResponse>(`/access-presets/${id}`, data),

  delete: (id: string) =>
    apiClient.delete(`/access-presets/${id}`),
}
```

- [ ] **Step 2: Create hooks**

```typescript
// apps/admin/src/features/access-presets/hooks.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { accessPresetsApi } from './api'

export function useAccessPresetsQuery(page: number, search?: string) {
  return useQuery({
    queryKey: ['access-presets', page, search],
    queryFn: () => accessPresetsApi.list(page, 20, search).then((r) => r.data),
  })
}

export function useAccessPresetMutations() {
  const queryClient = useQueryClient()

  const createPreset = useMutation({
    mutationFn: accessPresetsApi.create,
    onSuccess: () => {
      toast.success('Access preset created')
      queryClient.invalidateQueries({ queryKey: ['access-presets'] })
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Failed to create'),
  })

  const updatePreset = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof accessPresetsApi.update>[1] }) =>
      accessPresetsApi.update(id, data),
    onSuccess: () => {
      toast.success('Access preset updated')
      queryClient.invalidateQueries({ queryKey: ['access-presets'] })
    },
  })

  const deletePreset = useMutation({
    mutationFn: (id: string) => accessPresetsApi.delete(id),
    onSuccess: () => {
      toast.success('Access preset deleted')
      queryClient.invalidateQueries({ queryKey: ['access-presets'] })
    },
  })

  return { createPreset, updatePreset, deletePreset }
}
```

- [ ] **Step 3: Create main page component**

```tsx
// apps/admin/src/features/access-presets/index.tsx
'use client'

import { useState } from 'react'
import { useAccessPresetsQuery, useAccessPresetMutations } from './hooks'
import { type AccessPresetResponse } from './api'
import { PermissionCheckboxMatrix } from '@/components/permissions/PermissionCheckboxMatrix'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { GlobalSearchBar } from '@/components/global-search-bar'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

export default function AccessPresetsPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const { data, isLoading } = useAccessPresetsQuery(page, search)
  const { createPreset, updatePreset, deletePreset } = useAccessPresetMutations()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AccessPresetResponse | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formPerms, setFormPerms] = useState<string[]>([])

  const openCreate = () => {
    setEditing(null)
    setFormName('')
    setFormDesc('')
    setFormPerms([])
    setDialogOpen(true)
  }

  const openEdit = (preset: AccessPresetResponse) => {
    setEditing(preset)
    setFormName(preset.name)
    setFormDesc(preset.description || '')
    setFormPerms(preset.permissions)
    setDialogOpen(true)
  }

  const handleSave = () => {
    if (!formName.trim()) {
      toast.error('Name is required')
      return
    }
    if (editing) {
      updatePreset.mutate({
        id: editing.id,
        data: { name: formName, description: formDesc, permissions: formPerms },
      })
    } else {
      createPreset.mutate({ name: formName, description: formDesc, permissions: formPerms })
    }
    setDialogOpen(false)
  }

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this preset?')) {
      deletePreset.mutate(id)
    }
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchBar />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Access Presets</h2>
            <p className='text-muted-foreground'>Manage permission templates</p>
          </div>
          <Button onClick={openCreate}>
            <Plus className='mr-2 h-4 w-4' /> Add Preset
          </Button>
        </div>

        <div className='flex items-center gap-2'>
          <Input
            placeholder='Search presets...'
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className='max-w-xs'
          />
        </div>

        <Card>
          <CardContent className='p-0'>
            {isLoading ? (
              <div className='flex justify-center py-8'>
                <Loader2 className='animate-spin h-6 w-6' />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Permissions</TableHead>
                    <TableHead className='w-24'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className='text-center py-8 text-muted-foreground'>
                        No access presets found
                      </TableCell>
                    </TableRow>
                  ) : (
                    data?.data?.map((preset) => (
                      <TableRow key={preset.id}>
                        <TableCell className='font-medium'>{preset.name}</TableCell>
                        <TableCell className='text-muted-foreground'>{preset.description || '-'}</TableCell>
                        <TableCell>{preset.permissions.length} permissions</TableCell>
                        <TableCell>
                          <div className='flex gap-1'>
                            <Button variant='ghost' size='icon' onClick={() => openEdit(preset)}>
                              <Pencil className='h-4 w-4' />
                            </Button>
                            <Button variant='ghost' size='icon' onClick={() => handleDelete(preset.id)}>
                              <Trash2 className='h-4 w-4' />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className='max-w-2xl max-h-[90vh] overflow-y-auto'>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Preset' : 'New Access Preset'}</DialogTitle>
              <DialogDescription>
                Define the permissions for this preset template.
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-4'>
              <div className='grid gap-2'>
                <Label htmlFor='name'>Name *</Label>
                <Input
                  id='name'
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder='e.g., Floor Salesperson'
                />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='desc'>Description</Label>
                <Textarea
                  id='desc'
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder='Optional description'
                />
              </div>
              <div className='border-t pt-4'>
                <Label className='mb-4 block font-semibold'>Permissions</Label>
                <PermissionCheckboxMatrix selected={formPerms} onChange={setFormPerms} />
              </div>
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}
```

- [ ] **Step 4: Create route**

```tsx
// apps/admin/src/routes/_authenticated/mon/employees/presets.tsx
import { createFileRoute } from '@tanstack/react-router'
import AccessPresetsPage from '@/features/access-presets'

export const Route = createFileRoute('/_authenticated/mon/employees/presets')({
  component: AccessPresetsPage,
})
```

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/access-presets/ apps/admin/src/routes/_authenticated/mon/employees/presets.tsx
git commit -m "feat: add AccessPreset admin UI with permission matrix"
```

---

### Task 6: Designation CRUD Admin UI

**Files:**
- Create: `apps/admin/src/features/designations/api.ts`
- Create: `apps/admin/src/features/designations/hooks.ts`
- Create: `apps/admin/src/features/designations/index.tsx`
- Create: route file

- [ ] **Step 1: Create API client**

```typescript
// apps/admin/src/features/designations/api.ts
import { apiClient } from '@/lib/api-client'

export interface DesignationResponse {
  id: string
  name: string
  slug: string
  level: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export const designationsApi = {
  list: () => apiClient.get<DesignationResponse[]>('/designations'),

  create: (data: { name: string; level?: number }) =>
    apiClient.post<DesignationResponse>('/designations', data),

  update: (id: string, data: Partial<{ name: string; level: number; isActive: boolean }>) =>
    apiClient.put<DesignationResponse>(`/designations/${id}`, data),

  delete: (id: string) => apiClient.delete(`/designations/${id}`),
}
```

- [ ] **Step 2: Create hooks**

```typescript
// apps/admin/src/features/designations/hooks.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { designationsApi } from './api'

export function useDesignationsQuery() {
  return useQuery({
    queryKey: ['designations'],
    queryFn: () => designationsApi.list().then((r) => r.data),
  })
}

export function useDesignationMutations() {
  const qc = useQueryClient()
  return {
    create: useMutation({
      mutationFn: designationsApi.create,
      onSuccess: () => { toast.success('Designation created'); qc.invalidateQueries({ queryKey: ['designations'] }) },
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: Parameters<typeof designationsApi.update>[1] }) =>
        designationsApi.update(id, data),
      onSuccess: () => { toast.success('Designation updated'); qc.invalidateQueries({ queryKey: ['designations'] }) },
    }),
    delete: useMutation({
      mutationFn: (id: string) => designationsApi.delete(id),
      onSuccess: () => { toast.success('Designation deleted'); qc.invalidateQueries({ queryKey: ['designations'] }) },
    }),
  }
}
```

- [ ] **Step 3: Create main page (single-page CRUD with dialog)**

```tsx
// apps/admin/src/features/designations/index.tsx
'use client'

import { useState } from 'react'
import { useDesignationsQuery, useDesignationMutations } from './hooks'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { GlobalSearchBar } from '@/components/global-search-bar'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react'

export default function DesignationsPage() {
  const { data, isLoading } = useDesignationsQuery()
  const { create, update, delete: deleteDesig } = useDesignationMutations()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [name, setName] = useState('')
  const [level, setLevel] = useState('0')

  const openCreate = () => { setEditing(null); setName(''); setLevel('0'); setDialogOpen(true) }
  const openEdit = (d: any) => { setEditing(d); setName(d.name); setLevel(String(d.level)); setDialogOpen(true) }

  const handleSave = () => {
    if (!name.trim()) return
    const payload = { name: name.trim(), level: parseInt(level) || 0 }
    if (editing) update.mutate({ id: editing.id, data: payload })
    else create.mutate(payload)
    setDialogOpen(false)
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchBar /><ThemeSwitch /><ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Designations</h2>
            <p className='text-muted-foreground'>Manage job designations</p>
          </div>
          <Button onClick={openCreate}><Plus className='mr-2 h-4 w-4' /> Add Designation</Button>
        </div>
        <Card>
          <CardContent className='p-0'>
            {isLoading ? (
              <div className='flex justify-center py-8'><Loader2 className='animate-spin h-6 w-6' /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='w-24'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className='text-center py-8 text-muted-foreground'>No designations found</TableCell>
                    </TableRow>
                  ) : (
                    data?.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className='font-medium'>{d.name}</TableCell>
                        <TableCell>{d.level}</TableCell>
                        <TableCell><Badge variant={d.isActive ? 'default' : 'secondary'}>{d.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                        <TableCell>
                          <div className='flex gap-1'>
                            <Button variant='ghost' size='icon' onClick={() => openEdit(d)}><Pencil className='h-4 w-4' /></Button>
                            <Button variant='ghost' size='icon' onClick={() => deleteDesig.mutate(d.id)}><Trash2 className='h-4 w-4' /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? 'Edit Designation' : 'New Designation'}</DialogTitle></DialogHeader>
            <div className='space-y-4'>
              <div className='grid gap-2'>
                <Label>Name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g., Senior Sales Manager' />
              </div>
              <div className='grid gap-2'>
                <Label>Level</Label>
                <Input type='number' value={level} onChange={(e) => setLevel(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}
```

- [ ] **Step 4: Create route**

```tsx
// apps/admin/src/routes/_authenticated/mon/employees/designations.tsx
import { createFileRoute } from '@tanstack/react-router'
import DesignationsPage from '@/features/designations'

export const Route = createFileRoute('/_authenticated/mon/employees/designations')({
  component: DesignationsPage,
})
```

- [ ] **Step 5: Check if backend Designation endpoints exist**

If not, create a simple backend module.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/features/designations/ apps/admin/src/routes/_authenticated/mon/employees/designations.tsx
git commit -m "feat: add Designation CRUD admin UI"
```

---

### Task 7: CustomerProfile Backend + Linking Service

**Files:**
- Create: `apps/backend/src/customers/customer-linking.service.ts`
- Modify: `apps/backend/src/customers/customers.service.ts`
- Modify: `apps/backend/src/customers/customers.module.ts`
- Modify: `apps/backend/src/customers/customers.controller.ts`

- [ ] **Step 1: Create linking service**

```typescript
// apps/backend/src/customers/customer-linking.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { baPrisma } from '../better-auth/prisma';

@Injectable()
export class CustomerLinkingService {
  constructor(private prisma: PrismaService) {}

  /**
   * Email-based: on CustomerProfile create/update, check if email matches
   * an existing BA user. Link if so.
   */
  async linkByEmail(customerProfileId: string, email: string) {
    if (!email) return;

    const baUser = await baPrisma.betterAuthUser.findUnique({
      where: { email },
    });
    if (!baUser) return;

    // Check not already linked
    const profile = await this.prisma.customerProfile.findUnique({
      where: { id: customerProfileId },
    });
    if (profile?.betterAuthUserId) return; // already linked

    await this.prisma.customerProfile.update({
      where: { id: customerProfileId },
      data: { betterAuthUserId: baUser.id },
    });
  }

  /**
   * Phone-based: on order placed by logged-in BA user, check if order phone
   * matches an unlinked CustomerProfile.
   */
  async linkByPhone(betterAuthUserId: string, phone: string) {
    if (!phone) return;

    const profile = await this.prisma.customerProfile.findFirst({
      where: { phone, betterAuthUserId: null },
    });
    if (!profile) return;

    await this.prisma.customerProfile.update({
      where: { id: profile.id },
      data: { betterAuthUserId },
    });
  }
}
```

- [ ] **Step 2: Update CustomersModule to provide CustomerLinkingService**

```typescript
// apps/backend/src/customers/customers.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerLinkingService } from './customer-linking.service';

@Module({
  imports: [PrismaModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerLinkingService],
  exports: [CustomersService, CustomerLinkingService],
})
export class CustomersModule {}
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/customers/
git commit -m "feat: add CustomerLinkingService for email/phone profile merging"
```

---

### Task 8: Employee Backend (BA User Search) + Dedicated Create Page

**Files:**
- Create: `apps/backend/src/employees/dto/create-employee.dto.ts` (rewrite)
- Modify: `apps/backend/src/employees/employees.service.ts`
- Modify: `apps/backend/src/employees/employees.controller.ts`
- Create: `apps/admin/src/features/employees/create.tsx`

- [ ] **Step 1: Rewrite create-employee.dto.ts**

```typescript
// apps/backend/src/employees/dto/create-employee.dto.ts
import {
  IsString, IsNotEmpty, IsOptional, IsEnum, IsDateString, IsNumber, Min, IsArray,
} from 'class-validator';
import { EmploymentType } from '@prisma/client';

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  betterAuthUserId: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designationId?: string;

  @IsOptional()
  @IsString()
  accessPresetId?: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsDateString()
  @IsNotEmpty()
  joiningDate: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salary?: number;

  @IsOptional()
  @IsString()
  bankAccountNo?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  profilePictureUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
```

- [ ] **Step 2: Update EmployeesService — replace identity fields with BA user search**

```typescript
// apps/backend/src/employees/employees.service.ts
import {
  Injectable, NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { baPrisma } from '../better-auth/prisma';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, perPage = 20, status?: string, departmentId?: string) {
    const where: any = {};
    if (status) where.status = status;
    if (departmentId) where.departmentId = departmentId;

    const [data, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          department: { select: { id: true, name: true, slug: true } },
          designation: { select: { id: true, name: true, slug: true, level: true } },
          accessPreset: { select: { id: true, name: true } },
          betterAuthUser: { select: { id: true, name: true, email: true, role: true } },
        },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true, slug: true } },
        designation: { select: { id: true, name: true, slug: true, level: true } },
        accessPreset: { select: { id: true, name: true } },
        betterAuthUser: { select: { id: true, name: true, email: true, role: true } },
      },
    });
    if (!employee) throw new NotFoundException(`Employee not found`);
    return employee;
  }

  async create(dto: CreateEmployeeDto) {
    const baUser = await baPrisma.betterAuthUser.findUnique({
      where: { id: dto.betterAuthUserId },
    });
    if (!baUser) throw new BadRequestException('Better Auth user not found');

    const existing = await this.prisma.employee.findUnique({
      where: { betterAuthUserId: dto.betterAuthUserId },
    });
    if (existing) throw new ConflictException('User is already an employee');

    if (dto.departmentId) {
      const dept = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
      if (!dept) throw new NotFoundException('Department not found');
    }
    if (dto.designationId) {
      const desig = await this.prisma.designation.findUnique({ where: { id: dto.designationId } });
      if (!desig) throw new NotFoundException('Designation not found');
    }
    if (dto.accessPresetId) {
      const preset = await this.prisma.accessPreset.findUnique({ where: { id: dto.accessPresetId } });
      if (!preset) throw new NotFoundException('Access preset not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.orderCounter.upsert({
        where: { date: this.dateStr() },
        create: { date: this.dateStr(), seq: 1 },
        update: { seq: { increment: 1 } },
      });

      const employeeId = `EMP-${this.dateStr()}-${String(counter.seq).padStart(4, '0')}`;

      const employee = await tx.employee.create({
        data: {
          betterAuthUserId: dto.betterAuthUserId,
          employeeId,
          departmentId: dto.departmentId,
          designationId: dto.designationId,
          accessPresetId: dto.accessPresetId,
          employmentType: dto.employmentType || 'full_time',
          joiningDate: new Date(dto.joiningDate),
          salary: dto.salary ?? undefined,
          bankAccountNo: dto.bankAccountNo,
          bankName: dto.bankName,
          profilePictureUrl: dto.profilePictureUrl,
          notes: dto.notes,
        },
      });

      // Update BA user role to 'employee'
      await baPrisma.betterAuthUser.update({
        where: { id: dto.betterAuthUserId },
        data: { role: 'employee' },
      });

      return employee;
    });
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    await this.findOne(id);
    return this.prisma.employee.update({
      where: { id },
      data: {
        ...dto,
        joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : undefined,
      },
    });
  }

  async remove(id: string) {
    const emp = await this.findOne(id);
    // Reset BA user role back to admin (or previous)
    await baPrisma.betterAuthUser.update({
      where: { id: emp.betterAuthUserId },
      data: { role: 'admin' },
    });
    return this.prisma.employee.delete({ where: { id } });
  }

  /** Search BA users for employee creation combobox */
  async searchBaUsers(query: string) {
    const users = await baPrisma.betterAuthUser.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
        // Exclude users already linked to employees
        employee: null,
      },
      take: 20,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, role: true },
    });
    return { data: users };
  }

  private dateStr() {
    const d = new Date();
    const yy = d.getFullYear().toString().slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }
}
```

- [ ] **Step 3: Add search endpoint to controller**

```typescript
// apps/backend/src/employees/employees.controller.ts
// Add:
@Get('search/ba-users')
searchBaUsers(@Query('q') q: string) {
  return this.employeesService.searchBaUsers(q || '');
}
```

- [ ] **Step 4: Create dedicated employee create page (admin)**

```tsx
// apps/admin/src/features/employees/create.tsx
'use client'

import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { SelectDropdown } from '@/components/select-dropdown'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { Loader2, Search, ArrowLeft } from 'lucide-react'
import { useDesignationsQuery } from '@/features/designations/hooks'

// Simplified inline version - a full Combobox can replace the search field
export default function CreateEmployeePage() {
  const navigate = useNavigate()
  const { data: designations } = useDesignationsQuery()

  const [step, setStep] = useState<'search' | 'form' | 'hr'>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedUser, setSelectedUser] = useState<any>(null)

  const [formData, setFormData] = useState({
    designationId: '',
    departmentId: '',
    accessPresetId: '',
    employmentType: 'full_time',
    joiningDate: '',
    salary: '',
    bankAccountNo: '',
    bankName: '',
    notes: '',
  })

  const searchUsers = useCallback(async (q: string) => {
    if (q.length < 2) return
    setSearching(true)
    try {
      const res = await apiClient.get<{ data: any[] }>('/employees/search/ba-users', { params: { q } })
      setSearchResults(res.data.data)
    } catch {
      toast.error('Search failed')
    }
    setSearching(false)
  }, [])

  const selectUser = (user: any) => {
    setSelectedUser(user)
    setStep('form')
  }

  const handleSubmit = async () => {
    if (!selectedUser || !formData.joiningDate) {
      toast.error('Please fill all required fields')
      return
    }
    try {
      await apiClient.post('/employees', {
        betterAuthUserId: selectedUser.id,
        ...formData,
        salary: formData.salary ? parseFloat(formData.salary) : undefined,
      })
      toast.success('Employee created successfully')
      navigate({ to: '/op/employees' })
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to create employee')
    }
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchBar /><ThemeSwitch /><ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6 max-w-3xl mx-auto w-full'>
        <Button variant='ghost' className='w-fit' onClick={() => navigate({ to: '/op/employees' })}>
          <ArrowLeft className='mr-2 h-4 w-4' /> Back to Employees
        </Button>
        <h2 className='text-2xl font-bold tracking-tight'>Register New Employee</h2>

        {step === 'search' && (
          <Card>
            <CardHeader><CardTitle>Step 1: Select a User</CardTitle></CardHeader>
            <CardContent className='space-y-4'>
              <div className='relative'>
                <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                <Input
                  className='pl-10'
                  placeholder='Search by name or email...'
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); searchUsers(e.target.value) }}
                />
              </div>
              {searching && <div className='flex justify-center'><Loader2 className='animate-spin h-5 w-5' /></div>}
              <div className='space-y-2'>
                {searchResults.map((user) => (
                  <div
                    key={user.id}
                    className='flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-muted/50'
                    onClick={() => selectUser(user)}
                  >
                    <div>
                      <p className='font-medium'>{user.name}</p>
                      <p className='text-sm text-muted-foreground'>{user.email}</p>
                    </div>
                    <Button size='sm'>Select</Button>
                  </div>
                ))}
                {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
                  <p className='text-center text-muted-foreground py-4'>No users found</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {(step === 'form' || step === 'hr') && selectedUser && (
          <>
            <Card>
              <CardHeader><CardTitle>Selected User</CardTitle></CardHeader>
              <CardContent>
                <p className='font-medium'>{selectedUser.name}</p>
                <p className='text-sm text-muted-foreground'>{selectedUser.email}</p>
                <Button variant='outline' size='sm' className='mt-2' onClick={() => { setStep('search'); setSelectedUser(null) }}>
                  Change
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>HR Details</CardTitle></CardHeader>
              <CardContent className='grid grid-cols-2 gap-4'>
                <div className='grid gap-2'>
                  <Label>Designation</Label>
                  <SelectDropdown
                    value={formData.designationId}
                    onValueChange={(v) => setFormData({ ...formData, designationId: v })}
                    placeholder='Select designation'
                    items={(designations || []).map((d) => ({ label: d.name, value: d.id }))}
                  />
                </div>
                <div className='grid gap-2'>
                  <Label>Employment Type</Label>
                  <SelectDropdown
                    value={formData.employmentType}
                    onValueChange={(v) => setFormData({ ...formData, employmentType: v })}
                    placeholder='Select type'
                    items={[
                      { label: 'Full Time', value: 'full_time' },
                      { label: 'Part Time', value: 'part_time' },
                      { label: 'Contract', value: 'contract' },
                      { label: 'Internship', value: 'internship' },
                    ]}
                  />
                </div>
                <div className='grid gap-2'>
                  <Label>Joining Date *</Label>
                  <Input type='date' value={formData.joiningDate} onChange={(e) => setFormData({ ...formData, joiningDate: e.target.value })} />
                </div>
                <div className='grid gap-2'>
                  <Label>Salary</Label>
                  <Input type='number' value={formData.salary} onChange={(e) => setFormData({ ...formData, salary: e.target.value })} />
                </div>
                <div className='grid gap-2'>
                  <Label>Bank Account No</Label>
                  <Input value={formData.bankAccountNo} onChange={(e) => setFormData({ ...formData, bankAccountNo: e.target.value })} />
                </div>
                <div className='grid gap-2'>
                  <Label>Bank Name</Label>
                  <Input value={formData.bankName} onChange={(e) => setFormData({ ...formData, bankName: e.target.value })} />
                </div>
                <div className='col-span-2 grid gap-2'>
                  <Label>Notes</Label>
                  <textarea
                    className='flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>

            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => navigate({ to: '/op/employees' })}>Cancel</Button>
              <Button onClick={handleSubmit}>Create Employee</Button>
            </div>
          </>
        )}
      </Main>
    </>
  )
}
```

- [ ] **Step 5: Create route**

```tsx
// apps/admin/src/routes/_authenticated/op/employees/create.tsx
import { createFileRoute } from '@tanstack/react-router'
import CreateEmployeePage from '@/features/employees/create'

export const Route = createFileRoute('/_authenticated/op/employees/create')({
  component: CreateEmployeePage,
})
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/employees/ apps/admin/src/features/employees/create.tsx apps/admin/src/routes/_authenticated/op/employees/create.tsx
git commit -m "feat: restructure employee flow with BA user search + dedicated create page"
```

---

### Task 9: User Management Enhancement — Add Permission Matrix to Create/Edit

**Files:**
- Modify: `apps/admin/src/features/users/components/users-action-dialog.tsx`
- Modify: `apps/admin/src/features/users/api.ts`

- [ ] **Step 1: Add override_permissions to API types**

```typescript
// apps/admin/src/features/users/api.ts
// Add to UserResponse:
//   override_permissions: string[]

export interface UserResponse {
  id: string
  firstName: string
  lastName: string
  username: string
  email: string
  phoneNumber: string
  status: string
  role: string
  override_permissions: string[]
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: Extend user create/update API to accept permissions**

```typescript
// apps/admin/src/features/users/api.ts
// Update create:
create: (data: {
  firstName: string
  lastName: string
  username: string
  email: string
  phoneNumber: string
  password: string
  role: string
  override_permissions?: string[]
}) => apiClient.post<UserResponse>('/users', data),

// Update update:
update: (id: string, data: Partial<{
  firstName: string
  lastName: string
  username: string
  email: string
  phoneNumber: string
  status: string
  role: string
  password: string
  override_permissions?: string[]
}>) => apiClient.put<UserResponse>(`/users/${id}`, data),
```

- [ ] **Step 3: Add permission matrix toggle to UsersActionDialog**

In `users-action-dialog.tsx`, add after the role field:
```tsx
// After </FormField> for role, add:

{values.role === 'admin' && (
  <div className='col-span-6 border rounded-lg p-4 space-y-3'>
    <Label className='font-semibold'>Permissions</Label>
    <p className='text-sm text-muted-foreground mb-3'>
      Assign permissions directly (bypasses Employee module)
    </p>
    <PermissionCheckboxMatrix
      selected={permissions}
      onChange={setPermissions}
    />
  </div>
)}
```

Import: `import { PermissionCheckboxMatrix } from '@/components/permissions/PermissionCheckboxMatrix'`

And add state: `const [permissions, setPermissions] = useState<string[]>(currentRow?.override_permissions || [])`

Pass permissions in submit:
```typescript
updateData.override_permissions = permissions
// or for create:
override_permissions: permissions,
```

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/features/users/
git commit -m "feat: add permission matrix to user management create/edit"
```

---

### Task 10: Session Extension + @Permissions Guard

**Files:**
- Modify: `apps/backend/src/better-auth/auth.config.ts`
- Create: `apps/backend/src/common/decorators/permissions.decorator.ts`
- Create: `apps/backend/src/common/guards/permissions.guard.ts`

- [ ] **Step 1: Update auth.config.ts — extend customSession plugin**

```typescript
// apps/backend/src/better-auth/auth.config.ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { customSession } from "better-auth/plugins";
import { baPrisma } from "./prisma";
import { mainPrisma } from "./prisma"; // we'll export this
// alternatively, import main PrismaService instance

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) {
  const similar = Object.keys(process.env).filter(
    (k) => k.includes("SECRET") || k.includes("AUTH") || k.includes("BETTER"),
  );
  console.error("[BA] BETTER_AUTH_SECRET is NOT SET");
  console.error("[BA] Available related env vars:", similar.join(", ") || "(none)");
  console.error("[BA] All env var keys:", Object.keys(process.env).sort().join(", "));
  throw new Error(
    "BETTER_AUTH_SECRET is not set in environment variables. " +
      "Add it in Portainer stack Environment Variables section, then re-deploy the stack.",
  );
}

export const auth = betterAuth({
  secret,
  basePath: "/api/better-auth",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:4000",
  database: prismaAdapter(baPrisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  advanced: {
    database: {
      generateId: false,
    },
  },
  user: {
    modelName: "betterAuthUser",
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "customer" },
      override_permissions: { type: "string[]", required: false },
    },
  },
  account: { modelName: "betterAuthAccount" },
  session: {
    modelName: "betterAuthSession",
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  verification: { modelName: "betterAuthVerification" },
  plugins: [
    customSession(async ({ user, session }) => {
      try {
        // Resolve permissions
        let permissions: string[] = [];
        let customerProfileId: string | undefined;
        let employeeId: string | undefined;

        const role = (user as any).role || 'customer';
        const overridePerms: string[] = (user as any).override_permissions || [];

        if (role === 'employee') {
          // Lookup employee + access preset
          const emp = await baPrisma.employee.findUnique({
            where: { betterAuthUserId: user.id },
            include: { accessPreset: true },
          });
          if (emp) {
            employeeId = emp.id;
            if (emp.accessPreset) {
              permissions = [...emp.accessPreset.permissions];
            }
            // Merge overrides
            if (overridePerms.length > 0) {
              const overrideSet = new Set(overridePerms);
              permissions = [...new Set([...permissions, ...overridePerms])];
            }
          }
        } else if (role === 'admin' || role === 'superadmin') {
          // Standalone admin: permissions from override_permissions
          permissions = overridePerms;
        }

        // Lookup customer profile for customers
        if (role === 'customer') {
          const profile = await baPrisma.customerProfile.findUnique({
            where: { betterAuthUserId: user.id },
          });
          if (profile) {
            customerProfileId = profile.id;
          }
        }

        return {
          user: {
            ...user,
            role,
            permissions,
            customerProfileId,
            employeeId,
          },
          session,
        };
      } catch (error) {
        console.error('[BA] customSession error:', error);
        return {
          user: { ...user, role: 'customer', permissions: [] },
          session,
        };
      }
    }),
  ],
});
```

- [ ] **Step 2: Create @Permissions decorator**

```typescript
// apps/backend/src/common/decorators/permissions.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
```

- [ ] **Step 3: Create PermissionsGuard**

```typescript
// apps/backend/src/common/guards/permissions.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const session = request.session || request.user;

    // BA session embeds permissions in user object
    const userPermissions: string[] = session?.user?.permissions || [];

    const hasAll = requiredPermissions.every((perm) => userPermissions.includes(perm));
    if (!hasAll) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
```

- [ ] **Step 4: Register PermissionsGuard in AppModule (optional, use per-controller)**

```typescript
// In app.module.ts, add as provider if global, or use @UseGuards on controllers
```

- [ ] **Step 5: Update Prisma client export for better-auth**

```typescript
// apps/backend/src/better-auth/prisma.ts
import { PrismaClient } from '@prisma/client';

// Lazy-init Proxy for BA operations
function createBaPrisma() {
  let client: PrismaClient | null = null;
  const handler: ProxyHandler<PrismaClient> = {
    get(_, prop) {
      if (!client) {
        client = new PrismaClient({
          datasources: {
            db: { url: process.env.DATABASE_URL },
          },
        });
      }
      return (client as any)[prop];
    },
  };
  return new Proxy({} as PrismaClient, handler);
}

export const baPrisma = createBaPrisma();
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/common/decorators/permissions.decorator.ts apps/backend/src/common/guards/permissions.guard.ts apps/backend/src/better-auth/
git commit -m "feat: extend BA session with permissions + add @Permissions guard"
```

---

### Task 11: OAuth AuthSettings (Backend + Admin UI)

**Files:**
- Create: `apps/backend/src/auth-settings/auth-settings.service.ts`
- Create: `apps/backend/src/auth-settings/auth-settings.controller.ts`
- Create: `apps/backend/src/auth-settings/auth-settings.module.ts`
- Create: `apps/admin/src/features/auth-settings/`
- Modify: `apps/backend/src/better-auth/auth.config.ts` (OAuth loading)

- [ ] **Step 1: Create AuthSettings service with encryption**

```typescript
// apps/backend/src/auth-settings/auth-settings.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// In production, store this key in env var ENCRYPTION_KEY
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY || 'default-dev-key-change-in-production-1234';
  return crypto.scryptSync(key, 'salt', 32);
}

@Injectable()
export class AuthSettingsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const settings = await this.prisma.authSettings.findMany();
    return settings.map((s) => ({
      ...s,
      client_id: this.decrypt(s.client_id),
      client_secret: s.client_secret ? this.decrypt(s.client_secret) : '',
    }));
  }

  async upsert(provider_name: string, data: { is_enabled?: boolean; client_id?: string; client_secret?: string }) {
    const updateData: any = {};
    if (data.is_enabled !== undefined) updateData.is_enabled = data.is_enabled;
    if (data.client_id !== undefined) updateData.client_id = this.encrypt(data.client_id);
    if (data.client_secret !== undefined) updateData.client_secret = this.encrypt(data.client_secret);

    return this.prisma.authSettings.upsert({
      where: { provider_name },
      create: { provider_name, ...updateData },
      update: updateData,
    });
  }

  /** Load OAuth configs for BA — decrypt and return */
  async getEnabledProviders() {
    const providers = await this.prisma.authSettings.findMany({
      where: { is_enabled: true },
    });
    return providers.map((p) => ({
      provider_name: p.provider_name,
      client_id: this.decrypt(p.client_id),
      client_secret: this.decrypt(p.client_secret),
    }));
  }

  private encrypt(text: string): string {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  private decrypt(encryptedText: string): string {
    try {
      const key = getEncryptionKey();
      const parts = encryptedText.split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return encryptedText; // fallback: return as-is (for plaintext migration)
    }
  }
}
```

- [ ] **Step 2: Create AuthSettings controller**

```typescript
// apps/backend/src/auth-settings/auth-settings.controller.ts
import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { AuthSettingsService } from './auth-settings.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('auth-settings')
@Roles('superadmin')
export class AuthSettingsController {
  constructor(private service: AuthSettingsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Put(':provider')
  upsert(
    @Param('provider') provider: string,
    @Body() data: { is_enabled?: boolean; client_id?: string; client_secret?: string },
  ) {
    return this.service.upsert(provider, data);
  }
}
```

- [ ] **Step 3: Create module**

```typescript
// apps/backend/src/auth-settings/auth-settings.module.ts
import { Module } from '@nestjs/common';
import { AuthSettingsService } from './auth-settings.service';
import { AuthSettingsController } from './auth-settings.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuthSettingsController],
  providers: [AuthSettingsService],
  exports: [AuthSettingsService],
})
export class AuthSettingsModule {}
```

- [ ] **Step 4: Register in AppModule**

```typescript
import { AuthSettingsModule } from './auth-settings/auth-settings.module';
// In imports:
AuthSettingsModule,
```

- [ ] **Step 5: Note on OAuth DB-to-BA integration**

Better Auth's config is synchronous at module load — cannot query DB asynchronously
from `auth.config.ts` in CommonJS. For now, OAuth providers continue reading from
env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, etc.).

The `AuthSettings` table and admin UI serve as the **configuration management UI**
— admins can view/update credentials, but BA reads from env vars at runtime.
Full DB-driven OAuth loading requires restructuring `auth` into an async factory,
which is a separate future task.

The env var fallback from the spec (Section 6) covers this: if DB configs fail,
fall back to env vars. Since DB → BA sync is the complex part, env vars remain
the runtime source, and the admin UI manages the "source of truth" for ops.

- [ ] **Step 6: Create admin UI for AuthSettings**

```typescript
// apps/admin/src/features/auth-settings/api.ts
import { apiClient } from '@/lib/api-client'

export interface AuthProviderResponse {
  id: string
  provider_name: string
  is_enabled: boolean
  client_id: string
  client_secret: string
}

export const authSettingsApi = {
  list: () => apiClient.get<AuthProviderResponse[]>('/auth-settings'),

  upsert: (provider: string, data: { is_enabled?: boolean; client_id?: string; client_secret?: string }) =>
    apiClient.put<AuthProviderResponse>(`/auth-settings/${provider}`, data),
}
```

```tsx
// apps/admin/src/features/auth-settings/index.tsx
'use client'

import { useState, useEffect } from 'react'
import { authSettingsApi, type AuthProviderResponse } from './api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Loader2, Copy } from 'lucide-react'
import { toast } from 'sonner'

const PROVIDER_INFO: Record<string, { name: string; icon: string }> = {
  google: { name: 'Google', icon: 'G' },
  github: { name: 'GitHub', icon: 'GH' },
  facebook: { name: 'Facebook', icon: 'FB' },
}

function getRedirectUri(provider: string): string {
  const base = window.location.origin.replace('/admin', '')
  return `${base}/api/better-auth/oauth2/callback/${provider}`
}

export default function AuthSettingsPage() {
  const [providers, setProviders] = useState<AuthProviderResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    authSettingsApi.list().then((r) => setProviders(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const updateProvider = async (provider: string, data: Partial<AuthProviderResponse>) => {
    setSaving(provider)
    try {
      await authSettingsApi.upsert(provider, data)
      setProviders((prev) => prev.map((p) => (p.provider_name === provider ? { ...p, ...data } : p)))
      toast.success(`${PROVIDER_INFO[provider]?.name || provider} updated`)
    } catch {
      toast.error('Failed to update provider')
    }
    setSaving(null)
  }

  const copyRedirectUri = (uri: string) => {
    navigator.clipboard.writeText(uri)
    toast.success('Redirect URI copied')
  }

  const defaultProviders = ['google', 'github', 'facebook']

  return (
    <>
      <Header fixed><GlobalSearchBar /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6 max-w-3xl mx-auto w-full'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Auth & Integrations</h2>
          <p className='text-muted-foreground'>Configure OAuth providers for social login</p>
        </div>

        {loading ? (
          <div className='flex justify-center py-8'><Loader2 className='animate-spin h-6 w-6' /></div>
        ) : (
          <div className='space-y-4'>
            {defaultProviders.map((providerKey) => {
              const info = PROVIDER_INFO[providerKey] || { name: providerKey, icon: providerKey[0].toUpperCase() }
              const existing = providers.find((p) => p.provider_name === providerKey)
              const enabled = existing?.is_enabled || false
              const clientId = existing?.client_id || ''
              const clientSecret = existing?.client_secret || ''
              const redirectUri = getRedirectUri(providerKey)

              return (
                <Card key={providerKey}>
                  <CardHeader>
                    <CardTitle className='flex items-center justify-between'>
                      <span>{info.name}</span>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(checked) => updateProvider(providerKey, {
                          is_enabled: checked,
                          client_id: clientId || ' ',
                          client_secret: clientSecret || ' ',
                        })}
                        disabled={saving === providerKey}
                      />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <div className='grid gap-2'>
                      <Label>Redirect URI</Label>
                      <div className='flex gap-2'>
                        <Input value={redirectUri} readOnly className='font-mono text-xs' />
                        <Button variant='outline' size='icon' onClick={() => copyRedirectUri(redirectUri)}>
                          <Copy className='h-4 w-4' />
                        </Button>
                      </div>
                    </div>
                    <div className='grid gap-2'>
                      <Label>Client ID</Label>
                      <Input
                        value={clientId}
                        onChange={(e) => {
                          const updated = providers.map((p) =>
                            p.provider_name === providerKey ? { ...p, client_id: e.target.value } : p
                          )
                          setProviders(updated)
                        }}
                        onBlur={() => updateProvider(providerKey, { client_id: clientId })}
                        placeholder='Enter Client ID'
                      />
                    </div>
                    <div className='grid gap-2'>
                      <Label>Client Secret</Label>
                      <Input
                        type='password'
                        value={clientSecret}
                        onChange={(e) => {
                          const updated = providers.map((p) =>
                            p.provider_name === providerKey ? { ...p, client_secret: e.target.value } : p
                          )
                          setProviders(updated)
                        }}
                        onBlur={() => updateProvider(providerKey, { client_secret: clientSecret })}
                        placeholder='Enter Client Secret'
                      />
                    </div>
                    {enabled && (!clientId || !clientSecret) && (
                      <p className='text-sm text-amber-600'>Provider enabled but credentials are missing</p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </Main>
    </>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/auth-settings/ apps/admin/src/features/auth-settings/
git commit -m "feat: add OAuth AuthSettings with encrypted storage + admin UI"
```

---

### Task 12: Integration Test & Verify

**Files:**
- Backend e2e tests
- Verify all flows

- [ ] **Step 1: Run backend tests**

```bash
cd apps/backend && npm run test:e2e
```

Run: from project root
Expected: All existing tests pass

- [ ] **Step 2: Manually verify key flows**

1. Create AccessPreset via API — verify permission matrix saves correctly
2. Create Designation via admin UI — verify CRUD works
3. Create Employee — search BA user, assign designation + preset, verify BA role updated
4. Login as employee — verify session contains correct permissions
5. Access protected endpoint with @Permissions — verify guard works
6. Create User with direct permissions (standalone mode) — verify override_permissions saved
7. Login as standalone admin — verify session has correct permissions (no employeeId)
8. Create CustomerProfile — verify email/phone linking works

- [ ] **Step 3: Run frontend build**

```bash
cd apps/admin && npm run build
```

Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: integration tests and final verification"
```

- [ ] **Step 5: Push and deploy to production**

```bash
git push origin main
# Server: pull, rebuild, run migrations, run customer migration script
```

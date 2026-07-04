# Packing Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build packing workspace for `packing_assistant` role — queue of Confirmed orders, Done/Hold actions, print stickers, inside admin SPA as full-screen workspace.

**Architecture:** New `packing` NestJS module (controller + service + DTOs) in backend. New `PackingLock` Prisma model for lock semantics. Admin SPA gets `/op/packing/` route with custom layout (sidebar collapsed, full-height workspace).

**Tech Stack:** NestJS + Prisma + TanStack Router + TanStack Query + Zustand + shadcn sidebar + Tailwind v4

**Key dependencies:**
- `packing_assistant` role already exists in UserRole enum + DB
- `Confirmed` status already exists in OrderStatus table (seed.ts)
- Need to add `Packed` and `Packing Hold` statuses to seed + migration

---

### Task 1: Prisma — Add PackingLock model + OrderStatus seeds

**Files:**
- Create: `apps/backend/prisma/migrations/0007_add_packing_lock_and_statuses/migration.sql`
- Modify: `apps/backend/prisma/schema.prisma` (add PackingLock model)
- Modify: `apps/backend/prisma/seed.ts` (add Packed, Packing Hold statuses + transitions)

- [ ] **Step 1: Add PackingLock model to schema.prisma**

After `model PosSession` (around line 460), add:

```prisma
model PackingLock {
  id        String   @id @default(uuid())
  orderId   String   @unique
  order     Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  packerId  String
  packer    User     @relation(fields: [packerId], references: [id])
  startedAt DateTime @default(now())
  expiresAt DateTime?

  @@index([packerId])
}
```

And on `model Order`, add after `timeline Json? @default("[]")`:
```prisma
  packingLock PackingLock?
```

- [ ] **Step 2: Update seed.ts statuses**

In `apps/backend/prisma/seed.ts`, add `Packed` and `Packing Hold` to the statuses array (after `Confirmed`):

```typescript
    { name: 'Confirmed', color: '#3B82F6', isInitial: false, isFinal: false, sortOrder: 2, nextStatuses: [] },
    { name: 'Packed', color: '#059669', isInitial: false, isFinal: false, sortOrder: 3, nextStatuses: [] },
    { name: 'Packing Hold', color: '#D97706', isInitial: false, isFinal: false, sortOrder: 4, nextStatuses: [] },
    { name: 'Processing', color: '#8B5CF6', isInitial: false, isFinal: false, sortOrder: 5, nextStatuses: [] },
```

Update transitions to reflect new flow:

```typescript
  const transitions: Record<string, string[]> = {
    'Payment Pending': ['Pending', 'Confirmed', 'Cancelled'],
    'Pending': ['Confirmed', 'Cancelled'],
    'Confirmed': ['Packed', 'Packing Hold', 'Cancelled'],
    'Packed': ['Shipped', 'Cancelled'],
    'Packing Hold': ['Confirmed', 'Cancelled'],
    'Processing': ['Shipped', 'Cancelled'],
```

- [ ] **Step 3: Create migration**

Run: `npx prisma migrate dev --name add_packing_lock_and_statuses --create-only` in `apps/backend`

Then open the generated SQL and add data migration:

```sql
-- Insert statuses if they don't exist
INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Packed', '#059669', false, false, 3, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Packed');

INSERT INTO "OrderStatus" ("id", "name", "color", "isInitial", "isFinal", "sortOrder", "createdAt")
SELECT gen_random_uuid(), 'Packing Hold', '#D97706', false, false, 4, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "OrderStatus" WHERE "name" = 'Packing Hold');
```

Run: `npx prisma migrate dev` to apply

- [ ] **Step 4: Run prisma validate + generate**

Run: `npx prisma validate && npx prisma generate` in `apps/backend`

Expected: `✔ Your Prisma schema is valid` + generated client

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/
git commit -m "feat(packing): add PackingLock model, Packed/Packing Hold statuses"
```

---

### Task 2: Backend — PackingModule skeleton

**Files:**
- Create: `apps/backend/src/packing/dto/packing.dto.ts`
- Create: `apps/backend/src/packing/packing.service.ts`
- Create: `apps/backend/src/packing/packing.controller.ts`
- Create: `apps/backend/src/packing/packing.module.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Create DTOs**

`apps/backend/src/packing/dto/packing.dto.ts`:

```typescript
import { IsString, IsOptional, IsIn, MinLength } from 'class-validator';

export class HoldOrderDto {
  @IsString()
  @IsIn(['Product Missing', 'Stock Issue', 'Damaged Product', 'Waiting for Approval', 'Customer Request', 'Other'])
  reason: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class PackingQueueQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
}
```

- [ ] **Step 2: Create service**

`apps/backend/src/packing/packing.service.ts`:

```typescript
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PackingService {
  private readonly LOCK_DURATION_MS = 30 * 60 * 1000; // 30 min

  constructor(private readonly prisma: PrismaService) {}

  async getQueue(search?: string) {
    const confirmedStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Confirmed' } });
    if (!confirmedStatus) throw new NotFoundException('Confirmed status not found');

    const where: any = { statusId: confirmedStatus.id };
    if (search) {
      where.OR = [
        { displayId: { contains: search, mode: 'insensitive' } },
        { guestName: { contains: search, mode: 'insensitive' } },
        { guestPhone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        items: { include: { variant: { include: { product: { include: { images: true } } } } } },
        packingLock: { include: { packer: { select: { id: true, name: true } } } },
        customer: { select: { id: true, name: true, phone: true } },
        status: { select: { id: true, name: true, color: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return orders.map((o) => ({
      id: o.id,
      displayId: o.displayId,
      customer: o.customer ? { id: o.customer.id, name: o.customer.name, phone: o.customer.phone }
        : o.guestName ? { name: o.guestName, phone: o.guestPhone }
        : null,
      items: o.items.map((i) => ({
        id: i.id,
        productName: i.variant?.product?.name ?? 'Unknown',
        variantName: i.variant?.name ?? '',
        quantity: i.quantity,
        image: i.variant?.product?.images?.[0]?.url ?? null,
      })),
      totalItems: o.items.reduce((sum, i) => sum + i.quantity, 0),
      packingLock: o.packingLock ? {
        packerId: o.packingLock.packerId,
        packerName: o.packingLock.packer.name,
        startedAt: o.packingLock.startedAt,
        expiresAt: o.packingLock.expiresAt,
      } : null,
      createdAt: o.createdAt,
    }));
  }

  async openOrder(orderId: string, packerId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { packingLock: true, status: { select: { name: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status.name !== 'Confirmed') throw new BadRequestException('Order is not in Confirmed status');

    const existingLock = order.packingLock;
    if (existingLock && existingLock.packerId !== packerId) {
      const isExpired = existingLock.expiresAt && new Date() > existingLock.expiresAt;
      if (!isExpired) {
        throw new ConflictException('Order is being packed by another user');
      }
    }

    const expiresAt = new Date(Date.now() + this.LOCK_DURATION_MS);
    const lock = await this.prisma.packingLock.upsert({
      where: { orderId },
      update: { packerId, startedAt: new Date(), expiresAt },
      create: { orderId, packerId, expiresAt },
    });

    return lock;
  }

  async markDone(orderId: string, packerId: string) {
    const lock = await this.prisma.packingLock.findUnique({ where: { orderId } });
    if (!lock) throw new BadRequestException('Order is not opened for packing');
    if (lock.packerId !== packerId) throw new ConflictException('Order is locked by another packer');

    const packedStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packed' } });
    if (!packedStatus) throw new NotFoundException('Packed status not found');

    const [result] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { statusId: packedStatus.id },
      }),
      this.prisma.packingLock.delete({ where: { orderId } }),
    ]);

    return { success: true, orderId };
  }

  async markHold(orderId: string, packerId: string, reason: string, notes?: string) {
    const lock = await this.prisma.packingLock.findUnique({ where: { orderId } });
    if (!lock) throw new BadRequestException('Order is not opened for packing');
    if (lock.packerId !== packerId) throw new ConflictException('Order is locked by another packer');

    const holdStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packing Hold' } });
    if (!holdStatus) throw new NotFoundException('Packing Hold status not found');

    const [result] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { statusId: holdStatus.id, officeNotes: notes ?? '' },
      }),
      this.prisma.packingLock.delete({ where: { orderId } }),
    ]);

    return { success: true, orderId, reason, notes };
  }

  async getActiveLocks() {
    const locks = await this.prisma.packingLock.findMany({
      include: {
        order: { select: { id: true, displayId: true } },
        packer: { select: { id: true, name: true } },
      },
    });
    return locks.map((l) => ({
      id: l.id,
      orderId: l.orderId,
      displayId: l.order.displayId,
      packerName: l.packer.name,
      startedAt: l.startedAt,
      expiresAt: l.expiresAt,
      isExpired: l.expiresAt ? new Date() > l.expiresAt : false,
    }));
  }

  async getStats(packerId?: string) {
    const packedStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packed' } });
    const holdStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packing Hold' } });
    const confirmedStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Confirmed' } });

    const where = packerId ? { assignedToId: packerId } : {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [packedCount, holdCount, pendingCount] = await Promise.all([
      this.prisma.order.count({ where: { ...where, statusId: packedStatus!.id, updatedAt: { gte: today } } }),
      this.prisma.order.count({ where: { ...where, statusId: holdStatus!.id, updatedAt: { gte: today } } }),
      this.prisma.order.count({ where: { statusId: confirmedStatus!.id } }),
    ]);

    return { packed: packedCount, held: holdCount, pending: pendingCount };
  }

  async getHistory(packerId?: string) {
    const packedStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packed' } });
    const holdStatus = await this.prisma.orderStatus.findUnique({ where: { name: 'Packing Hold' } });

    const where: any = {
      OR: [{ statusId: packedStatus!.id }, { statusId: holdStatus!.id }],
    };
    if (packerId) where.assignedToId = packerId;

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        status: { select: { name: true, color: true } },
        assignee: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    return orders.map((o) => ({
      id: o.id,
      displayId: o.displayId,
      status: o.status.name,
      statusColor: o.status.color,
      packerName: o.assignee?.name ?? 'N/A',
      updatedAt: o.updatedAt,
    }));
  }
}
```

- [ ] **Step 3: Create controller**

`apps/backend/src/packing/packing.controller.ts`:

```typescript
import {
  Controller, Get, Post, Param, Query, Body,
  BadRequestException,
} from '@nestjs/common';
import { PackingService } from './packing.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HoldOrderDto, PackingQueueQueryDto } from './dto/packing.dto';

@Controller('packing')
export class PackingController {
  constructor(private readonly svc: PackingService) {}

  @Roles('packing_assistant', 'admin', 'superadmin')
  @Get('queue')
  async getQueue(@Query() query: PackingQueueQueryDto) {
    return this.svc.getQueue(query.search);
  }

  @Roles('packing_assistant', 'admin', 'superadmin')
  @Get('queue/:id')
  async openOrder(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.openOrder(id, user.id);
  }

  @Roles('packing_assistant', 'admin', 'superadmin')
  @Post('queue/:id/done')
  async markDone(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.markDone(id, user.id);
  }

  @Roles('packing_assistant', 'admin', 'superadmin')
  @Post('queue/:id/hold')
  async markHold(
    @Param('id') id: string,
    @Body() dto: HoldOrderDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.markHold(id, user.id, dto.reason, dto.notes);
  }

  @Roles('admin', 'superadmin')
  @Get('locks')
  async getActiveLocks() {
    return this.svc.getActiveLocks();
  }

  @Roles('packing_assistant', 'admin', 'superadmin')
  @Get('stats')
  async getStats(@CurrentUser() user: any, @Query('all') all?: string) {
    if (all && (user.role === 'admin' || user.role === 'superadmin')) {
      return this.svc.getStats();
    }
    return this.svc.getStats(user.id);
  }

  @Roles('admin', 'superadmin')
  @Get('history')
  async getHistory(@Query('packerId') packerId?: string) {
    return this.svc.getHistory(packerId);
  }
}
```

- [ ] **Step 4: Create module**

`apps/backend/src/packing/packing.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PackingController } from './packing.controller';
import { PackingService } from './packing.service';

@Module({
  controllers: [PackingController],
  providers: [PackingService],
})
export class PackingModule {}
```

- [ ] **Step 5: Register in app.module.ts**

Add import line near other modules:
```typescript
import { PackingModule } from './packing/packing.module';
```

Add `PackingModule,` to the `imports` array (alphabetically, after `OpeningBalancesModule`).

- [ ] **Step 6: Build check**

Run: `npx nest build` in `apps/backend`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/packing/ apps/backend/src/app.module.ts
git commit -m "feat(packing): add packing module with queue, done, hold endpoints"
```

---

### Task 3: Backend — Unit tests

**Files:**
- Create: `apps/backend/src/packing/packing.service.spec.ts`

- [ ] **Step 1: Write test file**

`apps/backend/src/packing/packing.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PackingService } from './packing.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';

describe('PackingService', () => {
  let svc: PackingService;
  let prisma: DeepMockProxy<PrismaService>;

  const orderStatusMap = {
    Confirmed: { id: 'status-confirmed-id', name: 'Confirmed' },
    Packed: { id: 'status-packed-id', name: 'Packed' },
    'Packing Hold': { id: 'status-hold-id', name: 'Packing Hold' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackingService,
        { provide: PrismaService, useValue: mockDeep<PrismaService>() },
      ],
    }).compile();

    svc = module.get(PackingService);
    prisma = module.get(PrismaService) as DeepMockProxy<PrismaService>;
  });

  describe('getQueue', () => {
    it('should return orders with Confirmed status', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(orderStatusMap.Confirmed);
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);

      const result = await svc.getQueue();
      expect(result).toEqual([]);
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { statusId: 'status-confirmed-id' } }),
      );
    });

    it('should throw if Confirmed status not found', async () => {
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.getQueue()).rejects.toThrow(NotFoundException);
    });
  });

  describe('openOrder', () => {
    it('should upsert lock for Confirmed order', async () => {
      const mockOrder = { id: 'order-1', status: { name: 'Confirmed' }, packingLock: null };
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.packingLock.upsert as jest.Mock).mockResolvedValue({
        id: 'lock-1', orderId: 'order-1', packerId: 'packer-1', startedAt: new Date(), expiresAt: new Date(),
      });

      const result = await svc.openOrder('order-1', 'packer-1');
      expect(result).toBeDefined();
      expect(result.packerId).toBe('packer-1');
    });

    it('should throw if order not Confirmed', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({ id: 'order-1', status: { name: 'Shipped' }, packingLock: null });
      await expect(svc.openOrder('order-1', 'packer-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw if locked by another packer', async () => {
      const future = new Date(Date.now() + 60000);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1', status: { name: 'Confirmed' },
        packingLock: { packerId: 'other', expiresAt: future },
      });
      await expect(svc.openOrder('order-1', 'packer-1')).rejects.toThrow(ConflictException);
    });

    it('should allow opening if lock expired', async () => {
      const past = new Date(Date.now() - 60000);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1', status: { name: 'Confirmed' },
        packingLock: { packerId: 'other', expiresAt: past },
      });
      (prisma.packingLock.upsert as jest.Mock).mockResolvedValue({
        id: 'lock-1', orderId: 'order-1', packerId: 'packer-1', startedAt: new Date(), expiresAt: new Date(),
      });
      const result = await svc.openOrder('order-1', 'packer-1');
      expect(result.packerId).toBe('packer-1');
    });
  });

  describe('markDone', () => {
    it('should update order to Packed and remove lock', async () => {
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue({
        id: 'lock-1', orderId: 'order-1', packerId: 'packer-1',
      });
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(orderStatusMap.Packed);
      (prisma.$transaction as jest.Mock).mockResolvedValue([]);

      const result = await svc.markDone('order-1', 'packer-1');
      expect(result.success).toBe(true);
    });

    it('should throw if no lock', async () => {
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.markDone('order-1', 'packer-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('markHold', () => {
    it('should update order to Packing Hold and remove lock', async () => {
      (prisma.packingLock.findUnique as jest.Mock).mockResolvedValue({
        id: 'lock-1', orderId: 'order-1', packerId: 'packer-1',
      });
      (prisma.orderStatus.findUnique as jest.Mock).mockResolvedValue(orderStatusMap['Packing Hold']);
      (prisma.$transaction as jest.Mock).mockResolvedValue([]);

      const result = await svc.markHold('order-1', 'packer-1', 'Stock Issue', 'Need approval');
      expect(result.success).toBe(true);
      expect(result.reason).toBe('Stock Issue');
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest src/packing/packing.service.spec.ts --no-coverage` in `apps/backend`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/packing/packing.service.spec.ts
git commit -m "test(packing): unit tests for packing service"
```

---

### Task 4: Frontend — Types + API service + hooks

**Files:**
- Create: `apps/admin/src/features/packing/types.ts`
- Create: `apps/admin/src/features/packing/api.ts`
- Create: `apps/admin/src/features/packing/hooks.ts`

- [ ] **Step 1: Create types**

`apps/admin/src/features/packing/types.ts`:

```typescript
export interface QueueItem {
  id: string
  displayId: string
  customer: { id?: string; name: string; phone?: string } | null
  items: QueueItemProduct[]
  totalItems: number
  packingLock: PackingLockInfo | null
  createdAt: string
}

export interface QueueItemProduct {
  id: string
  productName: string
  variantName: string
  quantity: number
  image: string | null
}

export interface PackingLockInfo {
  packerId: string
  packerName: string
  startedAt: string
  expiresAt: string | null
}

export interface PackingStats {
  packed: number
  held: number
  pending: number
}

export interface HoldFormData {
  reason: string
  notes?: string
}

export interface HistoryEntry {
  id: string
  displayId: string
  status: string
  statusColor: string
  packerName: string
  updatedAt: string
}

export interface ActiveLock {
  id: string
  orderId: string
  displayId: string
  packerName: string
  startedAt: string
  expiresAt: string | null
  isExpired: boolean
}
```

- [ ] **Step 2: Create API service**

`apps/admin/src/features/packing/api.ts`:

```typescript
import { apiClient } from '@/lib/api-client'
import type { QueueItem, PackingStats, HoldFormData, HistoryEntry, ActiveLock } from './types'

export const packingApi = {
  getQueue: (search?: string) =>
    apiClient.get<QueueItem[]>('/packing/queue', { params: search ? { search } : {} }).then((r) => r.data),

  openOrder: (id: string) =>
    apiClient.get(`/packing/queue/${id}`).then((r) => r.data),

  markDone: (id: string) =>
    apiClient.post(`/packing/queue/${id}/done`).then((r) => r.data),

  markHold: (id: string, data: HoldFormData) =>
    apiClient.post(`/packing/queue/${id}/hold`, data).then((r) => r.data),

  getStats: (all?: boolean) =>
    apiClient.get<PackingStats>('/packing/stats', { params: all ? { all: 'true' } : {} }).then((r) => r.data),

  getLocks: () =>
    apiClient.get<ActiveLock[]>('/packing/locks').then((r) => r.data),

  getHistory: (packerId?: string) =>
    apiClient.get<HistoryEntry[]>('/packing/history', { params: packerId ? { packerId } : {} }).then((r) => r.data),
}
```

- [ ] **Step 3: Create hooks**

`apps/admin/src/features/packing/hooks.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { packingApi } from './api'
import type { HoldFormData } from './types'

const PACKING_KEYS = {
  queue: ['packing', 'queue'] as const,
  stats: ['packing', 'stats'] as const,
  locks: ['packing', 'locks'] as const,
  history: ['packing', 'history'] as const,
}

export function usePackingQueue(search?: string) {
  return useQuery({
    queryKey: [...PACKING_KEYS.queue, search],
    queryFn: () => packingApi.getQueue(search),
    refetchInterval: 15_000,
  })
}

export function usePackingStats(all?: boolean) {
  return useQuery({
    queryKey: [...PACKING_KEYS.stats, all],
    queryFn: () => packingApi.getStats(all),
    refetchInterval: 30_000,
  })
}

export function useActiveLocks() {
  return useQuery({
    queryKey: PACKING_KEYS.locks,
    queryFn: () => packingApi.getLocks(),
    refetchInterval: 30_000,
  })
}

export function usePackingHistory(packerId?: string) {
  return useQuery({
    queryKey: [...PACKING_KEYS.history, packerId],
    queryFn: () => packingApi.getHistory(packerId),
  })
}

export function useOpenOrder() {
  return useMutation({
    mutationFn: (orderId: string) => packingApi.openOrder(orderId),
  })
}

export function useMarkDone() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) => packingApi.markDone(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PACKING_KEYS.queue })
      queryClient.invalidateQueries({ queryKey: PACKING_KEYS.stats })
    },
  })
}

export function useMarkHold() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: HoldFormData }) =>
      packingApi.markHold(orderId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PACKING_KEYS.queue })
      queryClient.invalidateQueries({ queryKey: PACKING_KEYS.stats })
    },
  })
}
```

- [ ] **Step 4: Build check**

Run: `npx tsc --noEmit` in `apps/admin`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/packing/
git commit -m "feat(packing): frontend types, API service, and hooks"
```

---

### Task 5: Frontend — Route + PackingWorkspace main component

**Files:**
- Create: `apps/admin/src/routes/_authenticated/op/packing/index.tsx`
- Create: `apps/admin/src/features/packing/index.tsx`

- [ ] **Step 1: Create route file**

`apps/admin/src/routes/_authenticated/op/packing/index.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { PackingWorkspace } from '@/features/packing'

export const Route = createFileRoute('/_authenticated/op/packing/')({
  component: PackingWorkspace,
})
```

- [ ] **Step 2: Create main workspace component**

`apps/admin/src/features/packing/index.tsx`:

```tsx
import { useEffect, useCallback, useState, useRef } from 'react'
import { useSidebar } from '@/components/ui/sidebar'
import { useAuthStore } from '@/stores/auth-store'
import { usePackingQueue, usePackingStats, useOpenOrder, useMarkDone, useMarkHold } from './hooks'
import { PackingQueue } from './PackingQueue'
import { HoldModal } from './HoldModal'
import { StatsBar } from './StatsBar'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import type { QueueItem, HoldFormData } from './types'

export function PackingWorkspace() {
  const { setOpen } = useSidebar()
  const [search, setSearch] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [holdOrderId, setHoldOrderId] = useState<string | null>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  const currentUser = useAuthStore((s) => s.auth.user)
  const currentPackerId = currentUser?.id ?? ''

  const { data: queue = [], isLoading } = usePackingQueue(search)
  const { data: stats } = usePackingStats()
  const openOrder = useOpenOrder()
  const markDone = useMarkDone()
  const markHold = useMarkHold()

  // Collapse sidebar on mount, restore on unmount
  useEffect(() => {
    setOpen(false)
    return () => setOpen(true)
  }, [setOpen])

  useEffect(() => {
    setFocusedIndex(0)
  }, [queue.length])

  const openAndSelect = useCallback(async (order: QueueItem) => {
    if (order.packingLock && order.packingLock.packerId !== openOrder.data?.packerId) return
    try {
      await openOrder.mutateAsync(order.id)
      setSelectedOrderId(order.id)
    } catch {
      // lock conflict handled by UI feedback
    }
  }, [openOrder])

  const handleDone = useCallback(async (orderId: string) => {
    await markDone.mutateAsync(orderId)
    setSelectedOrderId(null)
  }, [markDone])

  const handleHold = useCallback((orderId: string) => {
    setHoldOrderId(orderId)
  }, [])

  const handleHoldSubmit = useCallback(async (data: HoldFormData) => {
    if (!holdOrderId) return
    await markHold.mutateAsync({ orderId: holdOrderId, data })
    setHoldOrderId(null)
    setSelectedOrderId(null)
  }, [holdOrderId, markHold])

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (holdOrderId) return // modal open

      const order = queue[focusedIndex]
      if (!order) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex((i) => Math.min(i + 1, queue.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          openAndSelect(order)
          break
        case ' ':
          e.preventDefault()
          if (selectedOrderId === order.id) handleDone(order.id)
          break
        case 'h':
        case 'H':
          if (selectedOrderId === order.id) handleHold(order.id)
          break
        case 'Escape':
          setSelectedOrderId(null)
          break
        case 'p':
        case 'P':
          window.open(`/op/print/sticker/${order.id}`, '_blank')
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [queue, focusedIndex, selectedOrderId, holdOrderId, openAndSelect, handleDone, handleHold])

  // Scroll focused card into view
  useEffect(() => {
    cardRefs.current[focusedIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusedIndex])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center gap-4 border-b bg-white px-6 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold">Packing Workspace</h1>
        <div className="relative ml-auto max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search order ID, customer, phone..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <StatsBar stats={stats} />
      </header>

      {/* Queue */}
      <div className="flex flex-1 gap-0 overflow-hidden">
        <PackingQueue
          items={queue}
          isLoading={isLoading}
          selectedOrderId={selectedOrderId}
          focusedIndex={focusedIndex}
          currentPackerId={currentPackerId}
          cardRefs={cardRefs}
          onSelect={openAndSelect}
          onDone={handleDone}
          onHold={handleHold}
        />

        {/* Details panel */}
        {selectedOrderId && (
          <div className="w-96 shrink-0 border-l bg-white p-6 dark:bg-zinc-900">
            <DetailsPanel orderId={selectedOrderId} queue={queue} />
          </div>
        )}
      </div>

      {/* Hold Modal */}
      {holdOrderId && (
        <HoldModal
          orderId={holdOrderId}
          onClose={() => setHoldOrderId(null)}
          onSubmit={handleHoldSubmit}
          isSubmitting={markHold.isPending}
        />
      )}
    </div>
  )
}

function DetailsPanel({ orderId, queue }: { orderId: string; queue: QueueItem[] }) {
  const order = queue.find((o) => o.id === orderId)
  if (!order) return null

  const c = order.customer
  return (
    <div className="space-y-4">
      <h2 className="font-semibold">Order {order.displayId}</h2>
      <div className="space-y-2 text-sm">
        <p><span className="text-muted-foreground">Customer:</span> {c?.name ?? 'N/A'}</p>
        <p><span className="text-muted-foreground">Phone:</span> {c?.phone ?? 'N/A'}</p>
        <p><span className="text-muted-foreground">Items:</span> {order.totalItems}</p>
        <p><span className="text-muted-foreground">Created:</span> {new Date(order.createdAt).toLocaleString()}</p>
      </div>
      <div className="space-y-2">
        {order.items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 rounded-lg border p-2">
            {item.image && (
              <img src={item.image} alt="" className="h-12 w-12 rounded object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.productName}</p>
              <p className="text-xs text-muted-foreground">{item.variantName} x{item.quantity}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Build check**

Run: `npx tsc --noEmit` in `apps/admin`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/routes/_authenticated/op/packing/index.tsx apps/admin/src/features/packing/index.tsx
git commit -m "feat(packing): workspace route and main component with sidebar collapse"
```

---

### Task 6: Frontend — Sub-components (Queue, Card, HoldModal, StatsBar)

**Files:**
- Create: `apps/admin/src/features/packing/PackingQueue.tsx`
- Create: `apps/admin/src/features/packing/PackingCard.tsx`
- Create: `apps/admin/src/features/packing/HoldModal.tsx`
- Create: `apps/admin/src/features/packing/StatsBar.tsx`

- [ ] **Step 1: Create PackingCard**

`apps/admin/src/features/packing/PackingCard.tsx`:

```tsx
import { forwardRef } from 'react'
import type { QueueItem } from './types'

interface Props {
  item: QueueItem
  isFocused: boolean
  isSelected: boolean
  currentPackerId: string
  onSelect: () => void
  onDone: () => void
  onHold: () => void
}

export const PackingCard = forwardRef<HTMLDivElement, Props>(
  ({ item, isFocused, isSelected, currentPackerId, onSelect, onDone, onHold }, ref) => {
    const isLockedByOther = item.packingLock && item.packingLock.packerId !== currentPackerId

    return (
      <div
        ref={ref}
        data-focused={isFocused}
        data-selected={isSelected}
        className={`cursor-pointer rounded-xl border-2 p-4 transition-all
          ${isSelected ? 'border-primary bg-primary/5 shadow-md' : isFocused ? 'border-blue-400 bg-white shadow-sm' : 'border-transparent bg-white hover:border-gray-200'}
          ${isLockedByOther ? 'cursor-not-allowed opacity-60' : ''}`}
        onClick={() => !isLockedByOther && onSelect()}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-sm font-bold">{item.displayId}</span>
          <span className="text-xs text-muted-foreground">{item.totalItems} items</span>
        </div>

        {/* Product images row */}
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {item.items.slice(0, 5).map((p) => (
            <div key={p.id} className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border">
              {p.image ? (
                <img src={p.image} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                  No img
                </div>
              )}
            </div>
          ))}
          {item.items.length > 5 && (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
              +{item.items.length - 5}
            </div>
          )}
        </div>

        {/* Product names summary */}
        <p className="mb-1 truncate text-sm font-medium">
          {item.items[0]?.productName}
          {item.items.length > 1 && ` +${item.items.length - 1} more`}
        </p>

        {/* Lock info */}
        {item.packingLock && (
          <p className="mb-2 text-xs text-amber-600">
            Being packed by {item.packingLock.packerName}
          </p>
        )}

        {/* Actions */}
        {isSelected && !isLockedByOther && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onDone() }}
              className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Done (Space)
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onHold() }}
              className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              Hold (H)
            </button>
          </div>
        )}
      </div>
    )
  },
)

PackingCard.displayName = 'PackingCard'
```

- [ ] **Step 2: Create PackingQueue**

`apps/admin/src/features/packing/PackingQueue.tsx`:

```tsx
import { Loader2, Package } from 'lucide-react'
import { PackingCard } from './PackingCard'
import type { QueueItem } from './types'

interface Props {
  items: QueueItem[]
  isLoading: boolean
  selectedOrderId: string | null
  focusedIndex: number
  currentPackerId: string
  cardRefs: React.MutableRefObject<(HTMLDivElement | null)[]>
  onSelect: (item: QueueItem) => void
  onDone: (orderId: string) => void
  onHold: (orderId: string) => void
}

export function PackingQueue({
  items, isLoading, selectedOrderId, focusedIndex,
  cardRefs,   currentPackerId, onSelect, onDone, onHold,
}: Props) {
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Package className="h-12 w-12" />
        <p className="text-lg font-medium">No orders to pack</p>
        <p className="text-sm">All Confirmed orders are packed. Good job!</p>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-6">
      <p className="text-sm text-muted-foreground">{items.length} order{items.length !== 1 ? 's' : ''} waiting</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((item, i) => (
          <PackingCard
            key={item.id}
            ref={(el) => { cardRefs.current[i] = el }}
            item={item}
            isFocused={focusedIndex === i}
            isSelected={selectedOrderId === item.id}
            currentPackerId={currentPackerId}
            onSelect={() => onSelect(item)}
            onDone={() => onDone(item.id)}
            onHold={() => onHold(item.id)}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create HoldModal**

`apps/admin/src/features/packing/HoldModal.tsx`:

```tsx
import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { HoldFormData } from './types'

const HOLD_REASONS = [
  'Product Missing',
  'Stock Issue',
  'Damaged Product',
  'Waiting for Approval',
  'Customer Request',
  'Other',
]

interface Props {
  orderId: string
  onClose: () => void
  onSubmit: (data: HoldFormData) => void
  isSubmitting: boolean
}

export function HoldModal({ orderId, onClose, onSubmit, isSubmitting }: Props) {
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!reason) return
    onSubmit({ reason, notes: notes || undefined })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Hold Order</h2>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Reason</p>
            {HOLD_REASONS.map((r) => (
              <label key={r} className="flex items-center gap-2 rounded-lg border p-3 text-sm hover:bg-muted/50 cursor-pointer">
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={reason === r}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-4 w-4"
                />
                {r}
              </label>
            ))}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border p-2 text-sm"
              rows={3}
              placeholder="Add any notes..."
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border py-2 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!reason || isSubmitting}
              className="flex-1 rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Submit Hold'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create StatsBar**

`apps/admin/src/features/packing/StatsBar.tsx`:

```tsx
import { PackageCheck, Clock, AlertCircle } from 'lucide-react'
import type { PackingStats } from './types'

interface Props {
  stats: PackingStats | undefined
}

export function StatsBar({ stats }: Props) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <div className="flex items-center gap-1.5 text-green-600">
        <PackageCheck className="h-4 w-4" />
        <span className="font-medium">{stats?.packed ?? 0}</span>
        <span className="text-muted-foreground">packed</span>
      </div>
      <div className="flex items-center gap-1.5 text-amber-600">
        <AlertCircle className="h-4 w-4" />
        <span className="font-medium">{stats?.held ?? 0}</span>
        <span className="text-muted-foreground">held</span>
      </div>
      <div className="flex items-center gap-1.5 text-blue-600">
        <Clock className="h-4 w-4" />
        <span className="font-medium">{stats?.pending ?? 0}</span>
        <span className="text-muted-foreground">pending</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Build check**

Run: `npx tsc --noEmit` in `apps/admin`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/features/packing/PackingQueue.tsx apps/admin/src/features/packing/PackingCard.tsx apps/admin/src/features/packing/HoldModal.tsx apps/admin/src/features/packing/StatsBar.tsx
git commit -m "feat(packing): queue, card, hold modal, stats bar components"
```

---

### Task 7: Frontend — Sidebar nav item + auto-redirect for packing_assistant

**Files:**
- Modify: `apps/admin/src/components/layout/data/sidebar-data.ts`
- Modify: `apps/admin/src/components/layout/authenticated-layout.tsx` (add redirect logic)

- [ ] **Step 1: Add Packing nav item to sidebar**

In `apps/admin/src/components/layout/data/sidebar-data.ts`, add after the Orders group:

```typescript
        { title: 'Packing', url: '/op/packing', icon: Package },
```

Import `Package` from lucide-react (already imported at top of file).

Place it after line 55 (`{ title: 'Refunds', url: '/op/refunds', icon: RefreshCw }`) or between Orders and Payments for logical grouping. Put it right after the Orders collapsible group:

```typescript
        { title: 'Orders', icon: ListTodo, items: [...] },
        { title: 'Packing', url: '/op/packing', icon: Package },
```

- [ ] **Step 2: Add auto-redirect for packing_assistant users**

In `apps/admin/src/components/layout/authenticated-layout.tsx`, modify the `/auth/me` success handler (lines 33-36):

Before:
```typescript
    apiClient.get('/auth/me').then(r => {
      const u = r.data?.user || r.data
      if (u) setUser({ id: u.id, email: u.email, role: u.role })
    }).catch(() => {
```

After:
```typescript
    apiClient.get('/auth/me').then(r => {
      const u = r.data?.user || r.data
      if (u) {
        setUser({ id: u.id, email: u.email, role: u.role })
        // Auto-redirect packing_assistant (non-admin) to packing workspace
        if (u.role === 'packing_assistant' && u.role !== 'admin' && u.role !== 'superadmin') {
          const isOnPacking = window.location.pathname.startsWith('/op/packing')
          if (!isOnPacking) navigate({ to: '/op/packing', replace: true })
        }
      }
    }).catch(() => {
```

- [ ] **Step 3: Build check**

Run: `npx tsc --noEmit` in `apps/admin`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/components/layout/data/sidebar-data.ts apps/admin/src/components/layout/authenticated-layout.tsx
git commit -m "feat(packing): sidebar nav item and auto-redirect for packing_assistant"
```

---

### Task 8: Verification

- [ ] **Step 1: Full build check**

```bash
cd apps/backend && npx nest build
cd apps/admin && npx tsc --noEmit
cd apps/pos && npx tsc --noEmit
cd apps/storefront && npx tsc --noEmit
cd apps/backend && npx prisma validate
```

All should pass with 0 errors.

- [ ] **Step 2: Run backend tests**

```bash
cd apps/backend && npx jest src/packing/packing.service.spec.ts --no-coverage
```
Expected: All tests pass

- [ ] **Step 3: Final summary**

Print working tree status and list all changed files:
```bash
git status
```

- [ ] **Step 4: Final commit if needed**

```bash
git add -A && git commit -m "feat(packing): complete packing workspace implementation"
```

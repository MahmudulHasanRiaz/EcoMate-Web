# Dispatch & Payment System Implementation Plan
> **Superseded by:** `docs/3-DOMAINS/10-dispatch-packing.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete Dispatch Lifecycle (Model, Admin UI, Order Integration) and Payment Status flow (Refund Menu upgrade, Payment Verifying) per the Order & Dispatch Split Lifecycle Guide.

**Architecture:** 5 phases — (1) Dispatch DB + Backend, (2) Dispatch Admin UI, (3) Order-Dispatch Integration, (4) Refund Menu Upgrade, (5) Payment Verifying Flow. Each phase produces working, testable, commit-ready software.

**Tech Stack:** NestJS, Prisma (PostgreSQL), TanStack Router, React + shadcn/ui, Zustand, Zod

---

## File Structure

### Phase 1 — Backend Dispatch Module
```
apps/backend/prisma/schema.prisma          # + Dispatch model, + DispatchStatus enum
apps/backend/prisma/migrations/            # new migration
apps/backend/src/dispatch/                 # NEW module
  dispatch.module.ts
  dispatch.controller.ts
  dispatch.service.ts
  dispatch.service.spec.ts
  dto/
    create-dispatch.dto.ts
    update-dispatch.dto.ts
    dispatch-query.dto.ts
apps/backend/src/courier-manager/
  courier-webhook.service.ts               # MODIFY: sync → Dispatch model instead of courierStatus field
```

### Phase 2 — Dispatch Admin UI
```
apps/admin/src/features/dispatch/          # NEW
  api.ts                                   # API client
  hooks.ts                                 # React Query hooks
  index.tsx                                # Main Dispatch List page
  dispatch-detail.tsx                      # Single dispatch detail modal/page
  duplication-review.tsx                   # Duplicate Review submenu
  courier-metrics.tsx                      # Live courier metrics widget
apps/admin/src/routes/_authenticated/op/dispatch/
  index.tsx                                # Route: /op/dispatch
  duplicate-review.tsx                     # Route: /op/dispatch/duplicate-review
apps/admin/src/components/layout/data/sidebar-data.ts  # MODIFY: add Dispatch to sidebar
```

### Phase 3 — Order-Dispatch Integration
```
apps/backend/src/orders/orders.service.ts   # MODIFY: dispatch sync on webhook
apps/backend/src/dispatch/dispatch.service.ts # MODIFY: product split mapping
apps/admin/src/features/orders/order-detail.tsx  # MODIFY: + "Dispatch History" tab
```

### Phase 4 — Refund Menu
```
apps/backend/prisma/schema.prisma           # MODIFY: Refund model fields
apps/backend/src/refunds/                   # MODIFY: upgrade service
apps/admin/src/features/refunds/            # MODIFY: upgrade UI
```

### Phase 5 — Payment Verifying
```
apps/backend/src/orders/orders.service.ts   # MODIFY: Payment Verifying auto-flow
apps/admin/src/features/payments/           # MODIFY: manual verification UI
```

---

## Phase 1: Dispatch Backend (Model + CRUD + Webhook)

### Task 1.1: Add Dispatch model to Prisma

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

**Step 1: Add DispatchStatus enum**

```prisma
enum DispatchStatus {
  DISPATCHED
  HANDED_OVER
  PICKED_UP
  IN_TRANSIT
  DELIVERED
  PARTIAL
  RETURN_PENDING
  RETURNED
  CANCELLED
}
```

**Step 2: Add Dispatch model**

```prisma
model Dispatch {
  id              String         @id @default(uuid())
  orderId         String
  courier         CourierService
  consignmentId   String
  trackingCode    String?
  status          DispatchStatus @default(DISPATCHED)
  handedOverAt    DateTime?
  pickedUpAt      DateTime?
  deliveredAt     DateTime?
  productMapping  Json?          @default("[]")
  notes           String?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@unique([courier, consignmentId])
  @@index([orderId])
  @@index([courier])
  @@index([status])
}
```

**Step 3: Add paymentStatus field updates for VERIFYING**

In existing `PaymentStatus` enum, add `PAYMENT_VERIFYING`:
```prisma
enum PaymentStatus {
  PAYMENT_PENDING
  PENDING
  PAID
  PARTIAL_PAID
  UNPAID
  FAILED
  CANCELLED
  REFUNDED
  PAYMENT_VERIFYING
}
```

**Step 4: Run migration**

```bash
npx prisma migrate dev --name add_dispatch_and_payment_verifying
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat(dispatch): add Dispatch model + PAYMENT_VERIFYING enum"
```

### Task 1.2: Dispatch DTOs

**Files:**
- Create: `apps/backend/src/dispatch/dto/create-dispatch.dto.ts`
- Create: `apps/backend/src/dispatch/dto/update-dispatch.dto.ts`
- Create: `apps/backend/src/dispatch/dto/dispatch-query.dto.ts`

**Step 1: Create-dispatch.dto.ts**

```typescript
import { IsString, IsOptional, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ProductMappingItem {
  @IsString()
  productVariantId: string;
  @IsString()
  @IsOptional()
  productName?: string;
  @IsString()
  @IsOptional()
  variantName?: string;
  @IsString()
  quantity: number;
}

export class CreateDispatchDto {
  @IsString()
  orderId: string;
  @IsString()
  courier: string;
  @IsString()
  consignmentId: string;
  @IsString()
  @IsOptional()
  trackingCode?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductMappingItem)
  productMapping?: ProductMappingItem[];
  @IsOptional()
  @IsString()
  notes?: string;
}
```

**Step 2: Update-dispatch.dto.ts**

```typescript
import { IsOptional, IsString, IsEnum } from 'class-validator';

export class UpdateDispatchDto {
  @IsOptional()
  @IsString()
  status?: string;
  @IsOptional()
  @IsString()
  trackingCode?: string;
  @IsOptional()
  @IsString()
  notes?: string;
  @IsOptional()
  productMapping?: any;
}
```

**Step 3: Dispatch-query.dto.ts**

```typescript
import { IsOptional, IsString, IsEnum } from 'class-validator';

export class DispatchQueryDto {
  @IsOptional()
  @IsString()
  orderId?: string;
  @IsOptional()
  @IsString()
  courier?: string;
  @IsOptional()
  @IsString()
  status?: string;
  @IsOptional()
  @IsString()
  search?: string;
  @IsOptional()
  @IsString()
  startDate?: string;
  @IsOptional()
  @IsString()
  endDate?: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/dispatch/dto/
git commit -m "feat(dispatch): add DTOs"
```

### Task 1.3: Dispatch Service

**Files:**
- Create: `apps/backend/src/dispatch/dispatch.service.ts`
- Create: `apps/backend/src/dispatch/dispatch.service.spec.ts`

**Step 1: Write dispatch.service.ts**

```typescript
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDispatchDto } from './dto/create-dispatch.dto';
import { UpdateDispatchDto } from './dto/update-dispatch.dto';

@Injectable()
export class DispatchService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: any) {
    const where: any = {};
    if (query.orderId) where.orderId = query.orderId;
    if (query.courier) where.courier = query.courier;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { consignmentId: { contains: query.search, mode: 'insensitive' } },
        { trackingCode: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    return this.prisma.dispatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { order: { select: { displayId: true, total: true, guestName: true, guestPhone: true } } },
    });
  }

  async findOne(id: string) {
    const dispatch = await this.prisma.dispatch.findUnique({
      where: { id },
      include: { order: { select: { displayId: true, total: true, guestName: true, guestPhone: true } } },
    });
    if (!dispatch) throw new NotFoundException('Dispatch not found');
    return dispatch;
  }

  async create(dto: CreateDispatchDto) {
    // Check for duplicate (courier + consignmentId)
    const existing = await this.prisma.dispatch.findUnique({
      where: { courier_consignmentId: { courier: dto.courier, consignmentId: dto.consignmentId } },
    });
    if (existing) {
      // Check if previous dispatch is cancelled → auto-accept; else route to duplication review
      if (existing.status !== 'CANCELLED') {
        return { duplicate: true, existingId: existing.id, message: 'Duplicate dispatch detected — routed to Duplication Review' };
      }
    }

    return this.prisma.dispatch.create({
      data: {
        orderId: dto.orderId,
        courier: dto.courier,
        consignmentId: dto.consignmentId,
        trackingCode: dto.trackingCode,
        productMapping: dto.productMapping || [],
        notes: dto.notes,
      },
      include: { order: { select: { displayId: true } } },
    });
  }

  async updateStatus(id: string, status: string) {
    const dispatch = await this.findOne(id);
    const updateData: any = { status };
    if (status === 'HANDED_OVER') updateData.handedOverAt = new Date();
    if (status === 'PICKED_UP') updateData.pickedUpAt = new Date();
    if (status === 'DELIVERED') updateData.deliveredAt = new Date();
    return this.prisma.dispatch.update({ where: { id }, data: updateData });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.dispatch.delete({ where: { id } });
    return { message: 'Dispatch deleted' };
  }

  async getMetrics() {
    const dispatches = await this.prisma.dispatch.findMany({
      select: { courier: true, status: true, id: true },
    });
    const metrics: Record<string, Record<string, { count: number }>> = {};
    for (const d of dispatches) {
      if (!metrics[d.courier]) metrics[d.courier] = {};
      if (!metrics[d.courier][d.status]) metrics[d.courier][d.status] = { count: 0 };
      metrics[d.courier][d.status].count++;
    }
    return metrics;
  }
}
```

**Step 2: Write dispatch.service.spec.ts (minimal test)**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DispatchService } from './dispatch.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DispatchService', () => {
  let service: DispatchService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      dispatch: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'd-1' }),
        update: jest.fn().mockResolvedValue({ id: 'd-1' }),
        delete: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DispatchService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<DispatchService>(DispatchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return dispatches list', async () => {
    const result = await service.findAll({});
    expect(result).toEqual([]);
    expect(prisma.dispatch.findMany).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/dispatch/dispatch.service.ts apps/backend/src/dispatch/dispatch.service.spec.ts
git commit -m "feat(dispatch): add service with CRUD + duplicate detection"
```

### Task 1.4: Dispatch Controller

**Files:**
- Create: `apps/backend/src/dispatch/dispatch.controller.ts`
- Create: `apps/backend/src/dispatch/dispatch.module.ts`

**Step 1: dispatch.controller.ts**

```typescript
import { Controller, Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { CreateDispatchDto } from './dto/create-dispatch.dto';
import { UpdateDispatchDto } from './dto/update-dispatch.dto';
import { DispatchQueryDto } from './dto/dispatch-query.dto';

@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Get()
  findAll(@Query() query: DispatchQueryDto) {
    return this.dispatchService.findAll(query);
  }

  @Get('metrics')
  getMetrics() {
    return this.dispatchService.getMetrics();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dispatchService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateDispatchDto) {
    return this.dispatchService.create(dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.dispatchService.updateStatus(id, status);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.dispatchService.remove(id);
  }
}
```

**Step 2: dispatch.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DispatchController],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
```

**Step 3: Register in AppModule**

```typescript
// In app.module.ts imports array:
import { DispatchModule } from './dispatch/dispatch.module';
// Add DispatchModule to imports
```

- [ ] **Step 4: Build & test**

```bash
npx nest build && npx jest dispatch --passWithNoTests
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/dispatch/ apps/backend/src/app.module.ts
git commit -m "feat(dispatch): add controller + module, register in app"
```

### Task 1.5: Update Courier Webhook to use Dispatch model

**Files:**
- Modify: `apps/backend/src/courier-manager/courier-webhook.service.ts`

**Step 1: Add dispatch sync to webhook**

After the existing webhook processing logic, add:

```typescript
// Sync to Dispatch model if consignment_id exists
if (consignmentId) {
  const existingDispatch = await this.prisma.dispatch.findUnique({
    where: { courier_consignmentId: { courier, consignmentId } },
  });
  if (!existingDispatch) {
    await this.prisma.dispatch.create({
      data: {
        orderId,
        courier,
        consignmentId,
        status: mapToDispatchStatus(newStatus),
        handedOverAt: newStatus === 'HANDED_OVER' ? new Date() : undefined,
      },
    });
  } else {
    await this.prisma.dispatch.update({
      where: { id: existingDispatch.id },
      data: { status: mapToDispatchStatus(newStatus) },
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/courier-manager/
git commit -m "feat(dispatch): sync webhook to Dispatch model"
```

---

## Phase 2: Dispatch Admin UI

### Task 2.1: Dispatch API + Hooks

**Files:**
- Create: `apps/admin/src/features/dispatch/api.ts`
- Create: `apps/admin/src/features/dispatch/hooks.ts`

**Step 1: api.ts**

```typescript
import { apiClient } from '@/lib/api-client'

export interface DispatchResponse {
  id: string
  orderId: string
  courier: string
  consignmentId: string
  trackingCode: string | null
  status: string
  handedOverAt: string | null
  pickedUpAt: string | null
  deliveredAt: string | null
  productMapping: any
  notes: string | null
  createdAt: string
  updatedAt: string
  order?: { displayId: string; total: number; guestName: string | null; guestPhone: string | null }
}

export const dispatchApi = {
  list: (params?: any) => apiClient.get<DispatchResponse[]>('/v1/dispatch', { params }),
  get: (id: string) => apiClient.get<DispatchResponse>(`/v1/dispatch/${id}`),
  create: (data: any) => apiClient.post<DispatchResponse>('/v1/dispatch', data),
  updateStatus: (id: string, status: string) => apiClient.patch(`/v1/dispatch/${id}/status`, { status }),
  delete: (id: string) => apiClient.delete(`/v1/dispatch/${id}`),
  getMetrics: () => apiClient.get('/v1/dispatch/metrics'),
}
```

**Step 2: hooks.ts**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { dispatchApi } from './api'

export function useDispatches(params?: any) {
  return useQuery({
    queryKey: ['dispatches', params],
    queryFn: () => dispatchApi.list(params).then(r => r.data),
  })
}

export function useDispatch(id: string) {
  return useQuery({
    queryKey: ['dispatch', id],
    queryFn: () => dispatchApi.get(id).then(r => r.data),
    enabled: !!id,
  })
}

export function useCreateDispatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: any) => dispatchApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dispatches'] }),
  })
}

export function useUpdateDispatchStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => dispatchApi.updateStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dispatches'] }),
  })
}

export function useDispatchMetrics() {
  return useQuery({
    queryKey: ['dispatch-metrics'],
    queryFn: () => dispatchApi.getMetrics().then(r => r.data),
    refetchInterval: 30000,
  })
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/features/dispatch/api.ts apps/admin/src/features/dispatch/hooks.ts
git commit -m "feat(dispatch): add admin API + hooks"
```

### Task 2.2: Dispatch List Page

**Files:**
- Create: `apps/admin/src/features/dispatch/index.tsx`
- Create: `apps/admin/src/routes/_authenticated/op/dispatch/index.tsx`

**Step 1: Main dispatch list page**

```tsx
export function DispatchList() {
  const [search, setSearch] = useState('')
  const [courierFilter, setCourierFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const { data: dispatches, isLoading } = useDispatches({ search, courier: courierFilter, status: statusFilter })
  const { data: metrics } = useDispatchMetrics()

  return (
    <>
      <Header fixed><GlobalSearchBar /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main>
        {/* Courier Metrics Widget */}
        {metrics && <CourierMetricsWidget metrics={metrics} />}
        {/* Filters */}
        <div className="flex gap-2">
          <Input placeholder="Search by tracking ID, phone, order..." value={search} onChange={e => setSearch(e.target.value)} />
          <Select value={courierFilter} onValueChange={setCourierFilter}>
            <SelectItem value="">All Couriers</SelectItem>
            {['steadfast','pathao','redx','carrybee'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectItem value="">All Statuses</SelectItem>
            {['DISPATCHED','HANDED_OVER','PICKED_UP','IN_TRANSIT','DELIVERED','PARTIAL','RETURN_PENDING','CANCELLED'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </Select>
        </div>
        {/* Table */}
        {isLoading ? <Loader2 className="animate-spin" /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>Consignment ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dispatches?.map(d => (
                <TableRow key={d.id}>
                  <TableCell>{d.order?.displayId}</TableCell>
                  <TableCell className="capitalize">{d.courier}</TableCell>
                  <TableCell className="font-mono text-xs">{d.consignmentId}</TableCell>
                  <TableCell><Badge>{d.status}</Badge></TableCell>
                  <TableCell>{new Date(d.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => viewDispatch(d.id)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Main>
    </>
  )
}
```

**Step 2: Route**

```typescript
export const Route = createFileRoute('/_authenticated/op/dispatch/')({
  component: DispatchList,
})
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/features/dispatch/index.tsx apps/admin/src/routes/_authenticated/op/dispatch/
git commit -m "feat(dispatch): add admin list page"
```

### Task 2.3: Duplication Review Submenu

**Files:**
- Create: `apps/admin/src/features/dispatch/duplication-review.tsx`
- Create: `apps/admin/src/routes/_authenticated/op/dispatch/duplicate-review.tsx`

**Step 1: duplication-review.tsx**

```tsx
export function DuplicationReview() {
  const { data: dispatches } = useDispatches({ /* flagged duplicates */ })
  return (
    <div>
      <h2>Duplication Review</h2>
      {dispatches?.filter(d => d.duplicate).map(d => (
        <Card key={d.id}>
          <CardHeader><CardTitle>Order {d.order?.displayId}</CardTitle></CardHeader>
          <CardContent>
            <p>Consignment ID: {d.consignmentId}</p>
            <div className="flex gap-2">
              <Button>Accept (Product Split)</Button>
              <Button>Mark as Accessories</Button>
              <Button variant="destructive">Cancel Duplicate</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

**Step 2: Route**

```typescript
export const Route = createFileRoute('/_authenticated/op/dispatch/duplicate-review')({
  component: DuplicationReview,
})
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/features/dispatch/duplication-review.tsx
git commit -m "feat(dispatch): add duplication review submenu"
```

### Task 2.4: Add Dispatch to Sidebar

**Files:**
- Modify: `apps/admin/src/components/layout/data/sidebar-data.ts`

**Step 1: Add Dispatch to operational panel after Orders**

```typescript
{ title: 'Dispatch', url: '/op/dispatch', icon: Truck },
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/src/components/layout/data/sidebar-data.ts
git commit -m "feat(dispatch): add sidebar link"
```

---

## Phase 3: Order-Dispatch Integration

### Task 3.1: Dispatch History in Order Details

**Files:**
- Modify: `apps/admin/src/features/orders/order-detail.tsx`

**Step 1: Add "Dispatch History" tab in order detail**

Find the Order Detail page, add a tab/section:

```tsx
// Inside the order detail component, add:
<Tabs value={tab} onValueChange={setTab}>
  <TabsList>
    <TabsTrigger value="details">Details</TabsTrigger>
    <TabsTrigger value="items">Items</TabsTrigger>
    <TabsTrigger value="dispatch">Dispatch History</TabsTrigger>
  </TabsList>
  <TabsContent value="dispatch">
    <DispatchHistory orderId={order.id} />
  </TabsContent>
</Tabs>
```

Create sub-component:

```tsx
function DispatchHistory({ orderId }: { orderId: string }) {
  const { data: dispatches } = useDispatches({ orderId })
  return (
    <div className="space-y-2">
      {dispatches?.map(d => (
        <Card key={d.id} className="p-3 flex items-center justify-between">
          <div>
            <p className="font-mono text-sm">{d.consignmentId}</p>
            <p className="text-xs text-muted-foreground capitalize">{d.courier}</p>
          </div>
          <Badge>{d.status}</Badge>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/src/features/orders/
git commit -m "feat(dispatch): add dispatch history to order detail"
```

### Task 3.2: Order Status Auto-Sync on Webhook

**Files:**
- Modify: `apps/backend/src/courier-manager/courier-webhook.service.ts`

**Step 1: In webhook sync, also update Order.statusId**

When dispatch status changes to DELIVERED, PARTIAL, or RETURN_PENDING, auto-update the parent order's order status:

```typescript
const orderStatusMap: Record<string, string> = {
  DELIVERED: 'Delivered',
  PARTIAL: 'Partial',
  RETURN_PENDING: 'Return Pending',
};

if (orderStatusMap[dispatchStatus]) {
  const targetOrderStatus = await this.prisma.orderStatus.findUnique({
    where: { name: orderStatusMap[dispatchStatus] },
  });
  if (targetOrderStatus) {
    await this.prisma.order.update({
      where: { id: orderId },
      data: { statusId: targetOrderStatus.id },
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/courier-manager/
git commit -m "feat(orders): auto-sync order status from dispatch webhook"
```

---

## Phase 4: Refund Menu Upgrade

### Task 4.1: Refund DTO Update

**Files:**
- Modify: `apps/backend/src/refunds/dto/create-refund.dto.ts`

**Step 1: Add targetStatusId and reason fields**

```typescript
export class CreateRefundDto {
  @IsString()
  orderId: string;
  @IsNumber()
  @Min(0)
  amount: number;
  @IsOptional()
  @IsString()
  reason?: string;
  @IsOptional()
  @IsString()
  targetStatusId?: string;
}
```

- [ ] **Step 2: Commit**

### Task 4.2: Refund Service — Target Status + Payment Auto-Calc

**Files:**
- Modify: `apps/backend/src/refunds/refunds.service.ts`

**Step 1: In processRefund(), add payment status auto-calculation**

```typescript
async processRefund(dto: CreateRefundDto, userId: string) {
  const order = await this.prisma.order.findUniqueOrThrow({
    where: { id: dto.orderId },
    select: { total: true, paymentStatus: true },
  });

  // Create refund record
  const refund = await this.prisma.refund.create({
    data: {
      orderId: dto.orderId,
      amount: dto.amount,
      reason: dto.reason,
      status: 'processed',
      processedBy: userId,
      processedAt: new Date(),
    },
  });

  // Auto-calculate payment status
  const totalPaid = /* calculate total paid from payments */;
  const totalRefunded = /* calculate total refunded across all refunds */;
  const isFullRefund = totalRefunded >= totalPaid;

  await this.prisma.order.update({
    where: { id: dto.orderId },
    data: {
      paymentStatus: isFullRefund ? 'REFUNDED' : 'PARTIAL_REFUNDED',
      ...(dto.targetStatusId ? { statusId: dto.targetStatusId } : {}),
    },
  });

  return refund;
}
```

- [ ] **Step 2: Commit**

### Task 4.3: Refund Admin UI — Target Status Dropdown

**Files:**
- Modify: `apps/admin/src/features/refunds/index.tsx`

**Step 1: Add target status dropdown + validation in refund form**

```tsx
// Before submitting refund, show:
<Select value={targetStatusId} onValueChange={setTargetStatusId}>
  <SelectTrigger><SelectValue placeholder="Target Order Status" /></SelectTrigger>
  <SelectContent>
    {statuses.map(s => (
      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

- [ ] **Step 2: Commit**

---

## Phase 5: Payment Verifying Flow

### Task 5.1: Backend — Payment Verifying transition logic

**Files:**
- Modify: `apps/backend/src/orders/orders.service.ts`

**Step 1: When order has Payment Pending status and customer submits payment proof:**

```typescript
async submitPaymentProof(orderId: string, proofData: { transactionId?: string; screenshot?: string }) {
  const order = await this.prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { status: true },
  });

  if (order.status.name !== 'Payment Pending') {
    throw new BadRequestException('Order is not in Payment Pending status');
  }

  // Update order status to Payment Verifying
  const paymentVerifyingStatus = await this.prisma.orderStatus.findUnique({
    where: { name: 'Payment Verifying' },
  });

  return this.prisma.order.update({
    where: { id: orderId },
    data: {
      statusId: paymentVerifyingStatus!.id,
      paymentStatus: 'PAYMENT_VERIFYING',
      paymentProof: proofData, // new Json field on Order
    },
  });
}
```

> Note: If `paymentProof` field doesn't exist on Order, add it to Prisma schema: `paymentProof Json? @default("{}")`

**Step 2: Admin verification endpoint**

```typescript
@Post(':id/verify-payment')
async verifyPayment(
  @Param('id') id: string,
  @Body('verified') verified: boolean,
  @Body('note') note?: string,
) {
  const order = await this.prisma.order.findUniqueOrThrow({
    where: { id },
    include: { status: true },
  });

  if (order.paymentStatus !== 'PAYMENT_VERIFYING') {
    throw new BadRequestException('Order is not awaiting payment verification');
  }

  const confirmedStatus = await this.prisma.orderStatus.findUnique({
    where: { name: 'Confirmed' },
  });

  const paymentPendingStatus = await this.prisma.orderStatus.findUnique({
    where: { name: 'Payment Pending' },
  });

  return this.prisma.order.update({
    where: { id },
    data: {
      paymentStatus: verified ? 'PAID' : 'PAYMENT_PENDING',
      statusId: verified ? confirmedStatus!.id : paymentPendingStatus!.id,
    },
  });
}
```

- [ ] **Step 3: Commit**

### Task 5.2: Admin — Payment Verification UI

**Files:**
- Create: `apps/admin/src/features/payments/payment-verification.tsx`

**Step 1: Payment verification page/panel**

```tsx
export function PaymentVerificationPanel() {
  const { data: orders } = useQuery({
    queryKey: ['orders-payment-verifying'],
    queryFn: () => apiClient.get('/v1/orders', { params: { statusName: 'Payment Verifying' } }).then(r => r.data),
  })

  return (
    <div className="space-y-4">
      <h2>Payment Verification</h2>
      {orders?.map(order => (
        <Card key={order.id}>
          <CardHeader>
            <CardTitle>Order {order.displayId}</CardTitle>
          </CardHeader>
          <CardContent>
            {order.paymentProof?.screenshot && (
              <img src={order.paymentProof.screenshot} alt="Payment proof" className="max-w-md rounded" />
            )}
            <p>Transaction ID: {order.paymentProof?.transactionId}</p>
            <div className="flex gap-2 mt-2">
              <Button onClick={() => verifyPayment(order.id, true)}>✅ Verify</Button>
              <Button variant="destructive" onClick={() => rejectPayment(order.id)}>❌ Reject</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

---

## Verification

After all phases, run:

```bash
# Backend
npx nest build && npx jest --passWithNoTests

# Admin
npx tsc --noEmit

# Migration drift
cd apps/backend && npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma

# DB status
PGPASSWORD=postgres psql -h localhost -U postgres -d ecomate_web -c "SELECT COUNT(*) FROM \"Dispatch\"; SELECT COUNT(*) FROM \"Order\" WHERE \"paymentStatus\" = 'PAYMENT_VERIFYING';"
```

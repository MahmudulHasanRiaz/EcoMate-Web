# Shipping System Redesign — Implementation Plan
> **Superseded by:** `docs/3-DOMAINS/03-orders.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat per-district charge config with two mode-based shipping systems: Shipping Options (WooCommerce-like) and Auto District (default charge + exception zone groups).

**Architecture:** Two new Prisma models (ShippingOption, ShippingZoneGroup) + backend ShippingModule + admin settings page (3 tabs at `/mon/settings/shipping/`) + updated storefront checkout with mode-aware delivery charge calculation. Storefront config API returns mode-specific data.

**Tech Stack:** NestJS 11 (backend), Prisma 5/PostgreSQL, React 19/Vite (admin), Next.js 16 (storefront)

---

### Task 1: Prisma Migration — New Models + Order Fields

**Files:**
- Modify: `/apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Add ShippingOption model, ShippingZoneGroup model, and Order fields to schema.prisma**

Add before the `SystemSetting` model block:

```prisma
model ShippingOption {
  id        String   @id @default(uuid())
  name      String
  amount    Decimal  @db.Decimal(10, 2)
  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model ShippingZoneGroup {
  id        String   @id @default(uuid())
  label     String?
  type      String                     // "custom_amount" | "no_delivery"
  amount    Decimal? @db.Decimal(10, 2)
  districts Json                       // ["dhaka", "narayanganj", ...]
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Add to the `Order` model, after `viewToken`:

```prisma
  selectedShippingOptionId String?
  shippingChargeOverridden Boolean  @default(false)
```

- [ ] **Step 2: Run Prisma migration**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/backend && npx prisma migrate dev --name add-shipping-models`
Expected: Migration created and applied.

- [ ] **Step 3: Generate Prisma client**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/backend && npx prisma generate`
Expected: Client regenerated with new models.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat: add ShippingOption, ShippingZoneGroup models and Order fields"
```

---

### Task 2: Backend — ShippingModule (Controller, Service, DTOs)

**Files:**
- Create: `/apps/backend/src/shipping/shipping.module.ts`
- Create: `/apps/backend/src/shipping/shipping.controller.ts`
- Create: `/apps/backend/src/shipping/shipping.service.ts`
- Create: `/apps/backend/src/shipping/dto/shipping.dto.ts`

- [ ] **Step 1: Create `shipping.dto.ts`**

```typescript
import { IsString, IsOptional, IsNumber, IsBoolean, IsArray, IsIn, Min } from 'class-validator';

export class CreateShippingOptionDto {
  @IsString() name: string;
  @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsNumber() sortOrder?: number;
}

export class UpdateShippingOptionDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsNumber() sortOrder?: number;
}

export class CreateShippingZoneGroupDto {
  @IsOptional() @IsString() label?: string;
  @IsString() @IsIn(['custom_amount', 'no_delivery']) type: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsArray() districts: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateShippingZoneGroupDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() @IsIn(['custom_amount', 'no_delivery']) type?: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsArray() districts?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}
```

- [ ] **Step 2: Create `shipping.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShippingOptionDto, UpdateShippingOptionDto, CreateShippingZoneGroupDto, UpdateShippingZoneGroupDto } from './dto/shipping.dto';

@Injectable()
export class ShippingService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Shipping Options ----
  async findAllOptions() {
    return this.prisma.shippingOption.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async findActiveOptions() {
    return this.prisma.shippingOption.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createOption(dto: CreateShippingOptionDto) {
    return this.prisma.shippingOption.create({ data: dto });
  }

  async updateOption(id: string, dto: UpdateShippingOptionDto) {
    const existing = await this.prisma.shippingOption.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Shipping option not found');
    return this.prisma.shippingOption.update({ where: { id }, data: dto });
  }

  async deleteOption(id: string) {
    const existing = await this.prisma.shippingOption.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Shipping option not found');
    return this.prisma.shippingOption.delete({ where: { id } });
  }

  // ---- Zone Groups ----
  async findAllZoneGroups() {
    return this.prisma.shippingZoneGroup.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findActiveZoneGroups() {
    return this.prisma.shippingZoneGroup.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createZoneGroup(dto: CreateShippingZoneGroupDto) {
    return this.prisma.shippingZoneGroup.create({
      data: {
        label: dto.label,
        type: dto.type,
        amount: dto.type === 'custom_amount' ? dto.amount : null,
        districts: dto.districts,
        isActive: dto.isActive,
      },
    });
  }

  async updateZoneGroup(id: string, dto: UpdateShippingZoneGroupDto) {
    const existing = await this.prisma.shippingZoneGroup.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Zone group not found');
    const data: any = { ...dto };
    if (dto.type === 'no_delivery') data.amount = null;
    return this.prisma.shippingZoneGroup.update({ where: { id }, data });
  }

  async deleteZoneGroup(id: string) {
    const existing = await this.prisma.shippingZoneGroup.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Zone group not found');
    return this.prisma.shippingZoneGroup.delete({ where: { id } });
  }
}
```

- [ ] **Step 3: Create `shipping.controller.ts`**

```typescript
import { Controller, Get, Post, Put, Delete, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { CreateShippingOptionDto, UpdateShippingOptionDto, CreateShippingZoneGroupDto, UpdateShippingZoneGroupDto } from './dto/shipping.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('shipping')
@Roles('superadmin', 'admin', 'manager')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  // Options CRUD
  @Get('options')
  findAllOptions() { return this.shippingService.findAllOptions(); }

  @Post('options')
  createOption(@Body() dto: CreateShippingOptionDto) { return this.shippingService.createOption(dto); }

  @Put('options/:id')
  updateOption(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateShippingOptionDto) { return this.shippingService.updateOption(id, dto); }

  @Delete('options/:id')
  deleteOption(@Param('id', ParseUUIDPipe) id: string) { return this.shippingService.deleteOption(id); }

  // Zone Groups CRUD
  @Get('zones')
  findAllZoneGroups() { return this.shippingService.findAllZoneGroups(); }

  @Post('zones')
  createZoneGroup(@Body() dto: CreateShippingZoneGroupDto) { return this.shippingService.createZoneGroup(dto); }

  @Put('zones/:id')
  updateZoneGroup(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateShippingZoneGroupDto) { return this.shippingService.updateZoneGroup(id, dto); }

  @Delete('zones/:id')
  deleteZoneGroup(@Param('id', ParseUUIDPipe) id: string) { return this.shippingService.deleteZoneGroup(id); }
}
```

- [ ] **Step 4: Create `shipping.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ShippingController],
  providers: [ShippingService],
  exports: [ShippingService],
})
export class ShippingModule {}
```

- [ ] **Step 5: Register ShippingModule in AppModule**

Modify `/apps/backend/src/app.module.ts`:

```typescript
import { ShippingModule } from './shipping/shipping.module';

// In imports array, add: ShippingModule,
```

- [ ] **Step 6: Verify backend compiles**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/backend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/shipping/ apps/backend/src/app.module.ts
git commit -m "feat: add shipping module with CRUD for options and zone groups"
```

---

### Task 3: Backend — Update StorefrontConfig to Include Shipping Mode Data

**Files:**
- Modify: `/apps/backend/src/system-settings/system-settings.controller.ts`

- [ ] **Step 1: Read shipping_mode setting and return shipping data in storefront config**

In the `getStorefrontConfig()` method, after the existing `delivery` block and before `districtCharges`, add:

```typescript
const shippingMode = map['shipping_mode'] || 'auto_district';

let shippingOptions: any[] = [];
let shippingZones: any[] = [];

try {
  const opts = await this.prisma.shippingOption.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, amount: true, sortOrder: true },
  });
  shippingOptions = opts;
} catch {}

try {
  const zones = await this.prisma.shippingZoneGroup.findMany({
    where: { isActive: true },
    select: { id: true, type: true, amount: true, districts: true, label: true },
  });
  shippingZones = zones;
} catch {}
```

And update the return object:

```typescript
return {
  // ... existing fields ...
  delivery: {
    charge: parseFloat(map['delivery_charge'] || '0'),
    freeDeliveryMin: parseFloat(map['free_delivery_min'] || '0'),
  },
  // ADD these new fields:
  shippingMode,
  shippingOptions,
  shippingZones,
  // change districtCharges to empty (will be computed from zones by storefront, or kept as-is for backward compat):
  districtCharges: parseJson<Record<string, number>>(map['district_charges'] || '{}', {}),
};
```

Also inject PrismaService in the constructor (it's already injected).

- [ ] **Step 2: Verify backend compiles**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/backend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/system-settings/system-settings.controller.ts
git commit -m "feat: include shipping mode, options, and zones in storefront config"
```

---

### Task 4: Backend — Update OrdersService for selectedShippingOptionId + Override Tracking

**Files:**
- Modify: `/apps/backend/src/orders/orders.service.ts`
- Modify: `/apps/backend/src/orders/dto/order.dto.ts`

- [ ] **Step 1: Add fields to DTOs**

In `/apps/backend/src/orders/dto/order.dto.ts`, add to `CreateOrderDto`:

```typescript
@IsOptional() @IsString() selectedShippingOptionId?: string;
```

Add to `UpdateOrderDto`:

```typescript
@IsOptional() @IsString() selectedShippingOptionId?: string;
```

- [ ] **Step 2: Update OrdersService create() to store selectedShippingOptionId**

In `create()` method, after `const order = await this.prisma.order.create({` block, add to the data object:

```typescript
selectedShippingOptionId: dto.selectedShippingOptionId || null,
```

- [ ] **Step 3: Update OrdersService update() to handle selectedShippingOptionId + override tracking**

In `update()` method, in the data object preparation section (around line 469), add:

```typescript
if (dto.selectedShippingOptionId !== undefined)
  data.selectedShippingOptionId = dto.selectedShippingOptionId || null;
```

In the shipping charge change detection block (around lines 406-417), add override flag:

```typescript
if (
  dto.shippingCharge !== undefined &&
  Number(dto.shippingCharge) !== Number(order.shippingCharge)
) {
  data.shippingChargeOverridden = true;
  timeline.push({
    type: 'shipping',
    visibility: 'public',
    timestamp: now,
    oldValue: Number(order.shippingCharge),
    newValue: Number(dto.shippingCharge),
    note: `Shipping: ৳${Number(order.shippingCharge)} → ৳${Number(dto.shippingCharge)}${dto.selectedShippingOptionId ? ' (option changed)' : ' (override)'}`,
  });
}
```

- [ ] **Step 4: Verify backend compiles**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/backend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/orders/orders.service.ts apps/backend/src/orders/dto/order.dto.ts
git commit -m "feat: track selectedShippingOptionId and shipping charge override in orders"
```

---

### Task 5: Admin — Shipping Settings Page (mon/settings/shipping/)

**Files:**
- Create: `/apps/admin/src/features/settings/shipping-settings.tsx`
- Create: `/apps/admin/src/routes/_authenticated/mon/settings/shipping/index.tsx`

- [ ] **Step 1: Create the route file**

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { ShippingSettings } from '@/features/settings/shipping-settings'

export const Route = createFileRoute('/_authenticated/mon/settings/shipping/')({
  component: ShippingSettings,
})
```

- [ ] **Step 2: Create the shipping settings feature component**

```typescript
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, Save, Trash2, GripVertical, AlertTriangle, Search } from 'lucide-react'

interface ShippingOption {
  id: string; name: string; amount: number; isActive: boolean; sortOrder: number;
}

interface ShippingZoneGroup {
  id: string; label: string | null; type: 'custom_amount' | 'no_delivery';
  amount: number | null; districts: string[]; isActive: boolean;
}

// BD districts list with English and Bengali names
const BD_DISTRICTS = [
  { name: 'Bagerhat', nameBn: 'বাগেরহাট' }, { name: 'Bandarban', nameBn: 'বান্দরবান' },
  { name: 'Barguna', nameBn: 'বরগুনা' }, { name: 'Barishal', nameBn: 'বরিশাল' },
  { name: 'Bhola', nameBn: 'ভোলা' }, { name: 'Bogura', nameBn: 'বগুড়া' },
  { name: 'Brahmanbaria', nameBn: 'ব্রাহ্মণবাড়িয়া' }, { name: 'Chandpur', nameBn: 'চাঁদপুর' },
  { name: 'Chattogram', nameBn: 'চট্টগ্রাম' }, { name: 'Chuadanga', nameBn: 'চুয়াডাঙ্গা' },
  { name: 'Cox\'s Bazar', nameBn: 'কক্সবাজার' }, { name: 'Cumilla', nameBn: 'কুমিল্লা' },
  { name: 'Dhaka', nameBn: 'ঢাকা' }, { name: 'Dinajpur', nameBn: 'দিনাজপুর' },
  { name: 'Faridpur', nameBn: 'ফরিদপুর' }, { name: 'Feni', nameBn: 'ফেনী' },
  { name: 'Gaibandha', nameBn: 'গাইবান্ধা' }, { name: 'Gazipur', nameBn: 'গাজীপুর' },
  { name: 'Gopalganj', nameBn: 'গোপালগঞ্জ' }, { name: 'Habiganj', nameBn: 'হবিগঞ্জ' },
  { name: 'Jamalpur', nameBn: 'জামালপুর' }, { name: 'Jashore', nameBn: 'যশোর' },
  { name: 'Jhalokati', nameBn: 'ঝালকাঠি' }, { name: 'Jhenaidah', nameBn: 'ঝিনাইদহ' },
  { name: 'Joypurhat', nameBn: 'জয়পুরহাট' }, { name: 'Khagrachhari', nameBn: 'খাগড়াছড়ি' },
  { name: 'Kushtia', nameBn: 'কুষ্টিয়া' }, { name: 'Khulna', nameBn: 'খুলনা' },
  { name: 'Kishoreganj', nameBn: 'কিশোরগঞ্জ' }, { name: 'Lakshmipur', nameBn: 'লক্ষ্মীপুর' },
  { name: 'Lalmonirhat', nameBn: 'লালমনিরহাট' }, { name: 'Madaripur', nameBn: 'মাদারীপুর' },
  { name: 'Magura', nameBn: 'মাগুরা' }, { name: 'Manikganj', nameBn: 'মানিকগঞ্জ' },
  { name: 'Meherpur', nameBn: 'মেহেরপুর' }, { name: 'Moulvibazar', nameBn: 'মৌলভীবাজার' },
  { name: 'Munshiganj', nameBn: 'মুন্সিগঞ্জ' }, { name: 'Mymensingh', nameBn: 'ময়মনসিংহ' },
  { name: 'Naogaon', nameBn: 'নওগাঁ' }, { name: 'Narail', nameBn: 'নড়াইল' },
  { name: 'Narayanganj', nameBn: 'নারায়ণগঞ্জ' }, { name: 'Narsingdi', nameBn: 'নরসিংদী' },
  { name: 'Natore', nameBn: 'নাটোর' }, { name: 'Nawabganj', nameBn: 'নবাবগঞ্জ' },
  { name: 'Netrokona', nameBn: 'নেত্রকোনা' }, { name: 'Nilphamari', nameBn: 'নীলফামারী' },
  { name: 'Noakhali', nameBn: 'নোয়াখালী' }, { name: 'Pabna', nameBn: 'পাবনা' },
  { name: 'Panchagarh', nameBn: 'পঞ্চগড়' }, { name: 'Patuakhali', nameBn: 'পটুয়াখালী' },
  { name: 'Pirojpur', nameBn: 'পিরোজপুর' }, { name: 'Rajbari', nameBn: 'রাজবাড়ী' },
  { name: 'Rajshahi', nameBn: 'রাজশাহী' }, { name: 'Rangamati', nameBn: 'রাঙ্গামাটি' },
  { name: 'Rangpur', nameBn: 'রংপুর' }, { name: 'Satkhira', nameBn: 'সাতক্ষীরা' },
  { name: 'Shariatpur', nameBn: 'শরীয়তপুর' }, { name: 'Sherpur', nameBn: 'শেরপুর' },
  { name: 'Sirajganj', nameBn: 'সিরাজগঞ্জ' }, { name: 'Sunamganj', nameBn: 'সুনামগঞ্জ' },
  { name: 'Sylhet', nameBn: 'সিলেট' }, { name: 'Tangail', nameBn: 'টাঙ্গাইল' },
  { name: 'Thakurgaon', nameBn: 'ঠাকুরগাঁও' },
];

const api = {
  listSystemSettings: () => apiClient.get('/system-settings').then(r => r.data),
  updateSystemSetting: (key: string, value: string) => apiClient.post(`/system-settings/${key}`, { value }),
  listOptions: () => apiClient.get('/shipping/options').then(r => r.data),
  createOption: (d: any) => apiClient.post('/shipping/options', d),
  updateOption: (id: string, d: any) => apiClient.put(`/shipping/options/${id}`, d),
  deleteOption: (id: string) => apiClient.delete(`/shipping/options/${id}`),
  listZones: () => apiClient.get('/shipping/zones').then(r => r.data),
  createZone: (d: any) => apiClient.post('/shipping/zones', d),
  updateZone: (id: string, d: any) => apiClient.put(`/shipping/zones/${id}`, d),
  deleteZone: (id: string) => apiClient.delete(`/shipping/zones/${id}`),
}

export function ShippingSettings() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'general' | 'options' | 'zones'>('general')

  // General settings
  const { data: sysSettings } = useQuery({ queryKey: ['system-settings'], queryFn: api.listSystemSettings })
  const [shippingMode, setShippingMode] = useState('auto_district')
  const [deliveryCharge, setDeliveryCharge] = useState('')
  const [freeDeliveryMin, setFreeDeliveryMin] = useState('')

  useEffect(() => {
    if (sysSettings) {
      setShippingMode(sysSettings['shipping_mode'] || 'auto_district')
      setDeliveryCharge(sysSettings['delivery_charge'] || '0')
      setFreeDeliveryMin(sysSettings['free_delivery_min'] || '0')
    }
  }, [sysSettings])

  const saveGeneralMut = useMutation({
    mutationFn: async () => {
      await api.updateSystemSetting('shipping_mode', shippingMode)
      await api.updateSystemSetting('delivery_charge', deliveryCharge)
      await api.updateSystemSetting('free_delivery_min', freeDeliveryMin)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      toast.success('General settings saved')
    },
  })

  // --- Options Tab ---
  const { data: options = [], isLoading: optsLoading } = useQuery({
    queryKey: ['shipping-options'],
    queryFn: api.listOptions,
    enabled: activeTab === 'options',
  })

  const [optDialog, setOptDialog] = useState(false)
  const [editingOpt, setEditingOpt] = useState<ShippingOption | null>(null)
  const [optName, setOptName] = useState('')
  const [optAmount, setOptAmount] = useState('')

  const createOptMut = useMutation({
    mutationFn: () => api.createOption({ name: optName, amount: parseFloat(optAmount) || 0 }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipping-options'] }); setOptDialog(false); toast.success('Option created') },
  })
  const updateOptMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: any }) => api.updateOption(id, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipping-options'] }); toast.success('Option updated') },
  })
  const deleteOptMut = useMutation({
    mutationFn: (id: string) => api.deleteOption(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipping-options'] }); toast.success('Option deleted') },
  })

  const openNewOption = () => { setEditingOpt(null); setOptName(''); setOptAmount(''); setOptDialog(true) }
  const openEditOption = (o: ShippingOption) => { setEditingOpt(o); setOptName(o.name); setOptAmount(String(o.amount)); setOptDialog(true) }

  // --- Zones Tab ---
  const { data: zones = [], isLoading: zonesLoading } = useQuery({
    queryKey: ['shipping-zones'],
    queryFn: api.listZones,
    enabled: activeTab === 'zones',
  })

  const [zoneDialog, setZoneDialog] = useState(false)
  const [editingZone, setEditingZone] = useState<ShippingZoneGroup | null>(null)
  const [zoneLabel, setZoneLabel] = useState('')
  const [zoneType, setZoneType] = useState<'custom_amount' | 'no_delivery'>('custom_amount')
  const [zoneAmount, setZoneAmount] = useState('')
  const [zoneDistricts, setZoneDistricts] = useState<string[]>([])
  const [districtSearch, setDistrictSearch] = useState('')

  const createZoneMut = useMutation({
    mutationFn: () => api.createZone({
      label: zoneLabel || null,
      type: zoneType,
      amount: zoneType === 'custom_amount' ? (parseFloat(zoneAmount) || 0) : null,
      districts: zoneDistricts,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipping-zones'] }); setZoneDialog(false); toast.success('Zone group created') },
  })
  const updateZoneMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: any }) => api.updateZone(id, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipping-zones'] }); toast.success('Zone group updated') },
  })
  const deleteZoneMut = useMutation({
    mutationFn: (id: string) => api.deleteZone(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipping-zones'] }); toast.success('Zone group deleted') },
  })

  const openNewZone = () => { setEditingZone(null); setZoneLabel(''); setZoneType('custom_amount'); setZoneAmount(''); setZoneDistricts([]); setZoneDialog(true) }
  const openEditZone = (z: ShippingZoneGroup) => { setEditingZone(z); setZoneLabel(z.label || ''); setZoneType(z.type); setZoneAmount(z.amount ? String(z.amount) : ''); setZoneDistricts(z.districts as string[]); setZoneDialog(true) }

  const toggleDistrict = (name: string) => {
    setZoneDistricts(prev => prev.includes(name) ? prev.filter(d => d !== name) : [...prev, name])
  }

  const filteredDistricts = BD_DISTRICTS.filter(d =>
    d.name.toLowerCase().includes(districtSearch.toLowerCase()) ||
    d.nameBn.includes(districtSearch)
  )

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Shipping Settings</h1>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        <button onClick={() => setActiveTab('general')} className={`px-4 py-2 text-sm font-medium rounded-t ${activeTab === 'general' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}>General</button>
        <button onClick={() => setActiveTab('options')} className={`px-4 py-2 text-sm font-medium rounded-t ${activeTab === 'options' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}>Shipping Options</button>
        <button onClick={() => setActiveTab('zones')} className={`px-4 py-2 text-sm font-medium rounded-t ${activeTab === 'zones' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}>Zone Groups</button>
      </div>

      {/* Tab: General */}
      {activeTab === 'general' && (
        <Card>
          <CardHeader><CardTitle>General Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Shipping Mode</Label>
              <div className="flex gap-4 mt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="mode" value="options" checked={shippingMode === 'options'} onChange={e => setShippingMode(e.target.value)} />
                  <span>Shipping Options (কাস্টমার নিজে অপশন সিলেক্ট করবে)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="mode" value="auto_district" checked={shippingMode === 'auto_district'} onChange={e => setShippingMode(e.target.value)} />
                  <span>Auto District (জেলা অনুযায়ী অটো চার্জ)</span>
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Default Delivery Charge (৳)</Label><Input type="number" step="0.01" value={deliveryCharge} onChange={e => setDeliveryCharge(e.target.value)} /></div>
              <div><Label>Free Delivery Minimum (৳)</Label><Input type="number" step="0.01" value={freeDeliveryMin} onChange={e => setFreeDeliveryMin(e.target.value)} /></div>
            </div>
            <Button onClick={() => saveGeneralMut.mutate()} disabled={saveGeneralMut.isPending}><Save className="h-4 w-4 mr-1" /> Save General Settings</Button>
          </CardContent>
        </Card>
      )}

      {/* Tab: Shipping Options */}
      {activeTab === 'options' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Shipping Options</CardTitle>
            <Button size="sm" onClick={openNewOption}><Plus className="h-4 w-4 mr-1" /> Add Option</Button>
          </CardHeader>
          <CardContent>
            {optsLoading ? <Loader2 className="animate-spin" /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Amount</TableHead><TableHead>Active</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(options as ShippingOption[]).map(opt => (
                    <TableRow key={opt.id}>
                      <TableCell className="font-medium">{opt.name}</TableCell>
                      <TableCell>৳{opt.amount}</TableCell>
                      <TableCell><Switch checked={opt.isActive} onCheckedChange={v => updateOptMut.mutate({ id: opt.id, d: { isActive: v } })} /></TableCell>
                      <TableCell className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEditOption(opt)}>Edit</Button>
                        <Button variant="destructive" size="sm" onClick={() => deleteOptMut.mutate(opt.id)}><Trash2 className="h-3 w-3" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab: Zone Groups */}
      {activeTab === 'zones' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Zone Groups</CardTitle>
            <Button size="sm" onClick={openNewZone}><Plus className="h-4 w-4 mr-1" /> Add Group</Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">সকল জেলার জন্য ডিফল্ট চার্জ প্রযোজ্য। নিচের গ্রুপগুলোর জন্য ভিন্ন নিয়ম প্রযোজ্য হবে।</p>
            {zonesLoading ? <Loader2 className="animate-spin" /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Label</TableHead><TableHead>Type</TableHead><TableHead>Amount</TableHead><TableHead>Districts</TableHead><TableHead>Active</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(zones as ShippingZoneGroup[]).map(zone => (
                    <TableRow key={zone.id}>
                      <TableCell className="font-medium">{zone.label || '—'}</TableCell>
                      <TableCell><Badge variant={zone.type === 'no_delivery' ? 'destructive' : 'default'}>{zone.type === 'no_delivery' ? 'No Delivery' : 'Custom Amount'}</Badge></TableCell>
                      <TableCell>{zone.type === 'custom_amount' ? `৳${zone.amount}` : '—'}</TableCell>
                      <TableCell className="text-xs">{zone.districts.length} districts</TableCell>
                      <TableCell><Switch checked={zone.isActive} onCheckedChange={v => updateZoneMut.mutate({ id: zone.id, d: { isActive: v } })} /></TableCell>
                      <TableCell className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEditZone(zone)}>Edit</Button>
                        <Button variant="destructive" size="sm" onClick={() => deleteZoneMut.mutate(zone.id)}><Trash2 className="h-3 w-3" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Option Dialog */}
      <Dialog open={optDialog} onOpenChange={setOptDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingOpt ? 'Edit Option' : 'New Shipping Option'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Name</Label><Input value={optName} onChange={e => setOptName(e.target.value)} placeholder="e.g. ঢাকা সিটি" /></div>
            <div><Label>Amount (৳)</Label><Input type="number" step="0.01" value={optAmount} onChange={e => setOptAmount(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOptDialog(false)}>Cancel</Button>
            <Button onClick={() => editingOpt
              ? updateOptMut.mutate({ id: editingOpt.id, d: { name: optName, amount: parseFloat(optAmount) || 0 } })
              : createOptMut.mutate()
            } disabled={!optName || !optAmount}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Zone Group Dialog */}
      <Dialog open={zoneDialog} onOpenChange={setZoneDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingZone ? 'Edit Zone Group' : 'New Zone Group'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Label (optional)</Label><Input value={zoneLabel} onChange={e => setZoneLabel(e.target.value)} placeholder="e.g. No Delivery Areas" /></div>
            <div>
              <Label>Type</Label>
              <div className="flex gap-4 mt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="zoneType" value="custom_amount" checked={zoneType === 'custom_amount'} onChange={() => setZoneType('custom_amount')} />
                  <span>Custom Amount</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="zoneType" value="no_delivery" checked={zoneType === 'no_delivery'} onChange={() => setZoneType('no_delivery')} />
                  <span>No Delivery</span>
                </label>
              </div>
            </div>
            {zoneType === 'custom_amount' && (
              <div><Label>Amount (৳)</Label><Input type="number" step="0.01" value={zoneAmount} onChange={e => setZoneAmount(e.target.value)} placeholder="0 for free delivery" /></div>
            )}
            <div>
              <Label>Select Districts</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search district..." value={districtSearch} onChange={e => setDistrictSearch(e.target.value)} />
              </div>
              <div className="border rounded-md mt-2 max-h-48 overflow-y-auto grid grid-cols-2 gap-1 p-2">
                {filteredDistricts.map(d => (
                  <label key={d.name} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted p-1 rounded">
                    <input type="checkbox" checked={zoneDistricts.includes(d.name)} onChange={() => toggleDistrict(d.name)} />
                    <span>{d.nameBn} ({d.name})</span>
                  </label>
                ))}
                {filteredDistricts.length === 0 && <p className="text-xs text-muted-foreground col-span-2 p-2">No matching districts</p>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{zoneDistricts.length} district(s) selected</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setZoneDialog(false)}>Cancel</Button>
            <Button onClick={() => editingZone
              ? updateZoneMut.mutate({ id: editingZone.id, d: { label: zoneLabel || null, type: zoneType, amount: zoneType === 'custom_amount' ? (parseFloat(zoneAmount) || 0) : null, districts: zoneDistricts } })
              : createZoneMut.mutate()
            } disabled={zoneDistricts.length === 0 || (zoneType === 'custom_amount' && !zoneAmount)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 3: Verify route works**

Check that the admin router picks up the new route file at `apps/admin/src/routes/_authenticated/mon/settings/shipping/index.tsx`.

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/features/settings/shipping-settings.tsx apps/admin/src/routes/_authenticated/mon/settings/shipping/index.tsx
git commit -m "feat: add admin shipping settings page with general/options/zones tabs"
```

---

### Task 6: Admin — Enhance Order Edit Page Shipping Section

**Files:**
- Modify: `/apps/admin/src/routes/_authenticated/op/orders/$id.tsx`

- [ ] **Step 1: Fetch shipping options and shipping mode for the edit form**

Add parallel query after existing queries (around line 68):

```typescript
const { data: shippingOptions } = useQuery({
  queryKey: ['shipping-options-active'],
  queryFn: () => apiClient.get('/shipping/options').then(r => (r.data as any[]).filter((o: any) => o.isActive)),
  enabled: editing,
})

const { data: systemSettings } = useQuery({
  queryKey: ['system-settings'],
  queryFn: () => apiClient.get('/system-settings').then(r => r.data),
  enabled: editing,
})

const shippingMode = systemSettings?.['shipping_mode'] || 'auto_district'
```

- [ ] **Step 2: Add selectedShippingOptionId state**

After line 41 (`const [shippingCharge, setShippingCharge] = useState('')`), add:

```typescript
const [selectedShippingOptionId, setSelectedShippingOptionId] = useState('')
```

In the `useEffect` that initializes form fields (around line 89), add:

```typescript
setSelectedShippingOptionId(order.selectedShippingOptionId || '')
```

In `handleSaveEdit` (around line 145), add to the data object:

```typescript
selectedShippingOptionId: selectedShippingOptionId || null,
```

- [ ] **Step 3: Replace the plain shipping input with mode-aware UI**

Replace the existing shipping input in the edit card (line 399):

```typescript
{shippingMode === 'options' && shippingOptions?.length > 0 ? (
  <div>
    <Label className="text-xs">Shipping Option</Label>
    <select
      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
      value={selectedShippingOptionId}
      onChange={e => {
        const optId = e.target.value
        setSelectedShippingOptionId(optId)
        const opt = (shippingOptions as any[]).find(o => o.id === optId)
        if (opt) setShippingCharge(String(opt.amount))
      }}
    >
      <option value="">Select option...</option>
      {(shippingOptions as any[]).map((o: any) => (
        <option key={o.id} value={o.id}>৳{o.amount} — {o.name}</option>
      ))}
    </select>
    {selectedShippingOptionId && (
      <p className="text-xs text-muted-foreground mt-1">
        Amount auto-filled. You can manually override below.
        {order.shippingChargeOverridden && <Badge variant="outline" className="ml-2 text-xs">Overridden</Badge>}
      </p>
    )}
  </div>
) : (
  <div><Label className="text-xs">Shipping Charge</Label><Input type="number" step="0.01" value={shippingCharge} onChange={e => setShippingCharge(e.target.value)} /></div>
)}
```

And keep the existing discount input as is.

- [ ] **Step 4: Verify admin compiles**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/routes/_authenticated/op/orders/\$id.tsx
git commit -m "feat: enhance order edit shipping section with option selector and override tracking"
```

---

### Task 7: Storefront — Update StorefrontConfig Types

**Files:**
- Modify: `/apps/storefront/lib/api/storefront-config.ts`

- [ ] **Step 1: Add new types to StorefrontConfig interface**

Add to the `StorefrontConfig` interface:

```typescript
shippingMode: 'options' | 'auto_district';
shippingOptions: { id: string; name: string; amount: number; sortOrder: number }[];
shippingZones: { id: string; type: 'custom_amount' | 'no_delivery'; amount: number | null; districts: string[]; label: string | null }[];
```

Also add defaults in the service if the fields are missing (they will be when initially deployed with old data). The existing `getStorefrontConfig` function returns the raw backend response, so the types just need to be correct.

- [ ] **Step 2: Verify storefront compiles**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/storefront && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/storefront/lib/api/storefront-config.ts
git commit -m "feat: add shippingMode, shippingOptions, shippingZones to StorefrontConfig"
```

---

### Task 8: Storefront — Checkout Page: Mode 1 (Shipping Options)

**Files:**
- Modify: `/apps/storefront/app/checkout/page.tsx`

- [ ] **Step 1: Add selectedShippingOption state**

After line 331 (`const [paymentPopup, setPaymentPopup] = useState...`), add:

```typescript
const [selectedShippingOptionId, setSelectedShippingOptionId] = useState('')
```

- [ ] **Step 2: Replace the delivery charge calculation with mode-aware logic**

Replace lines 353-355:

```typescript
const districtCharge = district ? (config.districtCharges?.[district] ?? config.delivery.charge) : null;
const deliveryCharge = district ? (cartTotal >= config.delivery.freeDeliveryMin ? 0 : (districtCharge ?? 0)) : 0;
const totalWithDelivery = cartTotal + deliveryCharge;
```

With:

```typescript
// Calculate delivery charge based on mode
let deliveryCharge = 0;
let noDeliveryError = '';

if (config.shippingMode === 'options') {
  if (selectedShippingOptionId) {
    const opt = config.shippingOptions?.find(o => o.id === selectedShippingOptionId);
    deliveryCharge = opt?.amount ?? 0;
  }
} else {
  // auto_district mode
  if (district) {
    const zoneGroup = config.shippingZones?.find(z =>
      z.isActive !== false && z.districts.includes(district)
    );
    if (zoneGroup?.type === 'no_delivery') {
      noDeliveryError = 'এই এলাকায় ডেলিভারি সম্ভব না';
      deliveryCharge = 0;
    } else if (zoneGroup?.type === 'custom_amount') {
      deliveryCharge = zoneGroup.amount ?? config.delivery.charge;
    } else {
      deliveryCharge = config.delivery.charge;
    }
    // Free delivery threshold
    if (cartTotal >= config.delivery.freeDeliveryMin) {
      deliveryCharge = 0;
    }
  }
}

const totalWithDelivery = cartTotal + deliveryCharge;
```

- [ ] **Step 3: Add shipping options radio UI in the address section**

After the address textarea section and before the district charge info line (after line 688), add shipping options when in options mode:

```typescript
{config.shippingMode === 'options' && config.shippingOptions?.length > 0 && (
  <div className="mt-4 space-y-2">
    <Label className="text-sm font-bold text-gray-700">Delivery Option</Label>
    {config.shippingOptions.map(opt => (
      <label key={opt.id} className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${selectedShippingOptionId === opt.id ? 'border-brand-blue bg-brand-blue/5' : 'border-gray-200 hover:border-gray-300'}`}>
        <div className="flex items-center gap-3">
          <input type="radio" name="shippingOption" value={opt.id} checked={selectedShippingOptionId === opt.id} onChange={() => setSelectedShippingOptionId(opt.id)} className="accent-brand-blue" />
          <span className="text-sm font-medium text-gray-800">{opt.name}</span>
        </div>
        <span className="text-sm font-bold text-gray-800">{s}{opt.amount}</span>
      </label>
    ))}
  </div>
)}
```

Keep the existing district charge info block but only show it in auto_district mode (wrap with condition):

```typescript
{config.shippingMode !== 'options' && district && districtCharge !== null && (
  <div className="mt-3 text-xs text-gray-400">
    ...
  </div>
)}
```

Note: In auto district mode, `districtCharge` variable was removed. Replace this with inline logic:

```typescript
{config.shippingMode !== 'options' && district && deliveryCharge > 0 && (
  <div className="mt-3 text-xs text-gray-400">
    Delivery charge for {district}: <span className="font-bold text-gray-600">{s}{deliveryCharge}</span>
    {cartTotal >= config.delivery.freeDeliveryMin && <span className="text-green-600 ml-2">(Free delivery on orders over {s}{config.delivery.freeDeliveryMin})</span>}
  </div>
)}
```

- [ ] **Step 4: Add no-delivery error display**

After the district dropdown section and before the address textarea, add:

```typescript
{noDeliveryError && (
  <div className="mt-2 flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-sm">
    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
    <span>{noDeliveryError}</span>
  </div>
)}
```

Import AlertTriangle: `import { ..., AlertTriangle } from 'lucide-react'`

- [ ] **Step 5: Update `buildOrderPayload()` to include selectedShippingOptionId**

In the payload object (around line 454-464), add:

```typescript
selectedShippingOptionId: config.shippingMode === 'options' ? (selectedShippingOptionId || null) : undefined,
```

- [ ] **Step 6: Disable submit button when no delivery error**

Update `canSubmit` (line 372) to also check `noDeliveryError`:

```typescript
const canSubmit = items.length > 0 && !submitting && (user || (guestName.length > 0 && phoneOk)) && !noDeliveryError;
```

- [ ] **Step 7: Update delivery cost display in summary**

Replace lines 806-814 with mode-aware display:

```typescript
<div className="flex justify-between items-center">
  <span className="text-[14px] text-gray-500 font-medium">Delivery cost</span>
  <span className="text-[14px] text-gray-800 font-black">
    {config.shippingMode === 'options' ? (
      selectedShippingOptionId ? (
        deliveryCharge === 0 ? `${s}0 (Free)` : `${s}${deliveryCharge.toLocaleString('en-US', {minimumFractionDigits: 2})}`
      ) : (
        <span className="text-gray-400 italic">Select option</span>
      )
    ) : (
      district ? (
        deliveryCharge === 0 ? `${s}0 (Free)` : `${s}${deliveryCharge.toLocaleString('en-US', {minimumFractionDigits: 2})}`
      ) : (
        <span className="text-gray-400 italic">Not selected</span>
      )
    )}
  </span>
</div>
```

- [ ] **Step 8: Verify storefront compiles**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/storefront && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 9: Commit**

```bash
git add apps/storefront/app/checkout/page.tsx
git commit -m "feat: implement mode-aware shipping charge calculation in checkout"
```

---

### Task 9: Add Left Nav Link for Shipping Settings

**Files:**
- Modify: `/apps/admin/src/components/layout/sidebar.tsx` (or similar nav config)

- [ ] **Step 1: Find and update sidebar/nav to include shipping settings link**

Grep for existing nav links to find the sidebar file:

Run: `grep -r "courier" apps/admin/src/components/layout/ --include="*.tsx" -l`

Find the navigation configuration and add a link to `/mon/settings/shipping/` near the courier settings link.

Example entry (adjust path based on actual nav structure):

```typescript
{ title: 'Shipping', href: '/mon/settings/shipping/' },
```

- [ ] **Step 2: Commit**

```bash
git add <relevant nav file>
git commit -m "feat: add shipping settings link to admin sidebar"
```

---

### Self-Review Checklist

**Spec coverage:**
- Data model (ShippingOption, ShippingZoneGroup, Order fields) → Task 1
- Backend CRUD API → Task 2
- Storefront config with mode data → Task 3
- Order tracking for option ID + override → Task 4
- Admin shipping settings page (3 tabs) → Task 5
- Admin order edit with option selector → Task 6
- Storefront config type updates → Task 7
- Checkout Mode 1 (Shipping Options) → Task 8
- Checkout Mode 2 (Auto District with zone logic) → Task 8
- No-delivery blocking → Task 8 (Step 4, Step 6)
- Sidebar nav link → Task 9

**Placeholder scan:** All steps contain complete code. No TBD or TODOs.

**Type consistency:** `ShippingOption` model fields match across Tasks 1, 3, 5. `ShippingZoneGroup` type field values `custom_amount | no_delivery` consistent across all tasks. `selectedShippingOptionId` consistent across Tasks 1, 4, 5, 8.

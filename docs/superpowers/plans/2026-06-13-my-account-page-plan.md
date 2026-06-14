# My Account Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build complete customer My Account page (Profile, Orders, Addresses, Settings) with auto-variant-select toggle across the storefront.

**Architecture:** Backend NestJS adds 5 new endpoints (profile update, my orders, addresses CRUD, user settings). Frontend rewrites `/account` as sidebar-driven dashboard with section components. Prisma schema gets `Address` model and `autoVariantSelect` field.

**Tech Stack:** NestJS 11, Prisma ORM, Next.js 16 App Router, Tailwind CSS v4, Axios

---
### Task 1: Prisma — Add Address model + autoVariantSelect to UserSettings

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

- [ ] **Step 1: Add Address model after UserSettings block (line ~143)**

```prisma
model Address {
  id          String   @id @default(uuid())
  userId      String
  label       String   // "Home", "Office", etc.
  fullName    String
  phoneNumber String
  street      String
  city        String
  state       String?
  zipCode     String?
  country     String   @default("Bangladesh")
  isDefault   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

Add the relation on `User` model after line 86:
```prisma
  addresses     Address[]
```

- [ ] **Step 2: Add autoVariantSelect to UserSettings model (line 119)**

```prisma
  autoVariantSelect Boolean @default(true)
```

Add this field after `displayItems` (line 138), before `createdAt`.

- [ ] **Step 3: Run Prisma migration**

Run: `cd apps/backend && npx prisma migrate dev --name add-addresses-and-settings`
Expected: Migration created and applied successfully.

---

### Task 2: Backend — PUT /auth/me profile update endpoint

**Files:**
- Create: `apps/backend/src/auth/dto/update-profile.dto.ts`
- Modify: `apps/backend/src/auth/auth.controller.ts` (add endpoint)
- Modify: `apps/backend/src/auth/auth.service.ts` (add `updateProfile` method)

- [ ] **Step 1: Create UpdateProfileDto**

`apps/backend/src/auth/dto/update-profile.dto.ts`:
```typescript
import { IsOptional, IsString, IsEmail } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;
}
```

- [ ] **Step 2: Add updateProfile method to AuthService**

In `apps/backend/src/auth/auth.service.ts`, add after `me()` method (line 141):

```typescript
async updateProfile(userId: string, dto: UpdateProfileDto) {
  const data: any = {};
  if (dto.firstName !== undefined) data.firstName = dto.firstName;
  if (dto.lastName !== undefined) data.lastName = dto.lastName;
  if (dto.email !== undefined) data.email = dto.email;
  if (dto.phoneNumber !== undefined) {
    const normalized = normalizePhone(dto.phoneNumber);
    if (!normalized) throw new BadRequestException('Invalid phone number');
    data.phoneNumber = normalized;
  }

  return this.prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      email: true,
      phoneNumber: true,
      status: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
```

Add import of `UpdateProfileDto` at top:
```typescript
import { UpdateProfileDto } from './dto/update-profile.dto';
```

- [ ] **Step 3: Add PUT /auth/me endpoint to AuthController**

In `apps/backend/src/auth/auth.controller.ts`, add after `me()` method (line 106):

```typescript
@SkipThrottle()
@Put('me')
@HttpCode(HttpStatus.OK)
async updateProfile(
  @CurrentUser() user: { userId: string },
  @Body() dto: UpdateProfileDto,
) {
  return this.authService.updateProfile(user.userId, dto);
}
```

Add `Put` to the imports from NestJS common:
```typescript
Controller, Get, Post, Put, Body, Res, UseGuards, HttpCode, HttpStatus
```

---

### Task 3: Backend — GET/PUT /users/settings endpoints

**Files:**
- Create: `apps/backend/src/users/dto/update-settings.dto.ts`
- Modify: `apps/backend/src/users/users.controller.ts`
- Modify: `apps/backend/src/users/users.service.ts`

- [ ] **Step 1: Create UpdateSettingsDto**

`apps/backend/src/users/dto/update-settings.dto.ts`:
```typescript
import { IsOptional, IsBoolean } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  autoVariantSelect?: boolean;
}
```

- [ ] **Step 2: Add settings methods to UsersService**

In `apps/backend/src/users/users.service.ts`, add after `bulkUpdateStatus` (line 241):

```typescript
async getSettings(userId: string) {
  let settings = await this.prisma.userSettings.findUnique({
    where: { userId },
  });
  if (!settings) {
    settings = await this.prisma.userSettings.create({
      data: { userId },
    });
  }
  return settings;
}

async updateSettings(userId: string, dto: UpdateSettingsDto) {
  return this.prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...dto },
    update: dto,
  });
}
```

Add import:
```typescript
import { UpdateSettingsDto } from './dto/update-settings.dto';
```

- [ ] **Step 3: Add settings endpoints to UsersController**

In `apps/backend/src/users/users.controller.ts`, add after the `invite` endpoint (line 86):

```typescript
@SkipThrottle()
@Get('settings')
async getSettings(@CurrentUser() user: { userId: string }) {
  return this.usersService.getSettings(user.userId);
}

@SkipThrottle()
@Put('settings')
@HttpCode(HttpStatus.OK)
async updateSettings(
  @CurrentUser() user: { userId: string },
  @Body() dto: UpdateSettingsDto,
) {
  return this.usersService.updateSettings(user.userId, dto);
}
```

Add imports:
```typescript
import { SkipThrottle } from '@nestjs/throttler';
import { HttpCode } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateSettingsDto } from './dto/update-settings.dto';
```

---

### Task 4: Backend — Addresses CRUD module

**Files:**
- Create: `apps/backend/src/addresses/addresses.module.ts`
- Create: `apps/backend/src/addresses/addresses.controller.ts`
- Create: `apps/backend/src/addresses/addresses.service.ts`
- Create: `apps/backend/src/addresses/dto/create-address.dto.ts`
- Create: `apps/backend/src/addresses/dto/update-address.dto.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Create CreateAddressDto**

`apps/backend/src/addresses/dto/create-address.dto.ts`:
```typescript
import { IsString, IsOptional, IsBoolean, IsNotEmpty } from 'class-validator';

export class CreateAddressDto {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  street: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  zipCode?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
```

- [ ] **Step 2: Create UpdateAddressDto**

`apps/backend/src/addresses/dto/update-address.dto.ts`:
```typescript
import { PartialType } from '@nestjs/mapped-types';
import { CreateAddressDto } from './create-address.dto';

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
```

- [ ] **Step 3: Create AddressesService**

`apps/backend/src/addresses/addresses.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(userId: string, id: string) {
    const address = await this.prisma.address.findFirst({
      where: { id, userId },
    });
    if (!address) throw new NotFoundException('Address not found');
    return address;
  }

  async create(userId: string, dto: CreateAddressDto) {
    if (dto.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }
    return this.prisma.address.create({
      data: { ...dto, userId },
    });
  }

  async update(userId: string, id: string, dto: UpdateAddressDto) {
    await this.findOne(userId, id);
    if (dto.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return this.prisma.address.update({
      where: { id },
      data: dto,
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.prisma.address.delete({ where: { id } });
    return { message: 'Address deleted' };
  }

  async setDefault(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.prisma.address.updateMany({
      where: { userId },
      data: { isDefault: false },
    });
    return this.prisma.address.update({
      where: { id },
      data: { isDefault: true },
    });
  }
}
```

- [ ] **Step 4: Create AddressesController**

`apps/backend/src/addresses/addresses.controller.ts`:
```typescript
import {
  Controller, Get, Post, Put, Delete, Patch,
  Body, Param, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('addresses')
export class AddressesController {
  constructor(private readonly svc: AddressesService) {}

  @Get()
  findAll(@CurrentUser() user: { userId: string }) {
    return this.svc.findAll(user.userId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.svc.findOne(user.userId, id);
  }

  @Post()
  create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateAddressDto,
  ) {
    return this.svc.create(user.userId, dto);
  }

  @Put(':id')
  update(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.svc.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.svc.remove(user.userId, id);
  }

  @Patch(':id/default')
  setDefault(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.svc.setDefault(user.userId, id);
  }
}
```

- [ ] **Step 5: Create AddressesModule**

`apps/backend/src/addresses/addresses.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';

@Module({
  controllers: [AddressesController],
  providers: [AddressesService],
})
export class AddressesModule {}
```

- [ ] **Step 6: Register AddressesModule in AppModule**

In `apps/backend/src/app.module.ts`, add import line after other imports (around line 39):
```typescript
import { AddressesModule } from './addresses/addresses.module';
```

Add to `imports` array:
```typescript
AddressesModule,
```

---

### Task 5: Backend — GET /orders/my and /orders/my/:id endpoints

**Files:**
- Modify: `apps/backend/src/orders/orders.controller.ts`
- Modify: `apps/backend/src/orders/orders.service.ts`

- [ ] **Step 1: Add findMyOrders and findMyOrderById to OrdersService**

In `apps/backend/src/orders/orders.service.ts`, add after `findAll` (line 155):

```typescript
async findMyOrders(userId: string, query: { page?: number; perPage?: number; status?: string }) {
  const page = query.page || 1;
  const perPage = query.perPage || 10;
  const where: any = { customerId: userId };
  if (query.status) {
    where.status = { name: { equals: query.status, mode: 'insensitive' } };
  }
  const [data, total] = await Promise.all([
    this.prisma.order.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
      include: {
        status: true,
        items: {
          include: {
            product: { select: { id: true, name: true, images: true, slug: true } },
          },
        },
        payments: true,
      },
    }),
    this.prisma.order.count({ where }),
  ]);
  return {
    data: data.map((o: any) => this.transformOrder(o)),
    meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
  };
}

async findMyOrderById(userId: string, id: string) {
  const order = await this.prisma.order.findFirst({
    where: { id, customerId: userId },
    include: {
      status: true,
      shipment: true,
      items: {
        include: {
          product: { select: { id: true, name: true, images: true, slug: true } },
        },
      },
      payments: {
        include: {
          verifier: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      dispatchLogs: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!order) throw new NotFoundException('Order not found');
  return this.transformOrder(order);
}
```

- [ ] **Step 2: Add my-orders endpoints to OrdersController**

In `apps/backend/src/orders/orders.controller.ts`, add after `findAll` (line 64):

```typescript
@Get('my')
findMyOrders(
  @CurrentUser() user: { userId: string },
  @Query('page') page?: string,
  @Query('perPage') perPage?: string,
  @Query('status') status?: string,
) {
  return this.svc.findMyOrders(user.userId, {
    page: page ? parseInt(page) : undefined,
    perPage: perPage ? parseInt(perPage) : undefined,
    status,
  });
}

@Get('my/:id')
findMyOrderById(
  @CurrentUser() user: { userId: string },
  @Param('id') id: string,
) {
  return this.svc.findMyOrderById(user.userId, id);
}
```

---

### Task 6: Frontend — Update User type + add API modules

**Files:**
- Modify: `apps/storefront/lib/types.ts`
- Create: `apps/storefront/lib/api/addresses.ts`
- Create: `apps/storefront/lib/api/settings.ts`
- Modify: `apps/storefront/lib/api/auth.ts`
- Modify: `apps/storefront/lib/api/orders.ts`

- [ ] **Step 1: Fix User type to match backend response**

In `apps/storefront/lib/types.ts`, replace the `User` interface (lines 81-88):
```typescript
export interface User {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phoneNumber: string;
  status: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Add updateProfile to auth API**

In `apps/storefront/lib/api/auth.ts`, add at end of file:
```typescript
export async function updateProfile(data: {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
}): Promise<User> {
  const { data: res } = await apiClient.put("/auth/me", data);
  return res;
}
```

- [ ] **Step 3: Add getMyOrders to orders API**

In `apps/storefront/lib/api/orders.ts`, add at end of file:
```typescript
export async function getMyOrders(params?: {
  page?: number;
  perPage?: number;
  status?: string;
}) {
  const { data } = await apiClient.get("/orders/my", { params });
  return data;
}

export async function getMyOrderById(id: string) {
  const { data } = await apiClient.get(`/orders/my/${id}`);
  return data;
}
```

- [ ] **Step 4: Create addresses API module**

`apps/storefront/lib/api/addresses.ts`:
```typescript
import apiClient from "../api-client";

export interface AddressData {
  id?: string;
  label: string;
  fullName: string;
  phoneNumber: string;
  street: string;
  city: string;
  state?: string;
  zipCode?: string;
  country?: string;
  isDefault?: boolean;
}

export async function getAddresses(): Promise<AddressData[]> {
  const { data } = await apiClient.get("/addresses");
  return data;
}

export async function createAddress(dto: AddressData) {
  const { data } = await apiClient.post("/addresses", dto);
  return data;
}

export async function updateAddress(id: string, dto: Partial<AddressData>) {
  const { data } = await apiClient.put(`/addresses/${id}`, dto);
  return data;
}

export async function deleteAddress(id: string) {
  const { data } = await apiClient.delete(`/addresses/${id}`);
  return data;
}

export async function setDefaultAddress(id: string) {
  const { data } = await apiClient.patch(`/addresses/${id}/default`);
  return data;
}
```

- [ ] **Step 5: Create settings API module**

`apps/storefront/lib/api/settings.ts`:
```typescript
import apiClient from "../api-client";

export interface UserSettings {
  id: string;
  userId: string;
  autoVariantSelect: boolean;
  // ... other settings fields
}

export async function getSettings(): Promise<UserSettings> {
  const { data } = await apiClient.get("/users/settings");
  return data;
}

export async function updateSettings(dto: { autoVariantSelect?: boolean }) {
  const { data } = await apiClient.put("/users/settings", dto);
  return data;
}
```

---

### Task 7: Frontend — Rewrite /account page with section components

**Files:**
- Create: `apps/storefront/app/account/Sidebar.tsx`
- Create: `apps/storefront/app/account/sections/ProfileSection.tsx`
- Create: `apps/storefront/app/account/sections/OrdersSection.tsx`
- Create: `apps/storefront/app/account/sections/OrderDetailSection.tsx`
- Create: `apps/storefront/app/account/sections/AddressesSection.tsx`
- Create: `apps/storefront/app/account/sections/SettingsSection.tsx`
- Modify: `apps/storefront/app/account/page.tsx`

- [ ] **Step 1: Create Sidebar component**

`apps/storefront/app/account/Sidebar.tsx`:
```typescript
"use client";

import { User, Package, MapPin, Heart, Settings, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

type Section = 'profile' | 'orders' | 'addresses' | 'settings';

function SidebarItem({
  icon, label, isActive, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
        isActive
          ? 'bg-brand-blue/10 text-brand-blue font-semibold'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium'
      }`}
    >
      <div className={isActive ? 'text-brand-blue' : 'text-gray-400'}>{icon}</div>
      <span className="text-sm">{label}</span>
    </button>
  );
}

export function Sidebar({
  activeSection,
  onNavigate,
}: {
  activeSection: Section;
  onNavigate: (section: Section) => void;
}) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const initials = user
    ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || '?'
    : '?';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 bg-brand-blue/10 text-brand-blue rounded-full flex items-center justify-center font-bold text-2xl">
          {initials}
        </div>
        <div>
          <h3 className="font-bold text-gray-800 text-lg">
            {user?.firstName} {user?.lastName}
          </h3>
          <p className="text-sm text-gray-500">{user?.email}</p>
        </div>
      </div>

      <div className="space-y-1">
        <SidebarItem icon={<User size={18} />} label="Profile Overview" isActive={activeSection === 'profile'} onClick={() => onNavigate('profile')} />
        <SidebarItem icon={<Package size={18} />} label="My Orders" isActive={activeSection === 'orders'} onClick={() => onNavigate('orders')} />
        <SidebarItem icon={<MapPin size={18} />} label="Saved Addresses" isActive={activeSection === 'addresses'} onClick={() => onNavigate('addresses')} />
        <SidebarItem icon={<Heart size={18} />} label="Wishlist" onClick={() => router.push('/wishlist')} />
        <SidebarItem icon={<Settings size={18} />} label="Settings" isActive={activeSection === 'settings'} onClick={() => onNavigate('settings')} />
      </div>

      <div className="mt-8 pt-8 border-t border-gray-100">
        <button
          onClick={logout}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-600 hover:text-red-500 transition-colors p-3 rounded-lg hover:bg-red-50"
        >
          <span>Log Out</span>
          <LogOut size={18} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create ProfileSection**

`apps/storefront/app/account/sections/ProfileSection.tsx`:
```typescript
"use client";

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { updateProfile } from '@/lib/api/auth';
import { normalizePhone } from '@/lib/phone-utils';
import { toast } from 'sonner';

export function ProfileSection() {
  const { user, refreshUser } = useAuth();

  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phoneNumber || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const normalized = phone ? normalizePhone(phone) : phone;
    if (phone && !normalized) {
      toast.error('Please enter a valid phone number');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), phoneNumber: normalized || phone });
      await refreshUser();
      toast.success('Profile updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
      <h3 className="text-xl font-bold text-gray-800 mb-6">Profile Settings</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600 ml-1">First Name</label>
          <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600 ml-1">Last Name</label>
          <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600 ml-1">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600 ml-1">Phone</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
        </div>
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-brand-blue hover:bg-brand-blue/90 text-white px-8 h-11 rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {saving ? <Loader2 className="animate-spin inline-block" size={18} /> : 'Save Changes'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create OrdersSection**

`apps/storefront/app/account/sections/OrdersSection.tsx`:
```typescript
"use client";

import { useState, useEffect } from 'react';
import { Package, Loader2, ChevronRight } from 'lucide-react';
import { getMyOrders } from '@/lib/api/orders';
import { OrderDetailSection } from './OrderDetailSection';
import type { Order } from '@/lib/types';

const TABS = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function OrdersSection() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await getMyOrders({ page, perPage: 10, status: status || undefined });
      setOrders(res.data);
      setMeta(res.meta);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrders(); }, [page, status]);

  if (selectedOrderId) {
    return <OrderDetailSection orderId={selectedOrderId} onBack={() => setSelectedOrderId(null)} />;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
      <h3 className="text-xl font-bold text-gray-800 mb-6">My Orders</h3>

      <div className="flex gap-2 mb-6 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setStatus(tab.key); setPage(1); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              status === tab.key
                ? 'bg-brand-blue text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-brand-blue" size={28} /></div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Package size={48} strokeWidth={1} className="mx-auto mb-4 opacity-50" />
          <p>No orders found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <button
              key={order.id}
              onClick={() => setSelectedOrderId(order.id)}
              className="w-full flex items-center justify-between p-4 rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all text-left"
            >
              <div>
                <p className="font-semibold text-gray-800 text-sm">{order.displayId}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date(order.createdAt).toLocaleDateString('bn-BD', { year: 'numeric', month: 'short', day: 'numeric' })}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {order.items?.length || 0} item(s) — ৳{Number(order.total).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {order.status && (
                  <span
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: order.status.color ? `${order.status.color}20` : '#f3f4f6', color: order.status.color || '#6b7280' }}
                  >
                    {order.status.name}
                  </span>
                )}
                <ChevronRight size={16} className="text-gray-400" />
              </div>
            </button>
          ))}
          {meta && meta.totalPages > 1 && (
            <div className="flex justify-center gap-2 pt-4">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="px-4 py-2 text-sm rounded-lg border disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-sm text-gray-500">Page {meta.page} of {meta.totalPages}</span>
              <button
                disabled={page >= meta.totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-4 py-2 text-sm rounded-lg border disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create OrderDetailSection**

`apps/storefront/app/account/sections/OrderDetailSection.tsx`:
```typescript
"use client";

import { useState, useEffect } from 'react';
import { ChevronLeft, Package, Loader2 } from 'lucide-react';
import { getMyOrderById } from '@/lib/api/orders';
import type { Order } from '@/lib/types';

export function OrderDetailSection({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMyOrderById(orderId).then(setOrder).catch(() => setOrder(null)).finally(() => setLoading(false));
  }, [orderId]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-brand-blue" size={28} /></div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"><ChevronLeft size={16} /> Back</button>
        <p className="text-center text-gray-400 py-8">Order not found</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"><ChevronLeft size={16} /> Back to Orders</button>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-gray-800">{order.displayId}</h3>
        {order.status && (
          <span className="text-xs font-semibold px-3 py-1.5 rounded-full"
            style={{ backgroundColor: order.status.color ? `${order.status.color}20` : '#f3f4f6', color: order.status.color || '#6b7280' }}>
            {order.status.name}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
        <div><span className="text-gray-500">Date:</span> <span className="font-medium ml-1">{new Date(order.createdAt).toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric' })}</span></div>
        <div><span className="text-gray-500">Total:</span> <span className="font-medium ml-1">৳{Number(order.total).toLocaleString()}</span></div>
      </div>

      <h4 className="font-semibold text-gray-700 mb-3">Items</h4>
      <div className="space-y-2 mb-6">
        {order.items?.map((item: any) => (
          <div key={item.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            {item.product?.images?.[0] && (
              <img src={item.product.images[0]} alt="" className="w-12 h-12 rounded-lg object-cover" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{item.product?.name || 'Product'}</p>
              <p className="text-xs text-gray-500">Qty: {item.quantity} x ৳{Number(item.price).toLocaleString()}</p>
            </div>
            <p className="text-sm font-semibold text-gray-800">৳{(item.quantity * Number(item.price)).toLocaleString()}</p>
          </div>
        ))}
      </div>

      {order.shippingAddress && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-2">Shipping Address</h4>
          <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-xl">
            {typeof order.shippingAddress === 'object' ? Object.values(order.shippingAddress as Record<string, string>).filter(Boolean).join(', ') : String(order.shippingAddress)}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create AddressesSection**

`apps/storefront/app/account/sections/AddressesSection.tsx`:
```typescript
"use client";

import { useState, useEffect } from 'react';
import { MapPin, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { getAddresses, createAddress, updateAddress, deleteAddress, setDefaultAddress } from '@/lib/api/addresses';
import type { AddressData } from '@/lib/api/addresses';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

function AddressForm({ initial, onSave, onCancel }: { initial?: AddressData; onSave: (d: AddressData) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState<AddressData>(initial || { label: '', fullName: '', phoneNumber: '', street: '', city: '', state: '', zipCode: '', country: 'Bangladesh', isDefault: false });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs font-semibold text-gray-600">Label</label>
          <input type="text" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Home / Office" required className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
        </div>
        <div><label className="text-xs font-semibold text-gray-600">Full Name</label>
          <input type="text" value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} required className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs font-semibold text-gray-600">Phone</label>
          <input type="tel" value={form.phoneNumber} onChange={e => setForm(f => ({ ...f, phoneNumber: e.target.value }))} required className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
        </div>
        <div><label className="text-xs font-semibold text-gray-600">City</label>
          <input type="text" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} required className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
        </div>
      </div>
      <div><label className="text-xs font-semibold text-gray-600">Street Address</label>
        <input type="text" value={form.street} onChange={e => setForm(f => ({ ...f, street: e.target.value }))} required className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs font-semibold text-gray-600">State</label>
          <input type="text" value={form.state || ''} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
        </div>
        <div><label className="text-xs font-semibold text-gray-600">ZIP Code</label>
          <input type="text" value={form.zipCode || ''} onChange={e => setForm(f => ({ ...f, zipCode: e.target.value }))} className="w-full h-10 px-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-brand-blue outline-none" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="isDefault" checked={form.isDefault || false} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} className="rounded" />
        <label htmlFor="isDefault" className="text-sm text-gray-600">Set as default address</label>
      </div>
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving} className="bg-brand-blue hover:bg-brand-blue/90 text-white px-6 h-10 rounded-xl text-sm font-bold transition-all disabled:opacity-60">
          {saving ? <Loader2 className="animate-spin inline" size={16} /> : (initial ? 'Update' : 'Add Address')}
        </button>
        <button type="button" onClick={onCancel} className="px-6 h-10 rounded-xl text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">Cancel</button>
      </div>
    </form>
  );
}

export function AddressesSection() {
  const { user } = useAuth();
  const [addresses, setAddresses] = useState<AddressData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchAddresses = async () => {
    setLoading(true);
    try { setAddresses(await getAddresses()); } catch { setAddresses([]); } finally { setLoading(false); }
  };

  useEffect(() => { fetchAddresses(); }, []);

  const handleCreate = async (dto: AddressData) => {
    await createAddress(dto);
    setShowForm(false);
    toast.success('Address added');
    fetchAddresses();
  };

  const handleUpdate = async (dto: AddressData) => {
    if (!editingId) return;
    await updateAddress(editingId, dto);
    setEditingId(null);
    toast.success('Address updated');
    fetchAddresses();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this address?')) return;
    await deleteAddress(id);
    toast.success('Address deleted');
    fetchAddresses();
  };

  const handleSetDefault = async (id: string) => {
    await setDefaultAddress(id);
    fetchAddresses();
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-brand-blue" size={28} /></div>;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-gray-800">Saved Addresses</h3>
        {!showForm && <button onClick={() => setShowForm(true)} className="flex items-center gap-1 text-sm font-semibold text-brand-blue hover:underline"><Plus size={16} /> Add Address</button>}
      </div>

      {showForm && <div className="mb-6 p-4 border border-gray-200 rounded-xl"><AddressForm onSave={handleCreate} onCancel={() => setShowForm(false)} /></div>}
      {editingId && <div className="mb-6 p-4 border border-gray-200 rounded-xl"><AddressForm initial={addresses.find(a => a.id === editingId)} onSave={handleUpdate} onCancel={() => setEditingId(null)} /></div>}

      {addresses.length === 0 && !showForm ? (
        <div className="text-center py-12 text-gray-400">
          <MapPin size={48} strokeWidth={1} className="mx-auto mb-4 opacity-50" />
          <p>No saved addresses</p>
        </div>
      ) : (
        <div className="space-y-3">
          {addresses.map(addr => (
            <div key={addr.id} className={`p-4 rounded-xl border ${addr.isDefault ? 'border-brand-blue/30 bg-brand-blue/5' : 'border-gray-100'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800 text-sm">{addr.label}</span>
                    {addr.isDefault && <span className="text-[10px] bg-brand-blue/10 text-brand-blue font-semibold px-2 py-0.5 rounded-full">Default</span>}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{addr.fullName} — {addr.phoneNumber}</p>
                  <p className="text-sm text-gray-500">{addr.street}, {addr.city}{addr.state ? `, ${addr.state}` : ''}{addr.zipCode ? ` - ${addr.zipCode}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!addr.isDefault && <button onClick={() => handleSetDefault(addr.id!)} className="text-xs text-gray-400 hover:text-brand-blue">Set Default</button>}
                  <button onClick={() => setEditingId(addr.id!)} className="p-1.5 text-gray-400 hover:text-gray-600"><Pencil size={14} /></button>
                  <button onClick={() => handleDelete(addr.id!)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create SettingsSection**

`apps/storefront/app/account/sections/SettingsSection.tsx`:
```typescript
"use client";

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { getSettings, updateSettings } from '@/lib/api/settings';
import { toast } from 'sonner';

export function SettingsSection() {
  const [autoVariant, setAutoVariant] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings()
      .then(s => setAutoVariant(s.autoVariantSelect ?? true))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (val: boolean) => {
    setSaving(true);
    setAutoVariant(val);
    try {
      await updateSettings({ autoVariantSelect: val });
      toast.success('Setting updated');
    } catch {
      setAutoVariant(!val);
      toast.error('Failed to update setting');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-brand-blue" size={28} /></div>;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
      <h3 className="text-xl font-bold text-gray-800 mb-6">Settings</h3>

      <div className="space-y-6">
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
          <div>
            <p className="font-semibold text-gray-800 text-sm">Auto-select Variant</p>
            <p className="text-xs text-gray-500 mt-0.5">When viewing a product detail page, automatically select the first available variant</p>
          </div>
          <button
            onClick={() => handleToggle(!autoVariant)}
            disabled={saving}
            className={`relative w-12 h-6 rounded-full transition-colors ${autoVariant ? 'bg-brand-blue' : 'bg-gray-300'} ${saving ? 'opacity-60' : ''}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${autoVariant ? 'translate-x-6' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Rewrite /account/page.tsx**

`apps/storefront/app/account/page.tsx`:
```typescript
"use client";

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Sidebar } from './Sidebar';
import { ProfileSection } from './sections/ProfileSection';
import { OrdersSection } from './sections/OrdersSection';
import { AddressesSection } from './sections/AddressesSection';
import { SettingsSection } from './sections/SettingsSection';
import { useRouter } from 'next/navigation';

type Section = 'profile' | 'orders' | 'addresses' | 'settings';

export default function AccountPage() {
  const { user, loading, login, register } = useAuth();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<Section>('profile');
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-blue" size={32} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 md:py-24">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {isLoginMode ? 'Welcome Back' : 'Create Account'}
            </h2>
            <p className="text-sm text-gray-500">
              {isLoginMode
                ? 'Sign in to access your orders, wishlist, and settings'
                : 'Sign up to get started'}
            </p>
          </div>

          <form onSubmit={async (e) => {
            e.preventDefault(); setError(''); setSubmitting(true);
            try {
              if (isLoginMode) await login(email, password);
              else await register({ firstName, lastName, username, email, phoneNumber, password });
            } catch (err: any) {
              setError(err?.response?.data?.message || err?.message || 'Authentication failed');
            } finally { setSubmitting(false); }
          }} className="space-y-4">
            {!isLoginMode && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-600 ml-1">First Name</label>
                    <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="John" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-600 ml-1">Last Name</label>
                    <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Doe" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600 ml-1">Username</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="johndoe" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600 ml-1">Phone Number</label>
                  <input type="tel" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} placeholder="+8801700000000" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
                </div>
              </>
            )}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600 ml-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600 ml-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" required />
            </div>
            {error && <div className="text-red-500 text-xs font-medium bg-red-50 p-3 rounded-xl">{error}</div>}
            <button type="submit" disabled={submitting} className="w-full h-12 bg-brand-blue hover:bg-brand-blue/90 text-white font-bold rounded-xl transition-all shadow-lg shadow-brand-blue/20 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center">
              {submitting ? <Loader2 className="animate-spin" size={20} /> : (isLoginMode ? 'Sign In' : 'Create Account')}
            </button>
          </form>

          <div className="mt-8 text-center border-t border-gray-100 pt-6">
            <span className="text-sm text-gray-500 mr-2">
              {isLoginMode ? "Don't have an account?" : "Already have an account?"}
            </span>
            <button type="button" onClick={() => setIsLoginMode(!isLoginMode)} className="text-sm font-bold text-brand-blue hover:underline">
              {isLoginMode ? 'Sign Up' : 'Sign In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'profile': return <ProfileSection />;
      case 'orders': return <OrdersSection />;
      case 'addresses': return <AddressesSection />;
      case 'settings': return <SettingsSection />;
      default: return <ProfileSection />;
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      <div className="flex flex-col md:flex-row gap-8">
        <div className="w-full md:w-80 flex-shrink-0">
          <Sidebar activeSection={activeSection} onNavigate={setActiveSection} />
        </div>
        <div className="flex-1 space-y-6">
          {renderSection()}
        </div>
      </div>
    </div>
  );
}
```

---

### Task 8: Frontend — Integrate autoVariantSelect in ProductDetailClient

**Files:**
- Modify: `apps/storefront/components/ProductDetailClient.tsx`

- [ ] **Step 1: Add useEffect to fetch user settings and conditionally auto-select variant**

In `apps/storefront/components/ProductDetailClient.tsx`, replace the existing `selectedVariant` useState (lines 272-275) with:

```typescript
const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
```

Add a new useEffect and state variable after line 276:

```typescript
const [settingsLoaded, setSettingsLoaded] = useState(false);

useEffect(() => {
  if (!isVariable || activeVariants.length === 0) {
    setSettingsLoaded(true);
    return;
  }
  const token = localStorage.getItem('token');
  if (!token) {
    setSelectedVariant(activeVariants[0]);
    setSettingsLoaded(true);
    return;
  }
  import('@/lib/api/settings').then(({ getSettings }) => {
    getSettings().then(s => {
      if (s.autoVariantSelect !== false) {
        setSelectedVariant(activeVariants[0]);
      }
      setSettingsLoaded(true);
    }).catch(() => {
      setSelectedVariant(activeVariants[0]);
      setSettingsLoaded(true);
    });
  });
}, []);
```

---

### Task 9: Verify and test

- [ ] **Step 1: Build the backend**

Run: `cd apps/backend && npm run build`
Expected: Compilation succeeds without errors.

- [ ] **Step 2: Build the storefront**

Run: `cd apps/storefront && npm run build`
Expected: Compilation succeeds without errors.

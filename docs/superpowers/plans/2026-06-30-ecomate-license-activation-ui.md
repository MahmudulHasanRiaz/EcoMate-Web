# EcoMate License Activation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace env-var-based license configuration with an in-app activation UI. Add DB-persisted, encrypted license credentials, a global `LicenseGuard`, and activation page that gates all access behind a valid license.

**Architecture:** License credentials move from `env` to `Prisma` (encrypted at rest via AES-256-GCM). `LicenseService.onModuleInit()` reads from DB instead of env. New `LicenseGuard` checks activation on every request (skip for auth + license-activation routes). Admin panel gets `/license/activate` page. Storefront blocks with maintenance-style page when no license.

**Tech Stack:** NestJS 11, Prisma 7, TanStack Router (file-based), Next.js 16, AES-256-GCM, Jest

---

### Task 1: Prisma Schema + Migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/XXXXXX_add_license_activation/`

- [ ] **Step 1: Add LicenseActivation model to schema**

Add after the last model in `apps/backend/prisma/schema.prisma`:

```prisma
model LicenseActivation {
  id            String    @id @default(uuid())
  licenseKey    String
  keymateUrl    String
  domain        String?
  apiKey        String?
  licenseInfo   Json?     @db.JsonB
  status        String    @default("pending") // pending | active | expired | invalid
  errorMessage  String?
  activatedAt   DateTime?
  expiresAt     DateTime?
  lastCheckIn   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

- [ ] **Step 2: Run Prisma migration**

Run:
```bash
cd apps/backend
npx prisma migrate dev --name add_license_activation
```

Expected: Migration file created, schema updated.

- [ ] **Step 3: Run Prisma generate**

Run:
```bash
npx prisma generate
```

Expected: `@prisma/client` updated with `LicenseActivation` type.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/
git commit -m "feat: add LicenseActivation model"
```

---

### Task 2: Encryption Utility

**Files:**
- Create: `apps/backend/src/common/utils/encryption.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/common/utils/__tests__/encryption.spec.ts`:

```typescript
import { encrypt, decrypt } from '../encryption';

describe('EncryptionUtils', () => {
  const key = '0123456789abcdef0123456789abcdef'; // 32 hex bytes
  const plaintext = 'my-secret-license-key-1234';

  beforeEach(() => {
    process.env.LICENSE_ENCRYPTION_KEY = key;
  });

  afterEach(() => {
    delete process.env.LICENSE_ENCRYPTION_KEY;
  });

  it('encrypts and decrypts correctly', () => {
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext each time', () => {
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it('throws on missing encryption key', () => {
    delete process.env.LICENSE_ENCRYPTION_KEY;
    expect(() => encrypt(plaintext)).toThrow('LICENSE_ENCRYPTION_KEY');
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt(plaintext);
    const tampered = encrypted.slice(0, -4) + 'ffff';
    expect(() => decrypt(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/backend/src/common/utils/__tests__/encryption.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend/src/common/utils/encryption.ts`:

```typescript
import * as crypto from 'crypto';

function getKey(): Buffer {
  const hex = process.env.LICENSE_ENCRYPTION_KEY;
  if (!hex) throw new Error('LICENSE_ENCRYPTION_KEY not set');
  return Buffer.from(hex, 'hex');
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const [ivHex, tagHex, encrypted] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/backend/src/common/utils/__tests__/encryption.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/common/utils/encryption.ts apps/backend/src/common/utils/__tests__/encryption.spec.ts
git commit -m "feat: add AES-256-GCM encryption utility"
```

---

### Task 3: LicenseActivationService

**Files:**
- Create: `apps/backend/src/license/license-activation.service.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/license/__tests__/license-activation.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { LicenseActivationService } from '../license-activation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('LicenseActivationService', () => {
  let service: LicenseActivationService;
  let prisma: PrismaService;

  const mockPrisma = {
    licenseActivation: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseActivationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } },
      ],
    }).compile();
    service = module.get<LicenseActivationService>(LicenseActivationService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('find returns null when no activation exists', async () => {
    mockPrisma.licenseActivation.findFirst.mockResolvedValue(null);
    const result = await service.find();
    expect(result).toBeNull();
  });

  it('activate creates encrypted activation record', async () => {
    const dto = {
      licenseKey: 'TEST-KEY-1234',
      keymateUrl: 'https://keymate.example.com/api/v1/saas',
      domain: 'client-store.com',
      apiKey: 'test-api-token',
      licenseInfo: { valid: true, plan: { name: 'Growth' } },
    };

    mockPrisma.licenseActivation.upsert.mockResolvedValue({
      id: 'uuid',
      ...dto,
      status: 'active',
      apiKey: 'encrypted:value',
      licenseKey: 'encrypted:value',
      activatedAt: new Date(),
      expiresAt: null,
      lastCheckIn: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.activate(dto);
    expect(result.status).toBe('active');
    expect(mockPrisma.licenseActivation.upsert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/backend/src/license/__tests__/license-activation.service.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend/src/license/license-activation.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from '../common/utils/encryption';

interface ActivateDto {
  licenseKey: string;
  keymateUrl: string;
  domain?: string;
  apiKey?: string;
  licenseInfo?: any;
}

@Injectable()
export class LicenseActivationService {
  constructor(private prisma: PrismaService) {}

  async find() {
    return this.prisma.licenseActivation.findFirst();
  }

  async activate(dto: ActivateDto) {
    const data: any = {
      licenseKey: encrypt(dto.licenseKey),
      keymateUrl: dto.keymateUrl,
      domain: dto.domain || null,
      apiKey: dto.apiKey ? encrypt(dto.apiKey) : null,
      status: 'active',
      licenseInfo: dto.licenseInfo || null,
      activatedAt: new Date(),
      expiresAt: dto.licenseInfo?.expiry ? new Date(dto.licenseInfo.expiry) : null,
      errorMessage: null,
    };

    // Always only one record — upsert replaces existing
    const existing = await this.find();
    if (existing) {
      return this.prisma.licenseActivation.update({
        where: { id: existing.id },
        data,
      });
    }

    return this.prisma.licenseActivation.create({ data } as any);
  }

  async deactivate(errorMessage?: string) {
    const existing = await this.find();
    if (!existing) return null;
    return this.prisma.licenseActivation.update({
      where: { id: existing.id },
      data: { status: 'invalid', errorMessage: errorMessage || null },
    });
  }

  async getDecryptedCredentials() {
    const activation = await this.find();
    if (!activation || activation.status !== 'active') return null;
    return {
      licenseKey: decrypt(activation.licenseKey),
      keymateUrl: activation.keymateUrl,
      domain: activation.domain,
      apiKey: activation.apiKey ? decrypt(activation.apiKey) : undefined,
      licenseInfo: activation.licenseInfo,
    };
  }

  async updateLicenseInfo(licenseInfo: any) {
    const existing = await this.find();
    if (!existing) return null;
    return this.prisma.licenseActivation.update({
      where: { id: existing.id },
      data: {
        licenseInfo,
        lastCheckIn: new Date(),
        expiresAt: licenseInfo?.expiry ? new Date(licenseInfo.expiry) : undefined,
      },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/backend/src/license/__tests__/license-activation.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/license/license-activation.service.ts apps/backend/src/license/__tests__/license-activation.service.spec.ts
git commit -m "feat: add LicenseActivationService with encrypted CRUD"
```

---

### Task 4: SkipLicenseCheck Decorator

**Files:**
- Create: `apps/backend/src/common/decorators/skip-license-check.decorator.ts`

- [ ] **Step 1: Write decorator**

Create `apps/backend/src/common/decorators/skip-license-check.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';

export const SKIP_LICENSE_CHECK = 'skip_license_check';
export const SkipLicenseCheck = () => SetMetadata(SKIP_LICENSE_CHECK, true);
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/common/decorators/skip-license-check.decorator.ts
git commit -m "feat: add SkipLicenseCheck decorator"
```

---

### Task 5: LicenseGuard

**Files:**
- Create: `apps/backend/src/license/license.guard.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/license/__tests__/license.guard.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { LicenseGuard } from '../license.guard';
import { LicenseActivationService } from '../license-activation.service';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { SKIP_LICENSE_CHECK } from '../../common/decorators/skip-license-check.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

describe('LicenseGuard', () => {
  let guard: LicenseGuard;
  let licenseActivation: LicenseActivationService;
  let reflector: Reflector;

  const mockActivation = {
    find: jest.fn(),
  };

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const createMockContext = (): ExecutionContext =>
    ({
      getHandler: () => {},
      getClass: () => {},
    }) as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseGuard,
        { provide: LicenseActivationService, useValue: mockActivation },
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();
    guard = module.get<LicenseGuard>(LicenseGuard);
    licenseActivation = module.get<LicenseActivationService>(LicenseActivationService);
    reflector = module.get<Reflector>(Reflector);
  });

  it('allows when SkipLicenseCheck is set', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === SKIP_LICENSE_CHECK) return true;
      return null;
    });
    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
  });

  it('allows when route is Public', async () => {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return true;
      return null;
    });
    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
  });

  it('blocks when no activation exists', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(null);
    mockActivation.find.mockResolvedValue(null);
    await expect(guard.canActivate(createMockContext())).rejects.toThrow();
  });

  it('blocks when activation is not active', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(null);
    mockActivation.find.mockResolvedValue({ status: 'pending' });
    await expect(guard.canActivate(createMockContext())).rejects.toThrow();
  });

  it('allows when activation is active', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(null);
    mockActivation.find.mockResolvedValue({ status: 'active' });
    const result = await guard.canActivate(createMockContext());
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/backend/src/license/__tests__/license.guard.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend/src/license/license.guard.ts`:

```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LicenseActivationService } from './license-activation.service';
import { SKIP_LICENSE_CHECK } from '../common/decorators/skip-license-check.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private licenseActivation: LicenseActivationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip license check for public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Skip license check for activation/setup routes
    const skipLicense = this.reflector.getAllAndOverride<boolean>(SKIP_LICENSE_CHECK, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipLicense) return true;

    const activation = await this.licenseActivation.find();
    if (!activation || activation.status !== 'active') {
      throw new ForbiddenException('License not activated. Please activate your license.');
    }

    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/backend/src/license/__tests__/license.guard.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/license/license.guard.ts apps/backend/src/license/__tests__/license.guard.spec.ts
git commit -m "feat: add LicenseGuard global guard"
```

---

### Task 6: LicenseController — Add Activate Endpoint

**Files:**
- Modify: `apps/backend/src/license/license.controller.ts`
- Create: `apps/backend/src/license/dto/activate-license.dto.ts`

- [ ] **Step 1: Create DTO**

Create `apps/backend/src/license/dto/activate-license.dto.ts`:

```typescript
import { IsString, IsOptional } from 'class-validator';

export class ActivateLicenseDto {
  @IsString()
  licenseKey: string;

  @IsOptional()
  @IsString()
  apiKey?: string;
}
```

- [ ] **Step 2: Write failing test for controller**

Create `apps/backend/src/license/__tests__/license.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { LicenseController } from '../license.controller';
import { LicenseService } from '../license.service';
import { LicenseActivationService } from '../license-activation.service';

describe('LicenseController', () => {
  let controller: LicenseController;
  let licenseService: LicenseService;
  let activationService: LicenseActivationService;

  const mockLicenseService = {
    getStatus: jest.fn(),
    activateWithKeymate: jest.fn(),
  };

  const mockActivationService = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LicenseController],
      providers: [
        { provide: LicenseService, useValue: mockLicenseService },
        { provide: LicenseActivationService, useValue: mockActivationService },
      ],
    }).compile();
    controller = module.get<LicenseController>(LicenseController);
    licenseService = module.get<LicenseService>(LicenseService);
    activationService = module.get<LicenseActivationService>(LicenseActivationService);
  });

  it('activate endpoint calls licenseService.activateWithKeymate', async () => {
    const dto = { licenseKey: 'TEST-KEY' };
    const mockReq = { hostname: 'client-store.com' };
    const mockResult = { success: true, license: { valid: true } };
    mockLicenseService.activateWithKeymate.mockResolvedValue(mockResult);

    const result = await controller.activate(dto, mockReq as any);
    expect(result).toEqual(mockResult);
    expect(mockLicenseService.activateWithKeymate).toHaveBeenCalledWith(
      'TEST-KEY',
      'client-store.com',
      undefined,
    );
  });

  it('getStatus returns license status', () => {
    mockLicenseService.getStatus.mockReturnValue({ active: true });
    const result = controller.getStatus();
    expect(result).toEqual({ active: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest apps/backend/src/license/__tests__/license.controller.spec.ts`
Expected: FAIL

- [ ] **Step 4: Modify controller**

Update `apps/backend/src/license/license.controller.ts`:

```typescript
import { Controller, Get, Post, Body, Req } from '@nestjs/common';
import { LicenseService } from './license.service';
import { LicenseActivationService } from './license-activation.service';
import { ActivateLicenseDto } from './dto/activate-license.dto';
import { Public } from '../common/decorators/public.decorator';
import { SkipLicenseCheck } from '../common/decorators/skip-license-check.decorator';

@Controller('license')
export class LicenseController {
  constructor(
    private licenseService: LicenseService,
    private licenseActivation: LicenseActivationService,
  ) {}

  @Public()
  @SkipLicenseCheck()
  @Post('activate')
  async activate(@Body() dto: ActivateLicenseDto, @Req() req: any) {
    const domain = req.hostname;
    return this.licenseService.activateWithKeymate(dto.licenseKey, domain, dto.apiKey);
  }

  @Public()
  @Get('status')
  getStatus() {
    return this.licenseService.getStatus();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest apps/backend/src/license/__tests__/license.controller.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/license/license.controller.ts apps/backend/src/license/dto/activate-license.dto.ts apps/backend/src/license/__tests__/license.controller.spec.ts
git commit -m "feat: add POST /api/license/activate endpoint"
```

---

### Task 7: LicenseService Refactor — DB-backed + activateWithKeymate

**Files:**
- Modify: `apps/backend/src/license/license.service.ts`

- [ ] **Step 1: Update LicenseService**

Replace `apps/backend/src/license/license.service.ts`:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { ConfigService } from '@nestjs/config';
import { LicenseActivationService } from './license-activation.service';

@Injectable()
export class LicenseService implements OnModuleInit {
  constructor(
    private featureFlags: FeatureFlagsService,
    private config: ConfigService,
    private licenseActivation: LicenseActivationService,
  ) {}

  async onModuleInit() {
    const activation = await this.licenseActivation.find();

    if (!activation || activation.status !== 'active') {
      console.log('[License] No active activation found — setup required via UI');
      return;
    }

    const creds = await this.licenseActivation.getDecryptedCredentials();
    if (!creds) return;

    const { licenseKey, domain, apiKey } = creds;

    try {
      await this.featureFlags.initialize(licenseKey, domain, apiKey);
      const lic = this.featureFlags.getLicense();
      if (lic?.valid) {
        console.log(`[License] Validated — plan: ${lic.plan?.name || 'custom'}`);
        await this.licenseActivation.updateLicenseInfo(lic);
      } else {
        console.warn(`[License] KeyMate rejected: ${lic?.code}`);
        await this.licenseActivation.deactivate(lic?.code);
      }
    } catch {
      console.warn('[License] KeyMate unreachable — using cached data');
    }
  }

  async activateWithKeymate(licenseKey: string, domain: string, apiKey?: string) {
    const keymateUrl = this.config.get<string>('KEYMATE_API_URL')
      || 'https://keygen-keymate.commercians.com/api/v1/saas';

    try {
      await this.featureFlags.initialize(licenseKey, domain, apiKey);
      const lic = this.featureFlags.getLicense();

      if (lic?.valid) {
        await this.licenseActivation.activate({
          licenseKey,
          keymateUrl,
          domain,
          apiKey,
          licenseInfo: lic,
        });
        return { success: true, license: lic };
      }

      return { success: false, error: lic?.code || 'validation_failed', license: lic };
    } catch (err: any) {
      return { success: false, error: 'keymate_unreachable', detail: err.message };
    }
  }

  getStatus() {
    return {
      license: this.featureFlags.getLicense(),
      active: this.featureFlags.getLicense()?.valid ?? false,
    };
  }
}
```

- [ ] **Step 2: Update the existing test**

Update `apps/backend/src/license/__tests__/license.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { LicenseService } from '../license.service';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { ConfigService } from '@nestjs/config';
import { LicenseActivationService } from '../license-activation.service';

describe('LicenseService', () => {
  let service: LicenseService;

  const mockActivation = {
    find: jest.fn(),
    getDecryptedCredentials: jest.fn(),
    activate: jest.fn(),
    updateLicenseInfo: jest.fn(),
    deactivate: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseService,
        { provide: FeatureFlagsService, useFactory: () => new FeatureFlagsService() },
        { provide: ConfigService, useValue: { get: () => null } },
        { provide: LicenseActivationService, useValue: mockActivation },
      ],
    }).compile();
    service = module.get<LicenseService>(LicenseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getStatus returns active property', () => {
    const status = service.getStatus();
    expect(status).toHaveProperty('active');
  });

  it('activateWithKeymate handles KeyMate unreachable', async () => {
    const result = await service.activateWithKeymate('test-key', 'test.com');
    expect(result.success).toBe(false);
    expect(result.error).toBe('keymate_unreachable');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx jest apps/backend/src/license/__tests__/license.service.spec.ts`
Expected: PASS

- [ ] **Step 4: Update LicenseModule providers**

Update `apps/backend/src/license/license.module.ts`:

```typescript
import { Module, Global } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';
import { LicenseActivationService } from './license-activation.service';
import { LicenseGuard } from './license.guard';

@Global()
@Module({
  controllers: [LicenseController],
  providers: [
    LicenseService,
    LicenseActivationService,
    LicenseGuard,
    FeatureFlagsService,
  ],
  exports: [LicenseService, LicenseActivationService, LicenseGuard, FeatureFlagsService],
})
export class LicenseModule {}
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/license/license.service.ts apps/backend/src/license/license.module.ts apps/backend/src/license/__tests__/license.service.spec.ts
git commit -m "refactor: DB-backed LicenseService with activateWithKeymate"
```

---

### Task 8: AppModule — Register LicenseGuard

**Files:**
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Add LicenseGuard to APP_GUARD**

Find the `providers` array in `apps/backend/src/app.module.ts` and add `LicenseGuard`:

```typescript
import { LicenseGuard } from './license/license.guard';

// In providers array, after RolesGuard:
{ provide: APP_GUARD, useClass: LicenseGuard },
```

Final guard order:
```typescript
{ provide: APP_GUARD, useClass: JwtAuthGuard },
{ provide: APP_GUARD, useClass: RolesGuard },
{ provide: APP_GUARD, useClass: LicenseGuard },
{ provide: APP_GUARD, useClass: ThrottlerGuard },
{ provide: APP_GUARD, useClass: FeatureGuard },
```

- [ ] **Step 2: Ensure LicenseModule is imported**

Verify `LicenseModule` import is already in `imports` array (it was in the original).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/app.module.ts
git commit -m "feat: register LicenseGuard as global APP_GUARD"
```

---

### Task 9: Admin Activation Page UI

**Files:**
- Create: `apps/admin/src/routes/(auth)/license/activate.tsx`

- [ ] **Step 1: Create the activation page component**

Create `apps/admin/src/routes/(auth)/license/activate.tsx`:

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { apiClient } from '../../../lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Alert, AlertDescription } from '../../../components/ui/alert'

export const Route = createFileRoute('/(auth)/license/activate')({
  component: LicenseActivatePage,
})

function LicenseActivatePage() {
  const navigate = useNavigate()
  const [licenseKey, setLicenseKey] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await apiClient.post('/license/activate', {
        licenseKey: licenseKey.trim(),
        apiKey: apiKey.trim() || undefined,
      })

      if (res.data?.success) {
        setSuccess(true)
        setTimeout(() => navigate({ to: '/' }), 2000)
      } else {
        setError(res.data?.error || 'Activation failed. Please check your license key.')
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Unable to reach server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center text-green-600">License Activated!</CardTitle>
            <CardDescription className="text-center">
              Redirecting to dashboard...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Activate Your License</CardTitle>
          <CardDescription>
            Enter your license key to activate this EcoMate installation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="licenseKey">License Key</Label>
              <Input
                id="licenseKey"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key (optional)</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="e.g. eyJhbGciOi..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Optional security token for auto-verification. Leave blank if not provided.
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Activating...' : 'Activate License'}
            </Button>

            <p className="text-xs text-center text-muted-foreground mt-4">
              Need a license? Contact your service provider.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Regenerate route tree**

Run:
```bash
cd apps/admin
npx @tanstack/router-cli generate
```

Or if no CLI, check `package.json` scripts for route generation command.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/routes/(auth)/license/activate.tsx
git commit -m "feat: add license activation page to admin panel"
```

---

### Task 10: Admin Layout — Add License Check Redirect

**Files:**
- Modify: `apps/admin/src/components/layout/authenticated-layout.tsx`

- [ ] **Step 1: Add license check alongside auth check**

Modify `authenticated-layout.tsx` — after the existing auth check, add license status check:

```typescript
import { getCookie } from '@/lib/cookies'
import { apiClient } from '@/lib/api-client'
// ... existing imports

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.auth.accessToken)

  useEffect(() => {
    if (!accessToken) {
      navigate({ to: '/sign-in', replace: true })
    }
  }, [accessToken, navigate])

  useEffect(() => {
    if (!accessToken) return
    const { user, setUser, reset } = useAuthStore.getState().auth
    if (user) return
    apiClient.get('/auth/me').then(r => {
      const u = r.data?.user || r.data
      if (u) setUser({ id: u.id, email: u.email, role: u.role })
    }).catch(() => {
      reset()
      navigate({ to: '/sign-in', replace: true })
    })
  }, [accessToken, navigate])

  // License check after auth is confirmed
  useEffect(() => {
    if (!accessToken) return
    // Skip if already on activate page
    if (window.location.pathname.includes('/license/activate')) return

    apiClient.get('/license/status').then(r => {
      if (!r.data?.active) {
        navigate({ to: '/license/activate', replace: true })
      }
    }).catch(() => {
      // If status check fails, allow access (grace)
    })
  }, [accessToken, navigate])

  // redirect to sign-in if no token (with spinner)
  if (!accessToken) {
    return (...existing spinner...)
  }

  return (...existing layout...)
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/src/components/layout/authenticated-layout.tsx
git commit -m "feat: add license check redirect to admin layout"
```

---

### Task 11: Storefront — License Block

**Files:**
- Modify: `apps/storefront/app/layout.tsx`

- [ ] **Step 1: Add license status check to server component**

Modify `apps/storefront/app/layout.tsx` — fetch license status and pass to client:

The existing pattern uses `getStorefrontConfigServer()` in the root layout. Add a similar pattern for license status. In the server component (before the client wrapper), fetch license status.

Find the existing maintenance mode pattern and add license check alongside it:

```tsx
// Before the existing maintenance mode check, add:
const licenseRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/license/status`, {
  next: { revalidate: 300 }, // cache for 5 min
}).catch(() => null);
const licenseStatus = licenseRes ? await licenseRes.json().catch(() => null) : null;
const licenseActive = licenseStatus?.active ?? true;

// Replace the maintenance mode check area:
{!licenseActive ? (
  <div className="min-h-screen flex flex-col items-center justify-center bg-background p-8 text-center">
    <svg className="w-16 h-16 text-muted-foreground mb-4" ...lock-icon... />
    <h1 className="text-2xl font-bold mb-2">License Required</h1>
    <p className="text-muted-foreground max-w-md">
      This EcoMate installation requires a valid license. Please contact your
      administrator or service provider to activate your license.
    </p>
  </div>
) : initialConfig?.features?.maintenanceMode ? (
  // ...existing maintenance mode JSX...
) : (
  children
)}
```

- [ ] **Step 2: Commit**

```bash
git add apps/storefront/app/layout.tsx
git commit -m "feat: add license block to storefront"
```

---

### Task 12: Env Vars + Final Setup

**Files:**
- Modify: `apps/backend/.env.example`

- [ ] **Step 1: Update .env.example**

Update `apps/backend/.env.example`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ecomate_web"
JWT_SECRET="change-me-to-a-random-string-at-least-32-chars"
JWT_REFRESH_SECRET="change-me-to-another-random-string-32-chars"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
PORT=4000
CORS_ORIGIN="http://localhost:5173,http://localhost:3000"
APP_URL="http://localhost:4000"

# License Activation
# Encryption key for storing license credentials at rest (64 hex chars = 32 bytes)
LICENSE_ENCRYPTION_KEY="change-me-to-64-hex-characters"

# KeyMate License Server
KEYMATE_API_URL="https://keygen-keymate.commercians.com/api/v1/saas"

# Legacy env vars (no longer read for activation — kept for backward compat)
# LICENSE_KEY=
# LICENSE_TOKEN=
# KEYMATE_API_KEY=
# DOMAIN=
```

- [ ] **Step 2: Run all tests**

```bash
cd apps/backend
npx jest --passWithNoTests
```

Expected: All existing tests + new tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/.env.example
git commit -m "chore: update env vars for license activation UI"
```

---

### Task 13: E2E Flow Test (Manual Verification)

- [ ] **Step 1: Test activation flow**

1. Start backend: `cd apps/backend && npx nest start`
2. Verify `GET /api/license/status` returns `{ active: false }`
3. `POST /api/license/activate` with invalid key returns error
4. `POST /api/license/activate` with valid key returns success
5. `GET /api/license/status` now returns `{ active: true }`
6. Verify gated routes now pass

- [ ] **Step 2: Test admin activation page**

1. Start admin: `cd apps/admin && pnpm dev`
2. Log in
3. Verify redirect to `/license/activate`
4. Fill form
5. Verify activation success + redirect to dashboard

- [ ] **Step 3: Test storefront block**

1. Start storefront: `cd apps/storefront && pnpm dev`
2. Verify "License Required" page shown
3. Activate license via admin
4. Refresh storefront — content should now show

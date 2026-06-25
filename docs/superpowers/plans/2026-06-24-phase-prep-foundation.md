# Phase Prep: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up monorepo packages structure, Keygen CE license server, C++ license engine addon, feature-flag system, obfuscation pipeline, and client deployment workflow — without breaking FIXEDPLUS.

**Architecture:** New `packages/*` alongside existing `apps/*`. License engine runs as C++ N-API addon. Feature flags gate module registration in NestJS. Obfuscation added as Docker build step. Keygen CE self-hosted as separate Stack in same cluster.

**Tech Stack:** NestJS, C++ N-API (node-addon-api), javascript-obfuscator, Keygen CE, Docker Swarm, GitHub Actions, Portainer API

**Spec:** `docs/superpowers/specs/2026-06-24-ecomate-platform-transformation-design.md`

---

### Task 1: Create `packages/` monorepo structure

**Files:**
- Create: `packages/shared-types/package.json`
- Create: `packages/shared-types/tsconfig.json`
- Create: `packages/shared-types/src/index.ts`
- Create: `packages/shared-types/src/license-types.ts`
- Create: `packages/shared-types/src/client-config.ts`
- Modify: `package.json` (root)

- [ ] **Step 1: Create shared-types package**

```json
{
  "name": "@ecomate/shared-types",
  "version": "0.0.1",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: Create tsconfig**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create license types**

```typescript
// packages/shared-types/src/license-types.ts
export interface LicenseToken {
  clientId: string;
  plan: PlanType;
  packages: string[];
  customFeatures: string[];
  limits: ResourceLimits;
  exp: number;
  iat: number;
}

export type PlanType = 'essential' | 'growth' | 'enterprise' | 'ultimate' | 'custom';

export interface ResourceLimits {
  cpus: number;
  memory: string;
  users: number;
  stores: number;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  planMin: PlanType;
}

export const FEATURES: Record<string, FeatureFlag> = {
  'pos': { key: 'pos', enabled: true, planMin: 'growth' },
  'multi-warehouse': { key: 'multi-warehouse', enabled: true, planMin: 'enterprise' },
  'advanced-reports': { key: 'advanced-reports', enabled: true, planMin: 'enterprise' },
  'coupons': { key: 'coupons', enabled: true, planMin: 'growth' },
  'custom-reports': { key: 'custom-reports', enabled: true, planMin: 'ultimate' },
};
```

- [ ] **Step 4: Create client config types**

```typescript
// packages/shared-types/src/client-config.ts
export interface ClientConfig {
  clientId: string;
  displayName: string;
  features: Record<string, boolean>;
  overrides: {
    admin?: { loginLogo?: string; theme?: Record<string, string> };
    storefront?: { theme?: Record<string, string> };
  };
  branding?: {
    primaryColor: string;
    logo?: string;
    favicon?: string;
  };
}
```

- [ ] **Step 5: Create barrel export**

```typescript
// packages/shared-types/src/index.ts
export * from './license-types';
export * from './client-config';
```

- [ ] **Step 6: Add workspace to root package.json**

```json
"workspaces": [
  "apps/*",
  "packages/*"
]
```

- [ ] **Step 7: Verify workspace links**

Run: `npm install` from root
Expected: npm creates symlinks in node_modules/@ecomate/shared-types

---

### Task 2: Set up Keygen CE license server (Docker Stack)

**Files:**
- Create: `portainer/keygen/docker-compose.yml`
- Create: `portainer/keygen/.env.example`
- Create: `docs/keygen-setup.md`

- [ ] **Step 1: Create Keygen CE docker-compose**

```yaml
# portainer/keygen/docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: keygen
      POSTGRES_USER: keygen
      POSTGRES_PASSWORD: ${KEYGEN_DB_PASSWORD}
    volumes:
      - keygen-db:/var/lib/postgresql/data
    healthcheck:
      test: pg_isready -U keygen
      interval: 10s

  keygen:
    image: ghcr.io/keygen-sh/keygen-api:latest
    environment:
      DATABASE_URL: postgresql://keygen:${KEYGEN_DB_PASSWORD}@postgres:5432/keygen
      KEYGEN_SECRET_KEY: ${KEYGEN_SECRET_KEY}
      KEYGEN_HOST: ${KEYGEN_HOST}
      KEYGEN_ACCOUNT_ID: ${KEYGEN_ACCOUNT_ID}
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  keygen-db:
```

- [ ] **Step 2: Create env example**

```bash
# portainer/keygen/.env.example
KEYGEN_DB_PASSWORD=change_me
KEYGEN_SECRET_KEY=generate_with_openssl_rand_hex_64
KEYGEN_HOST=https://license.yourdomain.com
KEYGEN_ACCOUNT_ID=your-account-id
```

- [ ] **Step 3: Create setup guide**

Write concise setup doc covering:
1. Deploy stack via Portainer
2. Create admin account via Keygen API
3. Create product (license policy)
4. Create machine (device) policy
5. Generate API key for GitHub Actions

- [ ] **Step 4: Create initial license policy via curl (doc)**

```bash
# After Keygen deployed, run once:
curl -X POST https://license.yourdomain.com/v1/policies \
  -H "Authorization: Bearer $KEYGEN_API_KEY" \
  -H "Content-Type: application/vnd.api+json" \
  -d '{
    "data": {
      "type": "policies",
      "attributes": {
        "name": "EcoMate Enterprise",
        "requireFingerprint": true,
        "maxMachines": 3,
        "checkInInterval": 604800,
        "scheme": "ed25519"  
      }
    }
  }'
```

---

### Task 3: Build C++ N-API license engine addon

**Files:**
- Create: `packages/license-engine/package.json`
- Create: `packages/license-engine/binding.gyp`
- Create: `packages/license-engine/src/validator.cc`
- Create: `packages/license-engine/src/addon.cc`
- Create: `packages/license-engine/index.js`
- Create: `packages/license-engine/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@ecomate/license-engine",
  "version": "0.0.1",
  "private": true,
  "main": "index.js",
  "scripts": {
    "build": "node-gyp rebuild",
    "preinstall": "node-gyp install"
  },
  "dependencies": {
    "node-addon-api": "^8.3.1",
    "node-gyp": "^11.2.0"
  },
  "gypfile": true
}
```

- [ ] **Step 2: Create binding.gyp**

```python
{
  "targets": [
    {
      "target_name": "license_engine",
      "sources": ["src/addon.cc", "src/validator.cc"],
      "include_dirs": ["<!(node -e 'require(\"node-addon-api\").include')"],
      "dependencies": ["<!(node -e 'require(\"node-addon-api\").gyp')"],
      "defines": ["NAPI_CPP_EXCEPTIONS"]
    }
  ]
}
```

- [ ] **Step 3: Create JWT validator (C++)**

```cpp
// packages/license-engine/src/validator.cc
#include <napi.h>
#include <string>
#include <vector>
#include <sstream>

// Simplified JWT verification stub.
// Real impl: use a minimal JWT lib or libsodium crypto_sign_open
// Key embedded as byte array at build time (not source literal)

namespace {

const unsigned char PUBLIC_KEY_BLOB[] = {
  // Populated at build time from Keygen CE Ed25519 public key
  // This blob is NOT readable as ASCII — binary encoded
};

bool VerifyEd25519(const std::string& message, const std::string& signature) {
  // Phase Prep stub. Full crypto integrated in later phase when libsodium bundled into Docker image.
  // Verifies nothing yet — wraps JWT decode only. Always returns decoded payload.
  return true;
}

Napi::String VerifyLicense(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "String expected").ThrowAsJavaScriptException();
    return Napi::String::New(env, "");
  }

  std::string token = info[0].As<Napi::String>().Utf8Value();

  // Decode JWT parts
  // part0 = header (unused in verify)
  // part1 = payload
  // part2 = signature

  std::vector<std::string> parts;
  std::stringstream ss(token);
  std::string part;
  while (std::getline(ss, part, '.')) {
    parts.push_back(part);
  }

  if (parts.size() != 3) {
    return Napi::String::New(env, "{\"valid\":false,\"reason\":\"malformed\"}");
  }

  // Reconstruct signing input
  std::string signing_input = parts[0] + "." + parts[1];
  std::string signature_b64 = parts[2];

  // TODO: URL-safe base64 decode signature
  // bool valid = VerifyEd25519(signing_input, decoded_sig);

  // Return decoded payload for JS to read
  // In production: only return payload if signature valid
  return Napi::String::New(env, "{\"valid\":true,\"payload\":\"" + parts[1] + "\"}");
}

} // anonymous namespace

Napi::Object InitValidator(Napi::Env env, Napi::Object exports) {
  exports.Set("verifyLicense", Napi::Function::New(env, VerifyLicense));
  return exports;
}
```

```cpp
// packages/license-engine/src/addon.cc
#include <napi.h>

Napi::Object InitValidator(Napi::Env env, Napi::Object exports);

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  InitValidator(env, exports);
  return exports;
}

NODE_API_MODULE(license_engine, InitAll)
```

- [ ] **Step 4: Create JS wrapper**

```javascript
// packages/license-engine/index.js
const addon = require('./build/Release/license_engine');

class LicenseEngine {
  verify(token) {
    const result = JSON.parse(addon.verifyLicense(token));
    if (!result.valid) {
      return { valid: false, features: [] };
    }
    const payload = JSON.parse(Buffer.from(result.payload, 'base64url').toString());
    return {
      valid: true,
      clientId: payload.clientId,
      plan: payload.plan,
      packages: payload.packages || [],
      customFeatures: payload.customFeatures || [],
      limits: payload.limits || { cpus: 1, memory: '1G', users: 1, stores: 1 },
      exp: payload.exp,
    };
  }

  canUseFeature(license, featureKey) {
    if (!license || !license.valid) return false;
    const FEATURE_PLAN_MAP = {
      'pos': ['growth', 'enterprise', 'ultimate'],
      'multi-warehouse': ['enterprise', 'ultimate'],
      'advanced-reports': ['enterprise', 'ultimate'],
      'coupons': ['growth', 'enterprise', 'ultimate'],
    };
    const allowedPlans = FEATURE_PLAN_MAP[featureKey];
    if (!allowedPlans) return false;
    if (allowedPlans.includes(license.plan)) return true;
    if (license.customFeatures.includes(featureKey)) return true;
    if (license.packages.includes(featureKey)) return true;
    return false;
  }
}

module.exports = new LicenseEngine();
```

- [ ] **Step 5: Build and test addon**

Run: `cd packages/license-engine && npm install && npm run build`
Expected: `build/Release/license_engine.node` file exists

Run: `node -e "const engine = require('.'); console.log(engine.verify('test'))"`
Expected: No crash, returns result object

---

### Task 4: Build feature-flags package

**Files:**
- Create: `packages/feature-flags/package.json`
- Create: `packages/feature-flags/src/index.ts`
- Create: `packages/feature-flags/src/decorator.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@ecomate/feature-flags",
  "version": "0.0.1",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@ecomate/license-engine": "*",
    "@nestjs/common": "^11.0.1"
  },
  "devDependencies": {
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: Create feature flag service**

```typescript
// packages/feature-flags/src/index.ts
import { Injectable, Inject, Optional } from '@nestjs/common';

export interface LicenseInfo {
  valid: boolean;
  clientId: string;
  plan: string;
  packages: string[];
  customFeatures: string[];
  limits: { cpus: number; memory: string; users: number; stores: number };
  exp: number;
}

@Injectable()
export class FeatureFlagsService {
  private license: LicenseInfo | null = null;
  private licenseEngine: any;

  constructor() {
    // lazy-load license engine (may not exist in dev)
    try {
      this.licenseEngine = require('@ecomate/license-engine');
    } catch {
      console.warn('License engine not available — running in dev mode (all features enabled)');
    }
  }

  setLicense(token: string) {
    if (this.licenseEngine) {
      this.license = this.licenseEngine.verify(token);
    } else {
      // Dev mode: unlimited
      this.license = {
        valid: true,
        clientId: 'dev',
        plan: 'ultimate',
        packages: [],
        customFeatures: [],
        limits: { cpus: 999, memory: '999G', users: 999, stores: 999 },
        exp: 9999999999,
      };
    }
  }

  canUse(featureKey: string): boolean {
    if (!this.license || !this.license.valid) return false;
    if (this.licenseEngine) {
      return this.licenseEngine.canUseFeature(this.license, featureKey);
    }
    return true; // dev mode
  }

  getLicense(): LicenseInfo | null {
    return this.license;
  }
}
```

- [ ] **Step 3: Create @RequiresFeature decorator**

```typescript
// packages/feature-flags/src/decorator.ts
import { SetMetadata } from '@nestjs/common';

export const REQUIRES_FEATURE_KEY = 'requires_feature';

export const RequiresFeature = (featureKey: string) =>
  SetMetadata(REQUIRES_FEATURE_KEY, featureKey);
```

---

### Task 5: Add feature-flag guard to backend

**Files:**
- Create: `packages/feature-flags/src/guard.ts`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Step 1: Create feature guard**

```typescript
// packages/feature-flags/src/guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_FEATURE_KEY } from './decorator';
import { FeatureFlagsService } from './index';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private featureFlags: FeatureFlagsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const featureKey = this.reflector.getAllAndOverride<string>(REQUIRES_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!featureKey) return true; // no restriction
    return this.featureFlags.canUse(featureKey);
  }
}
```

- [ ] **Step 2: Register FeatureFlagsModule in AppModule**

Add to `apps/backend/src/app.module.ts`:

```typescript
import { FeatureFlagsService, FeatureGuard } from '@ecomate/feature-flags';

@Module({
  providers: [
    FeatureFlagsService,
    { provide: APP_GUARD, useClass: FeatureGuard },
    // ... existing providers
  ],
  exports: [FeatureFlagsService],
})
```

- [ ] **Step 3: Verify build**

Run: `cd apps/backend && npm run build`
Expected: No errors

---

### Task 6: Add `clients/` directory with example overlay

**Files:**
- Create: `clients/.gitkeep`
- Create: `clients/client-example/README.md`
- Create: `clients/client-example/client.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Create example client config**

```typescript
// clients/client-example/client.config.ts
import { ClientConfig } from '@ecomate/shared-types';

const config: ClientConfig = {
  clientId: 'example-client',
  displayName: 'Example Store',
  features: {},
  overrides: {},
  branding: {
    primaryColor: '#0055FF',
    logo: '/overrides/logo.svg',
  },
};

export default config;
```

- [ ] **Step 2: Update .gitignore**

```gitignore
# clients/ — real client configs NOT committed
clients/*
!clients/.gitkeep
!clients/client-example/
```

---

### Task 7: Set up obfuscation pipeline in Dockerfile

**Files:**
- Modify: `apps/backend/Dockerfile`
- Modify: `apps/admin/Dockerfile` (if exists)
- Modify: `apps/storefront/Dockerfile` (if exists)

- [ ] **Step 1: Update backend Dockerfile**

```dockerfile
# apps/backend/Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Build
RUN npm run build

# Obfuscate built JS
RUN npm install -g javascript-obfuscator
RUN javascript-obfuscator dist/ \
    --output dist-obfuscated/ \
    --control-flow-flattening true \
    --control-flow-flattening-threshold 0.75 \
    --string-array-encoding true \
    --string-array-threshold 0.8 \
    --dead-code-injection true \
    --dead-code-injection-threshold 0.4 \
    --self-defending true \
    --disable-console-output false

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist-obfuscated ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/license-engine/build/Release ./dist/license-engine-native

EXPOSE 4000
CMD ["node", "dist/main"]
```

- [ ] **Step 2: Add obfuscation config file**

Create `obfuscator.config.json` at root:

```json
{
  "controlFlowFlattening": true,
  "controlFlowFlatteningThreshold": 0.75,
  "stringArrayEncoding": ["base64"],
  "stringArrayThreshold": 0.8,
  "deadCodeInjection": true,
  "deadCodeInjectionThreshold": 0.4,
  "selfDefending": true,
  "disableConsoleOutput": false,
  "renameGlobals": false,
  "reservedStrings": ["\\bEcoMate\\b", "\\bhandle\\b", "\\bapp\\b"],
  "reservedNames": ["\\becomate\\b", "\\bapp\\b", "\\bmodule\\b", "\\bservice\\b"]
}
```

- [ ] **Step 3: Build test**

Run: `cd apps/backend && docker build -t ecomate-obfuscated-test .`
Expected: Build succeeds, dist-obfuscated contains unreadable JS

---

### Task 8: Update CI/CD workflow for multi-client deployment

**Files:**
- Create: `.github/workflows/deploy-client.yml` (rewrite existing)
- Create: `.github/workflows/build-client-image.yml`

- [ ] **Step 1: Rewrite deploy-client workflow**

```yaml
# .github/workflows/deploy-client.yml
name: Deploy Client
on:
  workflow_dispatch:
    inputs:
      client_name:
        description: 'Unique client identifier (e.g., client-xyz)'
        required: true
      plan:
        description: 'License plan'
        required: true
        type: choice
        options: [essential, growth, enterprise, ultimate]
      target_server:
        description: 'Portainer URL or server IP'
        required: true
      custom_domain:
        description: 'Custom domain (optional)'
        required: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Check for client overlay
        id: overlay
        run: |
          if [ -d "clients/${{ inputs.client_name }}" ]; then
            echo "exists=true" >> $GITHUB_OUTPUT
          else
            echo "exists=false" >> $GITHUB_OUTPUT
          fi

      - name: Build all apps
        run: npm run build
        env:
          LICENSE_CLIENT_ID: ${{ inputs.client_name }}
          LICENSE_PLAN: ${{ inputs.plan }}

      - name: Obfuscate backend
        run: |
          npm install -g javascript-obfuscator
          javascript-obfuscator apps/backend/dist/ \
            --output apps/backend/dist-obfuscated/ \
            --config obfuscator.config.json
          cp -r apps/backend/dist-obfuscated/* apps/backend/dist/

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push images
        run: |
          docker build -t ghcr.io/${{ github.repository_owner }}/ecomate-backend:${{ inputs.client_name }} apps/backend
          docker build -t ghcr.io/${{ github.repository_owner }}/ecomate-admin:${{ inputs.client_name }} apps/admin
          docker build -t ghcr.io/${{ github.repository_owner }}/ecomate-storefront:${{ inputs.client_name }} apps/storefront
          docker push --all-tags ghcr.io/${{ github.repository_owner }}/ecomate-backend
          docker push --all-tags ghcr.io/${{ github.repository_owner }}/ecomate-admin
          docker push --all-tags ghcr.io/${{ github.repository_owner }}/ecomate-storefront

      - name: Deploy via Portainer webhook
        run: |
          WEBHOOK_URL="${{ secrets[format('PORTAINER_WEBHOOK_{0}', inputs.client_name)] }}"
          if [ -n "$WEBHOOK_URL" ]; then
            curl -X POST -k --max-time 30 "$WEBHOOK_URL"
          else
            echo "No webhook secret found for ${{ inputs.client_name }}"
            echo "Create secret: PORTAINER_WEBHOOK_${{ inputs.client_name }}"
          fi
```

- [ ] **Step 2: Keep existing CI.yml unchanged**

No modifications to `.github/workflows/ci.yml`. FIXEDPLUS CI continues as-is.

- [ ] **Step 3: Verify workflow syntax**

Run: `npx --yes action-validator .github/workflows/deploy-client.yml`
Expected: No errors

---

### Task 9: Add license bootstrap for existing clients

**Files:**
- Create: `apps/backend/src/license/license.module.ts`
- Create: `apps/backend/src/license/license.controller.ts`
- Create: `apps/backend/src/license/license.service.ts`
- Modify: `apps/backend/src/main.ts`

- [ ] **Step 1: Create license module**

```typescript
// apps/backend/src/license/license.module.ts
import { Module } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';

@Module({
  controllers: [LicenseController],
  providers: [LicenseService, FeatureFlagsService],
  exports: [LicenseService, FeatureFlagsService],
})
export class LicenseModule {}
```

```typescript
// apps/backend/src/license/license.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LicenseService implements OnModuleInit {
  constructor(
    private featureFlags: FeatureFlagsService,
    private config: ConfigService,
  ) {}

  onModuleInit() {
    // For existing clients: read license from env
    const licenseToken = this.config.get<string>('LICENSE_TOKEN');
    if (licenseToken) {
      this.featureFlags.setLicense(licenseToken);
    } else {
      console.warn('LICENSE_TOKEN not set — all features disabled');
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

```typescript
// apps/backend/src/license/license.controller.ts
import { Controller, Get } from '@nestjs/common';
import { LicenseService } from './license.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('license')
export class LicenseController {
  constructor(private licenseService: LicenseService) {}

  @Public()
  @Get('status')
  getStatus() {
    return this.licenseService.getStatus();
  }
}
```

- [ ] **Step 2: Bootstrap FIXEDPLUS with unlimited license**

Create GitHub Secret `LICENSE_TOKEN_FIXEDPLUS` with a signed JWT granting:
```json
{
  "clientId": "fixedplus",
  "plan": "ultimate",
  "packages": ["*"],
  "customFeatures": ["*"],
  "limits": { "cpus": 999, "memory": "999G", "users": 999, "stores": 999 },
  "exp": 4102444800
}
```

- [ ] **Step 3: Update FIXEDPLUS docker stack with LICENSE_TOKEN env**

```yaml
# In Portainer stack for FIXEDPLUS
services:
  backend:
    environment:
      LICENSE_TOKEN: ${LICENSE_TOKEN_FIXEDPLUS}
```

---

### Task 10: Verify everything works end-to-end

- [ ] **Step 1: Build all packages**

Run: `npm run build`
Expected: All apps + packages compile

- [ ] **Step 2: Start backend in dev mode**

Run: `cd apps/backend && npm run start:dev`
Expected: Server starts. Log shows "License engine not available — running in dev mode (all features enabled)"

- [ ] **Step 3: Hit license endpoint**

Run: `curl http://localhost:4000/api/license/status`
Expected: `{"license":{"valid":true,"clientId":"dev","plan":"ultimate",...},"active":true}`

- [ ] **Step 4: Run existing tests**

Run: `cd apps/backend && npm test`
Expected: All existing tests pass (no regression)

- [ ] **Step 5: Build Docker image (obfuscated)**

Run: `cd apps/backend && docker build -t ecomate-test .`
Expected: Build succeeds. Image contains obfuscated JS.

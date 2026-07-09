# Phase 2: Fastify Migration — Implementation Plan
> **Superseded by:** `docs/2-ARCHITECTURE/ARCHITECTURE.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Swap NestJS platform from Express to Fastify with zero functional change. No API behavior change. No DB change. No client impact.

**Architecture:** NestJS supports interchangeable HTTP platforms. Changing from `@nestjs/platform-express` to `@nestjs/platform-fastify` only requires changing the adapter in `main.ts` and replacing Express middleware with Fastify equivalents.

**Tech Stack:** NestJS 11, Fastify, @fastify/helmet, @fastify/compress, @fastify/cookie

**Spec:** `docs/superpowers/specs/2026-06-24-ecomate-platform-transformation-design.md`

---

### Task 1: Install Fastify dependencies

**Files:**
- Modify: `apps/backend/package.json`

- [ ] **Step 1: Add Fastify packages**

```bash
npm install --workspace=backend @nestjs/platform-fastify @fastify/helmet @fastify/compress @fastify/cookie
```

- [ ] **Step 2: Verify install**

Run: `npm ls @nestjs/platform-fastify`
Expected: resolves to workspace backend

---

### Task 2: Update main.ts — Express → Fastify

**Files:**
- Modify: `apps/backend/src/main.ts`

- [ ] **Step 1: Rewrite main.ts**

Read existing `apps/backend/src/main.ts` first. Make these changes:

```diff
- import { NestExpressApplication } from '@nestjs/platform-express';
+ import { NestFastifyApplication } from '@nestjs/platform-fastify';

- import { json, urlencoded } from 'express';
- import helmet from 'helmet';
- import compression from 'compression';
- import cookieParser from 'cookie-parser';

- const app = await NestFactory.create<NestExpressApplication>(AppModule);
+ const app = await NestFactory.create<NestFastifyApplication>(AppModule);
```

Replace middleware:
```diff
- app.use(helmet({ ... }));
+ await app.register(require('@fastify/helmet'), { ... });

- app.use(compression());
+ await app.register(require('@fastify/compress'));

- app.use(json({ limit: '1mb' }));
- app.use(urlencoded({ limit: '1mb', extended: true }));
  // Fastify handles body parsing natively — no middleware needed

- app.use(cookieParser());
+ await app.register(require('@fastify/cookie'));

- app.useStaticAssets(join(...), { prefix: '/uploads/', ... });
+ await app.register(require('@fastify/static'), {
+   root: join(process.cwd(), 'uploads'),
+   prefix: '/uploads/',
+   maxAge: '1y',
+   immutable: true,
+ });
+ await app.register(require('@fastify/static'), {
+   root: join(process.cwd(), 'public'),
+   prefix: '/assets/',
+   maxAge: '1y',
+   immutable: true,
+ });
```

The uploads middleware (content-type check) needs adaptation:
```diff
- app.use('/uploads', (req, res, next) => {
-   const contentType = req.headers['content-type'];
-   if (contentType && !contentType.startsWith('image/')) {
-     console.warn(...);
-   }
-   next();
- });
// Replace with Fastify onRequest hook
```

The request logging middleware:
```diff
- app.use((req, res, next) => {
-   const start = Date.now();
-   res.on('finish', () => {
-     console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
-   });
-   next();
- });
// Replace with Fastify onResponse hook via `app.getHttpAdapter().getInstance()`
```

CORS setup:
```diff
- app.enableCors({ ... });
+ app.enableCors({ ... }); // Same API, works the same
```

- [ ] **Step 2: Add @fastify/static dependency**

```bash
npm install --workspace=backend @fastify/static
```

- [ ] **Step 3: Write test for main.ts bootstrap**

```typescript
// apps/backend/src/__tests__/main.bootstrap.spec.ts
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';

describe('App bootstrap (Fastify)', () => {
  it('module compiles with Fastify adapter', async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    expect(module).toBeDefined();
  });
});
```

- [ ] **Step 4: Build and test**

Run: `cd apps/backend && npm run build`
Expected: Build succeeds

Run: `cd apps/backend && npm test`
Expected: All existing 121+ tests pass

---

### Task 3: Remove Express dependencies

**Files:**
- Modify: `apps/backend/package.json`

- [ ] **Step 1: Remove unused Express packages**

```bash
npm uninstall --workspace=backend @nestjs/platform-express compression cookie-parser helmet
npm uninstall --workspace=backend @types/express
```

Keep `@types/express` only if any test or type still references Express types.

- [ ] **Step 2: Verify build still works**

Run: `cd apps/backend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Run full test suite**

Run: `cd apps/backend && npm test`
Expected: All tests pass

---

### Task 4: Verify runtime behavior

- [ ] **Step 1: Start backend in dev mode**

Run: `cd apps/backend && npm run start:dev`
Expected: Server starts on port 4000

- [ ] **Step 2: Hit health endpoint**

Run: `curl -s http://localhost:4000/api/health | head -c 200`
Expected: Returns 200 OK

- [ ] **Step 3: Hit license endpoint**

Run: `curl -s http://localhost:4000/api/license/status | head -c 200`
Expected: Returns license status JSON

- [ ] **Step 4: Verify static file serving**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/uploads/`
Expected: 200 (uploads dir exists) or 404 (dir empty but Fastify responds)

- [ ] **Step 5: Verify CORS headers**

Run: `curl -s -I -H "Origin: http://localhost:5173" http://localhost:4000/api/health 2>&1 | grep -i "access-control"`
Expected: Shows Access-Control-Allow-Origin header

---

### Task 5: Update Dockerfile for Fastify

**Files:**
- Modify: `apps/backend/Dockerfile`

- [ ] **Step 1: No changes needed**

Dockerfile doesn't reference Express or Fastify — it just runs `node dist/src/main`. The compiled output uses whatever adapter is configured. No Dockerfile changes required.

---

### Task 6: Final verification

- [ ] **Step 1: Build production Docker image**

Run: `cd apps/backend && docker build -t ecomate-fastify-test .`
Expected: Build succeeds

- [ ] **Step 2: Check for any Express references**

Run: `grep -r "platform-express\|from 'express'\|require('express')\|compression\|cookie-parser" apps/backend/src/`
Expected: No matches (all Express references removed)

- [ ] **Step 3: Run full test suite one final time**

Run: `cd apps/backend && npm test`
Expected: All tests pass

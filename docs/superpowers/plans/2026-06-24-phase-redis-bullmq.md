# Phase 3: Redis & BullMQ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Add Redis as shared cache + queue broker. Set up BullMQ for async job processing. Migrate existing import job manager to BullMQ.

**Architecture:** Redis container in docker-compose. BullMQ processors as NestJS modules. Existing cache module backed by Redis. ThrottlerModule switched to Redis store.

**Tech Stack:** Redis 7, BullMQ, @nestjs/bullmq, ioredis

**Spec:** `docs/superpowers/specs/2026-06-24-ecomate-platform-transformation-design.md`

---

### Task 1: Install dependencies

- [ ] **Step 1: Install BullMQ + Redis packages**

```bash
npm install --workspace=backend @nestjs/bullmq bullmq ioredis
```

- [ ] **Step 2: Verify install**

Run: `npm ls @nestjs/bullmq bullmq ioredis`
Expected: resolves in workspace backend

---

### Task 2: Add Redis + BullMQ to AppModule

**Files:**
- Modify: `apps/backend/src/app.module.ts`
- Create: `apps/backend/src/queue/queue.module.ts`

- [ ] **Step 1: Read existing app.module.ts**

Read `apps/backend/src/app.module.ts` to understand current import structure.

- [ ] **Step 2: Create QueueModule**

```typescript
// apps/backend/src/queue/queue.module.ts
import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host: process.env['REDIS_HOST'] || 'localhost',
          port: Number(process.env['REDIS_PORT']) || 6379,
          password: process.env['REDIS_PASSWORD'] || undefined,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
```

- [ ] **Step 3: Register QueueModule in app.module.ts**

Add to imports array:
```typescript
import { QueueModule } from './queue/queue.module';
// ...
QueueModule,
```

- [ ] **Step 4: Write TDD test**

```typescript
// apps/backend/src/queue/__tests__/queue.module.spec.ts
import { Test } from '@nestjs/testing';
import { QueueModule } from '../queue.module';
import { BullModule } from '@nestjs/bullmq';

describe('QueueModule', () => {
  it('exports BullModule', async () => {
    const module = await Test.createTestingModule({
      imports: [QueueModule],
    }).compile();
    expect(module.get(BullModule)).toBeDefined();
  });
});
```

---

### Task 3: Create email queue

**Files:**
- Create: `apps/backend/src/queue/email-queue/email-queue.service.ts`
- Create: `apps/backend/src/queue/email-queue/email-queue.processor.ts`
- Create: `apps/backend/src/queue/email-queue/email-queue.module.ts`

- [ ] **Step 1: Create email queue service (producer)**

```typescript
// apps/backend/src/queue/email-queue/email-queue.service.ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface EmailJob {
  to: string;
  subject: string;
  template: string;
  context: Record<string, any>;
}

@Injectable()
export class EmailQueueService {
  constructor(@InjectQueue('email') private emailQueue: Queue) {}

  async send(data: EmailJob) {
    await this.emailQueue.add('send', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}
```

- [ ] **Step 2: Create email processor (consumer)**

```typescript
// apps/backend/src/queue/email-queue/email-queue.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EmailJob } from './email-queue.service';

@Processor('email')
export class EmailQueueProcessor extends WorkerHost {
  async process(job: Job<EmailJob>): Promise<void> {
    const { to, subject, template, context } = job.data;
    console.log(`[EmailQueue] Sending email to ${to}: ${subject}`);
    // TODO: Integrate with existing EmailService
    // await this.emailService.send(to, subject, template, context);
  }
}
```

- [ ] **Step 3: Create module**

```typescript
// apps/backend/src/queue/email-queue/email-queue.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailQueueService } from './email-queue.service';
import { EmailQueueProcessor } from './email-queue.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'email' }),
  ],
  providers: [EmailQueueService, EmailQueueProcessor],
  exports: [EmailQueueService],
})
export class EmailQueueModule {}
```

- [ ] **Step 4: Write TDD test**

```typescript
// apps/backend/src/queue/email-queue/__tests__/email-queue.service.spec.ts
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EmailQueueService } from '../email-queue.service';

describe('EmailQueueService', () => {
  let service: EmailQueueService;
  const mockQueue = { add: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmailQueueService,
        { provide: getQueueToken('email'), useValue: mockQueue },
      ],
    }).compile();
    service = module.get(EmailQueueService);
  });

  it('adds email job to queue', async () => {
    await service.send({ to: 'test@test.com', subject: 'Test', template: 'test', context: {} });
    expect(mockQueue.add).toHaveBeenCalledWith('send', expect.any(Object), expect.any(Object));
  });
});
```

---

### Task 4: Create import queue (migrate existing job manager)

**Files:**
- Create: `apps/backend/src/queue/import-queue/import-queue.service.ts`
- Create: `apps/backend/src/queue/import-queue/import-queue.processor.ts`
- Create: `apps/backend/src/queue/import-queue/import-queue.module.ts`
- Modify: `apps/backend/src/import/import.module.ts` — use queue instead of direct job manager

- [ ] **Step 1: Create import queue service**

```typescript
// apps/backend/src/queue/import-queue/import-queue.service.ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface ImportJob {
  type: 'products' | 'orders';
  filePath: string;
  userId: string;
}

@Injectable()
export class ImportQueueService {
  constructor(@InjectQueue('import') private importQueue: Queue) {}

  async schedule(data: ImportJob) {
    await this.importQueue.add('process', data);
  }
}
```

- [ ] **Step 2: Create import processor**

```typescript
// apps/backend/src/queue/import-queue/import-queue.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ImportJob } from './import-queue.service';

@Processor('import')
export class ImportQueueProcessor extends WorkerHost {
  async process(job: Job<ImportJob>): Promise<void> {
    console.log(`[ImportQueue] Processing ${job.data.type} import for user ${job.data.userId}`);
    // TODO: Call existing ImportService
  }
}
```

- [ ] **Step 3: Create module**

```typescript
// apps/backend/src/queue/import-queue/import-queue.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ImportQueueService } from './import-queue.service';
import { ImportQueueProcessor } from './import-queue.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'import' })],
  providers: [ImportQueueService, ImportQueueProcessor],
  exports: [ImportQueueService],
})
export class ImportQueueModule {}
```

---

### Task 5: Wire queues into main QueueModule

- [ ] **Step 1: Update QueueModule to import sub-queues**

```typescript
// apps/backend/src/queue/queue.module.ts
import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailQueueModule } from './email-queue/email-queue.module';
import { ImportQueueModule } from './import-queue/import-queue.module';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host: process.env['REDIS_HOST'] || 'localhost',
          port: Number(process.env['REDIS_PORT']) || 6379,
          password: process.env['REDIS_PASSWORD'] || undefined,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      }),
    }),
    EmailQueueModule,
    ImportQueueModule,
  ],
  exports: [BullModule, EmailQueueModule, ImportQueueModule],
})
export class QueueModule {}
```

---

### Task 6: Update CacheModule to use Redis

**Files:**
- Read: `apps/backend/src/cache/cache.module.ts`
- Read: `apps/backend/src/cache/cache.service.ts`
- Modify: `apps/backend/src/cache/cache.service.ts` — add Redis backing

- [ ] **Step 1: Read existing cache service**

Read the current cache module. Add Redis-backed implementation:

```typescript
import { Injectable, Optional } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class CacheService {
  private redis: Redis | null = null;

  constructor() {
    if (process.env['REDIS_HOST']) {
      this.redis = new Redis({
        host: process.env['REDIS_HOST'],
        port: Number(process.env['REDIS_PORT']) || 6379,
        password: process.env['REDIS_PASSWORD'],
        lazyConnect: true,
      });
      this.redis.connect().catch(() => {
        this.redis = null;
        console.warn('[Cache] Redis unavailable, using memory fallback');
      });
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.redis) return this.redis.get(key);
    return null; // fallback — no in-memory store for now
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.redis) {
      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, value);
      } else {
        await this.redis.set(key, value);
      }
    }
  }

  async del(key: string): Promise<void> {
    if (this.redis) await this.redis.del(key);
  }
}
```

---

### Task 7: Add Redis to docker-compose

**Files:**
- Modify: `docker-compose.yml` (root)

- [ ] **Step 1: Add Redis service**

```yaml
# Add to docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: redis-cli ping
      interval: 10s

volumes:
  redis-data:
```

---

### Task 8: Update env files

**Files:**
- Modify: `.env.example`
- Modify: `apps/backend/.env` (if exists)

- [ ] **Step 1: Add Redis env vars**

```bash
# .env.example
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

---

### Task 9: Final verification

- [ ] **Step 1: Build backend**

Run: `cd apps/backend && npm run build`
Expected: Build succeeds

- [ ] **Step 2: Run full test suite**

Run: `cd apps/backend && npm test`
Expected: All tests pass

- [ ] **Step 3: Verify BullModule connection config**

Run: `grep -r "REDIS_HOST\|REDIS_PORT\|BullModule" apps/backend/src/queue/`
Expected: Shows proper configuration wiring

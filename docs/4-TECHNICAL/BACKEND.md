# Backend Technical Guide

> **Status:** Draft — replaces `apps/backend/README.md`

## Stack

- NestJS 11 with Fastify adapter
- Prisma 7.9.1 + PostgreSQL
- Redis + BullMQ for queues
- License engine (N-API addon)

## Module Pattern

Each domain has: `controller.ts`, `service.ts`, `module.ts`, `dto/*.ts`

## Guards

- `LicenseGuard` — Global license validation
- `FeatureGuard` — Per-feature access control
- `AuthGuard` / `DualModeAuthGuard` — Authentication
# ADR 002: Fastify over Express (via NestJS Platform Adapter)

**Status:** Accepted  
**Date:** 2026-06 (Phase 2 timeline)  
**Decider:** Lead Architect  

## Context

NestJS defaults to Express as the HTTP adapter. Express is mature but slower than Fastify for JSON serialization and throughput. EcoMate serves as an ecommerce API that benefits from lower latency per request.

## Decision

Use **NestJS with Fastify platform adapter** (`@nestjs/platform-fastify`) instead of Express.

- Fastify provides 2-3x throughput for JSON endpoints  
- NestJS abstract the platform — most NestJS code is identical  
- Fastify ecosystem covers compression, helmet, CORS, multipart, static serving

## Consequences

- **Positive:** Higher request throughput, lower P99 latency  
- **Positive:** NestJS compatibility maintained via `NestFactory.create<NestFastifyApplication>()`  
- **Negative:** Some Express-only middleware not available (but Nest middleware layer works)  
- **Negative:** Slightly different API for raw request/response access  
- **Negative:** `@fastify/static` replaces `serve-static`

## Implementation

- `apps/backend/src/main.ts:1-246` — uses `NestFactory.create<NestFastifyApplication>()`  
- Fastify packages: `@fastify/helmet`, `@fastify/static`, `@fastify/cors`, `@fastify/compress`

## Alternatives

- **Express:** Better middleware ecosystem, larger community. Rejected for performance.  
- **Raw Fastify (no NestJS):** Faster but loses NestJS module system, DI, guards, interceptors. Rejected for architecture.

## Verification

Backend `main.ts` confirmed using `NestFastifyApplication`. All Fastify packages present in dependencies.
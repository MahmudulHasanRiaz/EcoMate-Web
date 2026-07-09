# Auth Domain

> **Status:** Draft  

## Auth Systems

- **Legacy JWT** — Original auth (passport/jwt strategy)
- **Better Auth** — New auth system (being migrated to)

## Current State

Dual-mode: `DualModeAuthGuard` accepts both auth systems. Migration in progress.

## Owns

- User authentication and session management
- Role-based access control (RBAC)
- Auth provider integration
- User profile management
- Dual auth migration (legacy → Better Auth)

## Depends On

- **Finance & HR** — Employee records are linked to User accounts

## Does NOT Own

- License or feature flag evaluation
- Product catalog or inventory
- Order lifecycle
- Any business domain data
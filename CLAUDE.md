@AGENTS.md

# EcoMate Monorepo

- `apps/backend`: NestJS 11, Fastify, Prisma 7, PostgreSQL, Redis/BullMQ
- `apps/admin`: React 19, Vite, TanStack Router/Query, Vitest/Playwright
- `apps/storefront`: Next.js 16, React Server Components, Vitest
- `apps/pos`: React 19 and Vite
- `packages/*`: shared types, feature flags, and license engine

# Working Agreement

- For non-trivial work, inspect the affected code and tests, state a short plan, implement the smallest coherent change, then verify it.
- Use Superpowers workflows when applicable: brainstorming and planning before broad changes, TDD for behavior changes, systematic debugging for failures, and verification before completion.
- Do not silently alter business rules, API contracts, database semantics, tenant boundaries, money calculations, stock ledgers, or order/payment state transitions.
- Never run production deployment, production migrations, destructive database operations, `git push`, or publish commands without explicit user approval.
- Treat `.env*`, API keys, payment credentials, session secrets, customer PII, and production data as sensitive. Never print or commit them.
- Preserve unrelated user changes. Do not rewrite or delete files merely to simplify a task.
- Prefer targeted tests while iterating; run the relevant app build/typecheck before claiming completion.

# Verification Commands

- Backend: `npm run build --workspace=backend` and targeted Jest tests
- Admin: `npm run build --workspace=admin` and targeted Vitest/Playwright tests
- Storefront: `npm run build --workspace=storefront` and `npm run test --workspace=storefront`
- POS: `npm run build --workspace=pos`
- Whole monorepo: `npm run build`

# Current Documentation

- This repository uses versions newer than many model training snapshots. Inspect installed package docs/types first, especially `node_modules/next/dist/docs/`, and use Context7 when local documentation is insufficient.

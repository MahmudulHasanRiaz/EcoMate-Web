# System-Settings Audit Report

## Findings & Fixes

| # | Issue | Severity | File | Line | Fix Applied |
|---|-------|----------|------|------|-------------|
| 1 | **SMTP password leaked in `getAll()`** | High | `controller.ts:179` | `getAll()` returned all settings including `smtp_pass` in plaintext to manager+ roles. | Masked `smtp_pass` as `********` (same pattern as `getSmtpSettings`) |
| 2 | **`testSmtp()` unhandled `verify()` rejection** | High | `controller.ts:677` | `transporter.verify()` threw uncaught error → 500 with raw nodemailer stack. | Wrapped in try/catch → `BadRequestException` with user-friendly message |
| 3 | **`set()` no key validation** | Medium | `controller.ts:519` | Empty/invalid `:key` param silently upserted invalid data. | Added `BadRequestException` if key is missing/empty |
| 4 | **`PUT /smtp` no body validation** | Medium | `controller.ts:617` | Empty body returned `{success: true}` with no DB writes (misleading). | Added check for at least one valid SMTP key in body |
| 5 | **`testSmtp()` 6 round trips** | Low | `controller.ts:642-659` | 6 individual `findUnique` calls instead of batch `findMany`. | Batched into single `findMany` with `where: { key: { in: keys } }` |

## Verified

- **TypeScript build**: No new errors (pre-existing errors in accounting, accounts, products, users modules untouched)
- **Fastify compatibility**: No `@Req()`/`@Res()` or Express imports — framework-agnostic `@nestjs/common` only
- **Tests**: Pre-existing Jest config issue with ESM prevents test run; tests unchanged

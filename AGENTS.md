# Repository-Wide Agent Rules

## Database Schema Changes — MANDATORY RULES

**ANY change to `schema.prisma` MUST be followed by an instant migration.**

### Hard Rules

1. **NEVER** commit a `schema.prisma` change without a corresponding migration file in `prisma/migrations/`
2. **ALWAYS** run `npx prisma migrate dev --name <descriptive_name>` immediately after any schema change
3. **ALWAYS** verify migration applied successfully before proceeding to code changes
4. **IF** `prisma migrate dev` reports drift, stop and diagnose it. **NEVER** run `prisma db push`, `prisma migrate reset`, or data-loss flags unless the database is confirmed disposable and the user explicitly approves
5. **NEVER** use `prisma db push` alone in production — it bypasses migration history
6. **ALWAYS** include both the schema change AND the migration file in the same commit
7. **IF** you cannot run migrations (no DB available), create the migration file manually in `prisma/migrations/<timestamp>_<name>/migration.sql` and note in the PR that `prisma migrate deploy` must be run

### Migration Workflow

```
schema.prisma changed
  ↓
npx prisma migrate dev --name <name>
  ↓
Verify migration.sql content is correct
  ↓
npx prisma generate (regenerate client)
  ↓
Proceed with code changes
  ↓
Commit: schema.prisma + migration files + generated client
```

### Database Drift Safety

If drift is detected:

1. Stop before changing either the database or migration history
2. Capture `prisma migrate status` and the exact drift error
3. Confirm whether the target is a disposable local database, staging, or production
4. Prefer a reviewed migration created with `prisma migrate dev --create-only` or `prisma migrate diff`
5. Require explicit user approval before `db push`, `migrate reset`, destructive SQL, or any data-loss flag
6. Use `prisma migrate deploy` only through the staging/production deployment workflow

## Code Quality Rules

- Run `npx nest build` after backend changes
- Run `npx tsc --noEmit` after frontend changes
- No new TypeScript errors allowed in modified files

## Commit Rules

- Schema changes + migration = single atomic commit
- Never separate schema from its migration

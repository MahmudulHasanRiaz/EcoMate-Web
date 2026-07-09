# Repository-Wide Agent Rules

## Database Schema Changes — MANDATORY RULES

**ANY change to `schema.prisma` MUST be followed by an instant migration.**

### Hard Rules

1. **NEVER** commit a `schema.prisma` change without a corresponding migration file in `prisma/migrations/`
2. **ALWAYS** run `npx prisma migrate dev --name <descriptive_name>` immediately after any schema change
3. **ALWAYS** verify migration applied successfully before proceeding to code changes
4. **IF** `prisma migrate dev` fails due to drift, run `npx prisma db push` first, then create the migration manually using `prisma migrate diff`
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

### Emergency: DB Drift

If drift is detected and you cannot reset:
```bash
# 1. Push schema directly
npx prisma db push

# 2. Generate diff for manual migration
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource "postgresql://..." --script

# 3. Create migration directory and file manually
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_<name>
# Write the SQL output to migration.sql
```

## Code Quality Rules

- Run `npx nest build` after backend changes
- Run `npx tsc --noEmit` after frontend changes
- No new TypeScript errors allowed in modified files

## Commit Rules

- Schema changes + migration = single atomic commit
- Never separate schema from its migration

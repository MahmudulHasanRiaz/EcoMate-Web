---
paths:
  - "apps/backend/src/**/*.ts"
  - "apps/backend/test/**/*.ts"
---

# Backend Rules

- Use DTOs with `class-validator` for request input.
- Preserve the established `@Roles()` and `@RequiresFeature()` authorization model on protected endpoints.
- Use `PrismaService.$transaction` when one business action performs multiple dependent writes.
- Keep controllers thin; business invariants belong in services.
- Follow existing module, exception, pagination, and response patterns before introducing a new abstraction.
- Add or update targeted Jest tests for behavior changes and regressions.
- Run `npm run build --workspace=backend` before completion.

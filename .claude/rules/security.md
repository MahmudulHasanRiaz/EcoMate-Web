---
paths:
  - "apps/backend/src/auth/**/*"
  - "apps/backend/src/better-auth/**/*"
  - "apps/backend/src/common/guards/**/*"
  - "apps/backend/src/common/permissions/**/*"
  - "apps/backend/src/gateways/**/*"
  - "apps/backend/src/payments/**/*"
  - "apps/backend/src/users/**/*"
  - "apps/storefront/app/(main)/checkout/**/*"
  - "apps/storefront/app/(main)/account/**/*"
---

# Security Rules

- Enforce authentication, role/feature authorization, and tenant/resource ownership on the server.
- Validate and normalize all external input; do not rely on TypeScript types at runtime.
- Never log credentials, tokens, password material, payment secrets, full session identifiers, or unnecessary customer PII.
- Preserve CSRF, cookie, rate-limit, upload, redirect, and HTML sanitization protections.
- Use constant-time, maintained library primitives for secrets and signatures; do not invent cryptography.
- Add negative tests for unauthenticated, unauthorized, cross-tenant, replay, malformed-input, and duplicate-request cases when relevant.
